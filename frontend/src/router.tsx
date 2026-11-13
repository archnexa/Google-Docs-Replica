import { createBrowserRouter } from 'react-router-dom'
import App from './App'
import { RequireAuth } from './auth/RequireAuth'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'

// A data router is required for useBlocker (unsaved-changes navigation guard).
export const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/', element: <RequireAuth><DashboardPage /></RequireAuth> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
