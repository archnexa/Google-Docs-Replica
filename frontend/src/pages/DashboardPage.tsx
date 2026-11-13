import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { api } from '../api/endpoints'
import type { DocumentSummary } from '../api/types'
import { ConfirmDialog } from '../components/Modal'
import { useAuth } from '../auth/useAuth'
import { Brand } from '../components/Brand'
import { Icon } from '../components/Icon'
import { ThemeSwitcher } from '../components/ThemeSwitcher'
import { WorkspaceArt } from '../components/WorkspaceArt'
import { relativeTime } from '../lib/format'

type Scope = 'owned' | 'shared'

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; docs: DocumentSummary[] }

type Loaded = { key: string } & ({ docs: DocumentSummary[] } | { error: string })

export default function DashboardPage() {
  const [params] = useSearchParams()
  const { user, logout } = useAuth()
  const [search, setSearch] = useState('')
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
      .then((docs) => {
        if (!ctrl.signal.aborted) setLoaded({ key: requestKey, docs })
      })
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

  const owned = scope === 'owned'
  const section = owned ? 'My documents' : 'Shared with me'
  const searchTerm = search.trim().toLowerCase()
  const visibleDocs = list.status === 'ready'
    ? list.docs.filter((doc) => doc.title.toLowerCase().includes(searchTerm))
    : []
  const initials = user?.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

  return (
    <div className="workspace">
      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <Brand />
        <nav className="workspace-nav" aria-label="Document lists">
          <span className="nav-label" aria-hidden="true">Workspace</span>
          <Link
            to="/"
            replace
            className="nav-item"
            aria-current={owned ? 'page' : false}
            onClick={() => setSearch('')}
          >
            <Icon name="folder" /> My documents
          </Link>
          <Link
            to="/?tab=shared"
            replace
            className="nav-item"
            aria-current={owned ? false : 'page'}
            onClick={() => setSearch('')}
          >
            <Icon name="people" /> Shared with me
          </Link>
        </nav>
        {user && (
          <div className="workspace-account">
            <span className="avatar" aria-hidden="true">{initials || '?'}</span>
            <div className="account-info">
              <strong>{user.name}</strong>
              <span title={user.email}>{user.email}</span>
            </div>
            <button className="icon-button signout" onClick={() => void logout()} aria-label="Sign out" title="Sign out">
              <Icon name="logout" size={18} />
            </button>
          </div>
        )}
      </aside>

      <div className="workspace-body">
        <header className="workspace-header">
          <div className="breadcrumb">
            <span>Workspace</span><Icon name="chevron" size={14} /><strong>{section}</strong>
          </div>
          <ThemeSwitcher />
        </header>

        <main className="dashboard">
          <section className="workspace-hero" aria-labelledby="workspace-heading">
            <div className="hero-content">
              <h1 id="workspace-heading">Your workspace<span>.</span></h1>
              <p>Write, edit, and find your documents in one place.</p>
              <button className="btn btn-primary hero-action" onClick={createDoc} disabled={creating}>
                <Icon name="plus" size={19} /> {creating ? 'Creating…' : 'New document'}
              </button>
            </div>
            <WorkspaceArt />
          </section>

          {actionError && <div className="alert alert-error" role="alert">{actionError}</div>}

          <section className="document-section" aria-labelledby="document-heading">
            <div className="dash-head">
              <div>
                <h2 id="document-heading">{section}</h2>
                {list.status === 'ready' && (
                  <p>{list.docs.length} {list.docs.length === 1 ? 'document' : 'documents'}</p>
                )}
              </div>
              <div className="document-search" role="search">
                <Icon name="search" size={18} />
                <input
                  type="search"
                  aria-label="Search documents"
                  placeholder="Search documents…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
            {list.status === 'loading' && (
              <div className="empty" role="status"><span className="spinner" /> Loading documents…</div>
            )}
            {list.status === 'error' && (
              <div className="alert alert-error" role="alert">
                {list.message}
                <div className="actions"><button className="btn btn-sm" onClick={reload}>Try again</button></div>
              </div>
            )}
            {list.status === 'ready' && visibleDocs.length === 0 && (
              <div className="empty">
                <span className="empty-icon"><Icon name={searchTerm ? 'search' : owned ? 'document' : 'people'} size={24} /></span>
                <h3>{searchTerm ? 'No matching documents' : owned ? 'No documents yet' : 'Nothing shared yet'}</h3>
                <p>
                  {searchTerm
                    ? 'Try searching for a different title.'
                    : owned
                      ? 'Start with a blank page and make it yours.'
                      : 'Documents shared with you will appear here.'}
                </p>
                {searchTerm && <button className="btn" onClick={() => setSearch('')}>Clear search</button>}
              </div>
            )}
            {visibleDocs.length > 0 && (
              <ul className="doc-list">
                {visibleDocs.map((doc) => (
                  <li key={doc.id} className="doc-row">
                    <Link className="doc-link" to={`/d/${doc.id}`}>
                      <span className="doc-icon"><Icon name="document" size={20} /></span>
                      <div className="doc-main">
                        <span className="doc-title">{doc.title}</span>
                        <span className="doc-meta">
                          {!owned && `Owned by ${doc.owner.name} · `}
                          Edited {relativeTime(doc.updated_at)}
                        </span>
                      </div>
                      <span className={`tag tag-${doc.role}`}>{doc.role}</span>
                      <span className="doc-open"><Icon name="chevron" size={18} /></span>
                    </Link>
                    {doc.role === 'owner' && (
                      <button
                        className="icon-button delete-doc"
                        onClick={() => {
                          setDeleteError(null)
                          setToDelete(doc)
                        }}
                        aria-label={`Delete ${doc.title}`}
                        title="Delete document"
                      >
                        <Icon name="trash" size={18} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>

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
    </div>
  )
}
