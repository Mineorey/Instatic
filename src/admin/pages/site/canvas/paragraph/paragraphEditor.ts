import { Editor, Extension, Mark, Node } from '@tiptap/core'
import { DOMParser as PMDOMParser, type Slice } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { isAllowedLinkHref, isExternalHref, isLinkTarget } from '@core/paragraph'
import type { TextFormat } from '@core/text-formats'
import { canEditLink, syncDomSelection, toggleParagraphFormat, type FixedMarkStorage } from './paragraphCommands'
import { FIXED_MARK, LINK_MARK, formatMarkName, runsToDoc } from './paragraphDoc'
import type { ParagraphRenderSpec } from './paragraphPreview'

export interface ParagraphEditorOptions extends ParagraphRenderSpec {
  element: HTMLElement
  /** Pasted link classes are kept only when they name an existing class rule. */
  isKnownClassId: (classId: string) => boolean
  onCommit: () => void
  onCancel: () => void
  onRequestLink: () => void
}

/**
 * Block boundaries become <br> so they survive as hard breaks; the schema
 * still filters all other markup. Browser clipboard HTML wraps the fragment
 * in `<html><body><!--StartFragment-->…<!--EndFragment--></body></html>`, so
 * comments and the document wrapper go first — otherwise the closing block's
 * <br> would not be trailing and would survive as a dangling break.
 */
export function blocksToBreaks(html: string): string {
  // Opening/wrapper tags are dropped too: a <br> that is the last child of a block element is ignored by ProseMirror.
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(html|body)(\s[^>]*)?>/gi, '')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '<br>')
    .replace(/<\/?(p|div|li|ul|ol|h[1-6])(\s[^>]*)?>/gi, '')
    .replace(/^(\s|<br\s*\/?>)+/i, '')
    .replace(/(\s|<br\s*\/?>)+$/i, '')
}

/** Google Docs wraps a whole copied fragment in `<b style="font-weight:normal">` — that is no bold. */
function isNormalWeight(el: HTMLElement): boolean {
  const weight = el.style.fontWeight.trim().toLowerCase()
  return weight === 'normal' || weight === '400'
}

/** A single inline textblock as the whole document. */
const ParagraphDocument = Node.create({ name: 'doc', topNode: true, content: 'inline*' })

function formatMark(format: TextFormat, className: string) {
  const parseTags = format.tag === 'strong' ? ['strong', 'b'] : format.tag === 'em' ? ['em', 'i'] : []
  return Mark.create({
    name: formatMarkName(format.id),
    excludes: '_', // version 1: one format per text span (spec §13.2)
    // Display only: the stored classes of a word read through a format
    // variant (runsToDoc). Not parsed from pasted HTML, not read back by
    // docToRuns; a newly applied format has none and shows the own classes.
    addAttributes: () => ({ className: { default: null, rendered: false, parseHTML: () => null } }),
    parseHTML: () =>
      parseTags.map((tag) =>
        tag === 'b' ? { tag, getAttrs: (el) => (isNormalWeight(el as HTMLElement) ? false : null) } : { tag },
      ),
    renderHTML: ({ mark }) => {
      const cls = typeof mark.attrs.className === 'string' ? mark.attrs.className : className
      return [format.tag, cls ? { class: cls } : {}, 0]
    },
    addKeyboardShortcuts() {
      if (!format.shortcut) return {}
      // Always handled (true), so the browser's native bold/italic never runs;
      // a no-op where formats are unavailable (links, fixed runs — paragraphCommands),
      // and like the menu button it ignores the selection's boundary spaces.
      return {
        [format.shortcut]: () => {
          syncDomSelection(this.editor)
          toggleParagraphFormat(this.editor, format.id)
          return true
        },
      }
    },
  })
}

export function createParagraphEditor(o: ParagraphEditorOptions): Editor {
  const linkClassName = o.classNameOf(o.formats.link.classIds)
  const ParagraphLink = Mark.create({
    name: LINK_MARK,
    excludes: '_',
    inclusive: false,
    addAttributes: () => ({ href: { default: '' }, target: { default: '_self' }, classIds: { default: [] } }),
    parseHTML: () => [
      {
        tag: 'a[href]',
        getAttrs: (el) => {
          const anchor = el as HTMLElement
          const href = (anchor.getAttribute('href') ?? '').trim()
          if (!isAllowedLinkHref(href)) return false
          const rawTarget = anchor.getAttribute('target')
          const target = isLinkTarget(rawTarget) ? rawTarget : isExternalHref(href) ? '_blank' : '_self'
          const rawClasses = anchor.getAttribute('data-paragraph-link-classes')
          const classIds =
            rawClasses === null
              ? [...o.formats.link.classIds]
              : rawClasses.split(/\s+/).filter((id) => id !== '' && o.isKnownClassId(id))
          return { href, target, classIds }
        },
      },
    ],
    renderHTML: ({ mark }) => {
      const classIds = (mark.attrs.classIds as string[]) ?? []
      const cls = o.classNameOf(classIds) || linkClassName
      // The real href/target/classIds are rendered so copy/paste inside the editor keeps them;
      // the canvas iframe blocks navigation anyway.
      return [
        'a',
        {
          href: String(mark.attrs.href ?? ''),
          target: String(mark.attrs.target ?? '_self'),
          'data-paragraph-link': '',
          'data-paragraph-link-classes': classIds.join(' '),
          ...(cls ? { class: cls } : {}),
        },
        0,
      ]
    },
  })
  const ParagraphFixed = Mark.create<Record<string, never>, FixedMarkStorage>({
    name: FIXED_MARK,
    excludes: '_',
    inclusive: false,
    // Read by `selectionFormattingHint` (the disabled buttons' hint).
    addStorage: () => ({ fixedNodes: o.fixedNodes }),
    addAttributes: () => ({ nodeId: { default: '' } }),
    parseHTML: () => [],
    renderHTML: ({ mark }) => {
      const info = o.fixedNodes[String(mark.attrs.nodeId)] ?? { tag: 'span', className: '', unknownFormat: false }
      return [info.tag, { 'data-paragraph-fixed': '', ...(info.className ? { class: info.className } : {}) }, 0]
    },
  })
  const ParagraphKeys = Extension.create({
    name: 'paragraphKeys',
    priority: 1000,
    addKeyboardShortcuts: () => ({
      Enter: () => { o.onCommit(); return true },
      // Mod-Enter intentionally commits (shadows hardBreak's Mod-Enter).
      'Mod-Enter': () => { o.onCommit(); return true },
      // Shift-Enter inserts a hard break — at the DOM caret, which ProseMirror
      // may not have read yet when Shift+Enter follows an arrow key at once.
      'Shift-Enter': ({ editor }) => {
        syncDomSelection(editor)
        return editor.commands.setHardBreak()
      },
      Escape: () => { o.onCancel(); return true },
      // Like the Link button: a selection, or the caret inside a link — never over fixed text.
      'Mod-k': ({ editor }) => {
        syncDomSelection(editor)
        if (canEditLink(editor.state)) o.onRequestLink()
        return true
      },
    }),
  })

  return new Editor({
    element: o.element,
    injectCSS: false,
    extensions: [
      ParagraphDocument,
      StarterKit.configure({
        document: false, paragraph: false, heading: false, blockquote: false, bulletList: false,
        orderedList: false, listItem: false, listKeymap: false, codeBlock: false, code: false,
        horizontalRule: false, bold: false, italic: false, strike: false, underline: false,
        link: false, dropcursor: false, gapcursor: false, trailingNode: false,
      }),
      ...o.formats.formats.map((f) => formatMark(f, o.classNameOf(f.classIds))),
      ParagraphLink,
      ParagraphFixed,
      ParagraphKeys,
    ],
    content: runsToDoc(o.runs, o.formatClassNames),
    editorProps: {
      attributes: { 'data-paragraph-editor': '' },
      transformPastedHTML: blocksToBreaks,
      clipboardTextParser: (text, $context, _plain, view): Slice => {
        const dom = document.createElement('div')
        text.split(/(?:\r\n?|\n)+/).forEach((line, index) => {
          if (index > 0) dom.appendChild(document.createElement('br'))
          dom.appendChild(document.createTextNode(line))
        })
        return PMDOMParser.fromSchema(view.state.schema).parseSlice(dom, { context: $context, preserveWhitespace: 'full' })
      },
    },
  })
}
