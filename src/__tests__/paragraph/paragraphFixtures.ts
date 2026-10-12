import { makeNode } from '../fixtures'
import { reindexNodeParents, type NodeTree, type PageNode } from '@core/page-tree'
import type { TextFormatsSettings } from '@core/text-formats'
import '@modules/base/text'
import '@modules/base/link'
import '@modules/base/container'

export const FORMATS: TextFormatsSettings = {
  formats: [
    { id: 'bold', label: 'Bold', tag: 'strong', classIds: ['cls-bold'] },
    { id: 'italic', label: 'Italic', tag: 'em', classIds: [] },
  ],
  link: { classIds: [] },
}

export const text = (id: string, value: string, extra: Partial<PageNode> = {}) =>
  makeNode({ id, moduleId: 'base.text', props: { text: value, tag: 'none' }, ...extra })
export const strong = (id: string, value: string, classIds = ['cls-bold']) =>
  makeNode({ id, moduleId: 'base.text', props: { text: value, tag: 'strong' }, classIds })
export const link = (id: string, value: string, href: string, extra: Partial<PageNode> = {}) =>
  makeNode({ id, moduleId: 'base.link', props: { text: value, href, target: '_self' }, ...extra })

/** root(base.body) → p (container, custom tag) → children */
export function paragraphTree(children: PageNode[], tag = 'p', classIds = ['cls-body']): NodeTree<PageNode> {
  const nodes: Record<string, PageNode> = {
    root: makeNode({ id: 'root', moduleId: 'base.body', children: ['para'] }),
    para: makeNode({
      id: 'para',
      moduleId: 'base.container',
      props: { tag: 'custom', customTag: tag },
      classIds,
      children: children.map((c) => c.id),
    }),
  }
  for (const c of children) nodes[c.id] = c
  reindexNodeParents(nodes)
  return { rootNodeId: 'root', nodes } as NodeTree<PageNode>
}

/** root → single base.text paragraph */
export function textParagraphTree(value: string, tag = 'p', classIds = ['cls-body']): NodeTree<PageNode> {
  const nodes: Record<string, PageNode> = {
    root: makeNode({ id: 'root', moduleId: 'base.body', children: ['para'] }),
    para: makeNode({ id: 'para', moduleId: 'base.text', props: { text: value, tag }, classIds }),
  }
  reindexNodeParents(nodes)
  return { rootNodeId: 'root', nodes } as NodeTree<PageNode>
}
