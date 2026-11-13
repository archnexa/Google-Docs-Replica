import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { DocumentDetail } from '../api/types'
import { useAuth } from '../auth/useAuth'
import { SaveStatus } from './SaveStatus'
import { TitleField } from './TitleField'
import { Toolbar } from './Toolbar'
import { useBeforeUnload, useDocumentAutosave } from './useDocumentAutosave'

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: { openOnClick: false, autolink: true },
  }),
  Placeholder.configure({ placeholder: 'Start writing…' }),
]

export function DocumentEditor({ doc }: { doc: DocumentDetail }) {
  const { user } = useAuth()
  const readOnly = doc.role === 'viewer'
  const { controller, snapshot } = useDocumentAutosave(doc.id, doc.version, doc.content)
  useBeforeUnload(controller)

  // useEditor captures options once; route updates through refs.
  const controllerRef = useRef(controller)
  const applyingRemote = useRef(false)
  useEffect(() => {
    controllerRef.current = controller
  }, [controller])

  const editor = useEditor({
    extensions,
    content: doc.content, // initial content: does not emit onUpdate -> no save on load
    editable: !readOnly,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: e }) => {
      if (applyingRemote.current) return // programmatic replacement is not a user edit
      controllerRef.current?.edit(e.getHTML())
    },
  })

  useEffect(() => {
    document.title = `${doc.title} — Ajaia Docs`
  }, [doc.title])

  // Cmd/Ctrl+S saves immediately instead of opening the browser's "save page" dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        controller?.flushNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller])

  const isOwner = doc.role === 'owner'
  return (
    <div className="editor-page">
      <div className="editor-top">
        <div className="editor-head">
          <Link to="/" className="brand" title="Back to documents" aria-label="Back to documents">
            <span className="brand-mark" aria-hidden>
              A
            </span>
          </Link>
          <TitleField docId={doc.id} initial={doc.title} readOnly={readOnly} />
          <SaveStatus snap={snapshot} readOnly={readOnly} />
          <span className={`tag tag-${doc.role}`} title={isOwner ? 'You own this document' : `Owned by ${doc.owner.name}`}>
            {isOwner ? 'owner' : `${doc.role} · ${doc.owner.name}'s doc`}
          </span>
          <span className="user-chip">{user?.name}</span>
        </div>
        {!readOnly && editor && <Toolbar editor={editor} />}
      </div>

      <div className="editor-canvas">
        {readOnly && (
          <div className="alert alert-info" role="note">
            You have view-only access. Ask {doc.owner.name} for edit access to make changes.
          </div>
        )}
        <div className={`paper${readOnly ? ' readonly' : ''}`}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
