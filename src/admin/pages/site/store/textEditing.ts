/**
 * True while any in-canvas text editor owns the keyboard (plain inline edit or
 * paragraph mode). Truthiness, not `!= null`: the store holds the session
 * objects (or null), the spotlight `CommandContext` snapshot holds booleans.
 */
export function isCanvasTextEditing(state: { activeInlineEdit: unknown; activeParagraphEdit: unknown }): boolean {
  return Boolean(state.activeInlineEdit) || Boolean(state.activeParagraphEdit)
}
