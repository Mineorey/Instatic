import { isLinkTarget, type Run } from '@core/paragraph'
import type { TextFormatsSettings } from '@core/text-formats'

export interface ParagraphMarkJSON { type: string; attrs?: Record<string, unknown> }
export interface ParagraphInlineJSON { type: string; text?: string; marks?: ParagraphMarkJSON[] }
export interface ParagraphDocJSON { type: 'doc'; content?: ParagraphInlineJSON[] }

export const LINK_MARK = 'plink'
export const FIXED_MARK = 'pfixed'

export function formatMarkName(formatId: string): string {
  return `fmt_${formatId.replace(/-/g, '_')}`
}

function marksFor(run: Run): ParagraphMarkJSON[] | undefined {
  switch (run.kind) {
    case 'text': return undefined
    case 'format': return [{ type: formatMarkName(run.formatId) }]
    case 'link': return [{ type: LINK_MARK, attrs: { href: run.href, target: run.target, classIds: [...run.classIds] } }]
    case 'fixed': return [{ type: FIXED_MARK, attrs: { nodeId: run.nodeId } }]
  }
}

/**
 * `formatClassNames` (per run, display only): a format run's stored class
 * names when it was read through a format variant — carried as the format
 * mark's `className` attribute, which `docToRuns` ignores.
 */
export function runsToDoc(runs: readonly Run[], formatClassNames?: readonly (string | undefined)[]): ParagraphDocJSON {
  const content: ParagraphInlineJSON[] = []
  for (const [index, run] of runs.entries()) {
    const className = run.kind === 'format' ? formatClassNames?.[index] : undefined
    const marks = className !== undefined
      ? [{ type: formatMarkName((run as { formatId: string }).formatId), attrs: { className } }]
      : marksFor(run)
    run.text.split('\n').forEach((part, index) => {
      if (index > 0) content.push(marks ? { type: 'hardBreak', marks } : { type: 'hardBreak' })
      if (part) content.push(marks ? { type: 'text', text: part, marks } : { type: 'text', text: part })
    })
  }
  return { type: 'doc', content }
}

function runFor(text: string, mark: ParagraphMarkJSON | undefined, byMark: Map<string, string>): Run {
  if (!mark) return { kind: 'text', text }
  if (mark.type === LINK_MARK) {
    const a = mark.attrs ?? {}
    return {
      kind: 'link',
      text,
      href: String(a.href ?? ''),
      target: isLinkTarget(a.target) ? a.target : '_self',
      classIds: Array.isArray(a.classIds) ? a.classIds.map(String) : [],
    }
  }
  if (mark.type === FIXED_MARK) return { kind: 'fixed', nodeId: String(mark.attrs?.nodeId ?? ''), text }
  const formatId = byMark.get(mark.type)
  return formatId ? { kind: 'format', formatId, text } : { kind: 'text', text }
}

/**
 * Inverse of runsToDoc. Adjacent runs with identical data are merged here.
 * Only `marks[0]` is read: every editor mark has `excludes: '_'`, so a text node carries at most one.
 */
export function docToRuns(doc: ParagraphDocJSON, formats: TextFormatsSettings): Run[] {
  const byMark = new Map(formats.formats.map((f) => [formatMarkName(f.id), f.id]))
  const runs: Run[] = []
  for (const item of doc.content ?? []) {
    const text = item.type === 'hardBreak' ? '\n' : item.type === 'text' ? (item.text ?? '') : ''
    if (!text) continue
    const run = runFor(text, item.marks?.[0], byMark)
    const prev = runs[runs.length - 1]
    const mergeable =
      prev &&
      prev.kind === run.kind &&
      JSON.stringify({ ...prev, text: '' }) === JSON.stringify({ ...run, text: '' })
    if (mergeable) runs[runs.length - 1] = { ...prev, text: prev.text + run.text } as Run
    else runs.push(run)
  }
  return runs
}
