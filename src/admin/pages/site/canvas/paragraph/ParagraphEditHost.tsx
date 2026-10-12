import { useLayoutEffect, useRef, useState, type ElementType, type HTMLAttributes, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { classNamesForClassIds } from '@core/page-tree'
import { isUsableClassId } from '@core/text-formats'
import { useEditorStore } from '@site/store/store'
import { getActiveTree } from '@site/store/slices/selectionSlice'
import { docToRuns, type ParagraphDocJSON } from './paragraphDoc'
import { createParagraphPreview, injectParagraphEditorStyles } from './paragraphPreview'
import { paragraphFixedNodes, paragraphFormatClassNames } from './paragraphFixedNodes'
import { loadedParagraphMode, loadParagraphMode, type ParagraphEditorModule } from './paragraphModeLoader'
import {
  closeLinkPanel,
  getParagraphEditor,
  isLinkPanelOpen,
  requestLinkPanel,
  resetLinkPanelRequest,
  setParagraphCommitHandler,
  setParagraphEditor,
  whenParagraphMenuReady,
} from './paragraphEditorRegistry'
import {
  claimParagraphHost,
  releaseParagraphHost,
  scheduleOrphanedParagraphCheck,
  useParagraphHostClaimedByOther,
} from './paragraphHostClaim'
import { canvasDocuments } from './canvasDocuments'

/**
 * Upper bound for waiting on the formatting menu before focusing anyway — the
 * menu chunk is preloaded alongside the editor, so this only matters when it
 * failed to load or mount.
 */
const MENU_READY_TIMEOUT_MS = 500

const BACKSPACE = Symbol('backspace')

/** Replay keys pressed before the editor was ready at its caret (see the host's early-key handler). */
function replayTypedAhead(editor: Editor, keys: readonly (string | typeof BACKSPACE)[]): void {
  for (const key of keys) {
    if (key === BACKSPACE) {
      editor.commands.command(({ tr }) => {
        const { from, to, empty } = tr.selection
        if (!empty) tr.delete(from, to)
        else if (from > 0) tr.delete(from - 1, from)
        return true
      })
      continue
    }
    key.split('\n').forEach((part, index) => {
      if (index > 0) editor.commands.setHardBreak()
      if (part) editor.commands.command(({ tr }) => {
        tr.insertText(part)
        return true
      })
    })
  }
}

interface Props {
  tag: string
  className: string | undefined
  wrapperProps: HTMLAttributes<HTMLElement> & Record<string, unknown>
  /** The normal module render — shown when another host already owns the session. */
  fallback: ReactNode
}

/**
 * Stand-in for a paragraph while paragraph mode edits it: React owns only this
 * element; TipTap owns everything inside it (spec §6.1 step 2).
 *
 * The editor runtime (TipTap) is loaded with `import()` (`paragraphModeLoader`)
 * so it never lands in the canvas body chunk. Until it is there, a static
 * preview of the runs (`paragraphPreview`) fills the element — the paragraph
 * never goes blank — and keys pressed meanwhile are kept: typed characters
 * are inserted at the caret once it is placed, Enter commits after them,
 * Escape cancels. Once the Site editor has preloaded both chunks, the editor
 * mounts in the same task the session starts. Commit and cancel each end the session exactly once:
 * Enter / Escape come from the editor's key map, a blur commits — deferred one
 * tick, because focus may be moving into the formatting menu or link panel in
 * the parent document (those carry `data-paragraph-overlay`) — and the link
 * panel commits through the registry on a press outside the paragraph. A blur
 * caused by switching to another window or app (`document.hasFocus()` false)
 * does not commit; the check runs again when any canvas window gets focus
 * back. The page turning hidden or being left (`visibilitychange`,
 * `pagehide`) does commit.
 *
 * Focus (and with it the caret) is placed only once the formatting menu has
 * registered its plugin (`whenParagraphMenuReady`): registering reconfigures
 * the editor and would drop a selection the user already started. The host
 * then carries `data-paragraph-ready`.
 *
 * Only one host owns a session (`paragraphHostClaim`): a second host rendered
 * for the same node and frame shows `fallback` instead of a second editor.
 */
export function ParagraphEditHost({ tag, className, wrapperProps, fallback }: Props) {
  const ref = useRef<HTMLElement | null>(null)
  const [token] = useState(() => ({}))
  const claimedByOther = useParagraphHostClaimedByOther(token)

  useLayoutEffect(() => {
    const el = ref.current
    // Everything the runs render with is known now — the static preview
    // shows them at once, the editor takes over the same markup once loaded.
    const state = useEditorStore.getState()
    const session = state.activeParagraphEdit
    const tree = getActiveTree(state)
    if (claimedByOther || !el || !session || !tree || !state.site || !claimParagraphHost(token)) return
    let disposed = false
    let editor: Editor | null = null
    let finished = false
    let blurTimer: ReturnType<typeof setTimeout> | undefined
    let stopWaitingForMenu: (() => void) | undefined
    let stopWaitingForWindow: (() => void) | undefined
    resetLinkPanelRequest()

    const commit = () => {
      if (finished || disposed || !editor) return
      finished = true
      const session = useEditorStore.getState().activeParagraphEdit
      if (!session) return
      // The live document is only read here — normalisation happens in the
      // commit path (applyParagraphRuns), never inside the editor.
      useEditorStore.getState().commitParagraphEdit(docToRuns(editor.getJSON() as ParagraphDocJSON, session.formats))
    }
    const cancel = () => {
      if (finished || disposed) return
      finished = true
      useEditorStore.getState().cancelParagraphEdit()
    }
    // Escape: close an open link panel first; only a second Escape cancels.
    const escape = () => {
      if (isLinkPanelOpen()) closeLinkPanel()
      else cancel()
    }
    setParagraphCommitHandler(commit)

    // Only a window switch with the page still visible keeps the session
    // open. The page becoming hidden (tab switch, minimise) or going away
    // (tab closed, navigation) commits: an open session locks the paragraph
    // for peers and MCP edits, and a closed tab would lose the typed text.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') commit()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', commit)

    const styleRules = state.site.styleRules
    const classNameOf = (ids: readonly string[]) => classNamesForClassIds(styleRules, ids).join(' ')
    const fixedNodes = paragraphFixedNodes(tree, styleRules, session.initialRuns)
    const formatClassNames = paragraphFormatClassNames(tree, session.target, session.initialRuns, session.formats, styleRules)
    const spec = { runs: session.initialRuns, formats: session.formats, classNameOf, fixedNodes, formatClassNames }
    injectParagraphEditorStyles(el.ownerDocument)
    let preview: HTMLElement | null = createParagraphPreview(el.ownerDocument, spec)
    el.appendChild(preview)

    // Keys pressed before the editor is ready (focus still on the frame body
    // or the editor document) are replayed once the caret is placed: typed
    // characters as text (never HTML), Shift+Enter as a line break, Backspace
    // as a delete before the caret (or it drops a typed-ahead character);
    // Enter commits after them, Escape cancels. Keys aimed at the editor
    // itself (a click already focused it) pass.
    const typedAhead: (string | typeof BACKSPACE)[] = []
    let commitAhead = false
    const typeAhead = (text: string) => {
      const last = typedAhead.length - 1
      if (typeof typedAhead[last] === 'string') typedAhead[last] += text
      else typedAhead.push(text)
    }
    const backspaceAhead = () => {
      const last = typedAhead[typedAhead.length - 1]
      if (typeof last !== 'string') typedAhead.push(BACKSPACE)
      else if (last.length > 1) typedAhead[typedAhead.length - 1] = last.slice(0, -1)
      else typedAhead.pop()
    }
    const keyDocuments = [...new Set([el.ownerDocument, document])]
    const onEarlyKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
      if (editor && e.target instanceof Node && editor.view.dom.contains(e.target)) return
      if (e.key === 'Escape') cancel()
      else if (commitAhead) { /* swallowed: the session ends after the replay */ }
      else if (e.key === 'Enter') {
        if (e.shiftKey) typeAhead('\n')
        else commitAhead = true
      } else if (e.key === 'Backspace') backspaceAhead()
      else if (e.key.length === 1) typeAhead(e.key)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    const stopEarlyKeys = () => {
      for (const doc of keyDocuments) doc.removeEventListener('keydown', onEarlyKey, true)
    }
    for (const doc of keyDocuments) doc.addEventListener('keydown', onEarlyKey, true)

    const mountEditor = ({ createParagraphEditor }: ParagraphEditorModule) => {
      if (disposed || finished) return
      const created = createParagraphEditor({
        ...spec,
        element: el,
        isKnownClassId: (id) => isUsableClassId(styleRules, id),
        onCommit: commit,
        onCancel: escape,
        onRequestLink: requestLinkPanel,
      })
      // The editor renders the same markup — swap in the same task.
      preview?.remove()
      preview = null
      editor = created
      // Where did focus go? Checked one tick after a blur, and again when
      // the window comes back after a window / app switch.
      const checkFocusLeft = () => {
        stopWaitingForWindow?.()
        stopWaitingForWindow = undefined
        if (finished || disposed || isLinkPanelOpen()) return
        // Focus moved into the menu / link panel (parent document) or back
        // into the editor (iframe document) — the session continues.
        if (document.activeElement?.closest('[data-paragraph-overlay]')) return
        if (created.isFocused) return
        // No document of this window has focus: the user switched to another
        // window or app (alt-tab to copy text, a second browser window). The
        // editor blurred with it, but the session stays open; the browser
        // restores focus into the editor on return. If the user comes back
        // by clicking somewhere else instead, that is checked then.
        if (!document.hasFocus()) {
          // The return lands in whichever window gets focus: the admin or
          // any canvas frame.
          const windows = canvasDocuments().flatMap((doc) => (doc.defaultView ? [doc.defaultView] : []))
          const onReturn = () => {
            clearTimeout(blurTimer)
            blurTimer = setTimeout(checkFocusLeft, 0)
          }
          for (const win of windows) win.addEventListener('focus', onReturn)
          stopWaitingForWindow = () => {
            for (const win of windows) win.removeEventListener('focus', onReturn)
          }
          return
        }
        commit()
      }
      created.on('blur', () => {
        clearTimeout(blurTimer)
        blurTimer = setTimeout(checkFocusLeft, 0)
      })
      setParagraphEditor(created)
      stopWaitingForMenu = whenParagraphMenuReady(created, MENU_READY_TIMEOUT_MS, () => {
        stopEarlyKeys()
        // A commit / cancel meanwhile ended the session — never re-focus it.
        if (finished || disposed || created.isDestroyed) return
        // A click into the text meanwhile already placed the caret.
        if (!created.isFocused) {
          const caret = session.caret
            ? created.view.posAtCoords({ left: session.caret.x, top: session.caret.y })?.pos
            : undefined
          created.commands.focus(caret ?? 'end')
        }
        replayTypedAhead(created, typedAhead)
        el.setAttribute('data-paragraph-ready', '')
        if (commitAhead) commit()
      })
    }

    // Loaded before (the Site editor preloads both halves when idle): mount
    // in this task. Otherwise the preview stays until the chunks arrive.
    const loaded = loadedParagraphMode()
    if (loaded) mountEditor(loaded)
    else {
      loadParagraphMode()
        .then(mountEditor)
        .catch((err: unknown) => {
          console.error('[paragraph-edit] editor failed to load:', err)
          cancel()
        })
    }

    return () => {
      disposed = true
      stopEarlyKeys()
      preview?.remove()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', commit)
      clearTimeout(blurTimer)
      stopWaitingForWindow?.()
      stopWaitingForMenu?.()
      el.removeAttribute('data-paragraph-ready')
      setParagraphCommitHandler(null)
      if (editor && getParagraphEditor() === editor) setParagraphEditor(null)
      editor?.destroy()
      releaseParagraphHost(token)
      // Unmounted while the session is still open (frame removed, error
      // boundary reset): cancel it (with a warning — typing is lost) unless a
      // host re-claims it this tick.
      scheduleOrphanedParagraphCheck({ hadHost: true })
    }
  }, [claimedByOther, token])

  if (claimedByOther) return <>{fallback}</>
  const Tag = tag as ElementType
  return <Tag {...wrapperProps} className={className} ref={ref} data-paragraph-host="" />
}
