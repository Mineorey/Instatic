/**
 * Paragraph mode — canvas wiring gates (source assertions, same convention as
 * inlineTextEditingWiring.test.ts): the pieces only manifest inside live
 * canvas iframes, so the wiring itself is asserted.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'

// A non-type import from @tiptap/*. [^'"] spans a multi-line import list but
// never crosses into the next statement (each ends in a quoted specifier).
const TIPTAP_RUNTIME_IMPORT = /^import\s+(?!type\b)[^'"]*?from\s+'@tiptap\//m

const read = (p: string) => readFileSync(new URL(`../../admin/${p}`, import.meta.url), 'utf8')

describe('paragraph mode wiring', () => {
  it('double-click goes through the paragraph-or-inline entry with the render path host flag', () => {
    expect(read('pages/site/canvas/CanvasRoot.tsx')).toContain(
      'startParagraphOrInlineEdit(nodeId, bp, { x: e.clientX, y: e.clientY }, paragraphHostAllowed)',
    )
    const nodeRenderer = read('pages/site/canvas/NodeRenderer.tsx')
    expect(nodeRenderer.match(/onNodeDoubleClick\(nodeId, e as unknown as React\.MouseEvent, breakpointId, paragraphHostAllowed\)/g)).toHaveLength(2)
  })

  it('a paragraph session whose host unmounts is cancelled with a warning', () => {
    expect(read('pages/site/canvas/paragraph/ParagraphEditHost.tsx')).toContain('scheduleOrphanedParagraphCheck({ hadHost: true })')
  })

  it('snapshot frames and loop iterations never host the paragraph editor', () => {
    expect(read('pages/site/canvas/AgentSnapshotFrame.tsx')).toContain('<CanvasParagraphHostContext.Provider value={false}>')
    const nodeRenderer = read('pages/site/canvas/NodeRenderer.tsx')
    expect(nodeRenderer).toContain('<CanvasParagraphHostContext.Provider value={false}>')
    expect(nodeRenderer).toContain('paragraphEditTag !== null && paragraphHostAllowed')
  })

  it('NodeRenderer hands the paragraph session node to ParagraphEditHost', () => {
    expect(read('pages/site/canvas/NodeRenderer.tsx')).toContain('<ParagraphEditHost')
  })

  it('keyboard guards cover both text editing modes', () => {
    for (const file of [
      'pages/site/canvas/useCanvasKeyboardShortcuts.ts',
      'pages/site/canvas/IframeFrameSurface.tsx',
      'pages/site/canvas/CanvasRoot.tsx',
      'spotlight/shortcutDispatch.ts',
    ]) expect(read(file)).toContain('isCanvasTextEditing(')
  })

  it('TipTap stays out of the canvas body chunk', () => {
    for (const file of [
      'pages/site/canvas/NodeRenderer.tsx',
      'pages/site/canvas/CanvasRoot.tsx',
      'pages/site/canvas/paragraph/ParagraphEditHost.tsx',
      'pages/site/canvas/paragraph/paragraphModeLoader.ts',
      'pages/site/canvas/paragraph/paragraphPreview.ts',
    ]) {
      expect(read(file)).not.toMatch(TIPTAP_RUNTIME_IMPORT)
    }
  })

  it('the TipTap import gate catches multi-line imports', () => {
    expect("import {\n  Editor,\n} from '@tiptap/core'").toMatch(TIPTAP_RUNTIME_IMPORT)
    expect("import type {\n  Editor,\n} from '@tiptap/core'").not.toMatch(TIPTAP_RUNTIME_IMPORT)
    expect("import { a } from 'react'\nimport type { Editor } from '@tiptap/core'").not.toMatch(TIPTAP_RUNTIME_IMPORT)
  })

  it('the bubble menu and the editor runtime load only via import(), preloaded when the canvas is idle', () => {
    const loader = read('pages/site/canvas/paragraph/paragraphModeLoader.ts')
    expect(loader).toContain("prewarmedLazy(() => import('./ParagraphBubbleMenu')")
    expect(loader).toContain("import('./paragraphEditor')")
    expect(loader).not.toMatch(/^import\s+(?!type\b)[^'"]*?from\s+'\.\/(paragraphEditor|ParagraphBubbleMenu)'/m)
    const canvasRoot = read('pages/site/canvas/CanvasRoot.tsx')
    expect(canvasRoot).toContain("import { ParagraphBubbleMenu, preloadParagraphMode } from './paragraph/paragraphModeLoader'")
    expect(canvasRoot).toContain('requestIdleCallback(preloadParagraphMode')
    const host = read('pages/site/canvas/paragraph/ParagraphEditHost.tsx')
    expect(host).not.toMatch(/from '\.\/paragraphEditor'/)
    expect(host).toContain('createParagraphPreview(el.ownerDocument, spec)')
  })
})
