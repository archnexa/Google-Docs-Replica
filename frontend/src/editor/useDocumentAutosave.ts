import { useEffect, useState, useSyncExternalStore } from 'react'
import { api } from '../api/endpoints'
import { SaveController, type SaveSnapshot } from './SaveController'

const IDLE: SaveSnapshot = {
  status: 'idle',
  isDirty: false,
  blockedReason: null,
  message: null,
  conflict: null,
  retryInMs: null,
  lastSavedAt: null,
  leave: 'none',
}
const noopSubscribe = () => () => {}

/**
 * One SaveController per mounted editor. It is created in an effect and disposed in the
 * cleanup, so React StrictMode's mount → unmount → mount yields a fresh controller and the
 * disposed one ignores any late responses (no duplicate saves).
 */
export function useDocumentAutosave(docId: string, initialVersion: number, initialHtml: string) {
  const [controller, setController] = useState<SaveController | null>(null)

  useEffect(() => {
    const c = new SaveController({
      initialVersion,
      initialHtml,
      send: (req) => api.saveContent(docId, req),
    })
    // Creating/disposing an external object is what effects are for; the controller must not
    // outlive this mount (StrictMode would otherwise reuse a disposed instance).
    // oxlint-disable-next-line react/set-state-in-effect
    setController(c)

    const onOnline = () => c.retryNow()
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      c.dispose()
    }
    // initialVersion/initialHtml are only the starting point for this mount.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [docId])

  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? (() => IDLE),
  )
  return { controller, snapshot }
}

/** Warn on tab close / reload while anything is unsaved or unresolved. */
export function useBeforeUnload(controller: SaveController | null) {
  useEffect(() => {
    if (!controller) return
    const handler = (e: BeforeUnloadEvent) => {
      if (controller.canLeave()) return
      controller.flushNow() // best effort
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [controller])
}
