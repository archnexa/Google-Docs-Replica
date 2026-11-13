import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { api } from '../api/endpoints'
import type { DocumentSummary } from '../api/types'
import { ConfirmDialog } from '../components/Modal'
import { TopBar } from '../components/TopBar'
import { relativeTime } from '../lib/format'

type Scope = 'owned' | 'shared'

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; docs: DocumentSummary[] }

type Loaded = { key: string } & ({ docs: DocumentSummary[] } | { error: string })

export default function DashboardPage() {
  const [params, setParams] = useSearchParams()
  const scope: Scope = params.get('tab') === 'shared' ? 'shared' : 'owned'
  const [reloadKey, setReloadKey] = useState(0)
  const requestKey = `${scope}:${reloadKey}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [creating, setCreating] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<DocumentSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const navigate = useNavigate()

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    const ctrl = new AbortController()
    api
      .listDocuments(scope, ctrl.signal)
      .then((docs) => setLoaded({ key: requestKey, docs }))
      .catch((err) => {
        if (ctrl.signal.aborted) return
        setLoaded({ key: requestKey, error: err instanceof ApiError ? err.message : 'Could not load documents.' })
      })
    return () => ctrl.abort()
  }, [scope, requestKey])

  // Loading is derived: anything not loaded for the current tab/reload is still loading.
  const list: ListState =
    !loaded || loaded.key !== requestKey
      ? { status: 'loading' }
      : 'docs' in loaded
        ? { status: 'ready', docs: loaded.docs }
        : { status: 'error', message: loaded.error }

  async function createDoc() {
    setCreating(true)
    setActionError(null)
    try {
      const doc = await api.createDocument()
      navigate(`/d/${doc.id}`)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not create a document.')
      setCreating(false)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.deleteDocument(toDelete.id)
      setToDelete(null)
      reload()
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete the document.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <TopBar />
      <main className="dashboard">
        <div className="dash-head">
          <h1>Documents</h1>
          <button className="btn btn-primary" onClick={createDoc} disabled={creating}>
            {creating ? 'Creating…' : '+ New document'}
          </button>
        </div>

        {actionError && (
          <div className="alert alert-error" role="alert">
            {actionError}
          </div>
        )}

        <div className="tabs" role="tablist" aria-label="Document lists">
          <button
            className="tab"
            role="tab"
            aria-selected={scope === 'owned'}
            onClick={() => setParams({}, { replace: true })}
          >
            My documents
          </button>
          <button
            className="tab"
            role="tab"
            aria-selected={scope === 'shared'}
            onClick={() => setParams({ tab: 'shared' }, { replace: true })}
          >
            Shared with me
          </button>
        </div>

        <div role="tabpanel">
          {list.status === 'loading' && <div className="empty">Loading…</div>}
          {list.status === 'error' && (
            <div className="alert alert-error" role="alert">
              {list.message}
              <div className="actions">
                <button className="btn btn-sm" onClick={reload}>
                  Try again
                </button>
              </div>
            </div>
          )}
          {list.status === 'ready' && list.docs.length === 0 && (
            <div className="empty">
              {scope === 'owned' ? (
                <>
                  <p>You don't have any documents yet.</p>
                  <button className="btn btn-primary" onClick={createDoc} disabled={creating}>
                    Create your first document
                  </button>
                </>
              ) : (
                <p>Nothing has been shared with you yet.</p>
              )}
            </div>
          )}
          {list.status === 'ready' && list.docs.length > 0 && (
            <ul className="doc-list">
              {list.docs.map((doc) => (
                <li key={doc.id} className="doc-row">
                  <span className="doc-icon" aria-hidden />
                  <div className="doc-main">
                    <Link className="doc-title" to={`/d/${doc.id}`}>
                      {doc.title}
                    </Link>
                    <div className="doc-meta">
                      {scope === 'shared' ? `Owned by ${doc.owner.name} · ` : ''}
                      Edited {relativeTime(doc.updated_at)}
                    </div>
                  </div>
                  <span className={`tag tag-${doc.role}`}>{doc.role}</span>
                  {doc.role === 'owner' && (
                    <button
                      className="btn btn-sm btn-ghost btn-danger"
                      onClick={() => {
                        setDeleteError(null)
                        setToDelete(doc)
                      }}
                      aria-label={`Delete ${doc.title}`}
                    >
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {toDelete && (
        <ConfirmDialog
          title="Delete document?"
          message={
            <p>
              <strong>{toDelete.title}</strong> will be permanently deleted for you and everyone it's shared with.
            </p>
          }
          confirmLabel="Delete"
          danger
          busy={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </>
  )
}
