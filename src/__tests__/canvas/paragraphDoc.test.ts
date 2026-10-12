import { describe, it, expect } from 'bun:test'
import { docToRuns, formatMarkName, runsToDoc } from '@site/canvas/paragraph/paragraphDoc'
import type { Run } from '@core/paragraph'
import type { TextFormatsSettings } from '@core/text-formats'

const FORMATS: TextFormatsSettings = {
  formats: [{ id: 'bold', label: 'B', tag: 'strong', classIds: [] }, { id: 'my-mark', label: 'M', tag: 'span', classIds: [] }],
  link: { classIds: [] },
}

describe('paragraphDoc', () => {
  it('round-trips every run kind including hard breaks', () => {
    const runs: Run[] = [
      { kind: 'text', text: 'Zeile 1\nZeile 2 ' },
      { kind: 'format', formatId: 'bold', text: 'fett\nweiter' },
      { kind: 'format', formatId: 'my-mark', text: 'markiert' },
      { kind: 'link', text: 'Seite', href: 'cms:page:p1', target: '_self', classIds: ['c'] },
      { kind: 'fixed', nodeId: 'n1', text: 'Sonder' },
    ]
    expect(docToRuns(runsToDoc(runs), FORMATS)).toEqual(runs)
  })
  it('maps hyphenated ids to valid mark names', () => {
    expect(formatMarkName('my-mark')).toBe('fmt_my_mark')
  })
  it('turns marks of unknown formats into plain text', () => {
    const doc = { type: 'doc' as const, content: [{ type: 'text', text: 'x', marks: [{ type: 'fmt_gone' }] }] }
    expect(docToRuns(doc, FORMATS)).toEqual([{ kind: 'text', text: 'x' }])
  })
})
