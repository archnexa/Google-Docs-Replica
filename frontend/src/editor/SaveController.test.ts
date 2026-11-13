import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SaveController, type SaveRequest } from './SaveController'

/** A `send` whose calls stay pending until the test resolves/rejects them. */
function controllableSend() {
  const calls: { req: SaveRequest; resolve: (v: { version: number }) => void; reject: (e: unknown) => void }[] = []
  const send = vi.fn(
    (req: SaveRequest) =>
      new Promise<{ version: number }>((resolve, reject) => {
        calls.push({ req, resolve, reject })
      }),
  )
  return { send, calls }
}

const httpError = (status: number, body?: unknown) => Object.assign(new Error(`HTTP ${status}`), { status, body })
const flush = () => vi.advanceTimersByTimeAsync(0)

let ids = 0
function make(send: ReturnType<typeof controllableSend>['send'], overrides = {}) {
  return new SaveController({
    initialVersion: 1,
    initialHtml: '<p>start</p>',
    send,
    debounceMs: 1000,
    maxWaitMs: 8000,
    retryDelaysMs: [2000, 4000],
    jitter: (d) => d,
    newId: () => `id-${++ids}`,
    ...overrides,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  ids = 0
})
afterEach(() => vi.useRealTimers())

describe('debounce and single flight', () => {
  it('does not save until typing pauses for the debounce window', async () => {
    const { send } = controllableSend()
    const c = make(send)
    c.edit('<p>a</p>')
    await vi.advanceTimersByTimeAsync(600)
    c.edit('<p>ab</p>')
    await vi.advanceTimersByTimeAsync(600)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toEqual({ content: '<p>ab</p>', version: 1, save_id: 'id-1' })
  })

  it('max-wait forces a save during continuous typing', async () => {
    const { send } = controllableSend()
    const c = make(send)
    for (let t = 0; t < 8500; t += 500) {
      c.edit(`<p>${t}</p>`)
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('keeps at most one request in flight and sends edits made meanwhile as a follow-up', async () => {
    const { send, calls } = controllableSend()
    const c = make(send)
    c.edit('<p>one</p>')
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toHaveLength(1)

    c.edit('<p>two</p>')
    await vi.advanceTimersByTimeAsync(5000)
    c.flushNow()
    expect(calls).toHaveLength(1) // still only the first one

    calls[0].resolve({ version: 2 })
    await flush()
    expect(calls).toHaveLength(2) // follow-up immediately, using the new server version
    expect(calls[1].req).toMatchObject({ content: '<p>two</p>', version: 2 })
    expect(c.getSnapshot().status).toBe('saving')

    calls[1].resolve({ version: 3 })
    await flush()
    expect(c.getSnapshot()).toMatchObject({ status: 'saved', isDirty: false })
  })

  it('never reports saved while newer local edits exist (stale response)', async () => {
    const { send, calls } = controllableSend()
    const c = make(send)
    c.edit('<p>one</p>')
    await vi.advanceTimersByTimeAsync(1000)
    c.edit('<p>two</p>') // typed while request 1 was in flight
    calls[0].resolve({ version: 2 })
    await flush()
    const snap = c.getSnapshot()
    expect(snap.status).not.toBe('saved')
    expect(snap.isDirty).toBe(true)
    expect(c.draftHtml).toBe('<p>two</p>') // response did not replace local content
  })

  it('flushNow saves immediately and is a no-op when nothing changed', async () => {
    const { send } = controllableSend()
    const c = make(send)
    c.flushNow()
    expect(send).not.toHaveBeenCalled()
    c.edit('<p>x</p>')
    c.flushNow()
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('conflicts', () => {
  const conflictBody = (version: number, content: string) => ({
    current: { version, content, last_edited_by: { name: 'Bob' } },
  })

  it('409 enters conflict, keeps the draft and stops saving', async () => {
    const { send, calls } = controllableSend()
    const c = make(send)
    c.edit('<p>mine</p>')
    await vi.advanceTimersByTimeAsync(1000)
    calls[0].reject(httpError(409, conflictBody(5, '<p>theirs</p>')))
    await flush()

    expect(c.getSnapshot()).toMatchObject({
      status: 'conflict',
      conflict: { remoteHtml: '<p>theirs</p>', remoteVersion: 5, editedBy: 'Bob' },
    })
    c.edit('<p>mine, more</p>')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(c.draftHtml).toBe('<p>mine, more</p>')
    expect(c.canLeave()).toBe(false)
  })

  it('overwrite resends the draft conditionally on the remote version; a second 409 re-enters conflict', async () => {
    const { send, calls } = controllableSend()
    const c = make(send)
    c.edit('<p>mine</p>')
    await vi.advanceTimersByTimeAsync(1000)
    calls[0].reject(httpError(409, conflictBody(5, '<p>theirs</p>')))
    await flush()

    c.overwrite()
    expect(calls[1].req).toMatchObject({ content: '<p>mine</p>', version: 5 })
    calls[1].reject(httpError(409, conflictBody(6, '<p>theirs again</p>')))
    await flush()
    expect(c.getSnapshot()).toMatchObject({ status: 'conflict', conflict: { remoteVersion: 6 } })

    c.overwrite()
    calls[2].resolve({ version: 7 })
    await flush()
    expect(c.getSnapshot()).toMatchObject({ status: 'saved', isDirty: false })
  })

  it('adopt (load their version) clears local dirtiness at the remote version', async () => {
    const { send, calls } = controllableSend()
    const c = make(send)
    c.edit('<p>mine</p>')
    await vi.advanceTimersByTimeAsync(1000)
    calls[0].reject(httpError(409, conflictBody(5, '<p>theirs</p>')))
    await flush()

    c.adopt(5, '<p>theirs</p>')
    expect(c.getSnapshot()).toMatchObject({ status: 'saved', isDirty: false, conflict: null })
    c.edit('<p>theirs + me</p>')
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls[1].req).toMatchObject({ version: 5 })
  })
})

describe('blocked responses are not retried', () => {
  it.each([
    [404, 'revoked'],
    [403, 'forbidden'],
    [401, 'unauthenticated'],
    [400, 'invalid'],
    [413, 'invalid'],
  ] as const)('%i -> blocked/%s, no further sends, draft kept', async (status, reason) => {
    const { send, calls } = controllableSend()
    const c = make(send)
    c.edit('<p>draft</p>')
    await vi.advanceTimersByTimeAsync(1000)
    calls[0].reject(httpError(status))
    await flush()

    expect(c.getSnapshot()).toMatchObject({ status: 'blocked', blockedReason: reason })
    c.edit('<p>draft 2</p>')
    c.flushNow()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(c.draftHtml).toBe('<p>draft 2</p>')
    expect(c.canLeave()).toBe(false)
  })
})

describe('transient failures', () => {
  it('retries the identical attempt (same save_id) with backoff, then goes offline', async () => {
    const { send, calls } = controllableSend()
    const c = make(send)
    c.edit('<p>draft</p>')
    await vi.advanceTimersByTimeAsync(1000)
    calls[0].reject(httpError(0))
    await flush()
    expect(c.getSnapshot()).toMatchObject({ status: 'retrying', retryInMs: 2000 })

    c.edit('<p>draft + more</p>') // edits during backoff do not change the retried attempt
    await vi.advanceTimersByTimeAsync(1999)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls[1].req).toEqual(calls[0].req)

    calls[1].reject(httpError(503))
    await flush()
    await vi.advanceTimersByTimeAsync(4000)
    expect(calls[2].req).toEqual(calls[0].req)
    calls[2].reject(httpError(0))
    await flush()
    expect(c.getSnapshot().status).toBe('offline')
    await vi.advanceTimersByTimeAsync(600_000)
    expect(calls).toHaveLength(3) // no infinite retries

    c.retryNow()
    expect(calls[3].req).toEqual(calls[0].req)
    calls[3].resolve({ version: 2 })
    await flush()
    // the edit made during backoff goes out as a follow-up
    expect(calls[4].req).toMatchObject({ content: '<p>draft + more</p>', version: 2 })
  })
})

describe('navigation guard', () => {
  it('canLeave is false while dirty, in flight, or retrying', async () => {
    const { send, calls } = controllableSend()
    const c = make(send)
    expect(c.canLeave()).toBe(true)
    c.edit('<p>x</p>')
    expect(c.canLeave()).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(c.canLeave()).toBe(false) // in flight
    calls[0].reject(httpError(0))
    await flush()
    expect(c.canLeave()).toBe(false) // retrying
  })

  it('pending navigation becomes ready once the latest revision is saved', async () => {
    const { send, calls } = controllableSend()
    const c = make(send)
    c.edit('<p>x</p>')
    c.beginLeave() // flushes immediately
    expect(c.getSnapshot().leave).toBe('waiting')
    calls[0].resolve({ version: 2 })
    await flush()
    expect(c.getSnapshot().leave).toBe('ready')
  })

  it('typing while a navigation is pending cancels it', async () => {
    const { send, calls } = controllableSend()
    const c = make(send)
    c.edit('<p>x</p>')
    c.beginLeave()
    c.edit('<p>xy</p>')
    expect(c.getSnapshot().leave).toBe('cancelled')
    calls[0].resolve({ version: 2 })
    await flush()
    expect(c.getSnapshot().leave).toBe('cancelled') // never auto-proceeds
  })

  it('pending navigation is stuck on conflict / blocked / offline', async () => {
    const { send, calls } = controllableSend()
    const c = make(send)
    c.edit('<p>x</p>')
    c.beginLeave()
    calls[0].reject(httpError(404))
    await flush()
    expect(c.getSnapshot().leave).toBe('stuck')
  })
})

describe('lifecycle', () => {
  it('a late response after dispose changes nothing and notifies no one', async () => {
    const { send, calls } = controllableSend()
    const c = make(send)
    const listener = vi.fn()
    c.subscribe(listener)
    c.edit('<p>x</p>')
    await vi.advanceTimersByTimeAsync(1000)
    listener.mockClear()

    c.dispose()
    calls[0].resolve({ version: 2 })
    await flush()
    c.edit('<p>after</p>')
    await vi.advanceTimersByTimeAsync(10_000)

    expect(listener).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
    expect(c.getSnapshot().status).not.toBe('saved')
  })

  it('dispose cancels a pending debounce', async () => {
    const { send } = controllableSend()
    const c = make(send)
    c.edit('<p>x</p>')
    c.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(send).not.toHaveBeenCalled()
  })
})
