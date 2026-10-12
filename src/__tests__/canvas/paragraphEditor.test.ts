import { describe, it, expect } from 'bun:test'
import { blocksToBreaks, createParagraphEditor } from '@site/canvas/paragraph/paragraphEditor'
import {
  applyParagraphLink,
  canEditLink,
  canFormatSelection,
  clearParagraphFormatting,
  formatRange,
  isParagraphFormatActive,
  toggleParagraphFormat,
} from '@site/canvas/paragraph/paragraphCommands'
import { docToRuns } from '@site/canvas/paragraph/paragraphDoc'
import type { Run } from '@core/paragraph'
import type { TextFormatsSettings } from '@core/text-formats'

const FORMATS: TextFormatsSettings = {
  formats: [{ id: 'bold', label: 'B', tag: 'strong', classIds: ['c1'], shortcut: 'Mod-b' }],
  link: { classIds: [] },
}
const KNOWN_CLASS_IDS = new Set(['c1', 'lk', 'other'])

// happy-dom has no ClipboardEvent; prosemirror-view only needs an Event to pass to handlePaste.
const PASTE_EVENT = new Event('paste')

function setup(runs: Run[], formats: TextFormatsSettings = FORMATS) {
  const calls = { commit: 0, cancel: 0, link: 0 }
  const el = document.createElement('p')
  document.body.appendChild(el)
  const editor = createParagraphEditor({
    element: el, runs, formats,
    classNameOf: (ids) => (ids.includes('c1') ? 'text-strong' : ids.includes('lk') ? 'link-cls' : ''), fixedNodes: {},
    isKnownClassId: (id) => KNOWN_CLASS_IDS.has(id),
    onCommit: () => { calls.commit += 1 }, onCancel: () => { calls.cancel += 1 }, onRequestLink: () => { calls.link += 1 },
  })
  const runsOut = () => docToRuns(editor.getJSON() as never, formats)
  return { editor, el, calls, runsOut }
}

describe('createParagraphEditor', () => {
  it('loads runs, toggles bold and exports runs', () => {
    const { editor, el, runsOut } = setup([{ kind: 'text', text: 'based on plan for' }])
    editor.commands.setTextSelection({ from: 9, to: 13 }) // "plan"
    expect(editor.state.doc.textBetween(9, 13)).toBe('plan')
    editor.commands.toggleMark('fmt_bold')
    expect(runsOut()).toEqual([
      { kind: 'text', text: 'based on ' },
      { kind: 'format', formatId: 'bold', text: 'plan' },
      { kind: 'text', text: ' for' },
    ])
    expect(el.querySelector('strong.text-strong')?.textContent).toBe('plan')
    editor.destroy()
  })

  it('pasted HTML keeps only configured formats, allowed links and text', () => {
    const { editor, runsOut } = setup([])
    editor.view.pasteHTML(
      '<strong>a</strong><em>b</em><u>u</u><a href="javascript:alert(1)">bad</a><a href="https://x.de">ok</a><script>alert(1)</script><img src="x" onerror="1">z',
      PASTE_EVENT,
    )
    expect(runsOut()).toEqual([
      { kind: 'format', formatId: 'bold', text: 'a' },
      { kind: 'text', text: 'bubad' },
      { kind: 'link', text: 'ok', href: 'https://x.de', target: '_blank', classIds: [] },
      { kind: 'text', text: 'z' },
    ])
    editor.destroy()
  })

  it('keeps href, target and classIds across copy/paste of a link', () => {
    const link: Run = { kind: 'link', text: 'Seite', href: 'cms:page:p1', target: '_parent', classIds: ['lk', 'other'] }
    const { editor, el, runsOut } = setup([link])
    const html = el.querySelector('a')!.outerHTML
    editor.commands.clearContent()
    editor.view.pasteHTML(html, PASTE_EVENT)
    expect(runsOut()).toEqual([link])
    editor.destroy()
  })

  it('falls back to external/internal target and default link classes for foreign links', () => {
    const { editor, runsOut } = setup([], { ...FORMATS, link: { classIds: ['lk'] } })
    editor.view.pasteHTML('<a href="https://x.de">x</a>', PASTE_EVENT)
    expect(runsOut()).toEqual([{ kind: 'link', text: 'x', href: 'https://x.de', target: '_blank', classIds: ['lk'] }])
    editor.destroy()
  })

  it('keeps line breaks when pasting multi-line text', () => {
    const { editor, runsOut } = setup([])
    editor.view.pasteText('line1\nline2\n\nline3', PASTE_EVENT)
    expect(runsOut()).toEqual([{ kind: 'text', text: 'line1\nline2\nline3' }])
    editor.destroy()
  })

  it('keeps block boundaries as line breaks when pasting HTML', () => {
    const { editor, runsOut } = setup([])
    editor.view.pasteHTML('<p>P1</p><p>P2</p>', PASTE_EVENT)
    expect(runsOut()).toEqual([{ kind: 'text', text: 'P1\nP2' }])
    editor.destroy()
  })

  it('maps keyboard shortcuts to callbacks and hard breaks', () => {
    const { editor, calls, runsOut } = setup([{ kind: 'text', text: 'ab' }])
    editor.commands.setTextSelection(1)
    editor.commands.keyboardShortcut('Enter')
    editor.commands.keyboardShortcut('Mod-Enter')
    expect(calls.commit).toBe(2)
    editor.commands.keyboardShortcut('Escape')
    expect(calls.cancel).toBe(1)
    editor.commands.setTextSelection({ from: 1, to: 2 })
    editor.commands.keyboardShortcut('Mod-k')
    expect(calls.link).toBe(1)
    editor.commands.setTextSelection(1)
    editor.commands.keyboardShortcut('Shift-Enter')
    expect(runsOut()).toEqual([{ kind: 'text', text: 'a\nb' }])
    editor.destroy()
  })

  it('drops the clipboard fragment markers and the document wrapper on paste (no trailing break)', () => {
    const { editor, runsOut } = setup([])
    editor.view.pasteHTML(
      '<html><body>\n<!--StartFragment--><p>P1</p><p>P2</p><!--EndFragment-->\n</body></html>',
      PASTE_EVENT,
    )
    expect(runsOut()).toEqual([{ kind: 'text', text: 'P1\nP2' }])
    editor.destroy()
  })

  it('ignores a Google Docs <b style="font-weight:normal"> wrapper', () => {
    const { editor, runsOut } = setup([])
    editor.view.pasteHTML(
      '<b style="font-weight:normal;" id="docs-internal-guid-1">plain <b>fett</b> <b style="font-weight: 400">dünn</b></b>',
      PASTE_EVENT,
    )
    expect(runsOut()).toEqual([
      { kind: 'text', text: 'plain ' },
      { kind: 'format', formatId: 'bold', text: 'fett' },
      { kind: 'text', text: ' dünn' },
    ])
    editor.destroy()
  })

  it('keeps only existing class ids from pasted link classes', () => {
    const { editor, runsOut } = setup([])
    editor.view.pasteHTML('<a href="/x" data-paragraph-link-classes="lk ghost other">x</a>', PASTE_EVENT)
    expect(runsOut()).toEqual([{ kind: 'link', text: 'x', href: '/x', target: '_self', classIds: ['lk', 'other'] }])
    editor.destroy()
  })
})

describe('blocksToBreaks', () => {
  it('turns block boundaries into breaks without leading or trailing breaks', () => {
    expect(blocksToBreaks('<p>a</p><div>b</div>')).toBe('a<br>b')
    expect(blocksToBreaks('<meta charset="utf-8"><!--StartFragment--><p>a</p><!--EndFragment-->\n')).toBe('<meta charset="utf-8">a')
    expect(blocksToBreaks('<html><body><br><p>a</p><br> </body></html>')).toBe('a')
  })
})

describe('formatting never touches links or fixed runs', () => {
  const fixedRuns: Run[] = [
    { kind: 'text', text: 'vor ' },
    { kind: 'fixed', nodeId: 'fx', text: 'fest' },
    { kind: 'text', text: ' nach' },
  ]
  const link: Run = { kind: 'link', text: 'Seite', href: 'cms:page:p1', target: '_self', classIds: ['lk'] }
  const linkRuns: Run[] = [{ kind: 'text', text: 'vor ' }, link, { kind: 'text', text: ' nach' }]

  it('Ctrl+B on fixed text keeps the fixed run', () => {
    const { editor, runsOut } = setup(fixedRuns)
    editor.commands.setTextSelection({ from: 4, to: 8 })
    expect(editor.state.doc.textBetween(4, 8)).toBe('fest')
    expect(editor.commands.keyboardShortcut('Mod-b')).toBe(true)
    expect(runsOut()).toEqual(fixedRuns)
    // A partial overlap with plain text is refused too.
    editor.commands.setTextSelection({ from: 2, to: 6 })
    editor.commands.keyboardShortcut('Mod-b')
    expect(toggleParagraphFormat(editor, 'bold')).toBe(false)
    expect(runsOut()).toEqual(fixedRuns)
    editor.destroy()
  })

  it('Ctrl+B inside a link and on a partial link overlap is a no-op (href intact)', () => {
    const { editor, runsOut } = setup(linkRuns)
    editor.commands.setTextSelection({ from: 5, to: 8 }) // inside "Seite"
    editor.commands.keyboardShortcut('Mod-b')
    expect(runsOut()).toEqual(linkRuns)
    editor.commands.setTextSelection({ from: 2, to: 6 }) // "r Se" — partial overlap
    expect(canFormatSelection(editor.state)).toBe(false)
    editor.commands.keyboardShortcut('Mod-b')
    expect(runsOut()).toEqual(linkRuns)
    editor.commands.setTextSelection(6) // caret inside the link: no stored bold either
    editor.commands.keyboardShortcut('Mod-b')
    editor.commands.insertContent('x')
    expect(runsOut()).toEqual([{ kind: 'text', text: 'vor ' }, { ...link, text: 'Sexite' }, { kind: 'text', text: ' nach' }])
    editor.destroy()
  })

  it('formats plain text next to a link', () => {
    const { editor, runsOut } = setup(linkRuns)
    editor.commands.setTextSelection({ from: 0, to: 3 })
    expect(toggleParagraphFormat(editor, 'bold')).toBe(true)
    expect(runsOut()[0]).toEqual({ kind: 'format', formatId: 'bold', text: 'vor' })
    expect(runsOut()[2]).toEqual(link)
    editor.destroy()
  })

  it('refuses to apply a link over fixed text', () => {
    const { editor, runsOut } = setup(fixedRuns)
    editor.commands.setTextSelection({ from: 0, to: 6 }) // "vor fe"
    expect(canEditLink(editor.state)).toBe(false)
    expect(applyParagraphLink(editor, { href: '/x', target: '_self', classIds: [] })).toBe(false)
    expect(runsOut()).toEqual(fixedRuns)
    editor.destroy()
  })

  it('applies a link over plain text and edits an existing link from a caret inside it', () => {
    const { editor, runsOut } = setup(linkRuns)
    editor.commands.setTextSelection(6)
    expect(canEditLink(editor.state)).toBe(true)
    expect(applyParagraphLink(editor, { href: '/neu', target: '_blank', classIds: ['lk'] })).toBe(true)
    expect(runsOut()[1]).toEqual({ ...link, href: '/neu', target: '_blank' })
    editor.commands.setTextSelection({ from: 9, to: 13 }) // " nac"
    expect(applyParagraphLink(editor, { href: '/b', target: '_self', classIds: [] })).toBe(true)
    // The selection's boundary space stays outside the new link.
    expect(runsOut()[2]).toEqual({ kind: 'text', text: ' ' })
    expect(runsOut()[3]).toEqual({ kind: 'link', text: 'nac', href: '/b', target: '_self', classIds: [] })
    editor.destroy()
  })

  it('Ctrl+K needs a selection or a caret inside a link, never fixed text', () => {
    const { editor, calls } = setup([...linkRuns, ...fixedRuns])
    editor.commands.setTextSelection(1) // caret in plain text
    editor.commands.keyboardShortcut('Mod-k')
    expect(calls.link).toBe(0)
    editor.commands.setTextSelection(6) // caret inside the link
    editor.commands.keyboardShortcut('Mod-k')
    expect(calls.link).toBe(1)
    editor.commands.setTextSelection({ from: 0, to: 3 })
    editor.commands.keyboardShortcut('Mod-k')
    expect(calls.link).toBe(2)
    editor.commands.setTextSelection({ from: 19, to: 21 })
    expect(editor.state.doc.textBetween(19, 21)).toBe('es') // inside the fixed "fest"
    editor.commands.keyboardShortcut('Mod-k')
    expect(calls.link).toBe(2)
    editor.destroy()
  })

  it('Clear keeps fixed runs and removes formats and links elsewhere', () => {
    const runs: Run[] = [{ kind: 'format', formatId: 'bold', text: 'fett' }, ...fixedRuns, { kind: 'text', text: ' ' }, link]
    const { editor, runsOut } = setup(runs)
    editor.commands.selectAll()
    expect(clearParagraphFormatting(editor, FORMATS)).toBe(false)
    expect(runsOut()).toEqual([
      { kind: 'format', formatId: 'bold', text: 'fett' },
      { kind: 'text', text: 'vor ' },
      { kind: 'fixed', nodeId: 'fx', text: 'fest' },
      { kind: 'text', text: ' nach ' },
      link,
    ])
    editor.commands.setTextSelection({ from: 0, to: 4 })
    expect(clearParagraphFormatting(editor, FORMATS)).toBe(true)
    editor.commands.setTextSelection({ from: 18, to: 23 })
    expect(editor.state.doc.textBetween(18, 23)).toBe('Seite')
    expect(clearParagraphFormatting(editor, FORMATS)).toBe(true)
    expect(runsOut()).toEqual([
      { kind: 'text', text: 'fettvor ' },
      { kind: 'fixed', nodeId: 'fx', text: 'fest' },
      { kind: 'text', text: ' nach Seite' },
    ])
    editor.destroy()
  })
})

/**
 * Acceptance finding B: a double-click on Windows selects the word plus its
 * trailing space. Active state and toggling must ignore the selection's
 * boundary spaces, otherwise a bold word reads as "not bold" and the first
 * click re-applies bold (no visible change) instead of removing it.
 */
describe('boundary spaces of the selection', () => {
  const boldWord: Run[] = [
    { kind: 'text', text: 'based on ' },
    { kind: 'format', formatId: 'bold', text: 'plan' },
    { kind: 'text', text: ' for' },
  ]

  it('reports a bold word as active when the selection includes its trailing space', () => {
    const { editor } = setup(boldWord)
    editor.commands.setTextSelection({ from: 9, to: 14 }) // "plan "
    expect(editor.state.doc.textBetween(9, 14)).toBe('plan ')
    expect(isParagraphFormatActive(editor.state, 'bold')).toBe(true)
    editor.commands.setTextSelection({ from: 8, to: 14 }) // " plan "
    expect(isParagraphFormatActive(editor.state, 'bold')).toBe(true)
    editor.commands.setTextSelection({ from: 9, to: 15 }) // "plan f" — real text outside the format
    expect(isParagraphFormatActive(editor.state, 'bold')).toBe(false)
    editor.destroy()
  })

  it('removes bold with one toggle when the selection includes the trailing space', () => {
    const { editor, runsOut } = setup(boldWord)
    editor.commands.setTextSelection({ from: 9, to: 14 })
    expect(toggleParagraphFormat(editor, 'bold')).toBe(true)
    expect(runsOut()).toEqual([{ kind: 'text', text: 'based on plan for' }])
    editor.destroy()
  })

  it('Ctrl+B removes bold too', () => {
    const { editor, runsOut } = setup(boldWord)
    editor.commands.setTextSelection({ from: 9, to: 14 })
    editor.commands.keyboardShortcut('Mod-b')
    expect(runsOut()).toEqual([{ kind: 'text', text: 'based on plan for' }])
    editor.destroy()
  })

  it('adds bold to the word only, keeping the selection', () => {
    const { editor, runsOut } = setup([{ kind: 'text', text: 'based on plan for' }])
    editor.commands.setTextSelection({ from: 9, to: 14 })
    expect(toggleParagraphFormat(editor, 'bold')).toBe(true)
    expect(runsOut()).toEqual(boldWord)
    expect(editor.state.selection.from).toBe(9)
    expect(editor.state.selection.to).toBe(14)
    expect(isParagraphFormatActive(editor.state, 'bold')).toBe(true)
    editor.destroy()
  })

  it('a selection of spaces only is formatted as selected', () => {
    const { editor } = setup([{ kind: 'text', text: 'a  b' }])
    editor.commands.setTextSelection({ from: 1, to: 3 })
    expect(toggleParagraphFormat(editor, 'bold')).toBe(true)
    expect(isParagraphFormatActive(editor.state, 'bold')).toBe(true)
    editor.destroy()
  })

  it('a link next to the selected word does not block formatting the word', () => {
    const link: Run = { kind: 'link', text: 'Seite', href: '/s', target: '_self', classIds: [] }
    const { editor, runsOut } = setup([{ kind: 'text', text: 'Wort ' }, link])
    editor.commands.setTextSelection({ from: 0, to: 5 }) // "Wort "
    expect(canFormatSelection(editor.state)).toBe(true)
    expect(toggleParagraphFormat(editor, 'bold')).toBe(true)
    expect(runsOut()).toEqual([{ kind: 'format', formatId: 'bold', text: 'Wort' }, { kind: 'text', text: ' ' }, link])
    editor.destroy()
  })

  it('a new link does not swallow the trailing space', () => {
    const { editor, runsOut } = setup([{ kind: 'text', text: 'based on plan for' }])
    editor.commands.setTextSelection({ from: 9, to: 14 })
    expect(applyParagraphLink(editor, { href: '/t', target: '_self', classIds: [] })).toBe(true)
    expect(runsOut()).toEqual([
      { kind: 'text', text: 'based on ' },
      { kind: 'link', text: 'plan', href: '/t', target: '_self', classIds: [] },
      { kind: 'text', text: ' for' },
    ])
    editor.destroy()
  })
})

describe('formatRange with Select All (AllSelection)', () => {
  it('trims the boundary spaces of a select-all exactly', () => {
    const { editor, runsOut } = setup([{ kind: 'text', text: 'ein Wort ' }, { kind: 'format', formatId: 'bold', text: 'fett' }, { kind: 'text', text: ' x ' }])
    editor.commands.selectAll()
    expect(editor.state.selection.constructor.name).toBe('AllSelection')
    const { from, to } = formatRange(editor.state)
    expect(editor.state.doc.textBetween(from, to)).toBe('ein Wort fett x')
    expect(toggleParagraphFormat(editor, 'bold')).toBe(true)
    expect(runsOut()).toEqual([
      { kind: 'format', formatId: 'bold', text: 'ein Wort fett x' },
      { kind: 'text', text: ' ' },
    ])
    editor.destroy()
  })

  it('a hard break at the edge of a select-all is not a space', () => {
    const { editor } = setup([{ kind: 'text', text: 'a\nb' }])
    editor.commands.selectAll()
    const { from, to } = formatRange(editor.state)
    expect(editor.state.doc.textBetween(from, to, '\n', '\n')).toBe('a\nb')
    editor.destroy()
  })
})
