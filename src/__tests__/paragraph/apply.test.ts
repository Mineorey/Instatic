import { describe, it, expect } from 'bun:test'
import { applyParagraphRuns, paragraphFingerprint, readParagraphRuns, resolveParagraphTarget, type Run } from '@core/paragraph'
import type { NodeTree, PageNode } from '@core/page-tree'
import { FORMATS, link, paragraphTree, strong, text, textParagraphTree } from './paragraphFixtures'

/** ID-free structural description, for comparing trees across edits. */
function describeNode(tree: NodeTree<PageNode>, id: string): unknown {
  const n = tree.nodes[id]
  return {
    module: n.moduleId,
    props: Object.fromEntries(Object.entries(n.props).filter(([k]) => ['text', 'tag', 'customTag', 'href', 'target'].includes(k))),
    classIds: n.classIds,
    children: n.children.map((c) => describeNode(tree, c)),
  }
}
const paraId = (tree: NodeTree<PageNode>) => tree.nodes.root.children[0]
const runsOf = (tree: NodeTree<PageNode>) =>
  readParagraphRuns(tree, resolveParagraphTarget(tree, paraId(tree), FORMATS)!, FORMATS)
const apply = (tree: NodeTree<PageNode>, runs: Run[]) =>
  applyParagraphRuns(tree, resolveParagraphTarget(tree, paraId(tree), FORMATS)!, runs, FORMATS)
const t = (x: string): Run => ({ kind: 'text', text: x })
const b = (x: string): Run => ({ kind: 'format', formatId: 'bold', text: x })

describe('applyParagraphRuns', () => {
  it('collapses a container back to a single base.text when formatting is removed', () => {
    const tree = paragraphTree([text('a', 'based on '), strong('b', 'plan'), text('c', ' for')])
    apply(tree, [t('based on '), t('plan'), t(' for')])
    const id = paraId(tree)
    expect(tree.nodes[id].moduleId).toBe('base.text')
    expect(tree.nodes[id].props).toMatchObject({ text: 'based on plan for', tag: 'p' })
    expect(tree.nodes[id].classIds).toEqual(['cls-body'])
    expect(tree.nodes.a).toBeUndefined()
  })

  it('expands a single base.text into a container when formatting is added', () => {
    const tree = textParagraphTree('based on plan for')
    apply(tree, [t('based on '), b('plan'), t(' for')])
    expect(describeNode(tree, paraId(tree))).toEqual({
      module: 'base.container',
      props: { tag: 'custom', customTag: 'p' },
      classIds: ['cls-body'],
      children: [
        { module: 'base.text', props: { text: 'based on ', tag: 'none' }, classIds: [], children: [] },
        { module: 'base.text', props: { text: 'plan', tag: 'strong' }, classIds: ['cls-bold'], children: [] },
        { module: 'base.text', props: { text: ' for', tag: 'none' }, classIds: [], children: [] },
      ],
    })
  })

  it('carries locked and hidden over when expanding and collapsing', () => {
    const tree = textParagraphTree('based on plan')
    tree.nodes.para.locked = true
    tree.nodes.para.hidden = true
    apply(tree, [t('based on '), b('plan')])
    expect(tree.nodes[paraId(tree)]).toMatchObject({ moduleId: 'base.container', locked: true, hidden: true })
    apply(tree, [t('based on plan')])
    expect(tree.nodes[paraId(tree)]).toMatchObject({ moduleId: 'base.text', locked: true, hidden: true })
  })

  it('reuses existing child ids when only text changes', () => {
    const tree = paragraphTree([text('a', 'alt '), strong('b', 'fett'), text('c', ' ende')])
    apply(tree, [t('neu '), b('fetter'), t(' ende')])
    expect(tree.nodes.para.children).toEqual(['a', 'b', 'c'])
    expect(tree.nodes.b.props.text).toBe('fetter')
  })

  it('returns to the identical structure after 10 bold/unbold cycles', () => {
    const tree = textParagraphTree('We pay based on plan for alle.')
    apply(tree, [t('We pay based on '), b('plan'), t(' for alle.')])
    const bolded = describeNode(tree, paraId(tree))
    for (let i = 0; i < 10; i++) {
      apply(tree, runsOf(tree).map((r) => (r.kind === 'format' ? t(r.text) : r)))
      expect(tree.nodes[paraId(tree)].moduleId).toBe('base.text')
      apply(tree, [t('We pay based on '), b('plan'), t(' for alle.')])
      expect(describeNode(tree, paraId(tree))).toEqual(bolded)
    }
  })

  it('keeps fixed nodes untouched and turns a duplicated fixed run into plain text', () => {
    const tree = paragraphTree([text('a', 'x '), strong('f', 'Sonder', ['cls-card'])])
    apply(tree, [t('x '), { kind: 'fixed', nodeId: 'f', text: 'Sonder' }, t(' und '), { kind: 'fixed', nodeId: 'f', text: 'Sonder' }])
    const kids = tree.nodes.para.children.map((id) => tree.nodes[id])
    expect(kids.map((k) => [k.props.tag ?? k.moduleId, k.props.text])).toEqual([
      ['none', 'x '], ['strong', 'Sonder'], ['none', ' und Sonder'],
    ])
    expect(tree.nodes.f.classIds).toEqual(['cls-card'])
  })

  it('updates link href/target in place and creates new links with link classes', () => {
    const tree = paragraphTree([text('a', 'see '), link('l', 'Pricing', '/pricing')])
    apply(tree, [t('see '), { kind: 'link', text: 'Pricing', href: 'cms:page:p1', target: '_self', classIds: [] }])
    expect(tree.nodes.l.props).toMatchObject({ href: 'cms:page:p1', target: '_self' })
  })

  it('keeps an li container even when only plain text remains', () => {
    const tree = paragraphTree([text('a', 'Punkt '), strong('b', 'eins')], 'li')
    apply(tree, [t('Punkt eins')])
    expect(tree.nodes.para.moduleId).toBe('base.container')
    expect(tree.nodes.para.children.map((id) => tree.nodes[id].props.text)).toEqual(['Punkt eins'])
  })

  it('writes text edits of fixed runs but keeps their formatting', () => {
    const tree = paragraphTree([text('a', 'x '), strong('f', 'Sonder', ['cls-card'])])
    apply(tree, [t('x '), { kind: 'fixed', nodeId: 'f', text: 'Sondertarif' }])
    expect(tree.nodes.f.props.text).toBe('Sondertarif')
    expect(tree.nodes.f.classIds).toEqual(['cls-card'])
    expect(tree.nodes.f.props.tag).toBe('strong')
  })

  it('turns a fixed run whose node vanished into plain text merged with neighbours', () => {
    const tree = paragraphTree([text('a', 'x '), strong('f', 'Sonder', ['cls-card'])])
    apply(tree, [t('x '), { kind: 'fixed', nodeId: 'gone', text: 'weg' }, t(' y')])
    expect(tree.nodes[paraId(tree)].moduleId).toBe('base.text')
    expect(tree.nodes[paraId(tree)].props.text).toBe('x weg y')
  })
})

describe('paragraphFingerprint', () => {
  const fp = (tree: NodeTree<PageNode>) =>
    paragraphFingerprint(tree, resolveParagraphTarget(tree, 'para', FORMATS)!, FORMATS)

  it('is stable for the same tree and changes on text or order changes', () => {
    const tree = paragraphTree([text('a', 'x '), strong('b', 'fett')])
    const before = fp(tree)
    expect(fp(tree)).toBe(before)
    tree.nodes.b.props.text = 'fetter'
    expect(fp(tree)).not.toBe(before)
    tree.nodes.b.props.text = 'fett'
    expect(fp(tree)).toBe(before)
    tree.nodes.para.children = ['b', 'a']
    expect(fp(tree)).not.toBe(before)
  })

  it('changes when the paragraph tag changes (text and container)', () => {
    const single = textParagraphTree('Hallo')
    const singleBefore = fp(single)
    single.nodes.para.props.tag = 'h2'
    expect(fp(single)).not.toBe(singleBefore)
    const container = paragraphTree([text('a', 'x '), strong('b', 'fett')])
    const containerBefore = fp(container)
    container.nodes.para.props.customTag = 'h3'
    expect(fp(container)).not.toBe(containerBefore)
  })

  it("returns 'missing' for a missing node", () => {
    const tree = paragraphTree([text('a', 'x '), strong('b', 'fett')])
    const target = resolveParagraphTarget(tree, 'para', FORMATS)!
    delete tree.nodes.para
    expect(paragraphFingerprint(tree, target, FORMATS)).toBe('missing')
  })
})
