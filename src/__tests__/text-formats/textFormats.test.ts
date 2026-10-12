import { describe, it, expect } from 'bun:test'
import {
  DEFAULT_TEXT_FORMATS,
  effectiveTextFormats,
  isUsableClassId,
  parseTextFormatsSettings,
  resolveTextFormats,
} from '@core/text-formats'
import { parseSiteSettings } from '@core/page-tree'

describe('parseTextFormatsSettings', () => {
  it('returns undefined for missing or non-object input', () => {
    expect(parseTextFormatsSettings(undefined)).toBeUndefined()
    expect(parseTextFormatsSettings('x')).toBeUndefined()
  })

  it('keeps valid entries and drops invalid ones individually', () => {
    const parsed = parseTextFormatsSettings({
      formats: [
        { id: 'bold', label: 'Bold', tag: 'strong', classIds: ['c1', 'c1', 3], shortcut: 'Mod-b' },
        { id: 'bad-tag', label: 'X', tag: 'script', classIds: [] },
        { id: 'Bad Id', label: 'X', tag: 'em', classIds: [] },
        { id: 'bold', label: 'Duplicate', tag: 'em', classIds: [] },
        { id: 'mark', label: '', tag: 'span', classIds: [], shortcut: 'Ctrl+M' },
        'garbage',
      ],
      link: { classIds: ['l1'] },
    })
    expect(parsed).toEqual({
      formats: [
        { id: 'bold', label: 'Bold', tag: 'strong', classIds: ['c1'], shortcut: 'Mod-b' },
        { id: 'mark', label: 'mark', tag: 'span', classIds: [] },
      ],
      link: { classIds: ['l1'] },
    })
  })

  it('resolveTextFormats falls back to defaults', () => {
    expect(resolveTextFormats(undefined)).toEqual(DEFAULT_TEXT_FORMATS)
    expect(DEFAULT_TEXT_FORMATS.formats.map((f) => f.tag)).toEqual(['strong', 'em'])
  })

  it('keeps a stored empty format list empty (no fallback to the defaults)', () => {
    expect(parseTextFormatsSettings({ formats: [] })).toEqual({ formats: [], link: { classIds: [] } })
    expect(resolveTextFormats({ formats: [] }).formats).toEqual([])
    expect(effectiveTextFormats({ formats: [] }, {}).formats).toEqual([])
  })

  it('isUsableClassId accepts existing class rules only', () => {
    const rules = { ok: { kind: 'class' }, legacy: {}, amb: { kind: 'ambient' } }
    expect(['ok', 'legacy', 'amb', 'gone'].filter((id) => isUsableClassId(rules, id))).toEqual(['ok', 'legacy'])
  })

  it('effectiveTextFormats drops unknown and ambient class ids', () => {
    const raw = { formats: [{ id: 'bold', label: 'B', tag: 'strong', classIds: ['ok', 'gone', 'amb'] }], link: { classIds: ['gone'] } }
    const rules = { ok: { kind: 'class' }, amb: { kind: 'ambient' } }
    const eff = effectiveTextFormats(raw, rules)
    expect(eff.formats[0].classIds).toEqual(['ok'])
    expect(eff.link.classIds).toEqual([])
  })
})

describe('SiteSettings integration', () => {
  it('parseSiteSettings keeps textFormats', () => {
    const s = parseSiteSettings({ shortcuts: {}, textFormats: { formats: [{ id: 'bold', label: 'B', tag: 'strong', classIds: [] }], link: { classIds: [] } } })
    expect(resolveTextFormats(s.textFormats).formats[0].id).toBe('bold')
  })
  it('parseSiteSettings omits textFormats when absent', () => {
    expect('textFormats' in parseSiteSettings({ shortcuts: {} })).toBe(false)
  })
})
