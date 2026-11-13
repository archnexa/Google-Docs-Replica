import { useEditorState, type Editor } from '@tiptap/react'

type Block = 'p' | 'h1' | 'h2' | 'h3'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

export function Toolbar({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      block: (e.isActive('heading', { level: 1 })
        ? 'h1'
        : e.isActive('heading', { level: 2 })
          ? 'h2'
          : e.isActive('heading', { level: 3 })
            ? 'h3'
            : 'p') as Block,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })

  const chain = () => editor.chain().focus()
  const setBlock = (b: Block) => {
    if (b === 'p') chain().setParagraph().run()
    else chain().setHeading({ level: Number(b[1]) as 1 | 2 | 3 }).run()
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <button className="tool" type="button" onClick={() => chain().undo().run()} disabled={disabled || !s.canUndo} title={`Undo (${mod}Z)`} aria-label="Undo">
        ↶
      </button>
      <button className="tool" type="button" onClick={() => chain().redo().run()} disabled={disabled || !s.canRedo} title={`Redo (${mod}Shift+Z)`} aria-label="Redo">
        ↷
      </button>
      <span className="tool-sep" />
      <label className="sr-only" htmlFor="block-style">
        Text style
      </label>
      <select id="block-style" value={s.block} onChange={(e) => setBlock(e.target.value as Block)} disabled={disabled}>
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <span className="tool-sep" />
      <button className="tool" type="button" aria-pressed={s.bold} onClick={() => chain().toggleBold().run()} disabled={disabled} title={`Bold (${mod}B)`} aria-label="Bold">
        <strong>B</strong>
      </button>
      <button className="tool" type="button" aria-pressed={s.italic} onClick={() => chain().toggleItalic().run()} disabled={disabled} title={`Italic (${mod}I)`} aria-label="Italic">
        <em>I</em>
      </button>
      <button className="tool" type="button" aria-pressed={s.underline} onClick={() => chain().toggleUnderline().run()} disabled={disabled} title={`Underline (${mod}U)`} aria-label="Underline">
        <u>U</u>
      </button>
      <span className="tool-sep" />
      <button className="tool" type="button" aria-pressed={s.bullet} onClick={() => chain().toggleBulletList().run()} disabled={disabled} title="Bulleted list" aria-label="Bulleted list">
        • List
      </button>
      <button className="tool" type="button" aria-pressed={s.ordered} onClick={() => chain().toggleOrderedList().run()} disabled={disabled} title="Numbered list" aria-label="Numbered list">
        1. List
      </button>
    </div>
  )
}
