/**
 * Pure edit helpers for the "Text formats" settings section. Each returns a
 * fresh `TextFormatsSettings`; the section persists the result via
 * `updateSiteSettings({ textFormats })`.
 */
import { SHORTCUT_PATTERN } from '@core/text-formats'
import type { TextFormat, TextFormatsSettings } from '@core/text-formats'

export function addFormat(v: TextFormatsSettings): TextFormatsSettings {
  let n = 1
  while (v.formats.some((f) => f.id === `format-${n}`)) n += 1
  return { ...v, formats: [...v.formats, { id: `format-${n}`, label: `Format ${n}`, tag: 'span', classIds: [] }] }
}

export function updateFormat(
  v: TextFormatsSettings,
  id: string,
  patch: Partial<Omit<TextFormat, 'id'>>,
): TextFormatsSettings {
  return { ...v, formats: v.formats.map((f) => (f.id === id ? { ...f, ...patch } : f)) }
}

export function removeFormat(v: TextFormatsSettings, id: string): TextFormatsSettings {
  return { ...v, formats: v.formats.filter((f) => f.id !== id) }
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

/**
 * Add a class set (empty = the bare tag) that is also read as format `id`.
 * Unchanged (same object) when it equals the format's classes or one of its
 * variants. Claims of other formats are settled by the parser on read.
 */
export function addVariant(v: TextFormatsSettings, id: string, classIds: string[]): TextFormatsSettings {
  const format = v.formats.find((f) => f.id === id)
  if (!format) return v
  if (sameSet(format.classIds, classIds) || (format.variants ?? []).some((set) => sameSet(set, classIds))) return v
  return updateFormat(v, id, { variants: [...(format.variants ?? []), [...classIds]] })
}

export function removeVariant(v: TextFormatsSettings, id: string, index: number): TextFormatsSettings {
  return {
    ...v,
    formats: v.formats.map((f) => {
      if (f.id !== id) return f
      const { variants, ...rest } = f
      const next = (variants ?? []).filter((_, i) => i !== index)
      return next.length > 0 ? { ...rest, variants: next } : rest
    }),
  }
}

export function setLinkClasses(v: TextFormatsSettings, classIds: string[]): TextFormatsSettings {
  return { ...v, link: { classIds } }
}

/**
 * Validate a shortcut typed for format `id`. Returns an error message, or
 * `null` when the value is empty (clears the shortcut) or well-formed and
 * not used by another format.
 */
export function validateShortcut(v: TextFormatsSettings, id: string, raw: string): string | null {
  const value = raw.trim()
  if (value === '') return null
  if (!SHORTCUT_PATTERN.test(value)) {
    return 'Use modifiers and one lowercase key, e.g. Mod-b or Mod-Shift-k.'
  }
  if (v.formats.some((f) => f.id !== id && f.shortcut === value)) {
    return 'This shortcut is already used by another format.'
  }
  return null
}
