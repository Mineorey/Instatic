/**
 * Paragraph mode through the REAL publisher: a paragraph expanded by
 * `applyParagraphRuns` (container + text / strong / link children) and the
 * same paragraph collapsed back to a single base.text publish exactly the
 * HTML the spec promises — format classes on the inline tag, `cms:page:`
 * links resolved to the target page's public path.
 */
import { describe, it, expect } from 'bun:test'
import { renderNode, type RenderConfig } from '@core/publisher'
import { registry } from '@core/module-engine'
import type { Page, StyleRule } from '@core/page-tree'
import { applyParagraphRuns, readParagraphRuns, resolveParagraphTarget, type Run } from '@core/paragraph'
import type { TextFormatsSettings } from '@core/text-formats'
import { TextModule } from '@modules/base/text'
import '@modules/base/link'
import '@modules/base/container'
import { makeAccumulators, makePage, makeSite } from './helpers'

function classRule(id: string, name: string, order: number): StyleRule {
  return { id, name, kind: 'class', selector: `.${name}`, order, styles: {}, contextStyles: {}, createdAt: 0, updatedAt: 0 }
}

const FORMATS: TextFormatsSettings = {
  formats: [{ id: 'bold', label: 'Bold', tag: 'strong', classIds: ['cls-bold'] }],
  link: { classIds: ['cls-link'] },
}

function paragraphPage(): Page {
  const page = makePage({
    root: { moduleId: 'base.container', children: ['para'] },
    para: {
      moduleId: 'base.text',
      props: { ...TextModule.defaults, text: 'We pay based on plan – see Pricing', tag: 'p' },
      classIds: ['cls-body'],
    },
  })
  return { ...page, id: 'jobs-id', slug: 'jobs' }
}

function config(page: Page): RenderConfig {
  const site = makeSite({
    pages: [page, { ...paragraphPage(), id: 'pricing-id', slug: 'pricing' }],
    styleRules: {
      'cls-bold': classRule('cls-bold', 'text-bold', 0),
      'cls-link': classRule('cls-link', 'link-underline', 1),
      'cls-body': classRule('cls-body', 'body-copy', 2),
    },
  })
  return { page, site, registry, breakpointId: undefined }
}

function apply(page: Page, runs: Run[]): string {
  const paraId = page.nodes[page.rootNodeId].children[0]
  return applyParagraphRuns(page, resolveParagraphTarget(page, paraId, FORMATS)!, runs, FORMATS)
}

const FORMATTED: Run[] = [
  { kind: 'text', text: 'We pay based on ' },
  { kind: 'format', formatId: 'bold', text: 'plan' },
  { kind: 'text', text: ' – see ' },
  { kind: 'link', text: 'Pricing', href: 'cms:page:pricing-id', target: '_self', classIds: ['cls-link'] },
]

describe('paragraph mode → publisher', () => {
  it('publishes an expanded paragraph with format classes and a resolved page link', () => {
    const page = paragraphPage()
    const id = apply(page, FORMATTED)
    expect(page.nodes[id].moduleId).toBe('base.container')
    expect(renderNode(id, config(page), makeAccumulators())).toBe(
      '<p class="body-copy">We pay based on <strong class="text-bold">plan</strong> – see ' +
        '<a class="link-underline" href="/pricing" target="_self">Pricing</a></p>',
    )
  })

  it('publishes the paragraph collapsed back to a single base.text', () => {
    const page = paragraphPage()
    apply(page, FORMATTED)
    const id = apply(page, [{ kind: 'text', text: 'We pay based on plan – see Pricing' }])
    expect(page.nodes[id].moduleId).toBe('base.text')
    expect(renderNode(id, config(page), makeAccumulators())).toBe(
      '<p class="body-copy">We pay based on plan – see Pricing</p>',
    )
  })

  // Acceptance finding D: Shift+Enter twice (a blank line) between two
  // sentences of a paragraph that also has a format.
  it('publishes line breaks and a blank line in the plain text of an expanded paragraph', () => {
    const page = paragraphPage()
    const id = apply(page, [
      { kind: 'text', text: 'Satz eins.\n\nSatz zwei, Zeile\nweiter ' },
      { kind: 'format', formatId: 'bold', text: 'plan' },
    ])
    expect(renderNode(id, config(page), makeAccumulators())).toBe(
      '<p class="body-copy">Satz eins.<br><br>Satz zwei, Zeile<br>weiter <strong class="text-bold">plan</strong></p>',
    )
  })

  it('keeps the breaks when a paragraph with breaks is edited again', () => {
    const page = paragraphPage()
    const runs: Run[] = [
      { kind: 'text', text: 'Satz eins.\n\nSatz zwei ' },
      { kind: 'format', formatId: 'bold', text: 'plan' },
    ]
    const id = apply(page, runs)
    const before = page.nodes[id].children.slice()
    expect(readParagraphRuns(page, resolveParagraphTarget(page, id, FORMATS)!, FORMATS)
      .map((r) => r.text).join('')).toBe('Satz eins.\n\nSatz zwei plan')
    // Re-applying the same runs reuses every child node.
    apply(page, runs)
    expect(page.nodes[id].children).toEqual(before)
    expect(renderNode(id, config(page), makeAccumulators())).toBe(
      '<p class="body-copy">Satz eins.<br><br>Satz zwei <strong class="text-bold">plan</strong></p>',
    )
  })
})
