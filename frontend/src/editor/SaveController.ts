/**
 * Autosave state machine for ONE open document. Framework-free so it can be unit-tested with
 * fake timers; React subscribes via useSyncExternalStore (see useDocumentAutosave).
 *
 * Guarantees
 * - At most one content request in flight. Edits made meanwhile are sent as a follow-up.
 * - `localRev` counts edits, `savedRev` is the newest edit the server has confirmed, so
 *   "saved" is only reported when nothing newer exists locally.
 * - Server responses never write content into the editor (a stale response can't clobber text).
 * - Every save is a compare-and-swap on `version`; a transient failure retries the *identical*
 *   attempt (same content, version, save_id) with capped backoff, so a lost response is
 *   acknowledged idempotently by the server instead of producing a false conflict.
 * - 409 -> `conflict`, 401/403/404/400/413 -> `blocked`: no automatic retries, draft kept.
 * - After dispose() nothing (late responses, timers) touches state.
 */

export type SaveStatus =
  | 'idle' // opened, untouched
  | 'dirty' // local edits waiting for the debounce
  | 'saving'
  | 'saved'
  | 'retrying' // transient failure, backoff timer running
  | 'offline' // retries exhausted; waiting for "Retry now" / the browser coming back online
  | 'conflict' // server has a newer version; user must decide
  | 'blocked' // server refused (no access / view-only / signed out / invalid)
  | 'disposed'

export type BlockedReason = 'revoked' | 'forbidden' | 'unauthenticated' | 'invalid'

export interface ConflictInfo {
  remoteHtml: string
  remoteVersion: number
  editedBy: string | null
}

export interface SaveRequest {
  content: string
  version: number
  save_id: string
}

/** Must resolve with the new version, or reject with something carrying an HTTP `status`
 *  (0 = network) and, for 409, `body.current`. ApiError satisfies this. */
export type SendFn = (req: SaveRequest) => Promise<{ version: number }>

export type LeaveState = 'none' | 'waiting' | 'ready' | 'cancelled' | 'stuck'

export interface SaveSnapshot {
  status: SaveStatus
  isDirty: boolean
  blockedReason: BlockedReason | null
  message: string | null
  conflict: ConflictInfo | null
  retryInMs: number | null
  lastSavedAt: number | null
  leave: LeaveState
}

export interface SaveControllerOptions {
  initialVersion: number
  initialHtml: string
  send: SendFn
  debounceMs?: number
  maxWaitMs?: number
  retryDelaysMs?: number[]
  jitter?: (delayMs: number) => number
  newId?: () => string
  now?: () => number
}

interface Attempt {
  rev: number
  html: string
  version: number
  saveId: string
}

const TRANSIENT = (status: number) => status === 0 || status === 408 || status === 429 || status >= 500

export class SaveController {
  private readonly send: SendFn
  private readonly debounceMs: number
  private readonly maxWaitMs: number
  private readonly retryDelaysMs: number[]
  private readonly jitter: (d: number) => number
  private readonly newId: () => string
  private readonly now: () => number

  private localRev = 0
  private savedRev = 0
  private serverVersion: number
  private latestHtml: string
  private inFlight: Attempt | null = null
  private retryAttempt: Attempt | null = null
  private retryCount = 0
  private retryAt: number | null = null
  private firstDirtyAt: number | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private navRev: number | null = null

  private status: SaveStatus = 'idle'
  private blockedReason: BlockedReason | null = null
  private message: string | null = null
  private conflict: ConflictInfo | null = null
  private lastSavedAt: number | null = null

  private listeners = new Set<() => void>()
  private snapshot: SaveSnapshot

  constructor(opts: SaveControllerOptions) {
    this.send = opts.send
    this.serverVersion = opts.initialVersion
    this.latestHtml = opts.initialHtml
    this.debounceMs = opts.debounceMs ?? 1000
    this.maxWaitMs = opts.maxWaitMs ?? 8000
    this.retryDelaysMs = opts.retryDelaysMs ?? [2000, 4000, 8000, 16000, 30000]
    this.jitter = opts.jitter ?? ((d) => d + Math.round(Math.random() * 0.2 * d))
    this.newId = opts.newId ?? (() => crypto.randomUUID())
    this.now = opts.now ?? (() => Date.now())
    this.snapshot = this.buildSnapshot()
  }

  // --- React integration -------------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getSnapshot = () => this.snapshot

  // --- queries -------------------------------------------------------------------
  get isDirty() {
    return this.localRev > this.savedRev || this.inFlight !== null || this.retryAttempt !== null
  }

  /** Safe to navigate away: everything saved, nothing in flight, no unresolved state. */
  canLeave() {
    return !this.isDirty && this.status !== 'conflict' && this.status !== 'blocked'
  }

  /** The current local draft (for "copy my draft"). */
  get draftHtml() {
    return this.latestHtml
  }

  // --- user actions ----------------------------------------------------------------
  edit(html: string) {
    if (this.status === 'disposed') return
    this.localRev++
    this.latestHtml = html
    if (this.status === 'conflict' || this.status === 'blocked') return this.emit() // keep draft only
    if (this.inFlight || this.retryAttempt) return this.emit() // follow-up after current attempt
    this.status = 'dirty'
    this.scheduleDebounce()
    this.emit()
  }

  /** Save now (debounce bypass). No-op while a request is in flight or a decision is pending. */
  flushNow() {
    if (this.status === 'disposed' || this.status === 'conflict' || this.status === 'blocked') return
    if (this.inFlight) return
    if (this.retryAttempt) return this.retryNow()
    if (this.localRev === this.savedRev) return
    this.dispatch()
  }

  /** Manual retry (button / browser back online). Restarts the backoff schedule. */
  retryNow() {
    if (!this.retryAttempt || this.inFlight || this.status === 'disposed') return
    this.clearRetryTimer()
    this.retryCount = 0
    this.dispatch()
  }

  /** Conflict resolution: keep the local draft and replace the server copy (still a CAS). */
  overwrite() {
    if (this.status !== 'conflict' || !this.conflict) return
    this.serverVersion = this.conflict.remoteVersion
    this.conflict = null
    this.status = 'dirty'
    this.dispatch()
  }

  /**
   * Conflict resolution: the editor now shows `html` (set programmatically WITHOUT emitting an
   * update) at server `version`. Everything local is considered superseded.
   */
  adopt(version: number, html: string) {
    if (this.status === 'disposed') return
    this.clearDebounce()
    this.clearRetryTimer()
    this.retryAttempt = null
    this.conflict = null
    this.serverVersion = version
    this.latestHtml = html
    this.savedRev = this.localRev
    this.status = 'saved'
    this.emit()
  }

  // --- navigation guard ------------------------------------------------------------
  /** A navigation was blocked: remember the revision and try to save it. */
  beginLeave() {
    this.navRev = this.localRev
    this.flushNow()
    this.emit()
  }

  endLeave() {
    this.navRev = null
    this.emit()
  }

  private leaveState(): LeaveState {
    if (this.navRev === null) return 'none'
    if (this.localRev !== this.navRev) return 'cancelled' // user kept typing: require a new decision
    if (this.canLeave()) return 'ready'
    if (this.status === 'conflict' || this.status === 'blocked' || this.status === 'offline') return 'stuck'
    return 'waiting'
  }

  dispose() {
    this.clearDebounce()
    this.clearRetryTimer()
    this.status = 'disposed'
    this.listeners.clear()
  }

  // --- internals ------------------------------------------------------------------
  private scheduleDebounce() {
    const now = this.now()
    if (this.firstDirtyAt === null) this.firstDirtyAt = now
    const remainingMaxWait = this.maxWaitMs - (now - this.firstDirtyAt)
    this.clearDebounce()
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.flushNow()
    }, Math.max(0, Math.min(this.debounceMs, remainingMaxWait)))
  }

  private dispatch() {
    this.clearDebounce()
    this.firstDirtyAt = null
    const attempt: Attempt = this.retryAttempt ?? {
      rev: this.localRev,
      html: this.latestHtml,
      version: this.serverVersion,
      saveId: this.newId(),
    }
    this.retryAttempt = null
    this.retryAt = null
    this.inFlight = attempt
    this.status = 'saving'
    this.emit()
    this.send({ content: attempt.html, version: attempt.version, save_id: attempt.saveId }).then(
      (res) => this.onSuccess(attempt, res.version),
      (err) => this.onError(attempt, err),
    )
  }

  private onSuccess(attempt: Attempt, version: number) {
    if (this.status === 'disposed' || this.inFlight !== attempt) return
    this.inFlight = null
    this.retryCount = 0
    this.serverVersion = version
    this.savedRev = Math.max(this.savedRev, attempt.rev)
    this.lastSavedAt = this.now()
    this.message = null
    if (this.localRev > this.savedRev) {
      this.dispatch() // edits arrived while saving: send them now
      return
    }
    this.status = 'saved'
    this.emit()
  }

  private onError(attempt: Attempt, err: unknown) {
    if (this.status === 'disposed' || this.inFlight !== attempt) return
    this.inFlight = null
    const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 0
    const message = err instanceof Error ? err.message : null

    if (status === 409) {
      const current = (err as { body?: { current?: { content: string; version: number; last_edited_by: { name: string } | null } } })
        .body?.current
      this.status = 'conflict'
      this.conflict = {
        remoteHtml: current?.content ?? '',
        remoteVersion: current?.version ?? attempt.version,
        editedBy: current?.last_edited_by?.name ?? null,
      }
      this.message = message
      this.clearDebounce()
      return this.emit()
    }

    if (!TRANSIENT(status)) {
      this.status = 'blocked'
      this.blockedReason =
        status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 404 ? 'revoked' : 'invalid'
      this.message = message
      this.clearDebounce()
      return this.emit()
    }

    // Transient: retry the identical attempt with capped backoff.
    this.retryAttempt = attempt
    this.message = message
    if (this.retryCount >= this.retryDelaysMs.length) {
      this.status = 'offline'
      this.retryAt = null
      return this.emit()
    }
    const delay = this.jitter(this.retryDelaysMs[this.retryCount])
    this.retryCount++
    this.status = 'retrying'
    this.retryAt = this.now() + delay
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.retryAttempt && !this.inFlight && this.status === 'retrying') this.dispatch()
    }, delay)
    this.emit()
  }

  private clearDebounce() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = null
  }

  private clearRetryTimer() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private buildSnapshot(): SaveSnapshot {
    return {
      status: this.status,
      isDirty: this.isDirty,
      blockedReason: this.status === 'blocked' ? this.blockedReason : null,
      message: this.message,
      conflict: this.conflict,
      retryInMs: this.retryAt === null ? null : Math.max(0, this.retryAt - this.now()),
      lastSavedAt: this.lastSavedAt,
      leave: this.leaveState(),
    }
  }

  private emit() {
    if (this.status === 'disposed') return
    this.snapshot = this.buildSnapshot()
    this.listeners.forEach((fn) => fn())
  }
}
