import { useRef, useState, type KeyboardEvent } from 'react'
import { ApiError } from '../api/client'
import { api } from '../api/endpoints'

/** Inline title. Saved on blur / Enter, last-write-wins on the server (not versioned). */
export function TitleField({ docId, initial, readOnly }: { docId: string; initial: string; readOnly: boolean }) {
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function commit() {
    const title = value.trim()
    if (title === saved) {
      setValue(saved)
      setError(null)
      return
    }
    if (!title) {
      setError("Title can't be empty.")
      return
    }
    if (title.length > 200) {
      setError('Title must be 200 characters or fewer.')
      return
    }
    setBusy(true)
    try {
      const doc = await api.renameDocument(docId, title)
      setSaved(doc.title)
      setValue(doc.title)
      setError(null)
      document.title = `${doc.title} — Ajaia Docs`
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rename the document.')
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') inputRef.current?.blur()
    if (e.key === 'Escape') {
      setValue(saved)
      setError(null)
      requestAnimationFrame(() => inputRef.current?.blur())
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        className="title-input"
        aria-label="Document title"
        value={value}
        maxLength={200}
        disabled={readOnly || busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
      />
      {error && (
        <div className="title-error" role="alert">
          {error}
        </div>
      )}
    </>
  )
}
