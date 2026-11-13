import { useEffect, useState } from 'react'
import { subscribeSlowRequests } from '../api/client'

/** Free-tier hosting sleeps when idle; explain the delay instead of looking broken. */
export function WakeBanner() {
  const [slow, setSlow] = useState(false)
  useEffect(() => subscribeSlowRequests(setSlow), [])
  if (!slow) return null
  return (
    <div className="wake-banner" role="status">
      Waking up the server — free hosting sleeps when idle, this can take up to a minute…
    </div>
  )
}
