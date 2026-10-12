/**
 * TextFormatsSection — render + interaction tests against the editor store
 * (the Site-editor branch of useSiteSettingsController).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { TextFormatsSection } from '@admin/modals/Settings/sections/TextFormatsSection'
import { classKindSelector } from '@core/page-tree'
import { DEFAULT_TEXT_FORMATS } from '@core/text-formats'
import { useEditorStore } from '@site/store/store'
import { makeSite } from '../fixtures'

function seedStore() {
  const site = makeSite({
    styleRules: {
      'cls-bold': {
        id: 'cls-bold',
        name: 'text-bold',
        kind: 'class',
        selector: classKindSelector('text-bold'),
        order: 0,
        styles: { fontWeight: '900' },
        contextStyles: {},
        createdAt: 0,
        updatedAt: 0,
      },
    },
  })
  useEditorStore.setState({
    site,
    activePageId: site.pages[0].id,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(() => {
  localStorage.clear()
  seedStore()
})
afterEach(cleanup)

const storedFormats = () => useEditorStore.getState().site!.settings.textFormats

describe('TextFormatsSection', () => {
  it('lists the default formats', () => {
    render(<TextFormatsSection />)
    for (const f of DEFAULT_TEXT_FORMATS.formats) {
      expect(screen.getByTestId(`text-format-${f.id}`)).toBeDefined()
      expect((screen.getByLabelText('Label', { selector: `#tf-label-${f.id}` }) as HTMLInputElement).value).toBe(f.label)
    }
  })

  it('adds a class to a format through the picker', () => {
    render(<TextFormatsSection />)
    const combobox = screen.getByRole('combobox', { name: /classes for bold/i })
    fireEvent.click(combobox.nextElementSibling as HTMLElement)
    fireEvent.click(screen.getByRole('option', { name: 'text-bold' }))
    expect(storedFormats()?.formats.find((f) => f.id === 'bold')?.classIds).toEqual(['cls-bold'])
  })

  it('shows an inline error for a malformed shortcut and does not save it', () => {
    render(<TextFormatsSection />)
    const input = screen.getByLabelText('Shortcut', { selector: '#tf-key-bold' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ctrl+b' } })
    fireEvent.blur(input)
    expect(screen.getByRole('alert').textContent).toMatch(/Mod-b/)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(storedFormats()).toBeUndefined()
  })

  it('rejects a shortcut that another format already uses', () => {
    render(<TextFormatsSection />)
    const italicKey = DEFAULT_TEXT_FORMATS.formats[1].shortcut!
    const input = screen.getByLabelText('Shortcut', { selector: '#tf-key-bold' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: italicKey } })
    fireEvent.blur(input)
    expect(screen.getByRole('alert').textContent).toMatch(/already used/i)
    expect(storedFormats()).toBeUndefined()
  })

  it('adds and removes format variants under "Also recognize"', () => {
    render(<TextFormatsSection />)
    const combobox = screen.getByRole('combobox', { name: /also recognize for bold/i })
    fireEvent.click(combobox.nextElementSibling as HTMLElement)
    fireEvent.click(screen.getByRole('option', { name: 'text-bold' }))
    expect(storedFormats()?.formats.find((f) => f.id === 'bold')?.variants).toEqual([['cls-bold']])
    // Bold's primary set is empty, so the bare tag is not offered as a variant.
    expect(screen.queryByRole('checkbox', { name: /plain <strong> without class/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove variant strong.text-bold' }))
    expect(storedFormats()?.formats.find((f) => f.id === 'bold')?.variants).toBeUndefined()
  })

  it('offers the bare tag as a variant when the format has classes', () => {
    render(<TextFormatsSection />)
    const classes = screen.getByRole('combobox', { name: /classes for bold/i })
    fireEvent.click(classes.nextElementSibling as HTMLElement)
    fireEvent.click(screen.getByRole('option', { name: 'text-bold' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /plain <strong> without class/i }))
    expect(storedFormats()?.formats.find((f) => f.id === 'bold')?.variants).toEqual([[]])
    expect(screen.getByText('strong (no class)')).toBeDefined()
  })

  it('does not offer a class set another format of the same tag already claims', () => {
    useEditorStore.getState().updateSiteSettings({
      textFormats: {
        formats: [
          { id: 'bold', label: 'Bold', tag: 'strong', classIds: ['cls-x'] },
          { id: 'strong-2', label: 'Strong 2', tag: 'strong', classIds: ['cls-bold'], variants: [[]] },
          { id: 'italic', label: 'Italic', tag: 'em', classIds: [] },
        ],
        link: { classIds: [] },
      },
    })
    render(<TextFormatsSection />)
    const combobox = screen.getByRole('combobox', { name: /also recognize for bold/i })
    fireEvent.click(combobox.nextElementSibling as HTMLElement)
    expect(screen.queryByRole('option', { name: 'text-bold' })).toBeNull()
    // The bare <strong> is Strong 2's variant: shown, but not available for Bold.
    const bare = screen.getAllByRole('checkbox', { name: /plain <strong> without class/i })[0] as HTMLInputElement
    expect(bare.disabled).toBe(true)
    expect(screen.getByText(/used by Strong 2/i)).toBeDefined()
  })

  it('Reset to defaults removes the textFormats key', () => {
    render(<TextFormatsSection />)
    fireEvent.click(screen.getByRole('button', { name: /add format/i }))
    expect(storedFormats()?.formats.length).toBe(DEFAULT_TEXT_FORMATS.formats.length + 1)
    fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }))
    expect(storedFormats()).toBeUndefined()
    expect(JSON.parse(JSON.stringify(useEditorStore.getState().site!.settings))).not.toHaveProperty('textFormats')
  })
})
