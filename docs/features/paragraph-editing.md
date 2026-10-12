# Paragraph Editing and Text Formats

Double-clicking a paragraph in the Site editor canvas edits it as **one rich text**: select words, make them bold, italic or a link from a floating menu, press Enter. The result is written back into the normal node model (a container with `base.text` / `base.link` children) as **one undo step**. Nothing about storage, the publisher, HTML import or MCP changes.

The site setting `textFormats` decides which tag and classes each format writes.

---

## TL;DR

- Editor layer only. No HTML is stored anywhere; the document stays `base.container` + `base.text` (+ `base.link`) nodes.
- Pure logic lives in `src/core/paragraph/` (read, normalize, apply) and `src/core/text-formats/` (settings). No DOM, no editor imports.
- The editing session is `activeParagraphEdit` in `paragraphEditSlice`. It edits a detached copy; the document is touched once, on commit, via `commitParagraphRuns` (one undo entry). Cancel writes nothing.
- The editor is TipTap, started inside the canvas iframe on the paragraph's own element (`canvas/paragraph/`). It is loaded with `import()` so it stays out of the canvas chunk; the Site editor preloads it when idle, and until it is there a static preview of the runs keeps the paragraph visible.
- Commit refuses (`conflict`) when the paragraph changed since the session started. A peer editing it blocks the start.
- Plain inline editing (`startInlineEdit`) is unchanged and is the fallback.

---

## Where the code lives

```text
src/core/text-formats/schemas.ts        — TextFormatsSettings, lenient schema, parser, defaults, effectiveTextFormats
src/core/page-tree/siteSettings.ts      — `textFormats` key in the site settings schema
src/core/paragraph/
├── runs.ts                             — Run union (text | format | link | fixed), sameRunFormat, LINK_TARGETS / isLinkTarget, sameClassIds
├── read.ts                             — paragraphTargetOf / resolveParagraphTarget / childToRun / readParagraphRuns
├── normalize.ts                        — normalizeRuns (canonical form)
├── apply.ts                            — applyParagraphRuns (runs → node tree, id reuse, expand/collapse)
├── fingerprint.ts                      — paragraphFingerprint (conflict guard)
└── linkHref.ts                         — isAllowedLinkHref / isExternalHref / normalizeLinkInput
src/admin/pages/site/store/slices/
├── paragraphEditSlice.ts               — start / commit / cancel, peer check, conflict toast
└── site/nodeActions.ts                 — commitParagraphRuns (single recipe → one undo step)
src/admin/pages/site/canvas/paragraph/
├── ParagraphEditHost.tsx               — element inside the iframe that hosts TipTap
├── paragraphEditor.ts                  — TipTap schema built from the formats, key map, paste handling
├── paragraphCommands.ts                — format / clear / link commands + the guard that keeps them off links and fixed runs
├── paragraphDoc.ts                     — runs <-> TipTap document
├── paragraphEditorRegistry.ts          — editor, link-panel and menu-ready hand-off between trees
├── paragraphModeLoader.ts              — import() of editor + menu, idle preload, synchronous access once loaded
├── paragraphFixedNodes.ts              — tag / class names of fixed runs, the unknown-formatting hint
├── paragraphPreview.ts                 — static preview of the runs while TipTap loads; the injected iframe styles
├── paragraphHostClaim.ts               — one host per session, orphan cancel
├── ParagraphBubbleMenu.tsx             — floating formatting menu (lazy, via paragraphModeLoader)
└── ParagraphLinkPanel.tsx              — link target panel
src/admin/modals/Settings/sections/TextFormatsSection.tsx — "Text formats" settings section
```

---

## Data model

A paragraph is a flat list of **runs**; each run becomes one child node — except line breaks in plain text, which become their own `<br>` node (see "Line breaks").

| Run | Node | Recognised when |
|---|---|---|
| `text` | `base.text`, `tag: none`, no classes; a line break as a childless `base.container` with custom tag `br` | plain unformatted text |
| `format` | `base.text` with the format's tag + classes | tag and class **set** match a configured format exactly |
| `link` | `base.link` with `href`, `target`, classes | any `base.link` without extras |
| `fixed` | any other text-ish node | unknown: custom classes, inline styles, `htmlAttributes`, `propBindings` or breakpoint overrides |

`fixed` runs keep their id and formatting untouched; only their text is editable. Normalization never merges or drops them (even when empty), and no formatting command touches them (see "Menu and link panel"). They do leave the paragraph when the user removes them from the editor document: deleting all of their text or cutting them deletes the node on commit, and a pasted copy arrives as plain text (the fixed mark has no parse rule).

**Line breaks.** Shift+Enter stores `\n` in the run text. Inside a format the `\n` stays in the node's text (`base.text` renders it as `<br>` inside its tag). In the plain text of a container paragraph each `\n` becomes a separate `<br>` node (`base.container`, custom tag `br`, no classes or extras — `isParagraphBreakNode`): a `tag: none` text publishes its text verbatim (required for `<pre>` content), so a `\n` there collapsed to a space in canvas and published page. Reading turns such a node back into a `\n` of the plain text. HTML import stores `<br>` the same way, so imported paragraphs with plain `<br>`s open in paragraph mode too. A collapsed single `base.text` paragraph keeps `\n` in its text (rendered as `<br>`). Line breaks inside a link are not supported (`base.link` renders its text on one line).

### What opens in paragraph mode

`paragraphTargetOf` accepts:

- a `base.container` whose tag is `p`, `h1`–`h6` or `li` and whose children are **all** `base.text` (inline tags `none`/`strong`/`em`/`span`/`small`) or childless `base.link` or plain `<br>` nodes, without dynamic bindings (target kind `container`);
- a childless `base.text` with tag `p` or `h1`–`h6` (kind `text`).

In both cases the paragraph node itself must have no dynamic bindings, no `propBindings` and no non-empty breakpoint override: expand/collapse replaces the node (see below) and could not carry them over.

`resolveParagraphTarget` tries the node itself, then its parent container. Anything else (images, boxes, nested containers, bound or overridden nodes) falls back to the plain inline edit.

A paragraph containing an empty unknown child (for example an empty anchor link) is not eligible and stays on the plain inline-edit path: the editor cannot hold empty text, so the node would vanish on commit without the user touching it.

---

## Session flow

```text
nodes ─(1) read─▶ runs ─(2) TipTap edit─▶ runs ─(3) normalize─▶ runs ─(4) apply─▶ nodes
```

1. **Start.** CanvasRoot's double-click calls `startParagraphOrInlineEdit` (`paragraphHostClaim.ts`). Where the clicked render path cannot host the editor (loop iterations, agent snapshot frames — `CanvasParagraphHostContext`) it goes straight to the plain inline edit. Otherwise it calls `startParagraphEdit(nodeId, breakpointId, caret)`, which returns `false` (and the plain inline edit runs) when another text edit is active, the node is no paragraph, or a peer's awareness `editingNodeId` is one of the paragraph's nodes (a warning toast is shown for the peer case). A peer is any other collab client, including a second window of the same admin. Presence carries `userDisplayLabel` (display name, else email) as the name — the relay forwards only presence matching that session identity, and an admin without a display name used to publish none at all. On success the slice stores the target, a `baseline` fingerprint, `initialRuns`, and the effective formats.
2. **Edit.** `ParagraphEditHost` replaces the module component for that node and starts TipTap on its element. The element is never blank: it first shows a static preview of the session's runs (`createParagraphPreview` — the same markup the editor's marks render, styled like the editor), which the editor replaces in the task it mounts. When both chunks are already loaded (`CanvasRoot` calls `preloadParagraphMode` once the editable canvas is idle), the editor mounts in the same task the host does. Keys pressed before the editor is ready are not lost: once the caret is placed they are replayed — typed characters as text (never parsed as HTML), Shift+Enter as a line break, Backspace as a delete before the caret (or it drops a typed-ahead character) — then Enter commits; Escape cancels. An empty paragraph's preview keeps one line of height. Enter / Mod+Enter / click outside commit (focus moving anywhere else in the admin document or a canvas frame); switching to another window or app with the page still visible does **not** commit — when no document of the window has focus (`document.hasFocus()`), the blur is ignored and checked again when the admin or any canvas frame window gets focus back; the page turning hidden (tab switch, minimise — `visibilitychange`) or being left (`pagehide`) **does** commit, so an abandoned session never locks the paragraph for peers or MCP edits and a closed tab keeps the typed text; Escape cancels; Shift+Enter inserts a hard break at the DOM caret (stored as `\n`, rendered `<br>` — see "Line breaks"); Mod+K opens the link panel.
3. **Commit.** `commitParagraphEdit(runs)` calls `commitParagraphRuns(target, runs, baseline)`: inside one `mutateActiveTreeAndSite` recipe it re-computes the fingerprint (module, tag / custom tag, children and runs); a mismatch (collaborator, undo, Properties-panel edit including a tag change, changed text formats) yields `{ status: 'conflict' }` and a toast, nothing is written. If the normalized runs equal the current ones — or the collab write gate refused the write — the result is `unchanged`. Otherwise `applyParagraphRuns` runs and the result is `{ status: 'applied', nodeId }`; the resulting paragraph node is selected when expand/collapse replaced it or nothing is selected any more.
4. **Cancel.** `cancelParagraphEdit` clears the session; no undo entry exists because the document was never touched. The session is also force-closed (edit discarded) on a page or document switch, when the paragraph node is deleted, and when a collab reset hits the active document.

There is no live preview in other breakpoints while typing: applying mid-session could replace the edited node (container ↔ single text) and kill the session.

### One session, one host

- `NodeRenderer` renders `ParagraphEditHost` only where `CanvasParagraphHostContext` allows it: never in agent snapshot frames or loop iterations.
- `paragraphHostClaim` lets the first mounted host claim the session; any other host renders the normal module.
- If the claiming host unmounts while the session is open, or a started session never got a host, `scheduleOrphanedParagraphCheck` cancels it one tick later unless a host re-claimed it (StrictMode-safe). `isCanvasTextEditing` therefore cannot stay stuck. When the cancelled session belonged to a host that was editing, a warning toast says the changes were not applied.
- Canvas keyboard shortcuts and the Spotlight canvas-scoped bindings stand down while `isCanvasTextEditing` is true (inline **or** paragraph edit).

### Menu readiness

The lazy menu registers TipTap's BubbleMenu plugin after the editor exists, which reconfigures the editor state and would reset a selection the editor has not read yet. The host therefore focuses and places the caret only after the menu calls `markParagraphMenuReady(editor)` (`whenParagraphMenuReady`), or after a bounded timeout if the menu never arrives.

### Menu and link panel

- `ParagraphBubbleMenu` is mounted by CanvasRoot **outside** the canvas div so its clicks never reach the canvas deselect/gesture handlers. Its anchor rect is the selection's iframe coordinates scaled by the canvas zoom plus the iframe's outer rect.
- Menu content: one toggle per configured format, Link, "Remove formatting". Active state is shown; pressing an active format removes it.
- Formats and new links act on the selection **without its boundary spaces** (`formatRange`, U+0020 only — the spaces normalization moves out anyway). A Windows double-click selects a word plus its trailing space; the bold word still shows as active, and one click removes the bold. A selection of spaces only is formatted as selected. Active state (`isParagraphFormatActive`) means every character of that range carries the format.
- `ParagraphLinkPanel`: switch **Page | URL**. A page is stored as a `cms:page:<id>` reference. A URL is stored as `normalizeLinkInput` returns it — trimmed, and `https://` added when it starts with a bare hostname (`www.example.com`, `example.com/careers`, `host.de:8080`); the panel then shows "Links to https://…" under the field. A bare hostname is dotted labels ending in a letters-only TLD of 2–24 characters (or an IPv4 address), an optional port, then the end or `/ ? #`. A TLD that is a common file extension (`html`, `php`, `pdf`, `md`, `jpg`, `js`, `csv`, `zip` … — the list is `FILE_EXTENSIONS` in `linkHref.ts`) only counts with `www.` or a port, so `kontakt.html`, `index.php?id=3`, `index.php/route`, `datei.pdf` and `README.md` stay as typed (and are rejected unless written as a relative path such as `/kontakt.html`). Values with a scheme (`http://` stays http), relative targets (`/`, `#`, `?`) and anything that is no dotted hostname (`localhost`, `info@x.de`) are kept as typed. The result must pass `isAllowedLinkHref`. "Open in new tab" defaults on for external (`http(s)`) targets; an existing `_parent` target survives unless the box is toggled. Clicking an existing link opens the same panel.
- A press outside the link panel (editor document or any canvas frame): with an **unchanged** draft it closes the panel and, outside the paragraph, commits the paragraph. With a **changed** draft the press is swallowed — its pointerdown and the mouse events it produces until its pointerup (only outside the panel), so no focus or caret move and no click elsewhere; a press without a click or a cancelled one never swallows a later keyboard or programmatic click — and the panel shows "Unsaved link change" (`role="alert"`) with **Apply** (applies when valid; otherwise the notice stays and the field is marked invalid) and **Discard** (closes the panel; the paragraph stays in edit mode with focus in the text).
  - "Changed" is decided on what the user edited — the raw URL field, the page, the mode, the target — never on the normalised href, so opening an existing `www.x.de` or relative link and pressing outside asks nothing. A new link counts once it has a target.
  - Keyboard: while the draft is changed, focus reaching anything but the panel, its Select menus or the paragraph text (Tab / Shift+Tab to the toolbar, Publish …) is pulled back to the panel with the same notice; keyboard-activated and programmatic clicks are never swallowed. The context menu outside is suppressed.
  - Escape — in the panel or anywhere else while the draft is changed — discards the draft and closes the panel.
- `paragraphCommands.ts` guards every command. All marks exclude each other, and TipTap's `setMark` / `toggleMark` remove excluded marks, so unguarded bold would replace a fixed run's mark (deleting the unknown node on commit) or strip a link. Therefore:
  - format buttons and format shortcuts do nothing while the selection (or the caret) touches a link or a fixed run — a link is one unit;
  - "Remove formatting" is disabled over a fixed run;
  - a link is never applied over a fixed run, and the Link button and Ctrl+K need a selection or a caret inside an existing link (never fixed text).
  - When a fixed run is the reason, the disabled buttons say why (tooltip + `aria-description`, `selectionFormattingHint`): "Unknown formatting (strong.highlight) — add it under Settings → Text formats" for nodes that only lack a text-format entry (`isUnrecognisedFormatNode`), otherwise "Special formatting (…) — change it outside paragraph mode". Names are `tag.class` (`paragraphFixedNodes.describeFixedNode`).

---

## Normalization rules

`normalizeRuns` gives the same visible result the same structure, independent of editing history. It is idempotent.

1. Empty runs are dropped (except `fixed`).
2. Adjacent runs with the same format are merged (same format id; links: same href, target and classes). `fixed` runs are never merged.
3. Boundary spaces (U+0020 only, not NBSP) move out of format/link runs into neighbouring plain text.
4. Double spaces in plain text collapse; leading/trailing spaces and line breaks at paragraph edges are trimmed (a trailing break would publish as a dangling `<br>`). Breaks inside the paragraph stay.

`applyParagraphRuns` then writes the plan:

- Existing children are reused so ids — and the classes of format nodes read through a variant — survive (`reconcileChildren`): (1) a longest common subsequence of the planned children and the existing ones by identity (kind, format / link data, text; a fixed run is its node; `<br>` nodes) pins what stayed; (2) an unpinned plan takes an unused node with the same identity anywhere (a moved or swapped word); (3) inside each gap between pins, the next unused node of the same kind and format is reused (only its text changed); (4) the rest is created (formats with their own classes), unused nodes are deleted and the order is fixed with `moveNode`. Removing or adding one bold word therefore never shifts the remaining bold nodes' classes, and bolding an earlier copy of a bold word does not take the later word's node.
- Adjacent runs of the same format merge (rule 2), also when they came from different variants: the merged run is written into the first reused node, which keeps its classes; the other node is deleted. Visually nothing changes (variants are meant to look the same). A commit without changes is detected before applying (normalized runs compared) and writes nothing. Unmatched children are deleted, new ones created, order fixed with `moveNode`.
- Only plain text left: a container collapses to a single `base.text` with the container's tag (not for `li`, which `base.text` cannot express). The container's classes, inline styles, label, `htmlAttributes` and locked/hidden flags are carried over.
- A single `base.text` that gets its first format expands to a `base.container` (`tag: custom`, `customTag` = the old tag), again carrying classes, styles, label, attributes and locked/hidden. Converting creates a new node id; children keep theirs where possible.
- `fixed` runs whose node is gone or that occur twice (e.g. a drag-and-drop copy) are demoted to plain text.

Round-trip guarantee: formatting and un-formatting any number of times yields the starting node structure (`apply.test.ts`, ten bold/unbold cycles). The published HTML of an expanded paragraph (format classes, a `cms:page:` link resolved to the page path) and of the same paragraph collapsed back is pinned by `paragraphPublish.test.ts` through the real publisher.

One format per text span in v1: a different format replaces the existing one; bold + italic on the same word is not possible.

---

## Text formats setting

Stored in `site.settings.textFormats` (so it exports with the site and applies to all editors). Edited in **Settings → Text formats** (`TextFormatsSection`).

```ts
interface TextFormatsSettings {
  formats: {
    id: string; label: string; tag: 'strong' | 'em' | 'span' | 'small'; classIds: string[]
    variants?: string[][] // further class sets read as this format ("Also recognize")
    shortcut?: string
  }[]
  link: { classIds: string[] }
}
```

- Defaults (no key set): Bold = `strong` (`Mod-b`), Italic = `em` (`Mod-i`), link without classes. "Reset to defaults" removes the key.
- Shortcuts use TipTap notation (`Mod-b`), validated by `SHORTCUT_PATTERN`. Link is always `Mod-k`.
- The menu shows B / I icons for `strong` / `em`, the label otherwise. There is no icon field.
- The schema is deliberately lenient (`Type.Unknown()` entries) so one malformed entry cannot reject a whole site on import; `parseTextFormatsSettings` drops bad entries one by one (invalid id, tag outside the list, duplicate id) and `resolveTextFormats` falls back to the defaults only when the stored value is absent or not an object; a stored record with zero valid formats yields an empty format list.
- `effectiveTextFormats(raw, styleRules)` additionally drops class ids that no longer exist or are not classes. The session uses this variant.
- The class picker offers existing user-visible classes only (no free text).
- **Variants** ("Also recognize"): further class sets, same tag, that are also read as the format — for sites with several visually equal classes for one format (e.g. Bold = `text-strong`, also `highlight` and `text-bold`). Picking a class adds a single-class set; "Plain <tag> without class" adds the empty set (offered only when the format has classes). Sets another format of the same tag already claims are not offered (the bare tag shows "used by …"). Rules (`settleVariants`, run by the parser and again by `effectiveTextFormats` after dropping unknown class ids): ids are deduped, a set equal to the format's own classes is dropped, a set emptied only by cleaning/filtering is dropped (one stored empty stays), and a set another format of the same tag already claims — any format's own classes, or an earlier variant — is dropped. Own classes are never dropped (two formats with equal own classes behave as before: the first one is read). The key is absent when no variant is left.
- New text always gets the format's own classes; a node read through a variant keeps its classes as long as it is reused (see "Normalization rules"). During the session such a word is shown with its stored classes (editor and loading preview): `paragraphFormatClassNames` passes them per run, the format mark carries them as a display-only `className` attribute (not parsed from paste, ignored by `docToRuns`); newly applied formatting shows the own classes.

---

## Security

- No HTML is stored. Everything lands as text props on nodes the publisher already escapes.
- Tags are limited to `strong`, `em`, `span`, `small` by the parser; classes must be existing style-rule ids (`isUsableClassId`).
- Link targets: `isAllowedLinkHref` accepts `http:`, `https:`, `mailto:`, `tel:`, `cms:page:<id>`, and relative paths / `#anchors` / `?query`. It rejects other schemes (including obfuscated `javascript:`, `data:`, `vbscript:`) and protocol-relative forms (`//`, `/\`, tab/newline disguises, any backslash). Publishing still passes every `href` through `safeUrl()`.
- Pasted HTML is never kept: the TipTap schema only knows the configured marks, link, fixed and hard break; block boundaries become breaks, everything else becomes plain text. Clipboard comments (`<!--StartFragment-->`), the `<html>`/`<body>` wrapper and leading/trailing breaks are dropped; a `<b style="font-weight:normal">` wrapper (Google Docs) is not bold. Copy/paste inside the editor keeps a link's href, target and classes — pasted link class ids that name no existing class rule are dropped. Fixed runs do not survive copy/paste (see "Data model").

---

## Tests

- `src/__tests__/paragraph/read.test.ts` (eligibility), `normalize.test.ts`, `apply.test.ts` (round trip, id reuse, expand/collapse, fingerprint), `variants.test.ts` (a paragraph mixing `text-strong`, `highlight`, `text-bold` and a bare `strong`: all read as Bold, unbolding / new bold / untouched variants / merge, no-op commit, fingerprint), `linkHref.test.ts` — core logic.
- `src/__tests__/publisher/paragraphPublish.test.ts` — exact published HTML of an expanded and a collapsed-back paragraph, and of line breaks / a blank line in plain text.
- `src/__tests__/text-formats/textFormats.test.ts`, `textFormatVariants.test.ts` — settings parser, defaults, variant settling.
- `src/__tests__/settings/textFormatsEditing.test.ts`, `textFormatsSection.test.tsx`, `siteSettingsReload.test.tsx` — settings section; outside the Site editor it reloads the site after an import.
- `src/__tests__/editor-store/paragraphEditSlice.test.ts` — start guards, single undo step, conflict (incl. tag change), selection after commit, force-close on delete / page switch / document switch / collab reset.
- `src/__tests__/canvas/paragraphDoc.test.ts`, `paragraphEditor.test.ts`, `paragraphHostClaim.test.ts`, `paragraphMenuReady.test.ts`, `paragraphModeWiring.test.ts`, `paragraphEditHostLoading.test.tsx` (host never empty while loading, typed-ahead keys, preview markup), `paragraphFormattingHint.test.ts` (hint on disabled buttons), `paragraphLinkPanel.test.tsx` (unsaved-link guard: real changes only, swallowed presses, focus pull-back, Escape, context menu) — document mapping, editor schema/paste, the command guards (formats/links/Clear vs. fixed runs and links, Ctrl+K), host claim, orphan cancel and its toast, the double-click entry, menu readiness, wiring.
- `tests/e2e/paragraph-formatting.e2e.ts` — double-click entry, bold via shortcut and toolbar, link panel (URL and Page mode, editing an existing link), press-outside commit, Escape, a format class from Settings, undo, bold over a word plus trailing space, `https://` for bare hosts, a blank line, a window switch, the two-window presence warning, the unsaved-link-change notice, the paragraph staying visible while opening and a warm open under 1 s, a format variant read as Bold and the unknown-formatting hint (Playwright). Publishing is covered by the unit test above, not end to end.

## Not in v1

Formatting inside links and nested formats, per-area format sets, further inline tags (`mark`, `u`, `s`, `code`), editing across several `li`.
