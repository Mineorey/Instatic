/**
 * Paragraph edit slice tests — session lifecycle, single-undo commit (incl.
 * the base.text → container replacement on expand), conflict guard against
 * concurrent changes, and start guards.
 * Spec: docs/specs/2026-10-08-inline-textformatierung-design.md
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import { MAIN_BRANCH_ID } from '@core/branches'
import { encodeCollabDocId } from '@core/collab'
import type { BoundCollabDoc, CollabProvider, CollabResetListener } from '@site/collab/collabProvider'
import { connectCollabProvider, disconnectCollabProvider } from '@site/store/slices/site/collabBinding'
import { useEditorStore } from '@site/store/store'
import { isCanvasTextEditing } from '@site/store/textEditing'
// Side-effect imports: register the modules under test into the global registry.
import '@modules/base/text'
import '@modules/base/link'
import '@modules/base/container'

function setup(text = 'based on plan for') {
  const store = useEditorStore.getState()
  const site = store.createSite('Paragraph Test Site')
  const rootId = site.pages[0].rootNodeId
  const nodeId = useEditorStore.getState().insertNode('base.text', { text, tag: 'p' }, rootId)
  return { rootId, nodeId }
}
const s = () => useEditorStore.getState()
const rootChildren = (rootId: string) => {
  const page = s().site!.pages.find((p) => p.id === s().activePageId) ?? s().site!.pages[0]
  return page.nodes[rootId].children.map((id) => page.nodes[id])
}

beforeEach(() => {
  // clearSite also resets the collab binding's docs + undo history.
  s().clearSite()
  useEditorStore.setState({
    activePageId: null,
    activeDocument: null,
    activeInlineEdit: null,
    activeParagraphEdit: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
  })
})

describe('paragraph edit session', () => {
  it('starts on a text paragraph and commits bold as ONE undo step', () => {
    const { rootId, nodeId } = setup()
    expect(s().startParagraphEdit(nodeId, 'bp')).toBe(true)
    expect(s().activeParagraphEdit?.initialRuns).toEqual([{ kind: 'text', text: 'based on plan for' }])
    const result = s().commitParagraphEdit([
      { kind: 'text', text: 'based on ' },
      { kind: 'format', formatId: 'bold', text: 'plan' },
      { kind: 'text', text: ' for' },
    ])
    expect(result.status).toBe('applied')
    expect(s().activeParagraphEdit).toBeNull()
    expect(rootChildren(rootId)[0].moduleId).toBe('base.container')
    s().undo()
    expect(rootChildren(rootId)[0]).toMatchObject({ moduleId: 'base.text', props: { text: 'based on plan for' } })
  })

  it('cancel leaves no trace and no undo entry', () => {
    const { nodeId } = setup()
    const canUndoBefore = s().canUndo
    s().startParagraphEdit(nodeId, 'bp')
    s().cancelParagraphEdit()
    expect(s().activeParagraphEdit).toBeNull()
    expect(s().canUndo).toBe(canUndoBefore)
  })

  it('refuses to overwrite when the paragraph changed meanwhile', () => {
    const { nodeId } = setup()
    s().startParagraphEdit(nodeId, 'bp')
    s().updateNodeProps(nodeId, { text: 'von woanders geändert' })
    const result = s().commitParagraphEdit([{ kind: 'text', text: 'meine Version' }])
    expect(result.status).toBe('conflict')
    expect(s().activeParagraphEdit).toBeNull()
    const page = s().site!.pages[0]
    expect(page.nodes[nodeId].props.text).toBe('von woanders geändert')
  })

  it('does not start on non-paragraph nodes or while an inline edit runs', () => {
    const { rootId, nodeId } = setup()
    const div = s().insertNode('base.container', {}, rootId)
    expect(s().startParagraphEdit(div, 'bp')).toBe(false)
    s().startInlineEdit(nodeId, 'bp')
    expect(s().startParagraphEdit(nodeId, 'bp')).toBe(false)
    expect(s().activeParagraphEdit).toBeNull()
  })

  it('reports unchanged when the text is identical', () => {
    const { nodeId } = setup('Hallo')
    s().startParagraphEdit(nodeId, 'bp')
    const canUndoBefore = s().canUndo
    expect(s().commitParagraphEdit([{ kind: 'text', text: 'Hallo' }]).status).toBe('unchanged')
    expect(s().canUndo).toBe(canUndoBefore)
  })

  it('force-closes the session when the paragraph is deleted', () => {
    const { nodeId } = setup()
    s().startParagraphEdit(nodeId, 'bp')
    s().deleteNode(nodeId)
    expect(s().activeParagraphEdit).toBeNull()
  })
})

describe('paragraph edit session — selection and force-close', () => {
  it('selects the resulting node after an expand and after a collapse', () => {
    const { rootId, nodeId } = setup('based on plan')
    s().selectNode(nodeId)
    s().startParagraphEdit(nodeId, 'bp')
    const expanded = s().commitParagraphEdit([{ kind: 'text', text: 'based on ' }, { kind: 'format', formatId: 'bold', text: 'plan' }])
    expect(expanded.status).toBe('applied')
    const containerId = rootChildren(rootId)[0].id
    expect(expanded).toEqual({ status: 'applied', nodeId: containerId })
    expect(s().selectedNodeIds).toEqual([containerId])

    // Double-clicked on (and selected) the bold run; collapsing deletes it.
    const boldId = rootChildren(rootId)[0].children[1]
    s().selectNode(boldId)
    s().startParagraphEdit(boldId, 'bp')
    const collapsed = s().commitParagraphEdit([{ kind: 'text', text: 'based on plan' }])
    const textId = rootChildren(rootId)[0].id
    expect(collapsed).toEqual({ status: 'applied', nodeId: textId })
    expect(s().selectedNodeIds).toEqual([textId])
  })

  it('force-closes the session on page switch', () => {
    const { nodeId } = setup()
    const pageId = s().site!.pages[0].id
    const pageB = s().addPage('Second', 'second')
    s().openPageInCanvas(pageId)
    expect(s().startParagraphEdit(nodeId, 'bp')).toBe(true)
    s().openPageInCanvas(pageB.id)
    expect(s().activeParagraphEdit).toBeNull()
  })

  it('force-closes the session on active-document switch', () => {
    const { nodeId } = setup()
    expect(s().startParagraphEdit(nodeId, 'bp')).toBe(true)
    s().setActiveDocument({ kind: 'visualComponent', vcId: 'vc-x' })
    expect(s().activeParagraphEdit).toBeNull()
  })

  it('detects a concurrent tag change as a conflict', () => {
    const { nodeId } = setup('Hallo')
    s().startParagraphEdit(nodeId, 'bp')
    s().updateNodeProps(nodeId, { tag: 'h2' })
    expect(s().commitParagraphEdit([{ kind: 'text', text: 'Hallo ' }, { kind: 'format', formatId: 'bold', text: 'Welt' }]).status).toBe('conflict')
  })
})

describe('paragraph edit session — collab reset', () => {
  let resetListeners: Set<CollabResetListener>

  function fakeProvider(): CollabProvider {
    const presenceDoc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(presenceDoc)
    const bound = new Map<string, BoundCollabDoc>()
    resetListeners = new Set()
    return {
      bind: (docId) => {
        let entry = bound.get(docId)
        if (!entry) {
          entry = { doc: new Y.Doc(), synced: true, whenSynced: Promise.resolve() }
          bound.set(docId, entry)
        }
        return entry
      },
      unbind: (docId) => {
        bound.get(docId)?.doc.destroy()
        bound.delete(docId)
      },
      awareness,
      status: () => 'connected',
      canSend: () => true,
      reconnectNow: () => {},
      onStatus: () => () => {},
      onReset: (listener) => {
        resetListeners.add(listener)
        return () => resetListeners.delete(listener)
      },
      destroy: () => {
        awareness.destroy()
        presenceDoc.destroy()
      },
    }
  }

  afterEach(() => {
    disconnectCollabProvider()
    s().clearSite()
  })

  it('cancels the session when the active page doc is reset', () => {
    const { nodeId } = setup()
    const pageId = s().site!.pages[0].id
    s().openPageInCanvas(pageId)
    expect(s().startParagraphEdit(nodeId, 'bp')).toBe(true)
    // Synchronous on purpose: the (empty) fake docs project into the store
    // only after their whenSynced microtask, so the session is still alive here.
    connectCollabProvider(fakeProvider())
    expect(s().activeParagraphEdit).not.toBeNull()
    const docId = encodeCollabDocId({ kind: 'page', branchId: MAIN_BRANCH_ID, rowId: pageId })
    for (const listener of resetListeners) listener(docId, 'stale')
    expect(s().activeParagraphEdit).toBeNull()
  })

  it('keeps the session when another document is reset', () => {
    const { nodeId } = setup()
    s().openPageInCanvas(s().site!.pages[0].id)
    expect(s().startParagraphEdit(nodeId, 'bp')).toBe(true)
    connectCollabProvider(fakeProvider())
    const otherDoc = encodeCollabDocId({ kind: 'page', branchId: MAIN_BRANCH_ID, rowId: 'another-page' })
    for (const listener of resetListeners) listener(otherDoc, 'stale')
    expect(s().activeParagraphEdit).not.toBeNull()
  })
})

describe('isCanvasTextEditing', () => {
  it('is true while either editor owns the keyboard', () => {
    expect(isCanvasTextEditing({ activeInlineEdit: null, activeParagraphEdit: null })).toBe(false)
    expect(isCanvasTextEditing({ activeInlineEdit: {}, activeParagraphEdit: null })).toBe(true)
    expect(isCanvasTextEditing({ activeInlineEdit: null, activeParagraphEdit: {} })).toBe(true)
  })

  it('accepts the boolean flags of the spotlight command context', () => {
    expect(isCanvasTextEditing({ activeInlineEdit: false, activeParagraphEdit: false })).toBe(false)
    expect(isCanvasTextEditing({ activeInlineEdit: false, activeParagraphEdit: true })).toBe(true)
  })
})
