import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import App from './App'
import { RequireAuth } from './auth/RequireAuth'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'

// The editor (Tiptap/ProseMirror) is most of the bundle; load it only when a document opens.
// Route config module (not a component file), so fast-refresh boundaries don't apply.
// oxlint-disable-next-line react/only-export-components
const EditorRoute = lazy(() => import('./pages/EditorPage'))

// A data router is required for useBlocker (unsaved-changes navigation guard).
export const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/', element: <RequireAuth><DashboardPage /></RequireAuth> },
      {
        path: '/d/:id',
        element: (
          <RequireAuth>
            <Suspense fallback={<div className="page-loading">Opening document…</div>}>
              <EditorRoute />
            </Suspense>
          </RequireAuth>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
