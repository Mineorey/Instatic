import { createContext, type MouseEvent, type RefObject } from 'react'
import type { TemplateRenderDataContext } from '@core/templates/dynamicBindings'

interface CanvasSelectionContextValue {
  onNodeClick: (nodeId: string, e: MouseEvent, breakpointId?: string) => void
  onNodeHover: (nodeId: string | null, breakpointId?: string) => void
  onNodeContextMenu: (nodeId: string, e: MouseEvent, breakpointId?: string) => void
  /** `paragraphHostAllowed`: the clicked render path's `CanvasParagraphHostContext`. */
  onNodeDoubleClick: (nodeId: string, e: MouseEvent, breakpointId?: string, paragraphHostAllowed?: boolean) => void
}

export const CanvasSelectionContext = createContext<CanvasSelectionContextValue>({
  onNodeClick: () => {},
  onNodeHover: () => {},
  onNodeContextMenu: () => {},
  onNodeDoubleClick: () => {},
})

interface CanvasViewportActionsContextValue {
  canvasRootRef: RefObject<HTMLElement | null>
  panBy: (dx: number, dy: number) => void
}

export const CanvasViewportActionsContext =
  createContext<CanvasViewportActionsContextValue | null>(null)

export const CanvasBreakpointContext = createContext<string | undefined>(undefined)
export const CanvasTemplateContext = createContext<TemplateRenderDataContext | undefined>(undefined)
/**
 * False for render paths that must never host the paragraph-mode editor even
 * though they render the session's node in the session's breakpoint: agent
 * snapshot frames and loop iterations (the same node once per item).
 */
export const CanvasParagraphHostContext = createContext(true)
/** Final srcDoc document owned by the nearest IframeFrameSurface. */
export const CanvasDocumentContext = createContext<Document | null>(null)
/** Host iframe element owned by the nearest IframeFrameSurface. */
export const CanvasFrameElementContext = createContext<HTMLIFrameElement | null>(null)
