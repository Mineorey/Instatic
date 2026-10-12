import { sameRunFormat, type Run } from './runs'

function splitBoundarySpaces(run: Run): Run[] {
  if (run.kind !== 'format' && run.kind !== 'link') return [run]
  // Only U+0020 SPACE is a boundary space; NBSP (U+00A0) and other whitespace are not.
  const lead = /^ +/.exec(run.text)?.[0] ?? ''
  const rest = run.text.slice(lead.length)
  const trail = / +$/.exec(rest)?.[0] ?? ''
  const inner = rest.slice(0, rest.length - trail.length)
  const out: Run[] = []
  if (lead) out.push({ kind: 'text', text: lead })
  if (inner) out.push({ ...run, text: inner })
  if (trail) out.push({ kind: 'text', text: trail })
  return out
}

function mergeNeighbours(runs: readonly Run[]): Run[] {
  const out: Run[] = []
  for (const run of runs) {
    // Drop empty runs, except fixed runs (unknown nodes must never be deleted).
    if (run.text === '' && run.kind !== 'fixed') continue
    const prev = out[out.length - 1]
    if (prev && sameRunFormat(prev, run)) {
      out[out.length - 1] = { ...prev, text: prev.text + run.text } as Run
    } else {
      out.push(run)
    }
  }
  return out
}

/**
 * Canonical form of a paragraph: the same visible result always yields the
 * same runs, independent of the editing history (spec §5). Produces: no empty
 * runs except fixed (unknown nodes never deleted); no two adjacent equal runs
 * except fixed; no boundary spaces in format/link runs; no double spaces in text;
 * no leading/trailing spaces or line breaks at paragraph edges (a trailing
 * break would publish as a dangling `<br>`); idempotent.
 */
export function normalizeRuns(input: readonly Run[]): Run[] {
  const merged = mergeNeighbours(input.flatMap(splitBoundarySpaces)).map((run) =>
    run.kind === 'text' ? { ...run, text: run.text.replace(/ {2,}/g, ' ') } : run,
  )
  const first = merged[0]
  if (first?.kind === 'text') merged[0] = { ...first, text: first.text.replace(/^[ \n]+/, '') }
  const lastIndex = merged.length - 1
  const last = merged[lastIndex]
  if (last?.kind === 'text') merged[lastIndex] = { ...last, text: last.text.replace(/[ \n]+$/, '') }
  return mergeNeighbours(merged)
}
