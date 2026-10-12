/**
 * Format variants — extra class sets that are also recognised as a format
 * (e.g. `highlight` and `text-bold` next to the primary
 * `text-strong` for Bold).
 */
import { describe, it, expect } from 'bun:test'
import { effectiveTextFormats, parseTextFormatsSettings } from '@core/text-formats'

const bold = (extra: Record<string, unknown>) => ({ id: 'bold', label: 'Bold', tag: 'strong', classIds: ['primary'], ...extra })

describe('parseTextFormatsSettings — variants', () => {
  it('keeps valid variant sets, dedupes ids and sets, drops invalid ones and the primary set', () => {
    const parsed = parseTextFormatsSettings({
      formats: [
        bold({
          variants: [
            ['highlight', 'highlight'],
            'garbage',
            ['text-bold', 3],
            ['text-bold'],
            ['primary'],
            [],
            [],
            [7],
          ],
        }),
      ],
    })
    expect(parsed?.formats[0].variants).toEqual([['highlight'], ['text-bold'], []])
  })

  it('compares sets order-independently', () => {
    const parsed = parseTextFormatsSettings({
      formats: [{ id: 'bold', label: 'B', tag: 'strong', classIds: ['a', 'b'], variants: [['b', 'a'], ['c', 'd'], ['d', 'c']] }],
    })
    expect(parsed?.formats[0].variants).toEqual([['c', 'd']])
  })

  it('omits the key when no variant is left, and for a non-array value', () => {
    expect('variants' in parseTextFormatsSettings({ formats: [bold({ variants: [['primary']] })] })!.formats[0]).toBe(false)
    expect('variants' in parseTextFormatsSettings({ formats: [bold({ variants: 'x' })] })!.formats[0]).toBe(false)
  })

  it('never lets a variant claim a class set another format of the same tag already claims', () => {
    const parsed = parseTextFormatsSettings({
      formats: [
        bold({ variants: [['shared'], ['plain-strong']] }),
        // Primary `plain-strong` of a later format still wins over Bold's variant.
        { id: 'strong-2', label: 'Strong 2', tag: 'strong', classIds: ['plain-strong'], variants: [['shared'], ['own'], ['primary']] },
        // A different tag may use the same classes.
        { id: 'italic', label: 'Italic', tag: 'em', classIds: [], variants: [['shared']] },
      ],
    })
    expect(parsed?.formats.map((f) => f.variants)).toEqual([[['shared']], [['own']], [['shared']]])
  })
})

describe('effectiveTextFormats — variants', () => {
  const rules = { primary: { kind: 'class' }, highlight: { kind: 'class' }, alt: { kind: 'class' }, amb: { kind: 'ambient' } }

  it('filters unknown and ambient ids inside variants and dedupes what becomes equal', () => {
    const eff = effectiveTextFormats(
      { formats: [bold({ variants: [['highlight', 'gone'], ['highlight'], ['alt', 'amb'], ['gone'], []] })] },
      rules,
    )
    // ['gone'] became empty → dropped (it was not empty originally); [] stays.
    expect(eff.formats[0].variants).toEqual([['highlight'], ['alt'], []])
  })

  it('drops a variant that becomes equal to the primary after filtering', () => {
    const eff = effectiveTextFormats({ formats: [bold({ variants: [['primary', 'gone']] })] }, rules)
    expect(eff.formats[0].variants).toBeUndefined()
  })
})
