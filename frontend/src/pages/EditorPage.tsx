import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { api } from '../api/endpoints'
import type { DocumentDetail } from '../api/types'
import { TopBar } from '../components/TopBar'
import { DocumentEditor } from '../editor/DocumentEditor'
import NotFoundPage from './NotFoundPage'

type Loaded = { id: string } & ({ doc: DocumentDetail } | { error: ApiError | Error })

/** Route wrapper: remount everything per document id so no state leaks between documents. */
export default function EditorRoute() {
  const { id = '' } = useParams()
  return <EditorPage key={id} docId={id} />
}

function EditorPage({ docId }: { docId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    api
      .getDocument(docId, ctrl.signal)
      .then((doc) => setLoaded({ id: docId, doc }))
      .catch((error) => {
        if (!ctrl.signal.aborted) setLoaded({ id: docId, error })
      })
    return () => ctrl.abort()
  }, [docId, attempt])

  if (!loaded || loaded.id !== docId) {
    return (
      <>
        <TopBar />
        <div className="page-loading">Opening document…</div>
      </>
    )
  }
  if ('error' in loaded) {
    const err = loaded.error
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
      return (
        <>
          <TopBar />
          <NotFoundPage message="This document doesn't exist, or it hasn't been shared with you." />
        </>
      )
    }
    return (
      <>
        <TopBar />
        <div className="center-page">
          <p className="muted">{err.message || 'Could not open the document.'}</p>
          <button className="btn" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      </>
    )
  }
  // The editor is created only after the document is loaded, with its content as the initial
  // state, so loading never counts as an edit and never triggers a save.
  return <DocumentEditor doc={loaded.doc} />
}
