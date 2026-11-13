import { useAuth } from '../auth/useAuth'

export default function DashboardPage() {
  const { user, logout } = useAuth()
  return (
    <div className="center-page">
      <p>Signed in as {user?.name} ({user?.email})</p>
      <button className="btn" onClick={() => void logout()}>
        Sign out
      </button>
    </div>
  )
}
