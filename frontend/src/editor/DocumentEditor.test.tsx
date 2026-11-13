import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DocumentDetail } from '../api/types'
import { AuthContext } from '../auth/useAuth'
import { DocumentEditor } from './DocumentEditor'

const saveContent = vi.fn(async (_id: string, req: { version: number }) => ({ version: req.version + 1, updated_at: '' }))
vi.mock('../api/endpoints', () => ({ api: { saveContent: (id: string, req: { version: number }) => saveContent(id, req) } }))

// React's act() environment flag for non-RTL rendering.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const doc: DocumentDetail = {
  id: 'doc-1',
  title: 'Plan',
  content: '<h1>Hello</h1><p><strong>bold</strong> text</p>',
  version: 4,
  role: 'owner',
  owner: { id: 1, email: 'a@x.test', name: 'Alice' },
  last_edited_by: null,
  updated_at: new Date().toISOString(),
}
const auth = { user: doc.owner, restoring: false, login: vi.fn(), logout: vi.fn(), expire: vi.fn() }

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.useFakeTimers()
  saveContent.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

function mount(d: DocumentDetail) {
  act(() => {
    root.render(
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <DocumentEditor doc={d} />
        </MemoryRouter>
      </AuthContext.Provider>,
    )
  })
  const pm = container.querySelector('.ProseMirror') as HTMLElement & { editor?: import('@tiptap/core').Editor }
  return pm
}

it('loading a document renders its formatting and never triggers a save', async () => {
  const pm = mount(doc)
  expect(pm.innerHTML).toContain('<h1>Hello</h1>')
  expect(pm.innerHTML).toContain('<strong>bold</strong>')
  await act(() => vi.advanceTimersByTimeAsync(20_000))
  expect(saveContent).not.toHaveBeenCalled()
})

it('a user edit is saved once, against the loaded version', async () => {
  const pm = mount(doc)
  const editor = pm.editor!
  expect(editor).toBeTruthy()
  act(() => {
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' more') // no focus: jsdom has no layout APIs
  })
  await act(() => vi.advanceTimersByTimeAsync(1500))
  expect(saveContent).toHaveBeenCalledTimes(1)
  const [id, req] = saveContent.mock.calls[0]
  expect(id).toBe('doc-1')
  expect(req).toMatchObject({ version: 4 })
  expect((req as unknown as { content: string }).content).toContain('more')
})

it('viewers get a read-only editor without a toolbar', () => {
  const pm = mount({ ...doc, role: 'viewer' })
  expect(pm.getAttribute('contenteditable')).toBe('false')
  expect(container.querySelector('[role="toolbar"]')).toBeNull()
  expect(container.textContent).toContain('view-only access')
})
