/**
 * Runs — the flat, editor-independent model of one paragraph's inline content.
 * A paragraph is a sequence of runs; each run becomes exactly one child node.
 */
export type LinkTarget = '_self' | '_blank' | '_parent'

/** The link targets paragraph mode reads, edits and writes. */
export const LINK_TARGETS: readonly LinkTarget[] = ['_self', '_blank', '_parent']

export function isLinkTarget(value: unknown): value is LinkTarget {
  return (LINK_TARGETS as readonly unknown[]).includes(value)
}

/** Ordered equality of two class-id lists (link classes keep their order). */
export function sameClassIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i])
}

export type Run =
  | { kind: 'text'; text: string }
  | { kind: 'format'; formatId: string; text: string }
  | { kind: 'link'; text: string; href: string; target: LinkTarget; classIds: string[] }
  /** A node the paragraph editor does not understand: text editable, formatting untouchable. */
  | { kind: 'fixed'; nodeId: string; text: string }

export function sameRunFormat(a: Run, b: Run): boolean {
  if (a.kind === 'text' && b.kind === 'text') return true
  if (a.kind === 'format' && b.kind === 'format') return a.formatId === b.formatId
  if (a.kind === 'link' && b.kind === 'link') {
    return a.href === b.href && a.target === b.target && sameClassIds(a.classIds, b.classIds)
  }
  return false
}
