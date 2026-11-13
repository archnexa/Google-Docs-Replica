import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/useAuth'
import { Brand } from '../components/Brand'
import { Icon } from '../components/Icon'
import { ThemeSwitcher } from '../components/ThemeSwitcher'
import { WorkspaceArt } from '../components/WorkspaceArt'

const DEMO_ACCOUNTS = [
  { name: 'Alice', email: 'alice@ajaia.test', role: 'Owner' },
  { name: 'Bob', email: 'bob@ajaia.test', role: 'Editor' },
  { name: 'Carol', email: 'carol@ajaia.test', role: 'Viewer' },
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
      <header className="login-header">
        <Brand />
        <ThemeSwitcher />
      </header>
      <main className="login-layout">
        <div className="login-visual"><WorkspaceArt /></div>
        <div className="login-card">
          <h1>Sign in</h1>
          <p className="login-intro">Sign in to create, edit, and share documents.</p>

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
              {busy ? 'Signing in…' : 'Sign in'} <Icon name="arrowRight" size={18} />
            </button>
          </form>

          <div className="demo-box">
            <h2>Try a demo account</h2>
            <p>Choose an account to fill in its sign-in details. Roles refer to the Welcome document.</p>
            <ul>
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    className="demo-account"
                    aria-label={`Fill demo credentials for ${account.name}, ${account.role}`}
                    onClick={() => {
                      setEmail(account.email)
                      setPassword(DEMO_PASSWORD)
                      setError(null)
                    }}
                  >
                    <span className="avatar" aria-hidden="true">{account.name[0]}</span>
                    <span className="demo-account-name"><strong>{account.name}</strong>{account.email}</span>
                    <span className={`tag tag-${account.role.toLowerCase()}`}>{account.role}</span>
                    <Icon name="chevron" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </div>
  )
}
