/**
 * Format variants in paragraphs — a paragraph may mix three
 * visually equal bold classes (`text-strong` primary, `highlight`,
 * `text-bold`). All three read as Bold; reused nodes keep their classes, new
 * Bold gets the primary classes.
 */
import { describe, it, expect } from 'bun:test'
import {
  applyParagraphRuns,
  paragraphFingerprint,
  readParagraphRuns,
  resolveParagraphTarget,
  type Run,
} from '@core/paragraph'
import type { NodeTree, PageNode } from '@core/page-tree'
import type { TextFormatsSettings } from '@core/text-formats'
import { paragraphTree, strong, text } from './paragraphFixtures'

const FORMATS: TextFormatsSettings = {
  formats: [
    { id: 'bold', label: 'Bold', tag: 'strong', classIds: ['primary'], variants: [['highlight'], ['alt'], []] },
    { id: 'italic', label: 'Italic', tag: 'em', classIds: [] },
  ],
  link: { classIds: [] },
}
const t = (x: string): Run => ({ kind: 'text', text: x })
const b = (x: string): Run => ({ kind: 'format', formatId: 'bold', text: x })

function mixed(): NodeTree<PageNode> {
  return paragraphTree([
    text('a', 'Over '),
    strong('h', '500 people', ['highlight']),
    text('c', ' work based on '),
    strong('s', 'plan', ['primary']),
    text('e', ' with '),
    strong('f', 'bonuses', ['alt']),
    text('g', ' und '),
    strong('p', 'pension', []),
    text('i', '.'),
  ])
}
const target = (tree: NodeTree<PageNode>) => resolveParagraphTarget(tree, 'para', FORMATS)!
const runsOf = (tree: NodeTree<PageNode>) => readParagraphRuns(tree, target(tree), FORMATS)
const apply = (tree: NodeTree<PageNode>, runs: Run[]) => applyParagraphRuns(tree, target(tree), runs, FORMATS)
const strongs = (tree: NodeTree<PageNode>) =>
  tree.nodes.para.children
    .map((id) => tree.nodes[id])
    .filter((n) => n.props.tag === 'strong')
    .map((n) => ({ text: n.props.text, classIds: n.classIds }))

describe('format variants — read', () => {
  it('reads the primary and every variant as the format (no fixed runs)', () => {
    expect(runsOf(mixed())).toEqual([
      t('Over '), b('500 people'), t(' work based on '), b('plan'), t(' with '), b('bonuses'), t(' und '), b('pension'), t('.'),
    ])
  })

  it('a class set that is neither primary nor variant stays fixed', () => {
    const tree = paragraphTree([text('a', 'x '), strong('o', 'y', ['other'])])
    expect(runsOf(tree)[1]).toEqual({ kind: 'fixed', nodeId: 'o', text: 'y' })
  })
})

describe('format variants — apply', () => {
  it('a no-op commit changes nothing', () => {
    const tree = mixed()
    const before = JSON.stringify(tree)
    apply(tree, runsOf(tree))
    expect(JSON.stringify(tree)).toBe(before)
  })

  it('untouched variant words keep their class while other text changes', () => {
    const tree = mixed()
    const runs = runsOf(tree)
    runs[2] = t(' work gladly based on ')
    runs[3] = b('plan-rate')
    apply(tree, runs)
    expect(strongs(tree)).toEqual([
      { text: '500 people', classIds: ['highlight'] },
      { text: 'plan-rate', classIds: ['primary'] },
      { text: 'bonuses', classIds: ['alt'] },
      { text: 'pension', classIds: [] },
    ])
    expect(tree.nodes.h.props.text).toBe('500 people')
  })

  it('un-bolding a variant word removes its node', () => {
    const tree = mixed()
    const runs = runsOf(tree)
    runs[1] = t('500 people')
    apply(tree, runs)
    expect(tree.nodes.h).toBeUndefined()
    expect(strongs(tree).map((s) => s.text)).toEqual(['plan', 'bonuses', 'pension'])
    expect(runsOf(tree)[0]).toEqual(t('Over 500 people work based on '))
  })

  it('new bold text gets the primary classes', () => {
    const tree = mixed()
    const runs = runsOf(tree)
    runs.splice(8, 1, t('. '), b('Neu'))
    apply(tree, runs)
    expect(strongs(tree).at(-1)).toEqual({ text: 'Neu', classIds: ['primary'] })
  })

  it('adjacent bold runs merge into the first reused node, which keeps its classes', () => {
    const tree = mixed()
    // Delete " work based on " — "500 people" (highlight) and "plan" (primary) touch.
    const runs = runsOf(tree)
    runs.splice(2, 1)
    apply(tree, runs)
    expect(strongs(tree)[0]).toEqual({ text: '500 peopleplan', classIds: ['highlight'] })
    expect(tree.nodes.s).toBeUndefined()
  })
})

describe('format variants — node alignment', () => {
  it('bolding an earlier copy of a bold word keeps every existing node and class', () => {
    const tree = paragraphTree([
      text('a', 'Das ist wichtig und '),
      strong('h', 'neu', ['highlight']),
      text('u', ' und '),
      strong('f', 'wichtig', ['alt']),
    ])
    apply(tree, [t('Das ist '), b('wichtig'), t(' und '), b('neu'), t(' und '), b('wichtig')])
    const children = tree.nodes.para.children
    expect(children.map((id) => tree.nodes[id].props.text)).toEqual(['Das ist ', 'wichtig', ' und ', 'neu', ' und ', 'wichtig'])
    expect(children[0]).toBe('a')
    expect(children.slice(3)).toEqual(['h', 'u', 'f'])
    expect(tree.nodes[children[1]].classIds).toEqual(['primary'])
    expect(tree.nodes.h.classIds).toEqual(['highlight'])
    expect(tree.nodes.f.classIds).toEqual(['alt'])
  })

  it('swapping two bold words of different variants keeps both nodes and classes', () => {
    const tree = paragraphTree([strong('A', 'eins', ['highlight']), text('m', ' '), strong('B', 'zwei', ['alt'])])
    apply(tree, [b('zwei'), t(' '), b('eins')])
    expect(tree.nodes.para.children).toEqual(['B', 'm', 'A'])
    expect(tree.nodes.A.classIds).toEqual(['highlight'])
    expect(tree.nodes.B.classIds).toEqual(['alt'])
  })
})

describe('format variants — conflict guard', () => {
  it('the fingerprint changes when a variant node switches classes', () => {
    const tree = mixed()
    const before = paragraphFingerprint(tree, target(tree), FORMATS)
    tree.nodes.h.classIds = ['alt']
    expect(paragraphFingerprint(tree, target(tree), FORMATS)).not.toBe(before)
  })
})

describe('format variants — commit through the store', () => {
  it('a no-op commit over adjacent bold nodes of different variants is unchanged and mutates nothing', async () => {
    const { useEditorStore } = await import('@site/store/store')
    const { classKindSelector } = await import('@core/page-tree')
    const s = () => useEditorStore.getState()
    s().clearSite()
    const site = s().createSite('Variant Site')
    const rootId = site.pages[0].rootNodeId
    const paraId = s().insertNode('base.container', { tag: 'custom', customTag: 'p' }, rootId)
    const h = s().insertNode('base.text', { text: '500', tag: 'strong' }, paraId)
    const k = s().insertNode('base.text', { text: ' people', tag: 'strong' }, paraId)
    s().insertNode('base.text', { text: ' work here.', tag: 'none' }, paraId)
    const rule = (id: string) => ({
      id, name: id, kind: 'class' as const, selector: classKindSelector(id), order: 0,
      styles: {}, contextStyles: {}, createdAt: 0, updatedAt: 0,
    })
    useEditorStore.setState((state) => {
      const draft = state.site!
      draft.styleRules.primary = rule('primary')
      draft.styleRules.highlight = rule('highlight')
      draft.settings.textFormats = {
        formats: [{ id: 'bold', label: 'Bold', tag: 'strong', classIds: ['primary'], variants: [['highlight']] }],
        link: { classIds: [] },
      }
      const page = draft.pages.find((p) => p.id === state.activePageId) ?? draft.pages[0]
      page.nodes[h].classIds = ['highlight']
      page.nodes[k].classIds = ['primary']
    })
    const before = JSON.stringify(s().site)
    expect(s().startParagraphEdit(h, 'bp')).toBe(true)
    const runs = s().activeParagraphEdit!.initialRuns
    expect(runs.map((r) => r.kind)).toEqual(['format', 'format', 'text'])
    expect(s().commitParagraphEdit(runs)).toEqual({ status: 'unchanged' })
    expect(JSON.stringify(s().site)).toBe(before)
  })
})
