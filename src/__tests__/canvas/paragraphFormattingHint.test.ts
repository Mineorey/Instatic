/**
 * The hint on disabled format / link buttons when the selection touches a
 * fixed run (formatting paragraph mode does not know).
 */
import { describe, it, expect } from 'bun:test'
import { createParagraphEditor } from '@site/canvas/paragraph/paragraphEditor'
import { selectionFormattingHint } from '@site/canvas/paragraph/paragraphCommands'
import { describeFixedNode, unknownFormattingHint } from '@site/canvas/paragraph/paragraphFixedNodes'
import type { TextFormatsSettings } from '@core/text-formats'

const FORMATS: TextFormatsSettings = {
  formats: [{ id: 'bold', label: 'Bold', tag: 'strong', classIds: [] }],
  link: { classIds: [] },
}

describe('unknownFormattingHint', () => {
  it('names unknown formats as tag.classes and points to the settings', () => {
    expect(describeFixedNode({ tag: 'strong', className: 'highlight', unknownFormat: true })).toBe('strong.highlight')
    expect(describeFixedNode({ tag: 'span', className: 'a  b', unknownFormat: true })).toBe('span.a.b')
    expect(describeFixedNode({ tag: 'em', className: '', unknownFormat: true })).toBe('em')
    expect(
      unknownFormattingHint([
        { tag: 'strong', className: 'highlight', unknownFormat: true },
        { tag: 'strong', className: 'highlight', unknownFormat: true },
        { tag: 'span', className: 'x', unknownFormat: true },
      ]),
    ).toBe('Unknown formatting (strong.highlight, span.x) — add it under Settings → Text formats')
  })

  it('nodes that are fixed for other reasons get no settings advice', () => {
    expect(unknownFormattingHint([{ tag: 'a', className: 'btn', unknownFormat: false }])).toBe(
      'Special formatting (a.btn) — change it outside paragraph mode',
    )
    expect(unknownFormattingHint([])).toBeNull()
  })
})

describe('selectionFormattingHint', () => {
  function setup() {
    const el = document.createElement('p')
    document.body.appendChild(el)
    return createParagraphEditor({
      element: el,
      runs: [{ kind: 'text', text: 'Over ' }, { kind: 'fixed', nodeId: 'n1', text: '500 people' }, { kind: 'text', text: ' here' }],
      formats: FORMATS,
      classNameOf: () => '',
      fixedNodes: { n1: { tag: 'strong', className: 'highlight', unknownFormat: true } },
      isKnownClassId: () => true,
      onCommit: () => {}, onCancel: () => {}, onRequestLink: () => {},
    })
  }

  it('describes the fixed run the selection touches, and nothing elsewhere', () => {
    const editor = setup()
    editor.commands.setTextSelection({ from: 3, to: 10 }) // "er 500 "
    expect(selectionFormattingHint(editor)).toBe(
      'Unknown formatting (strong.highlight) — add it under Settings → Text formats',
    )
    editor.commands.setTextSelection({ from: 1, to: 4 }) // "Ove"
    expect(selectionFormattingHint(editor)).toBeNull()
    editor.destroy()
  })
})
