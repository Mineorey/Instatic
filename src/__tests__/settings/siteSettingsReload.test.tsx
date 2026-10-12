/**
 * The standalone branch of useSiteSettingsController (every admin page except
 * the Site editor) caches the loaded site document. A site write made outside
 * the Settings modal — an import, a plugin install — announces itself with
 * `requestCmsSiteReload()`; the next Settings render must show that document,
 * not the one cached before (acceptance finding A: the Text formats class
 * picker stayed empty after a site import).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { TextFormatsSection } from '@admin/modals/Settings/sections/TextFormatsSection'
import { requestCmsSiteReload } from '@admin/state/adminEvents'
import { cmsAdapter } from '@core/persistence/cms'
import { classKindSelector, type SiteDocument, type StyleRule } from '@core/page-tree'
import { useEditorStore } from '@site/store/store'
import { makeSite } from '../fixtures'

function classRule(id: string, name: string): StyleRule {
  return {
    id,
    name,
    kind: 'class',
    selector: classKindSelector(name),
    order: 0,
    styles: {},
    contextStyles: {},
    createdAt: 0,
    updatedAt: 0,
  }
}

const before: SiteDocument = makeSite({ styleRules: { a: classRule('a', 'before-class') } })
const after: SiteDocument = makeSite({
  styleRules: { a: classRule('a', 'imported-one'), b: classRule('b', 'imported-two') },
})

let served: SiteDocument = before
let loads = 0
const originalLoad = cmsAdapter.loadSite.bind(cmsAdapter)
const originalSave = cmsAdapter.saveSite.bind(cmsAdapter)

beforeEach(() => {
  served = before
  loads = 0
  useEditorStore.setState({ site: null } as Parameters<typeof useEditorStore.setState>[0])
  cmsAdapter.loadSite = async () => {
    loads++
    return { site: served, rowSeqs: {}, shellSeq: loads }
  }
  cmsAdapter.saveSite = async () => ({ seq: 100 + loads })
  // The standalone store is a module singleton: start every test from a
  // stale cache so it loads `before`.
  requestCmsSiteReload()
})
afterEach(() => {
  cleanup()
  cmsAdapter.loadSite = originalLoad
  cmsAdapter.saveSite = originalSave
})

async function boldClassOptions(): Promise<string[]> {
  const combobox = await screen.findByRole('combobox', { name: /classes for bold/i })
  fireEvent.click(combobox.nextElementSibling as HTMLElement)
  const names = screen.getAllByRole('option').map((o) => o.textContent ?? '').filter((n) => n !== 'Add class…')
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  return names
}

describe('Settings outside the Site editor after an out-of-modal site write', () => {
  it('shows the imported classes, not the document cached before the import', async () => {
    const first = render(<TextFormatsSection />)
    expect(await boldClassOptions()).toEqual(['before-class'])
    first.unmount()

    // Site import (Replace) finished on the Data page.
    served = after
    requestCmsSiteReload()

    render(<TextFormatsSection />)
    await waitFor(async () => expect(await boldClassOptions()).toEqual(['imported-one', 'imported-two']))
  })

  it('reloads while the modal stays open', async () => {
    render(<TextFormatsSection />)
    expect(await boldClassOptions()).toEqual(['before-class'])
    served = after
    requestCmsSiteReload()
    await waitFor(async () => expect(await boldClassOptions()).toEqual(['imported-one', 'imported-two']))
  })

  it('does not refetch after its own save', async () => {
    render(<TextFormatsSection />)
    await boldClassOptions()
    const loadsBefore = loads
    fireEvent.click(screen.getByRole('button', { name: 'Add format' }))
    await waitFor(() => expect(screen.getAllByText('Remove format').length).toBe(3))
    // Let the chained save settle (it dispatches the reload event itself).
    await new Promise((r) => setTimeout(r, 20))
    expect(loads).toBe(loadsBefore)
  })

  it('an import announced while the first load is in flight still reloads', async () => {
    // The beforeEach reload request ran before any render; start from a
    // load that is still pending when the next import lands.
    let release: (() => void) | undefined
    const gate = new Promise<void>((r) => { release = r })
    cmsAdapter.loadSite = async () => {
      loads++
      const site = served
      if (loads === 1) await gate
      return { site, rowSeqs: {}, shellSeq: loads }
    }
    render(<TextFormatsSection />)
    await waitFor(() => expect(loads).toBe(1))
    served = after
    requestCmsSiteReload()
    release?.()
    await waitFor(async () => expect(await boldClassOptions()).toEqual(['imported-one', 'imported-two']))
  })

  it('a reload that started before a save never rolls the save back', async () => {
    render(<TextFormatsSection />)
    await boldClassOptions()
    // A reload starts; its response is held back and carries the old document.
    let release: (() => void) | undefined
    const gate = new Promise<void>((r) => { release = r })
    const old = served
    let serverSeq = 2
    cmsAdapter.loadSite = async () => {
      loads++
      // The held-back response carries the document and seq from before the save.
      const snapshot = loads === 2 ? { site: old, seq: 2 } : { site: served, seq: serverSeq }
      if (loads === 2) await gate
      return { site: snapshot.site, rowSeqs: {}, shellSeq: snapshot.seq }
    }
    let savedBase: number | undefined
    const seqs: number[] = []
    cmsAdapter.saveSite = async (doc, opts) => {
      savedBase = opts?.shellBaseSeq
      seqs.push(savedBase ?? -1)
      served = doc
      serverSeq = 500 + seqs.length
      return { seq: serverSeq }
    }
    requestCmsSiteReload()
    await waitFor(() => expect(loads).toBe(2))
    // Meanwhile the user adds a format; it saves (seq 500).
    fireEvent.click(screen.getByRole('button', { name: 'Add format' }))
    await waitFor(() => expect(seqs.length).toBe(1))
    release?.()
    await new Promise((r) => setTimeout(r, 30))
    // The old response did not replace the saved document …
    await waitFor(() => expect(screen.getAllByText('Remove format').length).toBe(3))
    // … nor rewind the conflict base: the next save builds on seq 500 or newer.
    fireEvent.click(screen.getByRole('button', { name: 'Add format' }))
    await waitFor(() => expect(seqs.length).toBe(2))
    expect(seqs[1]).toBeGreaterThanOrEqual(500)
  })
})
