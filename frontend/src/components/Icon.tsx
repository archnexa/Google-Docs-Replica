import type { ReactNode } from 'react'

const paths = {
  document: <><path d="M14 2.75H6A2.25 2.25 0 0 0 3.75 5v14A2.25 2.25 0 0 0 6 21.25h12A2.25 2.25 0 0 0 20.25 19V9Z" /><path d="M14 2.75V9h6.25M8 13h8m-8 4h5" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 5a3 3 0 0 1 0 6m5 9v-2a4 4 0 0 0-3-3.9" /></>,
  plus: <path d="M12 5v14m-7-7h14" />,
  search: <><circle cx="10.75" cy="10.75" r="5.75" /><path d="m15 15 4.5 4.5" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  arrowLeft: <path d="m12 5-7 7 7 7m-7-7h14" />,
  arrowRight: <path d="m12 5 7 7-7 7m7-7H5" />,
  trash: <path d="M4.5 6.5h15m-13 0 1 13h9l1-13m-8 0v-3h5v3m-4.5 4v5m4-5v5" />,
  logout: <path d="M10 4H5v16h5m4-12 4 4-4 4m-5-4h9" />,
  check: <path d="m5 12 4 4L19 6" />,
  undo: <path d="M8 5 3 10l5 5m-5-5h12a5 5 0 0 1 0 10h-3" />,
  redo: <path d="m16 5 5 5-5 5m5-5H9a5 5 0 0 0 0 10h3" />,
  bold: <path d="M6 4h7a4 4 0 1 1 0 8H6zm0 8h8a4 4 0 1 1 0 8H6z" />,
  italic: <path d="M10 4h8M6 20h8m1-16L9 20" />,
  underline: <path d="M6 4v7a6 6 0 0 0 12 0V4M4 21h16" />,
  bullets: <><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4" cy="6" r=".75" fill="currentColor" /><circle cx="4" cy="12" r=".75" fill="currentColor" /><circle cx="4" cy="18" r=".75" fill="currentColor" /></>,
  numbers: <path d="M10 6h11M10 12h11M10 18h11M4 4l1-1v5M3 12a2 2 0 0 1 4 0c0 1-4 4-4 4h4" />,
} satisfies Record<string, ReactNode>

export function Icon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}
