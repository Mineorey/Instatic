/**
 * ParagraphLinkPanel outside-press and keyboard behaviour (review of finding
 * F): a changed draft is never dropped silently, an unchanged one never asks,
 * and the guard only swallows the mouse events of a press it swallowed.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { ParagraphLinkPanel } from '@site/canvas/paragraph/ParagraphLinkPanel'
import { createParagraphEditor } from '@site/canvas/paragraph/paragraphEditor'
import { docToRuns } from '@site/canvas/paragraph/paragraphDoc'
import type { Run } from '@core/paragraph'
import type { TextFormatsSettings } from '@core/text-formats'

const FORMATS: TextFormatsSettings = { formats: [], link: { classIds: [] } }
const ANCHOR = { left: 0, right: 10, top: 0, bottom: 10, width: 10, height: 10 }

let editor: Editor | null = null
let outside: HTMLButtonElement | null = null

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = null
  outside?.remove()
  outside = null
  document.body.innerHTML = ''
})

function setup(href: string) {
  const el = document.createElement('p')
  document.body.appendChild(el)
  const runs: Run[] = [{ kind: 'text', text: 'vor ' }, { kind: 'link', text: 'Seite', href, target: '_self', classIds: [] }]
  editor = createParagraphEditor({
    element: el, runs, formats: FORMATS, classNameOf: () => '', fixedNodes: {}, isKnownClassId: () => true,
    onCommit: () => {}, onCancel: () => {}, onRequestLink: () => {},
  })
  editor.commands.setTextSelection(6) // caret inside "Seite"
  outside = document.createElement('button')
  outside.textContent = 'Publish'
  let outsideClicks = 0
  outside.addEventListener('click', () => { outsideClicks += 1 })
  document.body.appendChild(outside)
  const calls = { close: 0 }
  const view = render(
    <ParagraphLinkPanel editor={editor} anchor={ANCHOR} focusPanel={false} formats={FORMATS} onClose={() => { calls.close += 1 }} />,
  )
  const ed = editor
  return { calls, view, outsideClicks: () => outsideClicks, href: () => docToRuns(ed.getJSON() as never, FORMATS)[1] }
}

const press = (target: Element) => {
  fireEvent.pointerDown(target)
  fireEvent.mouseDown(target)
  fireEvent.mouseUp(target)
  fireEvent.click(target, { detail: 1 })
}

describe('ParagraphLinkPanel outside press', () => {
  it.each(['kontakt.html', 'www.x.de', '/seite', 'https://x.de/a'])(
    'an unchanged existing link (%s) closes without a notice',
    (href) => {
      const { calls } = setup(href)
      press(outside!)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(calls.close).toBe(1)
    },
  )

  it('a changed draft swallows the press and shows the notice', () => {
    const { calls, outsideClicks } = setup('https://x.de/a')
    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://x.de/b' } })
    press(outside!)
    expect(screen.getByRole('alert').textContent).toContain('Unsaved link change')
    expect(calls.close).toBe(0)
    expect(outsideClicks()).toBe(0)
  })

  it('a programmatic or keyboard click elsewhere is not swallowed', () => {
    const { outsideClicks } = setup('https://x.de/a')
    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://x.de/b' } })
    fireEvent.click(outside!, { detail: 0 })
    outside!.click()
    expect(outsideClicks()).toBe(2)
  })

  it('a changed draft: focus leaving the panel shows the notice and returns to the panel', async () => {
    setup('https://x.de/a')
    const input = screen.getByLabelText('Link URL')
    input.focus()
    fireEvent.change(input, { target: { value: 'https://x.de/b' } })
    await act(async () => {
      outside!.focus()
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(screen.getByRole('alert').textContent).toContain('Unsaved link change')
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull()
  })

  it('a changed draft: Escape anywhere discards the draft and closes the panel', () => {
    const { calls, href } = setup('https://x.de/a')
    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://x.de/b' } })
    fireEvent.keyDown(outside!, { key: 'Escape' })
    expect(calls.close).toBe(1)
    expect(href()).toMatchObject({ href: 'https://x.de/a' })
  })

  it('a changed draft swallows the context menu outside', () => {
    setup('https://x.de/a')
    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://x.de/b' } })
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    outside!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('a swallowed press without a click (right button) does not eat a later keyboard click on Apply', () => {
    const { calls, href } = setup('https://x.de/a')
    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://x.de/b' } })
    fireEvent.pointerDown(outside!, { button: 2 })
    fireEvent.mouseDown(outside!, { button: 2 })
    fireEvent.mouseUp(outside!, { button: 2 })
    fireEvent.pointerUp(outside!, { button: 2 })
    const notice = screen.getByRole('alert')
    const apply = Array.from(notice.querySelectorAll('button')).find((b) => b.textContent === 'Apply')!
    fireEvent.click(apply, { detail: 0 })
    expect(calls.close).toBe(1)
    expect(href()).toMatchObject({ href: 'https://x.de/b' })
  })

  it('a swallowed press cancelled by the browser (pointercancel) does not eat a later click outside', () => {
    const { outsideClicks } = setup('https://x.de/a')
    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://x.de/b' } })
    fireEvent.pointerDown(outside!)
    fireEvent.pointerCancel(outside!)
    outside!.click()
    expect(outsideClicks()).toBe(1)
  })
})

describe('ParagraphLinkPanel returns focus synchronously', () => {
  // The panel unmounts on close; a deferred focus (commands.focus → next
  // frame) left a gap in which Enter reached the admin body instead of the editor.
  it.each(['Apply', 'Remove'])('%s puts focus back into the editor in the same task', (name) => {
    setup('https://x.de/a')
    const input = screen.getByLabelText('Link URL')
    input.focus()
    fireEvent.change(input, { target: { value: 'https://x.de/b' } })
    const button = screen.getAllByRole('button').find((b) => b.textContent === name)!
    button.focus()
    fireEvent.click(button)
    expect(document.activeElement).toBe(editor!.view.dom)
  })
})
