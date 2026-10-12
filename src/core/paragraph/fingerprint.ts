import type { NodeTree, PageNode } from '@core/page-tree'
import type { TextFormatsSettings } from '@core/text-formats'
import { readParagraphRuns, type ParagraphTarget } from './read'

/**
 * Changes whenever the paragraph's node structure, tag or content changes —
 * the tag is part of it because the commit writes `target.tag` (captured at
 * session start) when it converts between a single text and a container.
 */
export function paragraphFingerprint(
  tree: NodeTree<PageNode>,
  target: ParagraphTarget,
  formats: TextFormatsSettings,
): string {
  const node = tree.nodes[target.nodeId]
  if (!node) return 'missing'
  return JSON.stringify({
    m: node.moduleId,
    t: node.props.tag ?? null,
    ct: node.props.customTag ?? null,
    c: node.children,
    // Format runs do not carry classes, and a node read through a format
    // variant keeps its own on commit — so a class change must show here.
    cl: node.children.map((id) => tree.nodes[id]?.classIds ?? null),
    r: readParagraphRuns(tree, target, formats),
  })
}
