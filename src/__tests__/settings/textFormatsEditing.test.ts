import { describe, it, expect } from 'bun:test'
import {
  addFormat,
  addVariant,
  removeFormat,
  removeVariant,
  setLinkClasses,
  updateFormat,
  validateShortcut,
} from '@admin/modals/Settings/textFormatsEditing'
import { DEFAULT_TEXT_FORMATS } from '@core/text-formats'

describe('textFormatsEditing', () => {
  it('adds a span format with a unique id', () => {
    const one = addFormat(DEFAULT_TEXT_FORMATS)
    const two = addFormat(one)
    expect(one.formats.at(-1)).toMatchObject({ id: 'format-1', tag: 'span', classIds: [] })
    expect(two.formats.at(-1)?.id).toBe('format-2')
  })
  it('updates and removes by id without touching others', () => {
    const v = updateFormat(DEFAULT_TEXT_FORMATS, 'bold', { classIds: ['c1'] })
    expect(v.formats[0].classIds).toEqual(['c1'])
    expect(v.formats[1]).toEqual(DEFAULT_TEXT_FORMATS.formats[1])
    expect(removeFormat(v, 'bold').formats.map((f) => f.id)).toEqual(['italic'])
  })
  it('sets link classes', () => {
    expect(setLinkClasses(DEFAULT_TEXT_FORMATS, ['l1']).link.classIds).toEqual(['l1'])
  })
})

describe('format variants', () => {
  it('adds a variant once, never the primary set, and removes it by index', () => {
    const base = updateFormat(DEFAULT_TEXT_FORMATS, 'bold', { classIds: ['schwarz'] })
    const one = addVariant(base, 'bold', ['highlight'])
    expect(one.formats[0].variants).toEqual([['highlight']])
    expect(addVariant(one, 'bold', ['highlight'])).toBe(one)
    expect(addVariant(one, 'bold', ['schwarz'])).toBe(one)
    const two = addVariant(one, 'bold', [])
    expect(two.formats[0].variants).toEqual([['highlight'], []])
    expect(removeVariant(two, 'bold', 0).formats[0].variants).toEqual([[]])
    expect('variants' in removeVariant(removeVariant(two, 'bold', 0), 'bold', 0).formats[0]).toBe(false)
  })
})

describe('validateShortcut', () => {
  it('accepts empty (clears) and well-formed unique shortcuts', () => {
    expect(validateShortcut(DEFAULT_TEXT_FORMATS, 'bold', '')).toBeNull()
    expect(validateShortcut(DEFAULT_TEXT_FORMATS, 'bold', 'Mod-b')).toBeNull()
    expect(validateShortcut(DEFAULT_TEXT_FORMATS, 'bold', 'Mod-Shift-k')).toBeNull()
  })
  it('rejects malformed shortcuts', () => {
    expect(validateShortcut(DEFAULT_TEXT_FORMATS, 'bold', 'ctrl+b')).toMatch(/Mod-b/)
    expect(validateShortcut(DEFAULT_TEXT_FORMATS, 'bold', 'Mod-B')).not.toBeNull()
  })
  it('rejects a shortcut already used by another format', () => {
    const shortcutOfItalic = DEFAULT_TEXT_FORMATS.formats[1].shortcut!
    expect(validateShortcut(DEFAULT_TEXT_FORMATS, 'bold', shortcutOfItalic)).toMatch(/already used/i)
    expect(validateShortcut(DEFAULT_TEXT_FORMATS, 'italic', shortcutOfItalic)).toBeNull()
  })
})
