/**
 * Module-level hand-off between the paragraph-mode pieces that live in
 * different React trees and chunks: the host inside the canvas iframe
 * (ParagraphEditHost), the lazily loaded menu + link panel in the editor
 * document, and the editor's own key map. Kept free of TipTap runtime imports.
 */
import { useSyncExternalStore } from 'react'
import type { Editor } from '@tiptap/core'

let editor: Editor | null = null
let linkRequestPending = false
let linkPanelOpen = false
let linkPanelCloser: (() => void) | null = null
let commitHandler: (() => void) | null = null
const listeners = new Set<() => void>()
const linkRequestListeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function setParagraphEditor(next: Editor | null): void { editor = next; emit() }
export function getParagraphEditor(): Editor | null { return editor }
export function useParagraphEditor(): Editor | null { return useSyncExternalStore(subscribe, () => editor) }

/**
 * Ctrl+K inside the editor. A pending flag (not just an event) so a request
 * made before the lazily loaded menu mounted still opens the panel once it
 * does; `takeLinkPanelRequest` consumes it.
 */
export function requestLinkPanel(): void {
  linkRequestPending = true
  linkRequestListeners.forEach((l) => l())
}
export function subscribeLinkPanelRequest(listener: () => void): () => void {
  linkRequestListeners.add(listener)
  return () => linkRequestListeners.delete(listener)
}
export function takeLinkPanelRequest(): boolean {
  const pending = linkRequestPending
  linkRequestPending = false
  return pending
}
/** Drop a request left over from an earlier session (called on session start). */
export function resetLinkPanelRequest(): void { linkRequestPending = false }

export function setLinkPanelOpen(open: boolean): void { linkPanelOpen = open }
export function isLinkPanelOpen(): boolean { return linkPanelOpen }
/** The open panel registers how to close itself (Escape inside the editor). */
export function setLinkPanelCloser(close: (() => void) | null): void { linkPanelCloser = close }
export function closeLinkPanel(): void { linkPanelCloser?.() }

/** The claiming host registers its once-only commit (outside press while the link panel has focus). */
export function setParagraphCommitHandler(commit: (() => void) | null): void { commitHandler = commit }
export function requestParagraphCommit(): void { commitHandler?.() }

/**
 * Formatting-menu readiness. The lazily loaded menu registers TipTap's
 * BubbleMenu plugin after the editor exists; registering reconfigures the
 * editor state, which resets a native selection change (Shift+Arrow) the
 * editor has not read back yet. The host therefore focuses — and so lets the
 * user type — only once the menu reports its plugin registered for that
 * editor, or after a bounded timeout when the menu never arrives.
 */
let menuReadyFor: Editor | null = null
const menuReadyListeners = new Set<(ready: Editor) => void>()

/** Called by the menu once its plugin is registered on `ready`. */
export function markParagraphMenuReady(ready: Editor): void {
  menuReadyFor = ready
  menuReadyListeners.forEach((l) => l(ready))
}

/**
 * Run `onReady` once the menu is ready for `target` (immediately when it
 * already is), or after `timeoutMs` at the latest. Runs at most once; the
 * returned function cancels it.
 */
export function whenParagraphMenuReady(target: Editor, timeoutMs: number, onReady: () => void): () => void {
  if (menuReadyFor === target) {
    onReady()
    return () => {}
  }
  let done = false
  const listener = (ready: Editor) => {
    if (ready === target) finish()
  }
  const stop = () => {
    done = true
    clearTimeout(timer)
    menuReadyListeners.delete(listener)
  }
  const finish = () => {
    if (done) return
    stop()
    onReady()
  }
  menuReadyListeners.add(listener)
  const timer = setTimeout(finish, timeoutMs)
  return stop
}
