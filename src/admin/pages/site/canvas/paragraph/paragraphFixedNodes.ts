/**
 * What paragraph mode knows about a session's fixed runs (nodes it does not
 * understand): the tag and class names they render with — for the editor's
 * fixed mark and the static preview — and whether they are merely an unknown
 * format, for the hint on the disabled format buttons. Free of TipTap
 * runtime imports (used by the host in the canvas body chunk).
 */
import { classNamesForClassIds, type NodeTree, type PageNode, type StyleRule } from '@core/page-tree'
import { isUnrecognisedFormatNode, type ParagraphTarget, type Run } from '@core/paragraph'
import type { TextFormatsSettings } from '@core/text-formats'

export interface FixedNodeInfo {
  tag: string
  /** Class names, space-separated. */
  className: string
  /** True when only the missing text-format setting makes it fixed (`isUnrecognisedFormatNode`). */
  unknownFormat: boolean
}

export function paragraphFixedNodes(
  tree: NodeTree<PageNode>,
  styleRules: Record<string, StyleRule>,
  runs: readonly Run[],
): Record<string, FixedNodeInfo> {
  const fixedNodes: Record<string, FixedNodeInfo> = {}
  for (const run of runs) {
    if (run.kind !== 'fixed') continue
    const node = tree.nodes[run.nodeId]
    if (!node) continue
    fixedNodes[run.nodeId] = {
      tag: node.moduleId === 'base.link' ? 'a' : String(node.props.tag ?? 'span'),
      className: classNamesForClassIds(styleRules, node.classIds).join(' '),
      unknownFormat: isUnrecognisedFormatNode(node),
    }
  }
  return fixedNodes
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

/**
 * Per run (aligned with `runs`, read from the paragraph's children): the
 * class names a format run read through a format variant is stored with —
 * undefined for every other run and for formats with their own classes.
 * Display only: the editor and the preview show such a word as it is
 * stored; nothing of it goes back into the runs.
 */
export function paragraphFormatClassNames(
  tree: NodeTree<PageNode>,
  target: ParagraphTarget,
  runs: readonly Run[],
  formats: TextFormatsSettings,
  styleRules: Record<string, StyleRule>,
): (string | undefined)[] {
  const children = target.kind === 'container' ? (tree.nodes[target.nodeId]?.children ?? []) : []
  return runs.map((run, index) => {
    if (run.kind !== 'format') return undefined
    const node = tree.nodes[children[index]]
    const format = formats.formats.find((f) => f.id === run.formatId)
    if (!node || !format || sameSet(node.classIds, format.classIds)) return undefined
    return classNamesForClassIds(styleRules, node.classIds).join(' ')
  })
}

/** `strong.highlight` — the tag plus each class, CSS-selector style. */
export function describeFixedNode(info: FixedNodeInfo): string {
  const tag = info.tag === 'none' ? 'text' : info.tag
  return tag + info.className.split(/\s+/).filter(Boolean).map((name) => `.${name}`).join('')
}

/** The hint for format / link buttons disabled by fixed runs, or null without any. */
export function unknownFormattingHint(infos: readonly FixedNodeInfo[]): string | null {
  const unknown = [...new Set(infos.filter((i) => i.unknownFormat).map(describeFixedNode))]
  if (unknown.length > 0) {
    return `Unknown formatting (${unknown.join(', ')}) — add it under Settings → Text formats`
  }
  const other = [...new Set(infos.map(describeFixedNode))]
  return other.length > 0 ? `Special formatting (${other.join(', ')}) — change it outside paragraph mode` : null
}
