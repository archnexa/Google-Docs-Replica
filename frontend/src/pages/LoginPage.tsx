import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/useAuth'

const DEMO_ACCOUNTS = [
  { email: 'alice@ajaia.test', note: 'owns the Welcome doc' },
  { email: 'bob@ajaia.test', note: 'editor on Welcome' },
  { email: 'carol@ajaia.test', note: 'viewer on Welcome' },
]
const DEMO_PASSWORD = 'demo1234'

export default function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={from} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    try {
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand brand-lg">
          <span className="brand-mark" aria-hidden>
            A
          </span>
          Ajaia Docs
        </div>
        <p className="muted">Sign in to create, edit and share documents.</p>

        <form onSubmit={onSubmit} noValidate>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="demo-box">
          <div className="demo-title">
            Demo accounts <span className="tag">demo only</span>
          </div>
          <p className="muted small">
            Password for all: <code>{DEMO_PASSWORD}</code>. Click to fill.
          </p>
          <ul>
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setEmail(a.email)
                    setPassword(DEMO_PASSWORD)
                    setError(null)
                  }}
                >
                  {a.email}
                </button>
                <span className="muted small"> — {a.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
