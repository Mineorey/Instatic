/**
 * Text formats — the site-level vocabulary for inline formatting in the
 * Site editor's paragraph mode (bold/italic/… → which tag + which classes).
 *
 * The TypeBox schema is deliberately lenient (`Type.Unknown()` entries): site
 * bundles are validated against SiteSettingsSchema on import, and one
 * malformed entry must not reject a whole site. `parseTextFormatsSettings`
 * drops bad entries one by one. For that reason the parsed shapes below are
 * hand-written interfaces rather than `Static<>` of the schema.
 *
 * Constraint #269: no imports from editor / editor-store here.
 */
import { Type } from '@core/utils/typeboxHelpers'

export const INLINE_FORMAT_TAGS = ['strong', 'em', 'span', 'small'] as const
export type InlineFormatTag = (typeof INLINE_FORMAT_TAGS)[number]

export interface TextFormat {
  id: string
  label: string
  tag: InlineFormatTag
  classIds: string[]
  /**
   * Further class sets (same tag) that are ALSO read as this format — a site
   * with several visually equal bold classes. New text gets `classIds`; a
   * node read through a variant keeps its classes. A set may be empty (the
   * bare tag). Never equal to `classIds`, never a set another format of the
   * same tag claims (see `settleVariants`); the key is absent when empty.
   */
  variants?: string[][]
  /** TipTap key notation, e.g. `Mod-b`. */
  shortcut?: string
}

export interface TextFormatsSettings {
  formats: TextFormat[]
  link: { classIds: string[] }
}

export const TextFormatsSettingsSchema = Type.Object({
  formats: Type.Array(Type.Unknown()),
  link: Type.Optional(Type.Unknown()),
})

export const DEFAULT_TEXT_FORMATS: TextFormatsSettings = {
  formats: [
    { id: 'bold', label: 'Bold', tag: 'strong', classIds: [], shortcut: 'Mod-b' },
    { id: 'italic', label: 'Italic', tag: 'em', classIds: [], shortcut: 'Mod-i' },
  ],
  link: { classIds: [] },
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/
export const SHORTCUT_PATTERN = /^(?:(?:Mod|Shift|Alt)-){1,3}[a-z0-9]$/

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0))]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const classSetKey = (tag: string, ids: readonly string[]) => `${tag}|${[...ids].sort().join(' ')}`

/**
 * Make every format's variants unambiguous: a variant is dropped when it is
 * empty only through cleaning (`keepEmpty` false), equals the format's own
 * classes, or claims a class set of the same tag that any format's primary
 * classes or an earlier variant already claim. Primaries are never dropped
 * (two formats with equal primaries stay as before — the first one is read).
 */
function settleVariants(
  formats: readonly (Omit<TextFormat, 'variants'> & { candidates: { ids: string[]; keepEmpty: boolean }[] })[],
): TextFormat[] {
  const claimed = new Set(formats.map((f) => classSetKey(f.tag, f.classIds)))
  return formats.map(({ candidates, ...format }) => {
    const variants: string[][] = []
    for (const { ids, keepEmpty } of candidates) {
      if (ids.length === 0 && !keepEmpty) continue
      const key = classSetKey(format.tag, ids)
      if (claimed.has(key)) continue
      claimed.add(key)
      variants.push(ids)
    }
    return variants.length > 0 ? { ...format, variants } : format
  })
}

function variantCandidates(value: unknown): { ids: string[]; keepEmpty: boolean }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) =>
    Array.isArray(entry) ? [{ ids: uniqueStrings(entry), keepEmpty: entry.length === 0 }] : [],
  )
}

export function parseTextFormatsSettings(raw: unknown): TextFormatsSettings | undefined {
  if (!isRecord(raw)) return undefined
  const formats: Parameters<typeof settleVariants>[0][number][] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(raw.formats) ? raw.formats : []) {
    if (!isRecord(entry)) continue
    const { id, tag } = entry
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || seen.has(id)) continue
    if (typeof tag !== 'string' || !(INLINE_FORMAT_TAGS as readonly string[]).includes(tag)) continue
    const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim().slice(0, 40) : id
    const shortcut =
      typeof entry.shortcut === 'string' && SHORTCUT_PATTERN.test(entry.shortcut) ? entry.shortcut : undefined
    seen.add(id)
    formats.push({
      id,
      label,
      tag: tag as InlineFormatTag,
      classIds: uniqueStrings(entry.classIds),
      ...(shortcut ? { shortcut } : {}),
      candidates: variantCandidates(entry.variants),
    })
  }
  const link = { classIds: isRecord(raw.link) ? uniqueStrings(raw.link.classIds) : [] }
  return { formats: settleVariants(formats), link }
}

export function resolveTextFormats(raw: unknown): TextFormatsSettings {
  return parseTextFormatsSettings(raw) ?? DEFAULT_TEXT_FORMATS
}

type StyleRuleKinds = Record<string, { kind?: string } | undefined>

/** True when `id` names an existing class rule — the only ids text formats and links may carry. */
export function isUsableClassId(styleRules: StyleRuleKinds, id: string): boolean {
  const rule = styleRules[id]
  return rule !== undefined && (!rule.kind || rule.kind === 'class')
}

export function effectiveTextFormats(raw: unknown, styleRules: StyleRuleKinds): TextFormatsSettings {
  const resolved = resolveTextFormats(raw)
  const usable = (id: string) => isUsableClassId(styleRules, id)
  return {
    formats: settleVariants(
      resolved.formats.map(({ variants, ...f }) => ({
        ...f,
        classIds: f.classIds.filter(usable),
        // A variant emptied by the filter is dropped; one stored empty (the bare tag) stays.
        candidates: (variants ?? []).map((ids) => ({ ids: ids.filter(usable), keepEmpty: ids.length === 0 })),
      })),
    ),
    link: { classIds: resolved.link.classIds.filter(usable) },
  }
}
