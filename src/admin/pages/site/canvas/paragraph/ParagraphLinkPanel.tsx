/**
 * Link panel for paragraph mode: pick a site page (stored as a `cms:page:` ref
 * that survives renames) or enter a URL, choose the target, apply / remove.
 * Portaled into the editor body next to the formatting menu; `data-paragraph-
 * overlay` plus `setLinkPanelOpen` keep the paragraph session alive while focus
 * is in here (ParagraphEditHost defers its blur-commit on both). A press
 * outside never drops a changed draft silently: the panel asks to apply or
 * discard it first. Escape discards the draft and closes the panel.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { isPageRef, makePageRef, pagePublicPath, parsePageRef, type Page } from '@core/page-tree'
import { isAllowedLinkHref, isExternalHref, isLinkTarget, normalizeLinkInput } from '@core/paragraph'
import type { TextFormatsSettings } from '@core/text-formats'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { Input } from '@ui/components/Input'
import { SegmentedControl } from '@ui/components/SegmentedControl'
import { Select } from '@ui/components/Select'
import { useEditorStore } from '@site/store/store'
import { applyParagraphLink, removeParagraphLink } from './paragraphCommands'
import { LINK_MARK } from './paragraphDoc'
import { isElementLike } from '../readonlyRegion'
import { requestParagraphCommit, setLinkPanelCloser, setLinkPanelOpen } from './paragraphEditorRegistry'
import { canvasDocuments } from './canvasDocuments'
import styles from './ParagraphBubbleMenu.module.css'

export interface PanelAnchor { left: number; right: number; top: number; bottom: number; width: number; height: number }
type Mode = 'page' | 'url'
const EMPTY_PAGES: Page[] = []
const PANEL_GAP = 8

export function ParagraphLinkPanel({ editor, anchor, focusPanel, formats, onClose }: {
  editor: Editor
  anchor: PanelAnchor
  /** Move focus into the panel on open (Ctrl+K / button) — false when a click into a link opened it. */
  focusPanel: boolean
  formats: TextFormatsSettings
  onClose: () => void
}) {
  const newTabId = useId()
  const urlHintId = useId()
  const formRef = useRef<HTMLFormElement | null>(null)
  const pages = useEditorStore((s) => s.site?.pages ?? EMPTY_PAGES)
  // Read once: the panel edits the link under the selection at open time.
  const [current] = useState(
    () => editor.getAttributes(LINK_MARK) as { href?: string; target?: string; classIds?: string[] },
  )
  const initialHref = current.href ?? ''
  const initialRef = parsePageRef(initialHref)
  const initialMode: Mode = initialHref && !isPageRef(initialHref) ? 'url' : 'page'
  const initialPageId = initialRef?.pageId ?? ''
  const initialUrl = isPageRef(initialHref) ? '' : initialHref
  const [mode, setMode] = useState<Mode>(initialMode)
  const [pageId, setPageId] = useState(initialPageId)
  const [url, setUrl] = useState(initialUrl)
  const [newTab, setNewTab] = useState(current.target === '_blank')
  const [newTabTouched, setNewTabTouched] = useState(Boolean(initialHref))
  // Whether the user toggled the checkbox in this panel (keeps `_parent` otherwise).
  const [newTabChanged, setNewTabChanged] = useState(false)
  // A press outside hit a changed draft: ask "Apply / Discard" instead of dropping it.
  const [unsavedNotice, setUnsavedNotice] = useState(false)
  // Apply was tried with an invalid draft — mark the field even when empty.
  const [showInvalid, setShowInvalid] = useState(false)

  // Layout effect: the flag must be up before the editor's deferred blur
  // check runs (focus moves here on mount via autoFocus).
  useLayoutEffect(() => {
    setLinkPanelOpen(true)
    return () => setLinkPanelOpen(false)
  }, [])

  // Opened by Ctrl+K / the link button: move focus in, so Escape and typing
  // land in the panel, not in the paragraph (where Escape cancels the session).
  // URL mode focuses its input via autoFocus.
  // Decided once on open — later mode switches keep the user's focus.
  const [focusFormOnOpen] = useState(focusPanel && mode === 'page')
  useEffect(() => {
    if (focusFormOnOpen) formRef.current?.focus()
  }, [focusFormOnOpen])

  const trimmedUrl = url.trim()
  // What a typed URL is stored as: `www.example.com` → `https://www.example.com`.
  const urlHref = normalizeLinkInput(url)
  // Keep the original #fragment while the same page stays selected.
  const pageFragment = initialRef && initialRef.pageId === pageId ? initialRef.fragment : ''
  const href = mode === 'page' ? (pageId ? makePageRef(pageId, pageFragment) : '') : urlHref
  const valid = href !== '' && isAllowedLinkHref(href)
  const effectiveNewTab = newTabTouched ? newTab : mode === 'url' && isExternalHref(urlHref)
  const matchingPage = mode === 'url' && urlHref ? pages.find((p) => pagePublicPath(p.slug) === urlHref) : undefined
  const showUrlHint = mode === 'url' && valid && urlHref !== trimmedUrl
  const initialTarget = isLinkTarget(current.target) ? current.target : '_self'
  const target = effectiveNewTab ? '_blank' : !newTabChanged ? initialTarget : '_self'
  // Did the user change anything? Compared on what they edited — the raw field,
  // the page, the mode, the target — never on the normalised href: an existing
  // `www.x.de` or relative link must not count as changed just by opening it.
  // A new link counts once it has a target.
  const hrefChanged =
    mode === initialMode
      ? mode === 'page' ? pageId !== initialPageId : trimmedUrl !== initialUrl.trim()
      : href !== '' || initialHref !== ''
  const dirty = hrefChanged || (initialHref !== '' && target !== initialTarget)

  // Synchronous view focus — `commands.focus()` (also inside apply / remove
  // link) defers to the next frame, and with the panel already gone a key
  // pressed meanwhile would reach the admin body instead of the editor.
  const close = () => {
    onClose()
    editor.view.focus()
  }
  const apply = () => {
    if (!valid) return
    // Refused (no change) over a fixed run — its formatting is untouchable.
    applyParagraphLink(editor, {
      href,
      target,
      classIds: current.classIds?.length ? current.classIds : [...formats.link.classIds],
    })
    close()
  }
  const applyFromNotice = () => {
    if (valid) apply()
    else setShowInvalid(true)
  }
  const remove = () => {
    removeParagraphLink(editor)
    close()
  }

  // Escape inside the editor closes the panel instead of cancelling the session.
  useLayoutEffect(() => {
    const closer = () => {
      onClose()
      editor.view.focus()
    }
    setLinkPanelCloser(closer)
    return () => setLinkPanelCloser(null)
  }, [editor, onClose])

  // Outside the panel = the admin document or ANY canvas frame, except the
  // panel itself and Select menus (their listbox portals outside the panel).
  //  - Draft unchanged: a press closes the panel. A press inside the paragraph
  //    just lands there (caret placement); anywhere else commits the paragraph
  //    right away, since the editor may not hold focus to blur.
  //  - Draft changed: nothing outside may act until the user decides. A press
  //    is swallowed — its pointerdown and the mouse events that follow it (no
  //    focus or caret move: Apply must still hit the original selection) —
  //    and the panel asks "Unsaved link change: Apply / Discard". A context
  //    menu is suppressed, Escape anywhere discards the draft. Clicks without
  //    a swallowed press (keyboard activation, programmatic) are not touched;
  //    keyboard focus leaving the panel is handled by the focusout effect.
  useEffect(() => {
    const docs = canvasDocuments()
    const isOutside = (target: EventTarget | null) =>
      !(isElementLike(target) && target.closest('[data-paragraph-overlay], [role="listbox"]'))
    let swallowing = false
    let swallowReset: ReturnType<typeof setTimeout> | undefined
    const onPointerDown = (event: PointerEvent) => {
      clearTimeout(swallowReset)
      swallowing = false
      if (!isOutside(event.target)) return
      if (dirty) {
        event.preventDefault()
        event.stopPropagation()
        swallowing = true
        setUnsavedNotice(true)
        return
      }
      setLinkPanelOpen(false)
      onClose()
      const inParagraph = isElementLike(event.target) && editor.view.dom.contains(event.target)
      if (!inParagraph) requestParagraphCommit()
    }
    // A swallowed press ends with its pointerup: the mouseup / click / dblclick
    // it produces follow in the same turn, so the flag drops a tick later.
    // A press that yields no click (right or middle button, released
    // elsewhere) must never leave it set for a later keyboard or programmatic
    // click; a cancelled press yields no mouse events at all.
    const endSwallowSoon = () => {
      clearTimeout(swallowReset)
      swallowReset = setTimeout(() => {
        swallowing = false
      }, 0)
    }
    const onPointerCancel = () => {
      clearTimeout(swallowReset)
      swallowing = false
    }
    // Only the mouse events of a press swallowed above, and only outside.
    const swallow = (event: MouseEvent) => {
      if (!swallowing || !isOutside(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'click' || event.type === 'auxclick') endSwallowSoon()
    }
    const onContextMenu = (event: MouseEvent) => {
      if (swallowing) endSwallowSoon()
      if (!dirty || !isOutside(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      setUnsavedNotice(true)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!dirty || event.key !== 'Escape' || !isOutside(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
      editor.view.focus()
    }
    const mouseEvents = ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick'] as const
    for (const doc of docs) {
      doc.addEventListener('pointerdown', onPointerDown, true)
      doc.addEventListener('pointerup', endSwallowSoon, true)
      doc.addEventListener('pointercancel', onPointerCancel, true)
      doc.addEventListener('contextmenu', onContextMenu, true)
      doc.addEventListener('keydown', onKeyDown, true)
      for (const type of mouseEvents) doc.addEventListener(type, swallow, true)
    }
    return () => {
      clearTimeout(swallowReset)
      for (const doc of docs) {
        doc.removeEventListener('pointerdown', onPointerDown, true)
        doc.removeEventListener('pointerup', endSwallowSoon, true)
        doc.removeEventListener('pointercancel', onPointerCancel, true)
        doc.removeEventListener('contextmenu', onContextMenu, true)
        doc.removeEventListener('keydown', onKeyDown, true)
        for (const type of mouseEvents) doc.removeEventListener(type, swallow, true)
      }
    }
  }, [editor, onClose, dirty])

  // Keyboard way out: while the draft is changed, focus reaching anything but
  // the panel, its Select menus or the paragraph text (Tab / Shift+Tab to the
  // toolbar, Publish, a frame) is pulled back to the panel with the notice —
  // right in `focusin`, so the outside control never receives the Enter.
  // A window switch moves no focus inside the documents and is not caught.
  useEffect(() => {
    const form = formRef.current
    if (!form || !dirty) return undefined
    const docs = canvasDocuments()
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!isElementLike(target)) return
      if (target.closest('[data-paragraph-overlay], [role="listbox"]')) return
      if (editor.view.dom.contains(target)) return
      setUnsavedNotice(true)
      form.focus()
    }
    for (const doc of docs) doc.addEventListener('focusin', onFocusIn, true)
    return () => {
      for (const doc of docs) doc.removeEventListener('focusin', onFocusIn, true)
    }
  }, [editor, dirty])

  const position = {
    '--panel-left': `${anchor.left}px`,
    '--panel-top': `${anchor.bottom + PANEL_GAP}px`,
  } as CSSProperties

  return createPortal(
    <form
      ref={formRef}
      tabIndex={-1}
      className={styles.linkPanel}
      style={position}
      data-paragraph-overlay=""
      role="dialog"
      aria-label="Edit link"
      onSubmit={(e) => {
        e.preventDefault()
        apply()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          close()
        }
      }}
    >
      <SegmentedControl<Mode>
        value={mode}
        onChange={setMode}
        options={[{ value: 'page', label: 'Page' }, { value: 'url', label: 'URL' }]}
        fullWidth
      />
      {mode === 'page' ? (
        <Select
          searchable
          aria-label="Page"
          fieldSize="sm"
          value={pageId}
          onChange={(e) => setPageId(e.target.value)}
          options={[
            { value: '', label: 'Select a page…' },
            ...pages.map((p) => ({ value: p.id, label: `${p.title || pagePublicPath(p.slug)} · ${pagePublicPath(p.slug)}` })),
          ]}
        />
      ) : (
        <>
          <Input
            autoFocus={focusPanel}
            aria-label="Link URL"
            placeholder="https://"
            fieldSize="sm"
            value={url}
            invalid={(trimmedUrl !== '' || showInvalid) && !valid}
            aria-describedby={showUrlHint ? urlHintId : undefined}
            onChange={(e) => setUrl(e.target.value)}
          />
          {showUrlHint && (
            <p id={urlHintId} className={styles.hint} role="status">
              Links to {urlHref}
            </p>
          )}
          {matchingPage && (
            <Button
              variant="ghost"
              size="xs"
              type="button"
              onClick={() => {
                setMode('page')
                setPageId(matchingPage.id)
              }}
            >
              Link to page “{matchingPage.title}” instead (survives renames)
            </Button>
          )}
        </>
      )}
      <label className={styles.checkboxRow} htmlFor={newTabId}>
        <Checkbox
          id={newTabId}
          boxSize="sm"
          checked={effectiveNewTab}
          onCheckedChange={(checked) => {
            setNewTabTouched(true)
            setNewTabChanged(true)
            setNewTab(checked)
          }}
        />
        Open in new tab
      </label>
      {unsavedNotice ? (
        <div className={styles.unsaved} role="alert">
          <p className={styles.unsavedTitle}>Unsaved link change</p>
          {showInvalid && !valid && (
            <p className={styles.unsavedHint}>{mode === 'page' ? 'Select a page first.' : 'Enter a valid link target first.'}</p>
          )}
          <div className={styles.actions}>
            <Button variant="ghost" size="xs" type="button" onClick={close}>
              Discard
            </Button>
            <Button variant="primary" size="xs" type="button" onClick={applyFromNotice}>
              Apply
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          {initialHref && (
            <Button variant="ghost" size="xs" type="button" onClick={remove}>
              Remove
            </Button>
          )}
          <Button variant="ghost" size="xs" type="button" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" size="xs" type="submit" disabled={!valid}>
            Apply
          </Button>
        </div>
      )}
    </form>,
    document.body,
  )
}
