import type { NodeTree, PageNode } from '@core/page-tree'
import { resolveHtmlTag } from '@core/htmlAttributes'
import type { TextFormatsSettings } from '@core/text-formats'
import { isLinkTarget, type Run } from './runs'

const CONTAINER_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'])
const TEXT_BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const INLINE_TEXT_TAGS = new Set(['none', 'strong', 'em', 'span', 'small'])

export interface ParagraphTarget {
  /** `container`: base.container with paragraph tag; `text`: single base.text paragraph. */
  kind: 'container' | 'text'
  nodeId: string
  tag: string
}

const nonEmpty = (o: object | undefined | null) => o != null && Object.keys(o).length > 0

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((x) => set.has(x))
}

/** Bindings and per-breakpoint overrides — state a run node or a converted paragraph node cannot carry. */
function hasBindingsOrOverrides(node: PageNode): boolean {
  return nonEmpty(node.propBindings) || Object.values(node.breakpointOverrides ?? {}).some(nonEmpty)
}

function hasExtras(node: PageNode): boolean {
  return (
    nonEmpty(node.inlineStyles) ||
    nonEmpty(node.props.htmlAttributes as object | undefined) ||
    hasBindingsOrOverrides(node)
  )
}

/**
 * A plain `<br>` child (`base.container`, custom tag `br`, nothing else) — how
 * a paragraph container stores a line break in plain text. A `base.text` with
 * tag `none` publishes its text verbatim (it must, for `<pre>` content), so a
 * `\n` there would collapse to a space; HTML import stores `<br>` the same way.
 */
export function isParagraphBreakNode(node: PageNode): boolean {
  return (
    node.moduleId === 'base.container' &&
    resolveHtmlTag(String(node.props.tag ?? 'div'), String(node.props.customTag ?? '')) === 'br' &&
    node.children.length === 0 &&
    node.classIds.length === 0 &&
    !nonEmpty(node.dynamicBindings) &&
    !hasExtras(node)
  )
}

/**
 * The format a `tag` + class set reads as: a format's primary classes first,
 * then its variants (both recognised; `settleVariants` keeps them unambiguous).
 */
function formatOfClassSet(formats: TextFormatsSettings, tag: string, classIds: readonly string[]) {
  const sameTag = formats.formats.filter((f) => f.tag === tag)
  return (
    sameTag.find((f) => sameSet(f.classIds, classIds)) ??
    sameTag.find((f) => f.variants?.some((variant) => sameSet(variant, classIds)))
  )
}

/**
 * A child that reads as a fixed run only because no text format claims its
 * tag + classes — adding them under Settings → Text formats would make it a
 * format run. (Fixed runs with inline styles, attributes or bindings, links
 * and classed plain text stay fixed whatever the settings say.)
 */
export function isUnrecognisedFormatNode(node: PageNode): boolean {
  const tag = String(node.props.tag ?? 'p')
  return (
    node.moduleId === 'base.text' &&
    tag !== 'none' &&
    INLINE_TEXT_TAGS.has(tag) &&
    node.children.length === 0 &&
    !nonEmpty(node.dynamicBindings) &&
    !hasExtras(node)
  )
}

/**
 * One child → one run (a line-break node → a plain `\n`). `null` means the
 * child makes the paragraph ineligible.
 */
export function childToRun(node: PageNode, formats: TextFormatsSettings): Run | null {
  if (isParagraphBreakNode(node)) return { kind: 'text', text: '\n' }
  if (node.children.length > 0 || nonEmpty(node.dynamicBindings)) return null
  const text = String(node.props.text ?? '')
  if (node.moduleId === 'base.text') {
    const tag = String(node.props.tag ?? 'p')
    if (!INLINE_TEXT_TAGS.has(tag)) return null
    if (!hasExtras(node)) {
      if (tag === 'none' && node.classIds.length === 0) return { kind: 'text', text }
      const format = formatOfClassSet(formats, tag, node.classIds)
      if (format) return { kind: 'format', formatId: format.id, text }
    }
    return { kind: 'fixed', nodeId: node.id, text }
  }
  if (node.moduleId === 'base.link') {
    if (hasExtras(node)) return { kind: 'fixed', nodeId: node.id, text }
    const target = isLinkTarget(node.props.target) ? node.props.target : '_self'
    return { kind: 'link', text, href: String(node.props.href ?? ''), target, classIds: [...node.classIds] }
  }
  return null
}

export function paragraphTargetOf(
  node: PageNode,
  tree: NodeTree<PageNode>,
  formats: TextFormatsSettings,
): ParagraphTarget | null {
  // Prop bindings and breakpoint overrides would be lost when the paragraph
  // converts between a single base.text and a container (apply.ts replaceNode),
  // and a bound/overridden text cannot be edited as one rich text anyway.
  if (nonEmpty(node.dynamicBindings) || hasBindingsOrOverrides(node)) return null
  if (node.moduleId === 'base.text') {
    const tag = String(node.props.tag ?? 'p')
    if (node.children.length > 0 || !TEXT_BLOCK_TAGS.has(tag)) return null
    return { kind: 'text', nodeId: node.id, tag }
  }
  if (node.moduleId === 'base.container') {
    const tag = resolveHtmlTag(String(node.props.tag ?? 'div'), String(node.props.customTag ?? ''))
    if (!CONTAINER_TAGS.has(tag)) return null
    for (const id of node.children) {
      const child = tree.nodes[id]
      const run = child ? childToRun(child, formats) : null
      if (!run || (run.kind === 'fixed' && run.text === '')) return null
    }
    return { kind: 'container', nodeId: node.id, tag }
  }
  return null
}

export function resolveParagraphTarget(
  tree: NodeTree<PageNode>,
  nodeId: string,
  formats: TextFormatsSettings,
): ParagraphTarget | null {
  const node = tree.nodes[nodeId]
  if (!node) return null
  const own = paragraphTargetOf(node, tree, formats)
  if (own) return own
  const parent = node.parentId ? tree.nodes[node.parentId] : undefined
  return parent?.moduleId === 'base.container' ? paragraphTargetOf(parent, tree, formats) : null
}

export function readParagraphRuns(
  tree: NodeTree<PageNode>,
  target: ParagraphTarget,
  formats: TextFormatsSettings,
): Run[] {
  const node = tree.nodes[target.nodeId]
  if (!node) return []
  if (target.kind === 'text') {
    const value = String(node.props.text ?? '')
    return value ? [{ kind: 'text', text: value }] : []
  }
  return node.children.flatMap((id) => {
    const child = tree.nodes[id]
    const run = child ? childToRun(child, formats) : null
    return run ? [run] : []
  })
}
