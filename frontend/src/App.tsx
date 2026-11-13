import { Outlet } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { WakeBanner } from './components/WakeBanner'

export default function App() {
  return (
    <AuthProvider>
      <WakeBanner />
      <Outlet />
    </AuthProvider>
  )
}
