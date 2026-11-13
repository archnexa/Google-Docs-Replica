import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'

export function TopBar() {
  const { user, logout } = useAuth()
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <span className="brand-mark" aria-hidden>
          A
        </span>
        Ajaia Docs
      </Link>
      <div className="spacer" />
      {user && (
        <>
          <span className="user-chip" title={user.email}>
            {user.name}
          </span>
          <button className="btn btn-sm" onClick={() => void logout()}>
            Sign out
          </button>
        </>
      )}
    </header>
  )
}
