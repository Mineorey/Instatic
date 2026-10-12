/**
 * Paragraph mode — host claim, orphaned-session cancel, and the registry
 * hand-offs (link-panel request, Escape closer, commit hook). The focus /
 * pointer flows built on these are covered by the E2E suite.
 */
import { describe, it, expect, beforeEach } from 'bun:test'
import { useEditorStore } from '@site/store/store'
import {
  claimParagraphHost,
  hasParagraphHost,
  isParagraphHostClaimedByOther,
  releaseParagraphHost,
  scheduleOrphanedParagraphCheck,
  startParagraphOrInlineEdit,
} from '@site/canvas/paragraph/paragraphHostClaim'
import { __resetToastBusForTests, subscribeToasts, type Toast } from '@ui/components/Toast/toastBus'
import {
  closeLinkPanel,
  requestLinkPanel,
  requestParagraphCommit,
  resetLinkPanelRequest,
  setLinkPanelCloser,
  setParagraphCommitHandler,
  subscribeLinkPanelRequest,
  takeLinkPanelRequest,
} from '@site/canvas/paragraph/paragraphEditorRegistry'
import '@modules/base/text'

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

function captureToasts(): { toasts: () => readonly Toast[]; stop: () => void } {
  __resetToastBusForTests()
  let current: readonly Toast[] = []
  const stop = subscribeToasts((snapshot) => { current = snapshot })
  return { toasts: () => current, stop }
}

function startSession(): string {
  const store = useEditorStore.getState()
  const site = store.createSite('Paragraph Host Test')
  const nodeId = useEditorStore.getState().insertNode('base.text', { text: 'Hallo' }, site.pages[0].rootNodeId)
  expect(useEditorStore.getState().startParagraphEdit(nodeId, 'bp')).toBe(true)
  return nodeId
}

beforeEach(() => {
  useEditorStore.getState().clearSite()
  useEditorStore.setState({ activePageId: null, activeDocument: null, activeInlineEdit: null, activeParagraphEdit: null })
})

describe('paragraph host claim', () => {
  it('lets exactly one host own the session', () => {
    const a = {}
    const b = {}
    expect(claimParagraphHost(a)).toBe(true)
    expect(claimParagraphHost(a)).toBe(true)
    expect(claimParagraphHost(b)).toBe(false)
    expect(isParagraphHostClaimedByOther(b)).toBe(true)
    expect(isParagraphHostClaimedByOther(a)).toBe(false)
    releaseParagraphHost(b) // not the owner — no effect
    expect(hasParagraphHost()).toBe(true)
    releaseParagraphHost(a)
    expect(hasParagraphHost()).toBe(false)
    expect(claimParagraphHost(b)).toBe(true)
    releaseParagraphHost(b)
  })
})

describe('orphaned paragraph session', () => {
  it('is cancelled one tick after its host unmounted', async () => {
    startSession()
    const host = {}
    claimParagraphHost(host)
    releaseParagraphHost(host)
    scheduleOrphanedParagraphCheck()
    expect(useEditorStore.getState().activeParagraphEdit).not.toBeNull()
    await tick()
    expect(useEditorStore.getState().activeParagraphEdit).toBeNull()
  })

  it('survives a StrictMode-style release + re-claim within the tick', async () => {
    startSession()
    const host = {}
    claimParagraphHost(host)
    releaseParagraphHost(host)
    scheduleOrphanedParagraphCheck()
    claimParagraphHost(host)
    await tick()
    expect(useEditorStore.getState().activeParagraphEdit).not.toBeNull()
    releaseParagraphHost(host)
  })

  it('is cancelled when no host ever claimed it — silently', async () => {
    const captured = captureToasts()
    startSession()
    scheduleOrphanedParagraphCheck()
    await tick()
    expect(useEditorStore.getState().activeParagraphEdit).toBeNull()
    expect(captured.toasts()).toEqual([])
    captured.stop()
  })

  it('warns when the session of an editing host is discarded', async () => {
    const captured = captureToasts()
    startSession()
    const host = {}
    claimParagraphHost(host)
    releaseParagraphHost(host)
    scheduleOrphanedParagraphCheck({ hadHost: true })
    await tick()
    expect(useEditorStore.getState().activeParagraphEdit).toBeNull()
    expect(captured.toasts().map((t) => [t.kind, t.title])).toEqual([['warning', 'Paragraph edit closed']])
    captured.stop()
  })

  it('does not warn for a StrictMode-style re-claim', async () => {
    const captured = captureToasts()
    startSession()
    const host = {}
    claimParagraphHost(host)
    releaseParagraphHost(host)
    scheduleOrphanedParagraphCheck({ hadHost: true })
    claimParagraphHost(host)
    await tick()
    expect(captured.toasts()).toEqual([])
    releaseParagraphHost(host)
    captured.stop()
  })

  it('leaves a later session alone', async () => {
    const nodeId = startSession()
    scheduleOrphanedParagraphCheck()
    useEditorStore.getState().cancelParagraphEdit()
    expect(useEditorStore.getState().startParagraphEdit(nodeId, 'bp')).toBe(true)
    const host = {}
    claimParagraphHost(host)
    await tick()
    expect(useEditorStore.getState().activeParagraphEdit).not.toBeNull()
    releaseParagraphHost(host)
  })
})

describe('double-click entry', () => {
  function textNode(): string {
    const site = useEditorStore.getState().createSite('Paragraph Entry Test')
    return useEditorStore.getState().insertNode('base.text', { text: 'Hallo', tag: 'p' }, site.pages[0].rootNodeId)
  }

  it('opens paragraph mode where a host may mount', () => {
    const nodeId = textNode()
    startParagraphOrInlineEdit(nodeId, 'bp', { x: 1, y: 2 }, true)
    expect(useEditorStore.getState().activeParagraphEdit?.caret).toEqual({ x: 1, y: 2 })
    expect(useEditorStore.getState().activeInlineEdit).toBeNull()
  })

  it('falls back to the plain inline edit in a loop iteration / snapshot frame', async () => {
    const nodeId = textNode()
    startParagraphOrInlineEdit(nodeId, 'bp', { x: 1, y: 2 }, false)
    expect(useEditorStore.getState().activeParagraphEdit).toBeNull()
    expect(useEditorStore.getState().activeInlineEdit?.nodeId).toBe(nodeId)
    await tick()
    expect(useEditorStore.getState().activeInlineEdit?.nodeId).toBe(nodeId)
  })
})

describe('paragraph editor registry', () => {
  it('keeps a link-panel request until the menu takes it (menu may load later)', () => {
    resetLinkPanelRequest()
    expect(takeLinkPanelRequest()).toBe(false)
    requestLinkPanel()
    expect(takeLinkPanelRequest()).toBe(true)
    expect(takeLinkPanelRequest()).toBe(false)
    requestLinkPanel()
    resetLinkPanelRequest()
    expect(takeLinkPanelRequest()).toBe(false)
  })

  it('notifies a mounted menu of each Ctrl+K', () => {
    let calls = 0
    const unsubscribe = subscribeLinkPanelRequest(() => { calls += 1 })
    requestLinkPanel()
    unsubscribe()
    requestLinkPanel()
    resetLinkPanelRequest()
    expect(calls).toBe(1)
  })

  it('routes Escape to the open panel closer and outside presses to the host commit', () => {
    let closed = 0
    let committed = 0
    setLinkPanelCloser(() => { closed += 1 })
    setParagraphCommitHandler(() => { committed += 1 })
    closeLinkPanel()
    requestParagraphCommit()
    setLinkPanelCloser(null)
    setParagraphCommitHandler(null)
    closeLinkPanel()
    requestParagraphCommit()
    expect(closed).toBe(1)
    expect(committed).toBe(1)
  })
})
