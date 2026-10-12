/**
 * A format run read through a format variant shows with its own stored
 * classes during the session (editor and loading preview) — display only:
 * the runs the editor hands back carry no classes.
 */
import { describe, it, expect } from 'bun:test'
import { createParagraphEditor } from '@site/canvas/paragraph/paragraphEditor'
import { createParagraphPreview } from '@site/canvas/paragraph/paragraphPreview'
import { docToRuns } from '@site/canvas/paragraph/paragraphDoc'
import { paragraphFormatClassNames } from '@site/canvas/paragraph/paragraphFixedNodes'
import type { Run } from '@core/paragraph'
import type { TextFormatsSettings } from '@core/text-formats'
import { paragraphTree, strong, text } from '../paragraph/paragraphFixtures'

const FORMATS: TextFormatsSettings = {
  formats: [{ id: 'bold', label: 'Bold', tag: 'strong', classIds: ['primary'], variants: [['highlight']] }],
  link: { classIds: [] },
}
const RULES = {
  primary: { name: 'text-strong', kind: 'class' },
  highlight: { name: 'highlight', kind: 'class' },
} as never
const classNameOf = (ids: readonly string[]) =>
  ids.map((id) => (id === 'primary' ? 'text-strong' : id === 'highlight' ? 'highlight' : id)).join(' ')
const RUNS: Run[] = [
  { kind: 'format', formatId: 'bold', text: '5,000' },
  { kind: 'text', text: ' und ' },
  { kind: 'format', formatId: 'bold', text: 'plan' },
]

describe('variant display classes', () => {
  it('paragraphFormatClassNames names the stored classes of variant nodes only', () => {
    const tree = paragraphTree([strong('h', '5,000', ['highlight']), text('t', ' und '), strong('s', 'plan', ['primary'])])
    expect(paragraphFormatClassNames(tree, { kind: 'container', nodeId: 'para', tag: 'p' }, RUNS, FORMATS, RULES)).toEqual([
      'highlight', undefined, undefined,
    ])
  })

  it('the editor renders a variant run with its classes and hands back plain format runs', () => {
    const el = document.createElement('p')
    document.body.appendChild(el)
    const editor = createParagraphEditor({
      element: el, runs: RUNS, formats: FORMATS, classNameOf, fixedNodes: {},
      formatClassNames: ['highlight', undefined, undefined],
      isKnownClassId: () => true, onCommit: () => {}, onCancel: () => {}, onRequestLink: () => {},
    })
    expect([...el.querySelectorAll('strong')].map((s) => s.className)).toEqual(['highlight', 'text-strong'])
    expect(docToRuns(editor.getJSON() as never, FORMATS)).toEqual(RUNS)
    // Bolding new text uses the primary classes.
    editor.commands.setTextSelection({ from: 6, to: 9 }) // "und"
    editor.commands.toggleMark('fmt_bold')
    expect([...el.querySelectorAll('strong')].map((s) => s.className)).toEqual(['highlight', 'text-strong', 'text-strong'])
    editor.destroy()
  })

  it('the loading preview uses the same classes', () => {
    const preview = createParagraphPreview(document, {
      runs: RUNS, formats: FORMATS, classNameOf, fixedNodes: {}, formatClassNames: ['highlight', undefined, undefined],
    })
    expect([...preview.querySelectorAll('strong')].map((s) => s.className)).toEqual(['highlight', 'text-strong'])
  })
})
