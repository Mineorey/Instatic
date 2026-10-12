import {
  createNode,
  deleteNode,
  insertNode,
  moveNode,
  updateNodeProps,
  type NodeTree,
  type PageNode,
} from '@core/page-tree'
import { registry } from '@core/module-engine'
import type { TextFormatsSettings } from '@core/text-formats'
import { childToRun, isParagraphBreakNode, type ParagraphTarget } from './read'
import { normalizeRuns } from './normalize'
import { sameClassIds, type Run } from './runs'

type EditableRun = Exclude<Run, { kind: 'fixed' }>

/**
 * One child node to write: a run, or a line break. Line breaks in plain text
 * become their own `<br>` node (`isParagraphBreakNode`) — a plain-text node
 * publishes `\n` verbatim, where it collapses to a space. Formats keep their
 * `\n` (base.text renders it as `<br>` inside its tag).
 */
type ChildPlan = { kind: 'run'; run: Run } | { kind: 'break' }

function childPlans(runs: readonly Run[]): ChildPlan[] {
  return runs.flatMap((run): ChildPlan[] => {
    if (run.kind !== 'text' || !run.text.includes('\n')) return [{ kind: 'run', run }]
    const plans: ChildPlan[] = []
    run.text.split('\n').forEach((part, index) => {
      if (index > 0) plans.push({ kind: 'break' })
      if (part) plans.push({ kind: 'run', run: { kind: 'text', text: part } })
    })
    return plans
  })
}

function createBreakNode(): PageNode {
  return createNode('base.container', { ...moduleDefaults('base.container'), tag: 'custom', customTag: 'br' })
}

export type ParagraphCommitResult =
  | { status: 'applied'; nodeId: string }
  | { status: 'unchanged' }
  | { status: 'conflict' }

function moduleDefaults(moduleId: string): Record<string, unknown> {
  return { ...(registry.get(moduleId)?.defaults ?? {}) }
}

/** Detach a value from a mutative draft (drafts can't be structuredClone'd). */
function plainCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createRunNode(run: EditableRun, formats: TextFormatsSettings): PageNode {
  if (run.kind === 'text') {
    return createNode('base.text', { ...moduleDefaults('base.text'), text: run.text, tag: 'none' })
  }
  if (run.kind === 'format') {
    const format = formats.formats.find((f) => f.id === run.formatId)
    if (!format) throw new Error(`[paragraph] Unknown text format "${run.formatId}"`)
    const node = createNode('base.text', { ...moduleDefaults('base.text'), text: run.text, tag: format.tag })
    node.classIds = [...format.classIds]
    return node
  }
  const node = createNode('base.link', {
    ...moduleDefaults('base.link'),
    text: run.text,
    href: run.href,
    target: run.target,
  })
  node.classIds = [...run.classIds]
  return node
}

function runMatchesNode(node: PageNode, run: EditableRun, formats: TextFormatsSettings): boolean {
  if (isParagraphBreakNode(node)) return false
  const current = childToRun(node, formats)
  if (!current || current.kind !== run.kind) return false
  return run.kind !== 'format' || (current.kind === 'format' && current.formatId === run.formatId)
}

function updateRunNode(tree: NodeTree<PageNode>, nodeId: string, run: Run): void {
  const node = tree.nodes[nodeId]
  const patch: Record<string, unknown> = {}
  if (node.props.text !== run.text) patch.text = run.text
  if (run.kind === 'link') {
    if (node.props.href !== run.href) patch.href = run.href
    if (node.props.target !== run.target) patch.target = run.target
    if (!sameClassIds(node.classIds, run.classIds)) node.classIds = [...run.classIds]
  }
  if (Object.keys(patch).length > 0) updateNodeProps(tree, nodeId, patch)
}

/**
 * Swap `old` for `fresh` at the same position, carrying classes, styles, label,
 * attributes and the locked/hidden flags over. Prop bindings and breakpoint
 * overrides cannot be carried — such paragraphs are not eligible (read.ts).
 */
function replaceNode(tree: NodeTree<PageNode>, old: PageNode, fresh: PageNode): PageNode {
  const parentId = old.parentId
  if (!parentId) throw new Error('[paragraph] Paragraph node has no parent')
  const index = tree.nodes[parentId].children.indexOf(old.id)
  // Read everything off `old` before deleting it (it may be a mutative draft).
  fresh.classIds = plainCopy(old.classIds)
  if (old.inlineStyles) fresh.inlineStyles = plainCopy(old.inlineStyles)
  if (old.label) fresh.label = old.label
  if (old.props.htmlAttributes) fresh.props.htmlAttributes = plainCopy(old.props.htmlAttributes)
  if (old.locked !== undefined) fresh.locked = old.locked
  if (old.hidden !== undefined) fresh.hidden = old.hidden
  deleteNode(tree, old.id)
  insertNode(tree, fresh, parentId, index)
  return tree.nodes[fresh.id]
}

/**
 * Fixed runs whose node is gone, or whose text was duplicated (paste), become
 * plain text so they can merge with their neighbours. A pasted duplicate that
 * precedes the original keeps the node on its first occurrence (visible result is identical).
 */
function demoteStaleFixedRuns(runs: readonly Run[], childIds: readonly string[]): Run[] {
  const seen = new Set<string>()
  return runs.map((run): Run => {
    if (run.kind !== 'fixed') return run
    if (childIds.includes(run.nodeId) && !seen.has(run.nodeId)) {
      seen.add(run.nodeId)
      return run
    }
    return { kind: 'text', text: run.text }
  })
}

/** Identity of a run for alignment: kind, format / link data and text (a fixed run: its node). */
function runKey(run: Run): string {
  switch (run.kind) {
    case 'text': return JSON.stringify(['t', run.text])
    case 'format': return JSON.stringify(['f', run.formatId, run.text])
    case 'link': return JSON.stringify(['l', run.href, run.target, run.classIds, run.text])
    case 'fixed': return JSON.stringify(['x', run.nodeId])
  }
}

const BREAK_KEY = 'br'

/** Index pairs (a, b) of a longest common subsequence of `a` and `b`, ascending. */
function longestCommonPairs(a: readonly string[], b: readonly (string | null)[]): [number, number][] {
  const n = a.length
  const m = b.length
  // lengths[i][j] = LCS length of a[i..] and b[j..]
  const lengths = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++
    else j++
  }
  return pairs
}

/**
 * Map the planned children onto the existing ones, then write them. Nodes
 * keep their id and — for formats read through a variant — their classes
 * wherever the content allows:
 *
 * 1. Align: a longest common subsequence of the plans and the existing
 *    children by identity (`runKey`: kind, format / link data, text; a
 *    fixed run is its node) pins the pairs that stayed as they were, in order.
 * 2. Exact elsewhere: an unpinned plan takes an unused node with the same
 *    identity anywhere (a word moved, two words swapped; fixed runs always
 *    find their node here).
 * 3. By order: within each gap between two pins, the next unused node of
 *    the same kind and format (only the text changed).
 * 4. Create the rest; delete unused nodes; fix the order.
 */
function reconcileChildren(
  tree: NodeTree<PageNode>,
  parentId: string,
  runs: readonly Run[],
  formats: TextFormatsSettings,
): void {
  const existing = [...tree.nodes[parentId].children]
  const plans = childPlans(runs)
  const planKeys = plans.map((plan) => (plan.kind === 'break' ? BREAK_KEY : runKey(plan.run)))
  const nodeKeys = existing.map((id) => {
    const node = tree.nodes[id]
    if (isParagraphBreakNode(node)) return BREAK_KEY
    const run = childToRun(node, formats)
    return run ? runKey(run) : null
  })

  const assigned: (string | null)[] = plans.map(() => null)
  const used = new Set<string>()
  const assign = (planIndex: number, nodeIndex: number) => {
    assigned[planIndex] = existing[nodeIndex]
    used.add(existing[nodeIndex])
  }

  // 1. Align.
  const pins = longestCommonPairs(planKeys, nodeKeys)
  for (const [p, n] of pins) assign(p, n)

  // 2. Exact elsewhere.
  plans.forEach((_, p) => {
    if (assigned[p] !== null) return
    const n = existing.findIndex((id, i) => !used.has(id) && nodeKeys[i] === planKeys[p])
    if (n >= 0) assign(p, n)
  })

  // 3. By order inside each gap between pins.
  let pinIndex = 0
  let gapCursor = 0
  plans.forEach((plan, p) => {
    while (pinIndex < pins.length && pins[pinIndex][0] < p) {
      gapCursor = pins[pinIndex][1] + 1
      pinIndex++
    }
    if (assigned[p] !== null || plan.kind === 'break' || plan.run.kind === 'fixed') return
    const gapEnd = pinIndex < pins.length ? pins[pinIndex][1] : existing.length
    const run: EditableRun = plan.run
    for (let n = gapCursor; n < gapEnd; n++) {
      const id = existing[n]
      if (!used.has(id) && runMatchesNode(tree.nodes[id], run, formats)) {
        assign(p, n)
        gapCursor = n + 1
        break
      }
    }
  })

  // 4. Write.
  const finalIds = plans.map((plan, p) => {
    if (plan.kind === 'break') {
      const reused = assigned[p]
      if (reused) return reused
      const fresh = createBreakNode()
      insertNode(tree, fresh, parentId)
      return fresh.id
    }
    const run = plan.run
    // Fixed nodes keep their formatting untouched; only their text is updated.
    const reused = run.kind === 'fixed' ? run.nodeId : assigned[p]
    if (reused) {
      used.add(reused)
      updateRunNode(tree, reused, run)
      return reused
    }
    const fresh = createRunNode(run as EditableRun, formats)
    insertNode(tree, fresh, parentId)
    return fresh.id
  })

  for (const id of existing) if (!used.has(id)) deleteNode(tree, id)
  // moveNode removes first, then splices at the clamped index, so ascending order is stable.
  finalIds.forEach((id, index) => {
    if (tree.nodes[parentId].children[index] !== id) moveNode(tree, id, parentId, index)
  })
}

/**
 * Write a paragraph's runs back into the node tree (spec §5/§6.1 step 4).
 * Returns the id of the resulting paragraph node — it changes when the
 * paragraph converts between a single base.text and a container.
 */
export function applyParagraphRuns(
  tree: NodeTree<PageNode>,
  target: ParagraphTarget,
  input: readonly Run[],
  formats: TextFormatsSettings,
): string {
  const node = tree.nodes[target.nodeId]
  if (!node) throw new Error('[paragraph] Paragraph node is gone')
  const runs = normalizeRuns(demoteStaleFixedRuns(input, target.kind === 'container' ? node.children : []))
  const plainOnly = runs.every((r) => r.kind === 'text')
  const plainText = plainOnly ? runs.map((r) => r.text).join('') : ''

  if (target.kind === 'text') {
    if (plainOnly) {
      if (node.props.text !== plainText) updateNodeProps(tree, node.id, { text: plainText })
      return node.id
    }
    const container = replaceNode(
      tree,
      node,
      createNode('base.container', { ...moduleDefaults('base.container'), tag: 'custom', customTag: target.tag }),
    )
    reconcileChildren(tree, container.id, runs, formats)
    return container.id
  }

  if (plainOnly && target.tag !== 'li') {
    const single = replaceNode(
      tree,
      node,
      createNode('base.text', { ...moduleDefaults('base.text'), text: plainText, tag: target.tag }),
    )
    return single.id
  }
  reconcileChildren(tree, node.id, runs, formats)
  return node.id
}
