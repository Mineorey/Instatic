/**
 * Paragraph edit slice — ephemeral canvas UI state for paragraph mode
 * (double-click a paragraph, edit it as one rich text with bold/italic/link).
 * Spec: docs/specs/2026-10-08-inline-textformatierung-design.md
 *
 * Unlike the plain inline edit (live per-keystroke commits), paragraph mode
 * edits a detached copy and writes it back ONCE on commit through
 * `commitParagraphRuns` — one recipe, one undo entry. Cancel therefore needs
 * no undo: nothing reached the document.
 *
 * The session pins a `baseline` fingerprint of the paragraph at start; the
 * commit refuses (status `conflict`) when the paragraph changed meanwhile
 * (a collaborator, an undo, a Properties-panel edit), so no change is ever
 * silently overwritten.
 */
import {
  paragraphFingerprint,
  readParagraphRuns,
  resolveParagraphTarget,
  type ParagraphCommitResult,
  type ParagraphTarget,
  type Run,
} from '@core/paragraph'
import { effectiveTextFormats, type TextFormatsSettings } from '@core/text-formats'
import { pushToast } from '@ui/components/Toast'
import type { EditorStoreSliceCreator } from '@site/store/types'
import { collabAwareness, collabBreakCoalescing } from './site/collabBinding'
import { getActiveTree } from './selectionSlice'

export interface ActiveParagraphEdit {
  target: ParagraphTarget
  /** The breakpoint frame the user double-clicked in — owns the editor overlay. */
  breakpointId: string
  /** `paragraphFingerprint` at session start — the commit's conflict guard. */
  baseline: string
  /** Runs read at session start; the editor seeds its content from these. */
  initialRuns: Run[]
  /** Effective text formats at session start (menu entries + run tags). */
  formats: TextFormatsSettings
  /** Iframe client coordinates of the double-click, for caret placement. */
  caret: { x: number; y: number } | null
}

interface ParagraphEditSlice {
  activeParagraphEdit: ActiveParagraphEdit | null
  /**
   * Open a session for the paragraph `nodeId` belongs to (the node itself or
   * its paragraph container). Returns false — without opening — when another
   * text edit runs, the node is no paragraph, or a peer is editing it.
   */
  startParagraphEdit: (
    nodeId: string,
    breakpointId: string,
    caret?: { x: number; y: number } | null,
  ) => boolean
  /** Write the edited runs back as ONE undo step and close the session. */
  commitParagraphEdit: (runs: Run[]) => ParagraphCommitResult
  /** Close the session without touching the document (no undo entry). */
  cancelParagraphEdit: () => void
}

// Contribute this slice's fields to the combined `EditorStore` type via TS
// module augmentation. See `../types.ts` for why we use this pattern.
declare module '@site/store/types' {
  interface EditorStore extends ParagraphEditSlice {}
}

/** True when a remote collaborator's presence says it edits one of `nodeIds`. */
function peerIsEditing(nodeIds: readonly string[]): boolean {
  const awareness = collabAwareness()
  if (!awareness) return false
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue
    const editing = (state as { editingNodeId?: unknown } | undefined)?.editingNodeId
    if (typeof editing === 'string' && nodeIds.includes(editing)) return true
  }
  return false
}

export const createParagraphEditSlice: EditorStoreSliceCreator<ParagraphEditSlice> = (set, get) => ({
  activeParagraphEdit: null,

  startParagraphEdit: (nodeId, breakpointId, caret = null) => {
    const state = get()
    if (state.activeInlineEdit || state.activeParagraphEdit || !state.site) return false
    const tree = getActiveTree(state)
    if (!tree) return false
    const formats = effectiveTextFormats(state.site.settings.textFormats, state.site.styleRules)
    const target = resolveParagraphTarget(tree, nodeId, formats)
    if (!target) return false
    const involved = [target.nodeId, ...(tree.nodes[target.nodeId]?.children ?? [])]
    if (peerIsEditing(involved)) {
      pushToast({
        kind: 'warning',
        title: 'Someone else is editing this paragraph right now.',
        location: 'site-editor',
      })
      return false
    }
    const session: ActiveParagraphEdit = {
      target,
      breakpointId,
      baseline: paragraphFingerprint(tree, target, formats),
      initialRuns: readParagraphRuns(tree, target, formats),
      formats,
      caret,
    }
    set((s) => {
      s.activeParagraphEdit = session
    })
    // Isolate from any in-flight coalescing burst (e.g. Properties-panel typing).
    collabBreakCoalescing()
    return true
  },

  commitParagraphEdit: (runs) => {
    const session = get().activeParagraphEdit
    if (!session) return { status: 'unchanged' }
    const result = get().commitParagraphRuns(session.target, runs, session.baseline)
    set((s) => {
      s.activeParagraphEdit = null
    })
    // Later edits of the same props start a fresh undo entry.
    collabBreakCoalescing()
    // Expand / collapse replaces the paragraph node (and merging can delete a
    // selected run): keep the paragraph selected instead of nothing.
    if (
      result.status === 'applied' &&
      (result.nodeId !== session.target.nodeId || get().selectedNodeIds.length === 0)
    ) {
      get().selectNode(result.nodeId)
    }
    if (result.status === 'conflict') {
      pushToast({
        kind: 'warning',
        title: 'Paragraph changed elsewhere',
        body: 'Your edit was not applied so nothing gets overwritten. Please edit again.',
        location: 'site-editor',
      })
    }
    return result
  },

  cancelParagraphEdit: () => {
    if (!get().activeParagraphEdit) return
    set((s) => {
      s.activeParagraphEdit = null
    })
    collabBreakCoalescing()
  },
})
