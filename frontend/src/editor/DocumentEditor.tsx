import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { DocumentDetail } from '../api/types'
import { Icon } from '../components/Icon'
import { ThemeSwitcher } from '../components/ThemeSwitcher'
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
    editorProps: { attributes: { role: 'textbox', 'aria-label': 'Document content', 'aria-multiline': 'true', 'aria-readonly': String(readOnly) } },
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: e }) => {
      if (applyingRemote.current) return // programmatic replacement is not a user edit
      controllerRef.current?.edit(e.getHTML())
    },
  })

  useEffect(() => {
    document.title = `${doc.title} — Ajaia Docs`
    return () => { document.title = 'Ajaia Docs' }
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
      <header className="editor-top">
        <div className="editor-head">
          <Link to="/" className="editor-back brand-mark" title="Back to documents" aria-label="Back to documents">
            <Icon name="arrowLeft" size={21} />
          </Link>
          <div className="editor-document">
            <TitleField docId={doc.id} initial={doc.title} readOnly={readOnly} />
            <div className="editor-meta">
              <SaveStatus snap={snapshot} readOnly={readOnly} />
              <span className={`tag tag-${doc.role}`} title={isOwner ? 'You own this document' : `Owned by ${doc.owner.name}`}>
                {doc.role}
              </span>
            </div>
          </div>
          <ThemeSwitcher />
        </div>
        {!readOnly && editor && <Toolbar editor={editor} />}
      </header>

      <main className="editor-canvas" aria-label="Document">
        {readOnly && (
          <div className="alert alert-info" role="note">
            You have view-only access. Ask {doc.owner.name} for edit access to make changes.
          </div>
        )}
        <div className={`paper${readOnly ? ' readonly' : ''}`}>
          <EditorContent editor={editor} />
        </div>
      </main>
    </div>
  )
}
