/**
 * Paragraph mode's floating formatting menu (one button per text format, link,
 * clear) plus the link panel. Default export — CanvasRoot loads it lazily, so
 * TipTap's React bindings stay out of the canvas body chunk.
 *
 * The editor lives inside a breakpoint iframe while the menu renders in the
 * editor document, so its floating reference is built from the selection
 * coordinates translated into parent-document space (`selectionRect`).
 */
import { useEffect, useState } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState } from '@tiptap/react'
import { getMarkRange, type Editor } from '@tiptap/core'
import type { VirtualElement } from '@floating-ui/dom'
import { Button } from '@ui/components/Button'
import { BoldIcon } from 'pixel-art-icons/icons/bold'
import { ItalicIcon } from 'pixel-art-icons/icons/italic'
import { LinkIcon } from 'pixel-art-icons/icons/link'
import { useEditorStore } from '@site/store/store'
import { iframeScale } from '../canvasDomGeometry'
import { findRenderedCanvasNodes } from '../canvasNodeLookup'
import {
  canClearSelection,
  canEditLink,
  canFormatSelection,
  clearParagraphFormatting,
  isParagraphFormatActive,
  selectionFormattingHint,
  toggleParagraphFormat,
} from './paragraphCommands'
import { LINK_MARK } from './paragraphDoc'
import { markParagraphMenuReady, subscribeLinkPanelRequest, takeLinkPanelRequest, useParagraphEditor } from './paragraphEditorRegistry'
import { ParagraphLinkPanel, type PanelAnchor } from './ParagraphLinkPanel'
import styles from './ParagraphBubbleMenu.module.css'

/**
 * A document range's rect in parent-document coordinates. `coordsAtPos`
 * answers in the iframe's own viewport; the iframe element is CSS-scaled by
 * the canvas zoom, so the point is scaled (`iframeScale`) before the iframe's
 * outer rect is added — the same math as `clientPointToEditorDoc`.
 */
function rangeRect(editor: Editor, iframe: HTMLIFrameElement, from: number, to: number): PanelAnchor {
  const a = editor.view.coordsAtPos(from)
  const b = editor.view.coordsAtPos(to)
  const frame = iframe.getBoundingClientRect()
  const scale = iframeScale(iframe, frame)
  const left = frame.left + Math.min(a.left, b.left) * scale
  const right = frame.left + Math.max(a.right, b.right) * scale
  const top = frame.top + Math.min(a.top, b.top) * scale
  const bottom = frame.top + Math.max(a.bottom, b.bottom) * scale
  return { left, right, top, bottom, width: right - left, height: bottom - top }
}

function selectionRect(editor: Editor, iframe: HTMLIFrameElement): PanelAnchor {
  const { from, to } = editor.state.selection
  return rangeRect(editor, iframe, from, to)
}

/** The panel anchor for the link under a collapsed selection, or null when there is none. */
function linkUnderCaretRect(editor: Editor, iframe: HTMLIFrameElement): PanelAnchor | null {
  const { selection, schema } = editor.state
  const type = schema.marks[LINK_MARK]
  if (!selection.empty || !type || !editor.isActive(LINK_MARK)) return null
  const range = getMarkRange(selection.$from, type)
  return range ? rangeRect(editor, iframe, range.from, range.to) : selectionRect(editor, iframe)
}

/** The breakpoint iframe hosting the session's editor (the one with the claiming host). */
function sessionFrame(nodeId: string): HTMLIFrameElement | null {
  const hit = findRenderedCanvasNodes(nodeId).find((n) => n.element.hasAttribute('data-paragraph-host'))
  return hit?.frame ?? null
}

interface LinkPanelState {
  anchor: PanelAnchor
  /** Ctrl+K / button: focus moves into the panel. Click into a link: the caret stays in the text. */
  focusPanel: boolean
  /** Fresh panel instance per open, so it re-reads the link under the selection. */
  key: number
}

export default function ParagraphBubbleMenu() {
  const editor = useParagraphEditor()
  const session = useEditorStore((s) => s.activeParagraphEdit)
  const [linkPanel, setLinkPanel] = useState<LinkPanelState | null>(null)

  // `editor` is part of the inputs so the frame is looked up again once the
  // editor (and with it the host element) is mounted.
  const iframe = session && editor ? sessionFrame(session.target.nodeId) : null

  const ui = useEditorState({
    editor,
    selector: ({ editor: ed }) =>
      ed && session
        ? {
            // Boundary spaces of the selection do not count (paragraphCommands.formatRange).
            active: Object.fromEntries(session.formats.formats.map((f) => [f.id, isParagraphFormatActive(ed.state, f.id)])),
            inLink: ed.isActive(LINK_MARK),
            // paragraphCommands: formats never touch links / fixed runs; Clear never fixed runs.
            canFormat: canFormatSelection(ed.state),
            canClear: canClearSelection(ed.state),
            canLink: canEditLink(ed.state),
            // Why the buttons are off over a fixed run (unknown formatting).
            hint: selectionFormattingHint(ed),
          }
        : null,
  })

  const openLinkPanel = (anchor: PanelAnchor, focusPanel: boolean) =>
    setLinkPanel((prev) => ({ anchor, focusPanel, key: (prev?.key ?? 0) + 1 }))

  // Ctrl+K — including a request made before this lazily loaded menu (or the
  // editor / frame) was ready: the pending flag is checked once on setup.
  useEffect(() => {
    if (!editor || !iframe) return
    const handle = () => {
      if (editor.isDestroyed || !takeLinkPanelRequest()) return
      const anchor = linkUnderCaretRect(editor, iframe) ?? selectionRect(editor, iframe)
      setLinkPanel((prev) => ({ anchor, focusPanel: true, key: (prev?.key ?? 0) + 1 }))
    }
    const unsubscribe = subscribeLinkPanelRequest(handle)
    const initial = setTimeout(handle, 0)
    return () => {
      unsubscribe()
      clearTimeout(initial)
    }
  }, [editor, iframe])

  // Spec §3.3: a click into an existing link opens the panel with its target.
  // Deferred to after mouseup so the editor has placed the caret.
  useEffect(() => {
    if (!editor || !iframe) return
    const dom = editor.view.dom
    let timer: ReturnType<typeof setTimeout> | undefined
    const onMouseUp = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (editor.isDestroyed) return
        const anchor = linkUnderCaretRect(editor, iframe)
        if (anchor) setLinkPanel((prev) => ({ anchor, focusPanel: false, key: (prev?.key ?? 0) + 1 }))
      }, 0)
    }
    dom.addEventListener('mouseup', onMouseUp)
    return () => {
      clearTimeout(timer)
      dom.removeEventListener('mouseup', onMouseUp)
    }
  }, [editor, iframe])

  // Passive effects run child-first: by the time this runs, the BubbleMenu
  // below has registered its plugin in the same commit — the host may focus.
  const menuMounted = Boolean(editor && session && iframe)
  useEffect(() => {
    if (menuMounted && editor) markParagraphMenuReady(editor)
  }, [menuMounted, editor])

  if (!editor || !session || !iframe) return null

  const keepSelection = (e: React.MouseEvent) => e.preventDefault()
  // A disabled button over a fixed run names it and says where to fix it.
  const formatHint = !(ui?.canFormat ?? false) ? ui?.hint ?? undefined : undefined
  const linkHint = !(ui?.canLink ?? false) ? ui?.hint ?? undefined : undefined
  const clearHint = !(ui?.canClear ?? false) ? ui?.hint ?? undefined : undefined

  return (
    <>
      <BubbleMenu
        editor={editor}
        updateDelay={0}
        className={styles.floating}
        shouldShow={({ from, to, editor: ed }) => !ed.isDestroyed && (from !== to || ed.isActive(LINK_MARK))}
        appendTo={() => document.body}
        options={{
          strategy: 'fixed',
          // Keep the menu inside the frame's visible region.
          shift: { boundary: iframe, padding: 8 },
          flip: { boundary: iframe, padding: 8 },
        }}
        getReferencedVirtualElement={(): VirtualElement | null => {
          if (editor.isDestroyed) return null
          const r = selectionRect(editor, iframe)
          return { getBoundingClientRect: () => ({ ...r, x: r.left, y: r.top }) }
        }}
      >
        <div className={styles.menu} data-paragraph-overlay="" role="toolbar" aria-label="Text formatting">
          {session.formats.formats.map((f) => {
            const Icon = f.tag === 'strong' ? BoldIcon : f.tag === 'em' ? ItalicIcon : null
            const pressed = ui?.active[f.id] ?? false
            return Icon ? (
              <Button
                key={f.id}
                variant={pressed ? 'primary' : 'ghost'}
                size="xs"
                iconOnly
                pressed={pressed}
                disabled={!(ui?.canFormat ?? false)}
                tooltip={formatHint ?? f.label}
                aria-label={f.label}
                aria-description={formatHint}
                className={styles.markButton}
                onMouseDown={keepSelection}
                onClick={() => toggleParagraphFormat(editor, f.id)}
              >
                <Icon size={14} aria-hidden="true" />
              </Button>
            ) : (
              <Button
                key={f.id}
                variant={pressed ? 'primary' : 'ghost'}
                size="xs"
                pressed={pressed}
                disabled={!(ui?.canFormat ?? false)}
                tooltip={formatHint}
                aria-description={formatHint}
                onMouseDown={keepSelection}
                onClick={() => toggleParagraphFormat(editor, f.id)}
              >
                {f.label}
              </Button>
            )
          })}
          <span className={styles.divider} aria-hidden="true" />
          <Button
            variant={ui?.inLink ? 'primary' : 'ghost'}
            size="xs"
            iconOnly
            pressed={ui?.inLink ?? false}
            // A link needs text — a selection, or the caret inside an existing link — and no fixed run.
            disabled={!(ui?.canLink ?? false)}
            tooltip={linkHint ?? 'Link (Ctrl+K)'}
            aria-label="Link"
            aria-description={linkHint}
            className={styles.markButton}
            onMouseDown={keepSelection}
            onClick={() => openLinkPanel(linkUnderCaretRect(editor, iframe) ?? selectionRect(editor, iframe), true)}
          >
            <LinkIcon size={14} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            tooltip={clearHint ?? 'Remove formatting'}
            aria-description={clearHint}
            disabled={!(ui?.canClear ?? false)}
            onMouseDown={keepSelection}
            onClick={() => clearParagraphFormatting(editor, session.formats)}
          >
            Clear
          </Button>
        </div>
      </BubbleMenu>
      {linkPanel && (
        <ParagraphLinkPanel
          key={linkPanel.key}
          editor={editor}
          anchor={linkPanel.anchor}
          focusPanel={linkPanel.focusPanel}
          formats={session.formats}
          onClose={() => setLinkPanel(null)}
        />
      )}
    </>
  )
}
