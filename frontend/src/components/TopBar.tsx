import { useAuth } from '../auth/useAuth'
import { Brand } from './Brand'
import { Icon } from './Icon'
import { ThemeSwitcher } from './ThemeSwitcher'

export function TopBar() {
  const { user, logout } = useAuth()
  return (
    <header className="topbar">
      <Brand />
      <div className="spacer" />
      <ThemeSwitcher />
      {user && (
        <button className="btn btn-sm" onClick={() => void logout()} aria-label="Sign out" title="Sign out">
          <Icon name="logout" size={17} />
          <span className="topbar-signout-label">Sign out</span>
        </button>
      )}
    </header>
  )
}
