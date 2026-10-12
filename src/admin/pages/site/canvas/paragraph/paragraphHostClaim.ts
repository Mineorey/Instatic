/**
 * Exactly one ParagraphEditHost owns a paragraph session, and a session no
 * host owns does not outlive the tick.
 *
 * - Claim: the first host to mount for the session claims it with a token;
 *   any other host rendered for the same (node, breakpoint) — a duplicate
 *   render path the context flag did not exclude — renders the normal module.
 * - Orphan check: when the owning host unmounts while the session is still
 *   open (frame removed by a peer, canvas error-boundary reset), or when a
 *   started session never got a host, the session is cancelled one tick later
 *   unless a host (re)claimed it meanwhile. The tick keeps it StrictMode-safe:
 *   the dev double-invoke releases and re-claims synchronously. Cancelling a
 *   session whose host was already editing discards typed text, so that case
 *   warns with a toast.
 * - Start: a double-click only opens paragraph mode where a host may mount
 *   (`CanvasParagraphHostContext`); elsewhere — loop iterations, snapshot
 *   frames — it goes straight to the plain inline edit.
 */
import { useSyncExternalStore } from 'react'
import { pushToast } from '@ui/components/Toast'
import { useEditorStore } from '@site/store/store'

let claimToken: object | null = null
const listeners = new Set<() => void>()

export function subscribeParagraphHostClaim(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** True when another host than `token` owns the session (render snapshot). */
export function isParagraphHostClaimedByOther(token: object): boolean {
  return claimToken !== null && claimToken !== token
}

export function claimParagraphHost(token: object): boolean {
  if (claimToken === token) return true
  if (claimToken !== null) return false
  claimToken = token
  listeners.forEach((l) => l())
  return true
}

export function releaseParagraphHost(token: object): void {
  if (claimToken !== token) return
  claimToken = null
  listeners.forEach((l) => l())
}

export function hasParagraphHost(): boolean {
  return claimToken !== null
}

/**
 * Cancel the current session one tick from now if no host owns it by then.
 * `hadHost`: the caller is the host that owned (and edited) the session — a
 * cancel then discards the user's typing and is reported with a warning.
 */
export function scheduleOrphanedParagraphCheck({ hadHost = false }: { hadHost?: boolean } = {}): void {
  const session = useEditorStore.getState().activeParagraphEdit
  if (!session) return
  setTimeout(() => {
    const state = useEditorStore.getState()
    if (hasParagraphHost() || state.activeParagraphEdit !== session) return
    state.cancelParagraphEdit()
    if (hadHost) {
      pushToast({
        kind: 'warning',
        title: 'Paragraph edit closed',
        body: 'The paragraph left the canvas while you were editing it, so your changes were not applied.',
        location: 'site-editor',
      })
    }
  }, 0)
}

/**
 * Double-click entry: paragraph mode where a host may mount for the clicked
 * node, the plain inline edit otherwise (or when the node is no paragraph).
 * `caret` is the click's iframe client point.
 */
export function startParagraphOrInlineEdit(
  nodeId: string,
  breakpointId: string,
  caret: { x: number; y: number },
  paragraphHostAllowed: boolean,
): void {
  const state = useEditorStore.getState()
  if (paragraphHostAllowed && state.startParagraphEdit(nodeId, breakpointId, caret)) {
    // Safety net: a session no host claims (a render path that did not mount
    // one) must not leave every canvas shortcut stuck.
    scheduleOrphanedParagraphCheck()
    return
  }
  state.startInlineEdit(nodeId, breakpointId)
}

/** Re-renders when the claim changes; true while another host owns the session. */
export function useParagraphHostClaimedByOther(token: object): boolean {
  return useSyncExternalStore(subscribeParagraphHostClaim, () => isParagraphHostClaimedByOther(token))
}
