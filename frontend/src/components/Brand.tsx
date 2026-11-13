import { Link } from 'react-router-dom'
import { Icon } from './Icon'

export function Brand() {
  return (
    <Link to="/" className="brand">
      <span className="brand-mark"><Icon name="document" size={21} /></span>
      Ajaia Docs
    </Link>
  )
}
