/**
 * Static stand-in for the paragraph editor while TipTap loads — free of TipTap
 * runtime imports, so it lives in the canvas body chunk. It renders the
 * session's runs with exactly the markup the editor's marks render (format
 * tag + classes, link, fixed node tag + classes, `<br>` for line breaks) into
 * an element styled like the editor, so the paragraph never goes blank and
 * does not jump when the editor replaces it.
 */
import type { Run } from '@core/paragraph'
import type { TextFormatsSettings } from '@core/text-formats'
import type { FixedNodeInfo } from './paragraphFixedNodes'

/** What both the static preview and the editor need to render the runs. */
export interface ParagraphRenderSpec {
  runs: readonly Run[]
  formats: TextFormatsSettings
  classNameOf: (classIds: readonly string[]) => string
  fixedNodes: Record<string, FixedNodeInfo>
  /**
   * Per run: the stored class names of a format run read through a format
   * variant (`paragraphFormatClassNames`) — shown instead of the format's
   * own classes. Display only.
   */
  formatClassNames?: readonly (string | undefined)[]
}

function wrapperFor(doc: Document, run: Run, index: number, spec: ParagraphRenderSpec): HTMLElement | null {
  switch (run.kind) {
    case 'text':
      return null
    case 'format': {
      const format = spec.formats.formats.find((f) => f.id === run.formatId)
      if (!format) return null
      const el = doc.createElement(format.tag)
      const cls = spec.formatClassNames?.[index] ?? spec.classNameOf(format.classIds)
      if (cls) el.className = cls
      return el
    }
    case 'link': {
      const el = doc.createElement('a')
      el.setAttribute('href', run.href)
      el.setAttribute('target', run.target)
      const cls = spec.classNameOf(run.classIds) || spec.classNameOf(spec.formats.link.classIds)
      if (cls) el.className = cls
      return el
    }
    case 'fixed': {
      const info = spec.fixedNodes[run.nodeId] ?? { tag: 'span', className: '', unknownFormat: false }
      const el = doc.createElement(info.tag)
      if (info.className) el.className = info.className
      return el
    }
  }
}

/** The runs as static DOM inside a `data-paragraph-preview` element of `doc`. */
export function createParagraphPreview(doc: Document, spec: ParagraphRenderSpec): HTMLElement {
  const root = doc.createElement('div')
  root.setAttribute('data-paragraph-preview', '')
  spec.runs.forEach((run, index) => {
    const parent = wrapperFor(doc, run, index, spec) ?? root
    run.text.split('\n').forEach((part, index) => {
      if (index > 0) parent.appendChild(doc.createElement('br'))
      if (part) parent.appendChild(doc.createTextNode(part))
    })
    if (parent !== root) root.appendChild(parent)
  })
  // A trailing line break only shows with something after it, and an empty
  // paragraph would collapse to no height — the editor adds the same <br>.
  const last = spec.runs[spec.runs.length - 1]
  if (!last || last.text.endsWith('\n')) root.appendChild(doc.createElement('br'))
  return root
}

const STYLE_ID = 'instatic-paragraph-editor-style'

/**
 * Injected into the canvas iframe. `--canvas-selection-ring-color` is
 * forwarded onto the iframe :root by EditorChromeInjector (CHROME_TOKENS).
 */
export function injectParagraphEditorStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
[data-paragraph-host] { outline: 2px solid var(--canvas-selection-ring-color); outline-offset: 3px; border-radius: 2px; }
[data-paragraph-editor] { outline: none; }
[data-paragraph-editor], [data-paragraph-preview] { white-space: pre-wrap; word-wrap: break-word; }
[data-paragraph-editor] a[data-paragraph-link], [data-paragraph-preview] a { cursor: text; }
`
  doc.head.appendChild(style)
}
