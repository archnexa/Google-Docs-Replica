import type { SaveSnapshot } from './SaveController'

/** Honest status: "All changes saved" only when the server has confirmed the latest edit. */
export function SaveStatus({ snap, readOnly }: { snap: SaveSnapshot; readOnly: boolean }) {
  if (readOnly) return <span className="save-status" data-tone="warn">View only</span>

  let text: string
  let tone: 'ok' | 'warn' | 'error' | 'muted' = 'muted'
  switch (snap.status) {
    case 'idle':
      text = 'Saved'
      tone = 'ok'
      break
    case 'saved':
      text = snap.isDirty ? 'Unsaved changes' : 'All changes saved'
      tone = snap.isDirty ? 'muted' : 'ok'
      break
    case 'dirty':
      text = 'Unsaved changes'
      break
    case 'saving':
      text = 'Saving…'
      break
    case 'retrying':
      text = `Connection problem — retrying${snap.retryInMs ? ` in ${Math.ceil(snap.retryInMs / 1000)}s` : ''}`
      tone = 'warn'
      break
    case 'offline':
      text = 'Offline — changes not saved'
      tone = 'error'
      break
    case 'conflict':
      text = 'Not saved — conflict'
      tone = 'error'
      break
    case 'blocked':
      text = 'Not saved'
      tone = 'error'
      break
    default:
      text = ''
  }
  return (
    <span className="save-status" data-tone={tone} role="status" aria-live="polite">
      {text}
    </span>
  )
}
