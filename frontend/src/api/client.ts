import type { ApiErrorPayload } from './types'

/**
 * Thin fetch wrapper.
 * - Auth: `Authorization: Bearer <token>` (same scheme as the Django auth class and smoke.sh).
 * - Errors: every non-2xx becomes an ApiError carrying the server's {code, message} envelope.
 *   Network failures / timeouts become ApiError with status 0 so callers can tell
 *   "retry later" apart from "the server said no".
 */

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const TOKEN_KEY = 'ajaia.token'
const DEFAULT_TIMEOUT_MS = 75_000 // free-tier cold starts can take ~1 minute
const SLOW_REQUEST_MS = 3_000

export class ApiError extends Error {
  status: number
  code: string
  body: unknown

  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }

  get isNetwork() {
    return this.status === 0
  }

  get fields(): Record<string, string[]> | undefined {
    return (this.body as { error?: ApiErrorPayload } | undefined)?.error?.fields
  }
}

// --- token storage (localStorage may throw in private modes) -----------------
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore: session just won't survive a reload */
  }
}

// --- global listeners ---------------------------------------------------------
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

type SlowListener = (slow: boolean) => void
const slowListeners = new Set<SlowListener>()
let slowCount = 0
export function subscribeSlowRequests(fn: SlowListener) {
  slowListeners.add(fn)
  return () => {
    slowListeners.delete(fn)
  }
}
function bumpSlow(delta: number) {
  const before = slowCount > 0
  slowCount += delta
  const after = slowCount > 0
  if (before !== after) slowListeners.forEach((fn) => fn(after))
}

// --- request ------------------------------------------------------------------
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  json?: unknown
  form?: FormData
  signal?: AbortSignal
  timeoutMs?: number
  /** Don't trigger the global "signed out" redirect on 401 (editor keeps the draft instead). */
  keepSessionOn401?: boolean
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.json)
  } else if (opts.form) {
    body = opts.form
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const onAbort = () => controller.abort(opts.signal?.reason)
  opts.signal?.addEventListener('abort', onAbort)
  let markedSlow = false
  const slowTimer = setTimeout(() => {
    markedSlow = true
    bumpSlow(1)
  }, SLOW_REQUEST_MS)

  let resp: Response
  try {
    resp = await fetch(`${API_BASE}${path}`, { method: opts.method ?? 'GET', headers, body, signal: controller.signal })
  } catch (err) {
    if (opts.signal?.aborted) throw err // caller cancelled: propagate AbortError
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection.')
  } finally {
    clearTimeout(timeout)
    clearTimeout(slowTimer)
    opts.signal?.removeEventListener('abort', onAbort)
    if (markedSlow) bumpSlow(-1)
  }

  if (resp.status === 204) return undefined as T
  let data: unknown = null
  try {
    data = await resp.json()
  } catch {
    data = null
  }
  if (!resp.ok) {
    const payload = (data as { error?: ApiErrorPayload } | null)?.error
    const err = new ApiError(
      resp.status,
      payload?.code ?? (resp.status >= 500 ? 'server_error' : 'error'),
      payload?.message ?? (resp.status >= 500 ? 'The server had a problem. Please try again.' : `Request failed (${resp.status}).`),
      data,
    )
    if (resp.status === 401 && !opts.keepSessionOn401) onUnauthorized?.()
    throw err
  }
  return data as T
}
