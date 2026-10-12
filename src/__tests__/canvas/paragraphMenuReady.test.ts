/**
 * Paragraph mode — the formatting-menu readiness hand-off. The host focuses
 * the editor (and places the caret) only once the menu has registered its
 * plugin for THAT editor, or after a bounded timeout when the menu never
 * arrives. The browser-level effect (no lost selection) is covered by
 * tests/e2e/paragraph-formatting.e2e.ts.
 */
import { describe, it, expect } from 'bun:test'
import type { Editor } from '@tiptap/core'
import { markParagraphMenuReady, whenParagraphMenuReady } from '@site/canvas/paragraph/paragraphEditorRegistry'

const fakeEditor = () => ({}) as unknown as Editor
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('whenParagraphMenuReady', () => {
  it('runs once the menu reports ready for the same editor — not for another one', () => {
    const editor = fakeEditor()
    let runs = 0
    whenParagraphMenuReady(editor, 10_000, () => { runs++ })
    markParagraphMenuReady(fakeEditor())
    expect(runs).toBe(0)
    markParagraphMenuReady(editor)
    expect(runs).toBe(1)
    markParagraphMenuReady(editor)
    expect(runs).toBe(1)
  })

  it('runs immediately when the menu is already ready for the editor', () => {
    const editor = fakeEditor()
    markParagraphMenuReady(editor)
    let runs = 0
    whenParagraphMenuReady(editor, 10_000, () => { runs++ })
    expect(runs).toBe(1)
  })

  it('falls back to the timeout when the menu never reports ready', async () => {
    let runs = 0
    whenParagraphMenuReady(fakeEditor(), 5, () => { runs++ })
    expect(runs).toBe(0)
    await tick(30)
    expect(runs).toBe(1)
  })

  it('does not run twice when ready arrives after the timeout fired', async () => {
    const editor = fakeEditor()
    let runs = 0
    whenParagraphMenuReady(editor, 5, () => { runs++ })
    await tick(30)
    markParagraphMenuReady(editor)
    expect(runs).toBe(1)
  })

  it('cancel stops both the ready signal and the timeout', async () => {
    const editor = fakeEditor()
    let runs = 0
    const cancel = whenParagraphMenuReady(editor, 5, () => { runs++ })
    cancel()
    markParagraphMenuReady(editor)
    await tick(30)
    expect(runs).toBe(0)
  })
})
