/**
 * The two lazily loaded halves of paragraph mode — the TipTap editor runtime
 * (`./paragraphEditor`, used by ParagraphEditHost in the canvas iframe) and
 * the formatting menu (`./ParagraphBubbleMenu`, rendered by CanvasRoot). Both
 * stay out of the canvas body chunk; this module only holds their `import()`s.
 *
 * Once loaded, both are available synchronously: the host then creates the
 * editor in the same task the session starts (no blank tick), and the menu
 * renders without a Suspense round. `preloadParagraphMode` warms both — the
 * Site editor calls it when idle, so the first double-click rarely waits on a
 * chunk at all.
 */
import { prewarmedLazy } from '@admin/lib/prewarmedLazy'

export type ParagraphEditorModule = typeof import('./paragraphEditor')

let editorModule: ParagraphEditorModule | null = null
let editorPending: Promise<ParagraphEditorModule> | null = null

/** The formatting menu — synchronous once preloaded, Suspense on the cold path. */
export const ParagraphBubbleMenu = prewarmedLazy(() => import('./ParagraphBubbleMenu'), {
  displayName: 'ParagraphBubbleMenu',
})

let menuLoaded = false

/** The editor runtime; a failed load is retried on the next call. */
function loadParagraphEditor(): Promise<ParagraphEditorModule> {
  if (editorModule) return Promise.resolve(editorModule)
  editorPending ??= import('./paragraphEditor').then(
    (mod) => {
      editorModule = mod
      return mod
    },
    (err: unknown) => {
      editorPending = null
      throw err
    },
  )
  return editorPending
}

function loadParagraphMenu(): Promise<void> {
  return ParagraphBubbleMenu.preload().then(() => {
    menuLoaded = true
  })
}

/**
 * Both halves, resolving with the editor runtime. The menu loads in parallel
 * so it can register its plugin right after the editor exists; a menu that
 * fails to load is logged and does not block editing (the host focuses after
 * a bounded wait). Rejects only when the editor runtime fails.
 */
export function loadParagraphMode(): Promise<ParagraphEditorModule> {
  const menu = loadParagraphMenu().catch((err: unknown) => {
    console.error('[paragraph-edit] formatting menu failed to load:', err)
  })
  return Promise.all([loadParagraphEditor(), menu]).then(([mod]) => mod)
}

/** The editor runtime when both halves are already loaded, else null. */
export function loadedParagraphMode(): ParagraphEditorModule | null {
  return menuLoaded ? editorModule : null
}

/** Start loading both halves (idempotent, best effort — a session retries). */
export function preloadParagraphMode(): void {
  // A failed preload is no error yet: the session start loads again and reports it there.
  void loadParagraphEditor().catch((_err: unknown) => {})
  void loadParagraphMenu().catch((_err: unknown) => {})
}
