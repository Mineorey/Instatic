/**
 * What CanvasRoot needs from paragraph mode, in one import (CanvasRoot sits at
 * the module-size ceiling, so every fork line there counts).
 */
export { ParagraphModeLayer } from './ParagraphModeLayer'
export { startParagraphOrInlineEdit } from './paragraphHostClaim'
