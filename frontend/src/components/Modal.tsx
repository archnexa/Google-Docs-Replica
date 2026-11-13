import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose?: () => void
  children: ReactNode
}

/** Minimal accessible modal: focus moves in, Escape closes (if closable), backdrop click closes. */
export function Modal({ title, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, select, button:not([disabled])')
    first?.focus()
    return () => previouslyFocused?.focus?.()
  }, [])

  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

interface ConfirmProps {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, message, confirmLabel, danger, busy, error, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal title={title} onClose={busy ? undefined : onCancel}>
      <div>{message}</div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
