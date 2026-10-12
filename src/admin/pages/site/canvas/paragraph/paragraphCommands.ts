/**
 * Formatting commands of paragraph mode, shared by the key map
 * (paragraphEditor.ts), the formatting menu and the link panel.
 *
 * Every editor mark has `excludes: '_'` (one mark per text span, spec §13.2),
 * and TipTap's `setMark` / `toggleMark` dispatch `tr.addMark`, which REMOVES
 * every mark the new one excludes. Unguarded, bold over a fixed run would
 * replace its `pfixed` mark (the unknown node is deleted on commit) and bold
 * inside a link would strip or split the link. So formats never apply to a
 * selection touching a fixed run or a link, a link never applies over a fixed
 * run, and "Clear" never runs over a fixed run.
 *
 * Formats and new links act on the selection without its boundary spaces
 * (`formatRange`): a double-click on Windows selects a word plus its trailing
 * space, and that space must neither make a bold word read as "not bold" nor
 * be bolded or linked (normalisation would move it out again on commit).
 */
import { getMarkRange, type Editor } from '@tiptap/core'
import { TextSelection, type EditorState } from '@tiptap/pm/state'
import type { TextFormatsSettings } from '@core/text-formats'
import { FIXED_MARK, LINK_MARK, formatMarkName } from './paragraphDoc'
import { unknownFormattingHint, type FixedNodeInfo } from './paragraphFixedNodes'

/** The fixed mark's extension storage (paragraphEditor.ts). */
export interface FixedMarkStorage {
  fixedNodes: Record<string, FixedNodeInfo>
}

/**
 * The range formats and new links apply to: the selection without leading and
 * trailing U+0020 spaces — the same boundary spaces `normalizeRuns` moves out
 * of format and link runs. A selection of spaces only stays as it is. The
 * document is one inline textblock, so every position is one character
 * (a hard break counts as one, `\n`).
 */
export function formatRange(state: EditorState): { from: number; to: number } {
  const { from, to, empty } = state.selection
  if (empty) return { from, to }
  const text = state.doc.textBetween(from, to, '\n', '\n')
  const lead = /^ */.exec(text)?.[0].length ?? 0
  const trail = / *$/.exec(text)?.[0].length ?? 0
  if (lead + trail >= text.length) return { from, to }
  return { from: from + lead, to: to - trail }
}

/**
 * True when the selection touches one of the named marks: anywhere in its
 * `formatRange`, or — for a collapsed caret — in the marks the next typed
 * character would get (stored marks, else the marks at the caret).
 */
export function selectionTouchesMark(state: EditorState, markNames: readonly string[]): boolean {
  const types = markNames.flatMap((name) => (state.schema.marks[name] ? [state.schema.marks[name]] : []))
  const { empty, $from } = state.selection
  if (empty) return (state.storedMarks ?? $from.marks()).some((mark) => types.includes(mark.type))
  const { from, to } = formatRange(state)
  return types.some((type) => state.doc.rangeHasMark(from, to, type))
}

/**
 * Whether a format is active: every character of the `formatRange` carries
 * it, or — for a caret — the next typed character would. The menu's pressed
 * state and `toggleParagraphFormat` both use this.
 */
export function isParagraphFormatActive(state: EditorState, formatId: string): boolean {
  const type = state.schema.marks[formatMarkName(formatId)]
  if (!type) return false
  const { empty, $from } = state.selection
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()))
  const { from, to } = formatRange(state)
  let all = true
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isInline && !type.isInSet(node.marks)) all = false
  })
  return all
}

/**
 * ProseMirror reads a changed DOM selection on `selectionchange`, which can
 * still be pending when a shortcut's keydown arrives right after Shift+Arrow
 * — the command would then see the old (often collapsed) selection. Key
 * handlers call this first to take the DOM selection over.
 */
export function syncDomSelection(editor: Editor): void {
  const { view } = editor
  if (!view.hasFocus()) return
  const dom = view.dom.ownerDocument.getSelection()
  if (!dom?.anchorNode || !dom.focusNode) return
  if (!view.dom.contains(dom.anchorNode) || !view.dom.contains(dom.focusNode)) return
  const anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset)
  const head = view.posAtDOM(dom.focusNode, dom.focusOffset)
  const { selection } = view.state
  if (selection.anchor === anchor && selection.head === head) return
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)))
}

/** Node ids of the fixed runs the selection touches (same rules as `selectionTouchesMark`). */
export function selectionFixedNodeIds(state: EditorState): string[] {
  const type = state.schema.marks[FIXED_MARK]
  if (!type) return []
  const ids = new Set<string>()
  const { empty, $from } = state.selection
  if (empty) {
    for (const mark of state.storedMarks ?? $from.marks()) {
      if (mark.type === type) ids.add(String(mark.attrs.nodeId))
    }
    return [...ids]
  }
  const { from, to } = formatRange(state)
  state.doc.nodesBetween(from, to, (node) => {
    for (const mark of node.marks) if (mark.type === type) ids.add(String(mark.attrs.nodeId))
  })
  return [...ids]
}

/**
 * Why formats / links are unavailable over the selection: the fixed runs it
 * touches, named as `tag.class` (`unknownFormattingHint`). Null when it
 * touches none.
 */
export function selectionFormattingHint(editor: Editor): string | null {
  const storage = (editor.storage as unknown as Record<string, FixedMarkStorage | undefined>)[FIXED_MARK]
  const infos = selectionFixedNodeIds(editor.state).flatMap((id) => {
    const info = storage?.fixedNodes[id]
    return info ? [info] : []
  })
  return unknownFormattingHint(infos)
}

/** Formats (and their buttons / shortcuts) are available only away from links and fixed runs. */
export function canFormatSelection(state: EditorState): boolean {
  return !selectionTouchesMark(state, [FIXED_MARK, LINK_MARK])
}

/** "Clear" is available unless the selection touches a fixed run (whose formatting is untouchable). */
export function canClearSelection(state: EditorState): boolean {
  return !selectionTouchesMark(state, [FIXED_MARK])
}

/**
 * The link panel opens for a non-empty selection, or for a caret inside an
 * existing link — never over a fixed run.
 */
export function canEditLink(state: EditorState): boolean {
  if (selectionTouchesMark(state, [FIXED_MARK])) return false
  return !state.selection.empty || selectionTouchesMark(state, [LINK_MARK])
}

/**
 * Toggle one format over the selection's `formatRange` (the selection itself
 * is kept); a no-op (false) where formats are unavailable.
 */
export function toggleParagraphFormat(editor: Editor, formatId: string): boolean {
  const { state } = editor
  const type = state.schema.marks[formatMarkName(formatId)]
  if (!type || !canFormatSelection(state)) return false
  if (state.selection.empty) return editor.chain().focus().toggleMark(type.name).run()
  const { from, to } = formatRange(state)
  const active = isParagraphFormatActive(state, formatId)
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      if (active) tr.removeMark(from, to, type)
      else tr.addMark(from, to, type.create())
      return true
    })
    .run()
}

/** Remove every format and link from the selection; a no-op (false) over a fixed run. */
export function clearParagraphFormatting(editor: Editor, formats: TextFormatsSettings): boolean {
  if (!canClearSelection(editor.state)) return false
  const chain = editor.chain().focus()
  for (const f of formats.formats) chain.unsetMark(formatMarkName(f.id))
  return chain.unsetMark(LINK_MARK, { extendEmptyMarkRange: true }).run()
}

export interface ParagraphLinkAttrs {
  href: string
  target: string
  classIds: string[]
}

/**
 * Set a link over the selection — extended to the whole link when the
 * selection lies inside one (like `extendMarkRange`). Refused (false, nothing
 * changes) when that range touches a fixed run.
 */
export function applyParagraphLink(editor: Editor, attrs: ParagraphLinkAttrs): boolean {
  const { state } = editor
  const linkType = state.schema.marks[LINK_MARK]
  if (!linkType) return false
  const { from: selFrom, to: selTo } = state.selection
  const range = getMarkRange(state.selection.$from, linkType)
  // Inside an existing link: the whole link. Otherwise the selection without
  // its boundary spaces, so a new link never swallows a trailing space.
  const { from, to } = range && range.from <= selFrom && range.to >= selTo ? range : formatRange(state)
  if (from === to) return false
  const fixedType = state.schema.marks[FIXED_MARK]
  if (fixedType && state.doc.rangeHasMark(from, to, fixedType)) return false
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.addMark(from, to, linkType.create(attrs))
      return true
    })
    .run()
}

/** Remove the link under the selection (the whole link under a caret). */
export function removeParagraphLink(editor: Editor): boolean {
  return editor.chain().focus().extendMarkRange(LINK_MARK).unsetMark(LINK_MARK).run()
}
