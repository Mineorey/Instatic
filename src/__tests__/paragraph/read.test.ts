import { describe, it, expect } from 'bun:test'
import { readParagraphRuns, resolveParagraphTarget } from '@core/paragraph'
import { makeNode } from '../fixtures'
import { FORMATS, link, paragraphTree, strong, text, textParagraphTree } from './paragraphFixtures'

describe('resolveParagraphTarget', () => {
  it('detects a custom-tag p container with text/link children', () => {
    const tree = paragraphTree([text('a', 'based on '), strong('b', 'plan'), text('c', ' for')])
    expect(resolveParagraphTarget(tree, 'para', FORMATS)).toEqual({ kind: 'container', nodeId: 'para', tag: 'p' })
  })
  it('resolves a double-clicked inline child to its paragraph', () => {
    const tree = paragraphTree([text('a', 'x '), strong('b', 'y')])
    expect(resolveParagraphTarget(tree, 'b', FORMATS)?.nodeId).toBe('para')
  })
  it('detects a single base.text paragraph and heading', () => {
    expect(resolveParagraphTarget(textParagraphTree('Hallo'), 'para', FORMATS)).toEqual({ kind: 'text', nodeId: 'para', tag: 'p' })
    expect(resolveParagraphTarget(textParagraphTree('Titel', 'h2'), 'para', FORMATS)?.tag).toBe('h2')
  })
  it('rejects a div container and containers with non-inline children', () => {
    const div = paragraphTree([text('a', 'x')], 'div')
    expect(resolveParagraphTarget(div, 'para', FORMATS)).toBeNull()
    const withImage = paragraphTree([text('a', 'x'), makeNode({ id: 'img', moduleId: 'base.image' })])
    expect(resolveParagraphTarget(withImage, 'para', FORMATS)).toBeNull()
  })
  it('rejects a standalone strong whose parent is not a paragraph', () => {
    const tree = paragraphTree([strong('b', 'Titel', ['cls-card'])], 'div')
    expect(resolveParagraphTarget(tree, 'b', FORMATS)).toBeNull()
  })
  it('rejects a container with an empty fixed run (e.g., empty anchor)', () => {
    // An anchor like <a id="x"></a> becomes a fixed run with empty text; such containers are ineligible
    const tree = paragraphTree([
      text('a', 'before '),
      link('anchor', '', '#', { props: { text: '', href: '#', target: '_self', htmlAttributes: { id: 'x' } } }),
      text('b', ' after'),
    ])
    expect(resolveParagraphTarget(tree, 'para', FORMATS)).toBeNull()
  })
  it('accepts an empty container with no runs', () => {
    const tree = paragraphTree([])
    const target = resolveParagraphTarget(tree, 'para', FORMATS)
    expect(target).toEqual({ kind: 'container', nodeId: 'para', tag: 'p' })
    expect(readParagraphRuns(tree, target!, FORMATS)).toEqual([])
  })
  it('rejects a child with children of its own or with dynamic bindings', () => {
    const nested = paragraphTree([text('a', 'x', { children: ['deep'] })])
    nested.nodes.deep = text('deep', 'y', { parentId: 'a' })
    expect(resolveParagraphTarget(nested, 'para', FORMATS)).toBeNull()
    const bound = paragraphTree([text('a', 'x', { dynamicBindings: { text: { source: 'currentEntry', field: 'title' } } })])
    expect(resolveParagraphTarget(bound, 'para', FORMATS)).toBeNull()
  })
  it('rejects a child with a block tag', () => {
    const tree = paragraphTree([text('a', 'x '), text('b', 'Block', { props: { text: 'Block', tag: 'p' } })])
    expect(resolveParagraphTarget(tree, 'para', FORMATS)).toBeNull()
  })
  it('rejects a single text with a breakpoint override of its text', () => {
    const tree = textParagraphTree('Hallo')
    tree.nodes.para.breakpointOverrides = { mobile: { text: 'Hi' } }
    expect(resolveParagraphTarget(tree, 'para', FORMATS)).toBeNull()
  })
  it('rejects a paragraph node with prop bindings or any breakpoint override (lost on convert)', () => {
    const bound = textParagraphTree('Hallo')
    bound.nodes.para.propBindings = { text: { paramId: 'p1' } }
    expect(resolveParagraphTarget(bound, 'para', FORMATS)).toBeNull()
    const overridden = paragraphTree([text('a', 'x')])
    overridden.nodes.para.breakpointOverrides = { mobile: { customTag: 'h2' } }
    expect(resolveParagraphTarget(overridden, 'para', FORMATS)).toBeNull()
    const otherOverride = textParagraphTree('Hallo')
    otherOverride.nodes.para.breakpointOverrides = { mobile: { align: 'center' } }
    expect(resolveParagraphTarget(otherOverride, 'para', FORMATS)).toBeNull()
    // An empty override record is no override.
    const empty = textParagraphTree('Hallo')
    empty.nodes.para.breakpointOverrides = { mobile: {} }
    expect(resolveParagraphTarget(empty, 'para', FORMATS)?.kind).toBe('text')
  })
})

describe('readParagraphRuns', () => {
  it('reads the em format and fixed text from inline styles or html attributes', () => {
    const tree = paragraphTree([
      text('a', 'kursiv', { props: { text: 'kursiv', tag: 'em' } }),
      strong('b', 'gestylt'),
      text('c', 'attr', { props: { text: 'attr', tag: 'span', htmlAttributes: { title: 't' } } }),
    ])
    tree.nodes.b.inlineStyles = { color: 'red' }
    expect(readParagraphRuns(tree, resolveParagraphTarget(tree, 'para', FORMATS)!, FORMATS)).toEqual([
      { kind: 'format', formatId: 'italic', text: 'kursiv' },
      { kind: 'fixed', nodeId: 'b', text: 'gestylt' },
      { kind: 'fixed', nodeId: 'c', text: 'attr' },
    ])
  })
  it('maps children to text / format / link / fixed runs', () => {
    const tree = paragraphTree([
      text('a', 'We pay based on '),
      strong('b', 'plan'),
      text('c', ' – see '),
      link('d', 'Pricing', '/pricing'),
      strong('e', 'Sonder', ['cls-card']),
      link('f', 'mit Attr', '/x', { props: { text: 'mit Attr', href: '/x', target: '_self', htmlAttributes: { rel: 'nofollow' } } }),
    ])
    const target = resolveParagraphTarget(tree, 'para', FORMATS)!
    expect(readParagraphRuns(tree, target, FORMATS)).toEqual([
      { kind: 'text', text: 'We pay based on ' },
      { kind: 'format', formatId: 'bold', text: 'plan' },
      { kind: 'text', text: ' – see ' },
      { kind: 'link', text: 'Pricing', href: '/pricing', target: '_self', classIds: [] },
      { kind: 'fixed', nodeId: 'e', text: 'Sonder' },
      { kind: 'fixed', nodeId: 'f', text: 'mit Attr' },
    ])
  })
  it('reads a single text paragraph as one text run, empty as no run', () => {
    const t = textParagraphTree('Hallo Welt')
    expect(readParagraphRuns(t, resolveParagraphTarget(t, 'para', FORMATS)!, FORMATS)).toEqual([{ kind: 'text', text: 'Hallo Welt' }])
    const e = textParagraphTree('')
    expect(readParagraphRuns(e, resolveParagraphTarget(e, 'para', FORMATS)!, FORMATS)).toEqual([])
  })
})

describe('line-break nodes (<br>) in a paragraph container', () => {
  const br = (id: string, extra: Partial<Parameters<typeof makeNode>[0]> = {}) =>
    makeNode({ id, moduleId: 'base.container', props: { tag: 'custom', customTag: 'br' }, ...extra })

  it('reads a plain <br> child as a line break in plain text', () => {
    const tree = paragraphTree([text('a', 'Satz eins.'), br('b1'), br('b2'), text('c', 'Satz zwei '), strong('d', 'fett')])
    const target = resolveParagraphTarget(tree, 'a', FORMATS)
    expect(target).toEqual({ kind: 'container', nodeId: 'para', tag: 'p' })
    expect(readParagraphRuns(tree, target!, FORMATS).map((r) => r.text).join('')).toBe('Satz eins.\n\nSatz zwei fett')
  })

  it('a <br> with a class or attributes keeps the paragraph on the plain edit path', () => {
    expect(resolveParagraphTarget(paragraphTree([text('a', 'x'), br('b', { classIds: ['c'] })]), 'para', FORMATS)).toBeNull()
    expect(
      resolveParagraphTarget(
        paragraphTree([text('a', 'x'), br('b', { props: { tag: 'custom', customTag: 'br', htmlAttributes: { id: 'z' } } })]),
        'para',
        FORMATS,
      ),
    ).toBeNull()
  })
})
