/**
 * The admin document plus every canvas breakpoint iframe document — where
 * paragraph mode listens for presses, focus and keys outside the paragraph.
 */
export function canvasDocuments(): Document[] {
  const docs: Document[] = [document]
  for (const frame of document.querySelectorAll('iframe')) {
    let frameDoc: Document | null
    try {
      frameDoc = frame.contentDocument
    } catch (_err) {
      // Cross-origin frame (plugin / dev tool) — not a canvas frame.
      frameDoc = null
    }
    if (frameDoc?.body?.hasAttribute('data-breakpoint-id')) docs.push(frameDoc)
  }
  return docs
}
