/**
 * Paragraph mode's canvas-level layer, mounted once by CanvasRoot.
 *
 * - Warms paragraph mode's lazy chunks once the editable canvas is idle, so
 *   the first double-click mounts the editor at once instead of waiting.
 * - Renders the formatting menu + link panel while a paragraph session is
 *   open. CanvasRoot mounts this OUTSIDE the canvas div on purpose: the menu
 *   is portaled to the editor body, and React events bubble through portals
 *   along the component tree, so inside the canvas div a press on the menu
 *   would reach its pan/zoom gesture handlers, its background-click deselect
 *   and its key handler.
 */
import { Suspense, useEffect } from 'react'
import { useEditorStore } from '@site/store/store'
import { ParagraphBubbleMenu, preloadParagraphMode } from './paragraphModeLoader'

interface ParagraphModeLayerProps {
  /** Design canvas, editable, and the user may edit content. */
  enabled: boolean
}

export function ParagraphModeLayer({ enabled }: ParagraphModeLayerProps) {
  const paragraphEditing = useEditorStore((s) => s.activeParagraphEdit !== null)

  useEffect(() => {
    if (!enabled) return
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(preloadParagraphMode, { timeout: 3000 })
      return () => w.cancelIdleCallback?.(id)
    }
    const timer = window.setTimeout(preloadParagraphMode, 1000)
    return () => window.clearTimeout(timer)
  }, [enabled])

  if (!paragraphEditing) return null
  return (
    <Suspense fallback={null}>
      <ParagraphBubbleMenu />
    </Suspense>
  )
}
