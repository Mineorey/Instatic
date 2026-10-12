/**
 * ParagraphEditHost while paragraph mode loads (acceptance finding: "the text
 * disappears for a moment after a double-click"). The host replaces the
 * module render the moment a session starts, but TipTap and the menu arrive
 * through `import()` — the host must show the paragraph's text the whole
 * time, and keys typed before the editor is ready must not get lost.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { ParagraphEditHost } from '@site/canvas/paragraph/ParagraphEditHost'
import { createParagraphPreview } from '@site/canvas/paragraph/paragraphPreview'
import { useEditorStore } from '@site/store/store'
// Side-effect imports: register the modules under test into the global registry.
import '@modules/base/text'
import '@modules/base/link'
import '@modules/base/container'

const TEXT = 'based on plan for'
const s = () => useEditorStore.getState()

function startSession(): void {
  const site = s().createSite('Paragraph Loading Site')
  const nodeId = s().insertNode('base.text', { text: TEXT, tag: 'p' }, site.pages[0].rootNodeId)
  expect(s().startParagraphEdit(nodeId, 'bp')).toBe(true)
}

/** Render the host and record its text after every DOM change until it is ready. */
async function renderAndWatch(): Promise<{ host: HTMLElement; seen: string[] }> {
  const seen: string[] = []
  let host: HTMLElement | null = null
  const observer = new MutationObserver(() => {
    if (host) seen.push(host.textContent ?? '')
  })
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
  render(<ParagraphEditHost tag="p" className="body-copy" wrapperProps={{}} fallback={null} />)
  host = document.querySelector<HTMLElement>('[data-paragraph-host]')
  expect(host).not.toBeNull()
  // Synchronously after mount — before any import() can have resolved.
  seen.push(host!.textContent ?? '')
  const deadline = Date.now() + 3000
  while (!host!.hasAttribute('data-paragraph-ready') && Date.now() < deadline) {
    await act(() => new Promise((r) => setTimeout(r, 5)))
  }
  observer.disconnect()
  expect(host!.hasAttribute('data-paragraph-ready')).toBe(true)
  return { host: host!, seen }
}

beforeEach(() => {
  s().clearSite()
  useEditorStore.setState({
    activePageId: null,
    activeDocument: null,
    activeInlineEdit: null,
    activeParagraphEdit: null,
    selectedNodeId: null,
    selectedNodeIds: [],
  })
})

afterEach(() => {
  s().cancelParagraphEdit()
  cleanup()
  document.body.innerHTML = ''
})

describe('ParagraphEditHost while paragraph mode loads', () => {
  it('shows the paragraph text from the first frame until the editor is ready — never an empty host', async () => {
    startSession()
    const { host, seen } = await renderAndWatch()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.filter((text) => text !== TEXT)).toEqual([])
    // Once ready, only the editor is left inside the host (the preview is gone).
    expect(host.querySelector('[data-paragraph-editor]')?.textContent).toBe(TEXT)
    expect(host.querySelector('[data-paragraph-preview]')).toBeNull()
  })

  it('keys typed before the editor is ready reach the editor once it is', async () => {
    startSession()
    render(<ParagraphEditHost tag="p" className="body-copy" wrapperProps={{}} fallback={null} />)
    const host = document.querySelector<HTMLElement>('[data-paragraph-host]')!
    for (const key of [' ', 'a', 'b']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
    const deadline = Date.now() + 3000
    while (!host.hasAttribute('data-paragraph-ready') && Date.now() < deadline) {
      await act(() => new Promise((r) => setTimeout(r, 5)))
    }
    expect(host.querySelector('[data-paragraph-editor]')?.textContent).toBe(`${TEXT} ab`)
  })
})

/** Press `keys` before the editor is ready, then wait until it is. */
async function typeAhead(keys: { key: string; shiftKey?: boolean }[]): Promise<HTMLElement> {
  startSession()
  render(<ParagraphEditHost tag="p" className="body-copy" wrapperProps={{}} fallback={null} />)
  const host = document.querySelector<HTMLElement>('[data-paragraph-host]')!
  for (const init of keys) {
    document.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }))
  }
  const deadline = Date.now() + 3000
  while (!host.hasAttribute('data-paragraph-ready') && Date.now() < deadline) {
    await act(() => new Promise((r) => setTimeout(r, 5)))
  }
  return host
}
const keysOf = (text: string) => [...text].map((key) => ({ key }))

describe('typed-ahead keys', () => {
  it('are inserted as text, never parsed as HTML', async () => {
    const host = await typeAhead(keysOf('<b>x</b>&amp;'))
    const editor = host.querySelector('[data-paragraph-editor]')!
    expect(editor.textContent).toBe(`${TEXT}<b>x</b>&amp;`)
    expect(editor.querySelector('b, strong')).toBeNull()
  })

  it('Shift+Enter inserts a line break and keeps the session open', async () => {
    const host = await typeAhead([{ key: 'a' }, { key: 'Enter', shiftKey: true }, { key: 'b' }])
    const editor = host.querySelector('[data-paragraph-editor]')!
    expect(editor.textContent).toBe(`${TEXT}ab`)
    expect(editor.querySelectorAll('br').length).toBeGreaterThanOrEqual(1)
    expect(s().activeParagraphEdit).not.toBeNull()
  })

  it('Backspace with nothing typed ahead deletes before the caret', async () => {
    const host = await typeAhead([{ key: 'Backspace' }, { key: 'Backspace' }, { key: 'X' }, { key: 'Y' }, { key: 'Backspace' }])
    expect(host.querySelector('[data-paragraph-editor]')!.textContent).toBe(`${TEXT.slice(0, -2)}X`)
  })
})

describe('createParagraphPreview', () => {
  it('an empty paragraph keeps one line of height (like the editor)', () => {
    const preview = createParagraphPreview(document, {
      runs: [], formats: { formats: [], link: { classIds: [] } }, classNameOf: () => '', fixedNodes: {},
    })
    expect(preview.innerHTML).toBe('<br>')
  })

  it('renders runs with the markup the editor marks render', () => {
    const preview = createParagraphPreview(document, {
      runs: [
        { kind: 'text', text: 'a\n\nb ' },
        { kind: 'format', formatId: 'bold', text: 'fett' },
        { kind: 'link', text: 'Seite', href: '/x', target: '_self', classIds: [] },
        { kind: 'fixed', nodeId: 'n1', text: 'fix\n' },
      ],
      formats: { formats: [{ id: 'bold', label: 'B', tag: 'strong', classIds: ['c1'] }], link: { classIds: ['lk'] } },
      classNameOf: (ids) => ids.map((id) => `cls-${id}`).join(' '),
      fixedNodes: { n1: { tag: 'span', className: 'own', unknownFormat: false } },
    })
    expect(preview.hasAttribute('data-paragraph-preview')).toBe(true)
    expect(preview.innerHTML).toBe(
      'a<br><br>b <strong class="cls-c1">fett</strong><a href="/x" target="_self" class="cls-lk">Seite</a>' +
        '<span class="own">fix<br></span><br>',
    )
  })
})
