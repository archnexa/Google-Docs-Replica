import { Link } from 'react-router-dom'

export default function NotFoundPage({ message }: { message?: string }) {
  return (
    <div className="center-page">
      <h1>Not found</h1>
      <p className="muted">{message ?? "This page doesn't exist, or you don't have access to it."}</p>
      <Link className="btn" to="/">
        Back to documents
      </Link>
    </div>
  )
}
