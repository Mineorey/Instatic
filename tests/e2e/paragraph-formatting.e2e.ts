import { test, expect, type FrameLocator, type Locator, type Page } from '@playwright/test'
import { canvasFrame, createPage, insertNotchModule, openSiteEditor, openSitePanel } from './helpers/editor'
import { OWNER_STATE_FILE } from './helpers/constants'

/**
 * PARA — paragraph mode (inline formatting + link panel).
 *
 * Unit tests cover the run model and commit path; these specs cover what only a
 * real browser proves: double-click entry, the editor's key map, focus moving
 * between the canvas iframe and the link panel in the editor document, and the
 * press-outside commit.
 */

const DEFAULT_TEXT = 'Add your text here.'

/** A fresh page with one text module on it. Returns the canvas frame. */
async function pageWithParagraph(page: Page, name: string): Promise<FrameLocator> {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`
  await openSiteEditor(page)
  await createPage(page, name, slug)
  await insertNotchModule(page, 'text')
  const frame = canvasFrame(page)
  await expect(frame.getByText(DEFAULT_TEXT, { exact: true })).toBeVisible()
  return frame
}

function editorOf(frame: FrameLocator): Locator {
  return frame.locator('[data-paragraph-host] [data-paragraph-editor]')
}

/**
 * Double-click `target` and wait until the session is ready: the host carries
 * `data-paragraph-ready` once the formatting menu is registered and the caret
 * placed, so keystrokes from here on are not lost.
 */
async function openParagraph(frame: FrameLocator, target: Locator, options?: Parameters<Locator['dblclick']>[0]) {
  await target.dblclick(options)
  await expect(frame.locator('[data-paragraph-host][data-paragraph-ready]')).toBeVisible()
  await expect(editorOf(frame)).toBeFocused()
}

/**
 * Select the trailing `text` of the paragraph, character by character
 * (Chromium's word-wise Shift+Ctrl+ArrowLeft stops at the trailing period of
 * "here.").
 */
async function selectTrailing(page: Page, frame: FrameLocator, text: string) {
  await page.keyboard.press('End')
  for (let i = 0; i < text.length; i++) await page.keyboard.press('Shift+ArrowLeft')
  await expect
    .poll(() => editorOf(frame).evaluate((el) => el.ownerDocument.getSelection()?.toString() ?? ''))
    .toBe(text)
}

/** Select `length` characters starting `start` characters into the paragraph. */
async function selectRange(page: Page, frame: FrameLocator, start: number, length: number, expected: string) {
  await page.keyboard.press('Home')
  for (let i = 0; i < start; i++) await page.keyboard.press('ArrowRight')
  for (let i = 0; i < length; i++) await page.keyboard.press('Shift+ArrowRight')
  await expect
    .poll(() => editorOf(frame).evaluate((el) => el.ownerDocument.getSelection()?.toString() ?? ''))
    .toBe(expected)
}

function linkPanel(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Edit link' })
}

test.describe('PARA paragraph formatting', () => {
  test('PARA-001 bold a word, remove it again, escape discards', async ({ page }) => {
    const frame = await pageWithParagraph(page, 'Paragraph test')
    const host = frame.locator('[data-paragraph-host]')

    // Bold the last word.
    await openParagraph(frame, frame.getByText(DEFAULT_TEXT, { exact: true }))
    await selectTrailing(page, frame, 'here.')
    // The menu shows for the selection even in the very first session (its
    // chunk loads while the session starts). Bold via the shortcut here; the
    // toolbar button is used to remove it below.
    await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toBeVisible()
    await page.keyboard.press('Control+b')
    await expect(editorOf(frame).locator('strong')).toHaveText('here.')
    await page.keyboard.press('Enter')
    await expect(host).toHaveCount(0)
    await expect(frame.locator('p strong', { hasText: 'here.' })).toBeVisible()
    await expect(frame.locator('p', { hasText: 'Add your text' })).toHaveText(DEFAULT_TEXT)

    // The plain part ("Add your text ") has no element of its own (tag "none").
    // Double-clicking it must open the whole paragraph directly.
    await openParagraph(frame, frame.locator('p', { hasText: 'Add your text' }), { position: { x: 4, y: 4 } })
    await expect(host).toHaveText(DEFAULT_TEXT)
    await page.keyboard.press('Escape')
    await expect(host).toHaveCount(0)
    await expect(frame.locator('p strong', { hasText: 'here.' })).toBeVisible()

    // Remove bold again via the formatting toolbar → back to a single text
    // element without <strong>.
    await openParagraph(frame, frame.locator('strong', { hasText: 'here.' }))
    await selectTrailing(page, frame, 'here.')
    const toolbar = page.getByRole('toolbar', { name: 'Text formatting' })
    await expect(toolbar).toBeVisible()
    const boldButton = toolbar.getByRole('button', { name: 'Bold' })
    await expect(boldButton).toHaveAttribute('aria-pressed', 'true')
    await boldButton.click()
    await expect(boldButton).toHaveAttribute('aria-pressed', 'false')
    await expect(editorOf(frame)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(host).toHaveCount(0)
    await expect(frame.locator('strong')).toHaveCount(0)
    const single = frame.getByText(DEFAULT_TEXT, { exact: true })
    await expect(single).toBeVisible()
    // One element, no nested runs.
    await expect(single.locator('*')).toHaveCount(0)

    // Escape discards typed text.
    await openParagraph(frame, single)
    await page.keyboard.press('End')
    await page.keyboard.type(' XYZ')
    await expect(host).toContainText('XYZ')
    await page.keyboard.press('Escape')
    await expect(host).toHaveCount(0)
    await expect(frame.getByText('XYZ')).toHaveCount(0)
    await expect(frame.getByText(DEFAULT_TEXT, { exact: true })).toBeVisible()
  })

  test('PARA-002 link a word via Ctrl+K, URL mode, external opens in new tab', async ({ page }) => {
    const frame = await pageWithParagraph(page, 'Link test')
    await openParagraph(frame, frame.getByText(DEFAULT_TEXT, { exact: true }))
    await selectTrailing(page, frame, 'here.')
    await page.keyboard.press('Control+k')
    const panel = linkPanel(page)
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: 'URL' }).click()
    await panel.getByLabel('Link URL').fill('https://www.example.com')
    await expect(panel.getByRole('checkbox')).toBeChecked() // external → new tab preselected
    await panel.getByRole('button', { name: 'Apply' }).click()
    await expect(panel).toBeHidden()
    await expect(editorOf(frame)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(frame.locator('[data-paragraph-host]')).toHaveCount(0)
    const link = frame.locator('a', { hasText: 'here.' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('href', 'https://www.example.com')
  })

  test('PARA-003 press outside the link panel commits; Escape in the panel closes only the panel', async ({ page }) => {
    const frame = await pageWithParagraph(page, 'Panel focus test')
    const host = frame.locator('[data-paragraph-host]')
    const panel = linkPanel(page)

    await test.step('Escape inside the open panel closes only the panel', async () => {
      await openParagraph(frame, frame.getByText(DEFAULT_TEXT, { exact: true }))
      await page.keyboard.press('End')
      await page.keyboard.type(' One')
      await selectTrailing(page, frame, 'One')
      await page.keyboard.press('Control+k')
      await expect(panel).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      await expect(host).toBeVisible()
      await expect(editorOf(frame)).toBeFocused()
      // The typed change survives and commits with Enter.
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await expect(host).toHaveCount(0)
      await expect(frame.getByText(`${DEFAULT_TEXT} One`, { exact: true })).toBeVisible()
    })

    await test.step('second Escape cancels the session without changes', async () => {
      await openParagraph(frame, frame.getByText(`${DEFAULT_TEXT} One`, { exact: true }))
      await page.keyboard.press('End')
      await page.keyboard.type(' Two')
      await selectTrailing(page, frame, 'Two')
      await page.keyboard.press('Control+k')
      await expect(panel).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      await page.keyboard.press('Escape')
      await expect(host).toHaveCount(0)
      await expect(frame.getByText('Two')).toHaveCount(0)
      await expect(frame.getByText(`${DEFAULT_TEXT} One`, { exact: true })).toBeVisible()
    })

    await test.step('a press inside the paragraph closes the panel and keeps editing', async () => {
      await openParagraph(frame, frame.getByText(`${DEFAULT_TEXT} One`, { exact: true }))
      await selectTrailing(page, frame, 'One')
      await page.keyboard.press('Control+k')
      await expect(panel).toBeVisible()
      await editorOf(frame).click({ position: { x: 4, y: 4 } })
      await expect(panel).toBeHidden()
      await expect(host).toBeVisible()
      await expect(editorOf(frame)).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(host).toHaveCount(0)
    })

    await test.step('a press on a Properties input commits once and keeps focus there', async () => {
      await openParagraph(frame, frame.getByText(`${DEFAULT_TEXT} One`, { exact: true }))
      await page.keyboard.press('End')
      await page.keyboard.type(' Three')
      await selectTrailing(page, frame, 'Three')
      await page.keyboard.press('Control+k')
      await expect(panel).toBeVisible()
      const propertiesInput = page.getByRole('textbox', { name: 'Add or create a CSS selector' })
      await propertiesInput.click()
      await expect(panel).toBeHidden()
      await expect(host).toHaveCount(0)
      await expect(frame.getByText(`${DEFAULT_TEXT} One Three`, { exact: true })).toBeVisible()
      // Focus is not yanked back into the canvas, not even with a delay:
      // keystrokes typed afterwards all land in the input.
      await expect(propertiesInput).toBeFocused()
      await page.keyboard.type('abc')
      await expect(propertiesInput).toHaveValue('abc')
      await expect(propertiesInput).toBeFocused()
      await expect(frame.getByText(`${DEFAULT_TEXT} One Three`, { exact: true })).toBeVisible()
      await propertiesInput.fill('')
    })

    await test.step('a press on the canvas frame background commits the paragraph', async () => {
      await openParagraph(frame, frame.getByText(`${DEFAULT_TEXT} One Three`, { exact: true }))
      await page.keyboard.press('End')
      await page.keyboard.type(' Four')
      await selectTrailing(page, frame, 'Four')
      await page.keyboard.press('Control+k')
      await expect(panel).toBeVisible()
      // Just below the paragraph on the frame body, outside the text.
      const body = frame.locator('body')
      const bodyBox = await body.boundingBox()
      const paragraphBox = await frame.locator('[data-paragraph-host]').boundingBox()
      if (!bodyBox || !paragraphBox) throw new Error('canvas frame body or paragraph has no box')
      const below = paragraphBox.y + paragraphBox.height - bodyBox.y + 24
      expect(below).toBeLessThan(bodyBox.height)
      await body.click({ position: { x: paragraphBox.x - bodyBox.x + 4, y: below } })
      await expect(panel).toBeHidden()
      await expect(host).toHaveCount(0)
      await expect(frame.getByText(`${DEFAULT_TEXT} One Three Four`, { exact: true })).toBeVisible()
    })
  })

  test('PARA-004 clicking into an existing link opens the panel with its URL; Page tab links to site pages', async ({ page }) => {
    const pageName = 'Existing link test'
    const frame = await pageWithParagraph(page, pageName)
    const panel = linkPanel(page)

    // Create the link first.
    await openParagraph(frame, frame.getByText(DEFAULT_TEXT, { exact: true }))
    await selectTrailing(page, frame, 'here.')
    await page.keyboard.press('Control+k')
    await panel.getByRole('button', { name: 'URL' }).click()
    await panel.getByLabel('Link URL').fill('https://example.org/info')
    await panel.getByRole('button', { name: 'Apply' }).click()
    await expect(panel).toBeHidden()
    await expect(editorOf(frame)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(frame.locator('a', { hasText: 'here.' })).toBeVisible()

    // Open the paragraph on its plain part, then click into the link.
    await openParagraph(frame, frame.locator('p', { hasText: 'Add your text' }), { position: { x: 4, y: 4 } })
    await editorOf(frame).locator('a', { hasText: 'here.' }).click()
    await expect(panel).toBeVisible()
    await expect(panel.getByLabel('Link URL')).toHaveValue('https://example.org/info')
    // Focus stays in the text: typing continues in the paragraph while the
    // panel stays open.
    await expect(editorOf(frame)).toBeFocused()
    await page.keyboard.type('Q')
    await expect(editorOf(frame)).toContainText('Q')
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape') // closes the panel
    await expect(panel).toBeHidden()
    await page.keyboard.press('Escape') // cancels the session
    await expect(frame.locator('[data-paragraph-host]')).toHaveCount(0)
    await expect(frame.getByText('Q')).toHaveCount(0)
    await expect(frame.locator('a', { hasText: 'here.' })).toHaveAttribute('href', 'https://example.org/info')

    await test.step('Page tab: link to a site page, then switch to another page', async () => {
      const stamp = Date.now().toString(36)
      const targetA = `Ziel A ${stamp}`
      const targetB = `Ziel B ${stamp}`
      await createPage(page, targetA, `ziel-a-${stamp}`)
      await createPage(page, targetB, `ziel-b-${stamp}`)
      // createPage opens the new page — return to the paragraph's page.
      await openSitePanel(page)
      await page.getByRole('treeitem', { name: `Open page ${pageName}` }).click()
      const link = frame.locator('a', { hasText: 'here.' })
      await expect(link).toBeVisible()

      const pickPage = async (title: string) => {
        await openParagraph(frame, frame.locator('p', { hasText: 'Add your text' }), { position: { x: 4, y: 4 } })
        await editorOf(frame).locator('a', { hasText: 'here.' }).click()
        await expect(panel).toBeVisible()
        await panel.getByRole('button', { name: 'Page', exact: true }).click()
        await panel.getByRole('combobox', { name: 'Page' }).click()
        await page.getByRole('option', { name: new RegExp(`^${title} · `) }).click()
        await panel.getByRole('button', { name: 'Apply' }).click()
        await expect(panel).toBeHidden()
        await expect(editorOf(frame)).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(frame.locator('[data-paragraph-host]')).toHaveCount(0)
      }

      // Stored as a rename-proof page reference — the canvas shows it raw.
      await pickPage(targetA)
      await expect(link).toHaveAttribute('href', /^cms:page:./)
      const hrefA = await link.getAttribute('href')
      // Changing the page rewrites the reference; the panel reopens in Page mode on it.
      await pickPage(targetB)
      await expect(link).toHaveAttribute('href', /^cms:page:./)
      await expect(link).not.toHaveAttribute('href', hrefA ?? '')
      await openParagraph(frame, frame.locator('p', { hasText: 'Add your text' }), { position: { x: 4, y: 4 } })
      await editorOf(frame).locator('a', { hasText: 'here.' }).click()
      await expect(panel.getByRole('combobox', { name: 'Page' })).toHaveValue(new RegExp(`^${targetB} · `))
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await expect(frame.locator('[data-paragraph-host]')).toHaveCount(0)
    })
  })

  test('PARA-005 a class assigned to Bold in Settings lands on the <strong>', async ({ page }) => {
    const className = `e2e-bold-${Date.now().toString(36)}`
    const frame = await pageWithParagraph(page, 'Format class test')

    // Create a class through the class picker of the selected text module.
    await page.getByTestId('class-picker-input').fill(className)
    await page.getByTestId('class-picker-submit').click()
    await expect(page.getByTestId(`class-chip-${className}`)).toBeVisible()

    // Settings → Text formats → Bold → add the class.
    await page.getByTestId('toolbar-settings-btn').click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings).toBeVisible()
    await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Text formats' }).click()
    await settings.getByRole('combobox', { name: 'Classes for Bold' }).click()
    await page.getByRole('option', { name: className, exact: true }).click()
    await expect(settings.getByTestId('text-format-bold').getByText(className, { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()

    await openParagraph(frame, frame.getByText(DEFAULT_TEXT, { exact: true }))
    await selectTrailing(page, frame, 'here.')
    await page.keyboard.press('Control+b')
    await page.keyboard.press('Enter')
    await expect(frame.locator('[data-paragraph-host]')).toHaveCount(0)
    await expect(frame.locator('strong', { hasText: 'here.' })).toHaveClass(new RegExp(`(^|\\s)${className}(\\s|$)`))
  })

  test('PARA-006 a committed session is one undo step; a cancelled one adds none', async ({ page }) => {
    const frame = await pageWithParagraph(page, 'Undo test')
    const host = frame.locator('[data-paragraph-host]')
    const single = frame.getByText(DEFAULT_TEXT, { exact: true })

    const boldLastWord = async () => {
      await openParagraph(frame, frame.getByText(DEFAULT_TEXT, { exact: true }))
      await selectTrailing(page, frame, 'here.')
      await page.keyboard.press('Control+b')
      await page.keyboard.press('Enter')
      await expect(host).toHaveCount(0)
      await expect(frame.locator('p strong', { hasText: 'here.' })).toBeVisible()
    }

    await test.step('one Ctrl+Z reverts the whole committed paragraph', async () => {
      await boldLastWord()
      await page.keyboard.press('Control+z')
      await expect(frame.locator('strong')).toHaveCount(0)
      await expect(single).toBeVisible()
      await expect(single.locator('*')).toHaveCount(0)
    })

    await test.step('a cancelled session leaves no undo entry', async () => {
      await boldLastWord()
      await openParagraph(frame, frame.locator('p', { hasText: 'Add your text' }), { position: { x: 4, y: 4 } })
      await page.keyboard.press('End')
      await page.keyboard.type(' XYZ')
      await page.keyboard.press('Escape')
      await expect(host).toHaveCount(0)
      // The next Ctrl+Z undoes the bold commit, not an empty entry.
      await page.keyboard.press('Control+z')
      await expect(frame.locator('strong')).toHaveCount(0)
      await expect(single).toBeVisible()
      await expect(frame.getByText('XYZ')).toHaveCount(0)
    })
  })

  test('PARA-007 a word selected with its trailing space (Windows double-click) toggles bold in one click', async ({ page }) => {
    const frame = await pageWithParagraph(page, 'Trailing space test')
    const host = frame.locator('[data-paragraph-host]')
    const toolbar = page.getByRole('toolbar', { name: 'Text formatting' })
    const boldButton = toolbar.getByRole('button', { name: 'Bold' })

    // "your " — the word plus the space a Windows double-click selects.
    await openParagraph(frame, frame.getByText(DEFAULT_TEXT, { exact: true }))
    await selectRange(page, frame, 4, 5, 'your ')
    await expect(boldButton).toHaveAttribute('aria-pressed', 'false')
    await boldButton.click()
    await expect(editorOf(frame).locator('strong')).toHaveText('your')
    await expect(boldButton).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Enter')
    await expect(host).toHaveCount(0)
    await expect(frame.locator('p strong')).toHaveText('your')

    await openParagraph(frame, frame.locator('p strong', { hasText: 'your' }))
    await selectRange(page, frame, 4, 5, 'your ')
    await expect(boldButton).toHaveAttribute('aria-pressed', 'true')
    await boldButton.click()
    await expect(editorOf(frame).locator('strong')).toHaveCount(0)
    await expect(boldButton).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('Enter')
    await expect(host).toHaveCount(0)
    await expect(frame.locator('strong')).toHaveCount(0)
    await expect(frame.getByText(DEFAULT_TEXT, { exact: true })).toBeVisible()
  })

  test('PARA-008 a URL without scheme gets https://', async ({ page }) => {
    const frame = await pageWithParagraph(page, 'Bare host test')
    const panel = linkPanel(page)
    await openParagraph(frame, frame.getByText(DEFAULT_TEXT, { exact: true }))
    await selectTrailing(page, frame, 'here.')
    await page.keyboard.press('Control+k')
    await panel.getByRole('button', { name: 'URL' }).click()
    const input = panel.getByLabel('Link URL')
    await input.fill('example.com/careers')
    await expect(panel.getByRole('status')).toHaveText('Links to https://example.com/careers')
    await expect(panel.getByRole('checkbox')).toBeChecked() // external → new tab preselected
    // An explicit scheme is kept as typed — no hint.
    await input.fill('http://example.com')
    await expect(panel.getByRole('status')).toHaveCount(0)
    await input.fill('www.example.com')
    await expect(panel.getByRole('status')).toHaveText('Links to https://www.example.com')
    await panel.getByRole('button', { name: 'Apply' }).click()
    await expect(panel).toBeHidden()
    await page.keyboard.press('Enter')
    await expect(frame.locator('[data-paragraph-host]')).toHaveCount(0)
    const link = frame.locator('a', { hasText: 'here.' })
    await expect(link).toHaveAttribute('href', 'https://www.example.com')
    await expect(link).toHaveAttribute('target', '_blank')
  })

  test('PARA-009 a blank line (Shift+Enter twice) stays visible after commit and on reopen', async ({ page }) => {
    const frame = await pageWithParagraph(page, 'Blank line test')
    const host = frame.locator('[data-paragraph-host]')
    // A format makes the paragraph a container with plain-text children.
    await openParagraph(frame, frame.getByText(DEFAULT_TEXT, { exact: true }))
    await selectTrailing(page, frame, 'here.')
    await page.keyboard.press('Control+b')
    await page.keyboard.press('Enter')
    await expect(host).toHaveCount(0)
    const paragraph = frame.locator('p', { hasText: 'Add your' })
    const heightBefore = (await paragraph.boundingBox())?.height ?? 0

    await openParagraph(frame, paragraph, { position: { x: 4, y: 4 } })
    // Caret right after "Add your": select the rest, collapse to its start.
    await selectTrailing(page, frame, ' text here.')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.press('Enter')
    await expect(host).toHaveCount(0)

    // Two <br> in the canvas, and the paragraph got two lines taller.
    await expect(paragraph.locator('br')).toHaveCount(2)
    expect(await paragraph.evaluate((el) => (el as HTMLElement).innerText)).toMatch(/^Add your\n\n ?text here\.$/)
    const heightAfter = (await paragraph.boundingBox())?.height ?? 0
    expect(heightAfter).toBeGreaterThan(heightBefore * 2.5)

    // Reopening shows the same blank line in the editor.
    await openParagraph(frame, paragraph, { position: { x: 4, y: 4 } })
    await expect(editorOf(frame).locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(host).toHaveCount(0)
  })
  test('PARA-010 switching to another window or app keeps the session open', async ({ page }) => {
    const frame = await pageWithParagraph(page, `Window switch test ${Date.now().toString(36)}`)
    const host = frame.locator('[data-paragraph-host]')
    const editor = editorOf(frame)

    /**
     * Headless Chromium never loses window focus, so the switch is replayed the
     * way a browser reports it: no document of the window has focus any more,
     * the focused editor gets a blur (it stays the active element), and on
     * return focus comes back to it.
     */
    const leaveWindow = () =>
      editor.evaluate((el) => {
        const frameDoc = el.ownerDocument
        const topDoc = frameDoc.defaultView!.top!.document
        frameDoc.hasFocus = () => false
        topDoc.hasFocus = () => false
        el.dispatchEvent(new FocusEvent('blur'))
        frameDoc.defaultView!.dispatchEvent(new FocusEvent('blur'))
      })
    const returnToWindow = () =>
      editor.evaluate((el) => {
        const frameDoc = el.ownerDocument
        const topDoc = frameDoc.defaultView!.top!.document
        delete (frameDoc as Partial<Document>).hasFocus
        delete (topDoc as Partial<Document>).hasFocus
        frameDoc.defaultView!.dispatchEvent(new FocusEvent('focus'))
        el.dispatchEvent(new FocusEvent('focus'))
      })

    await test.step('alt-tab away and back: still editing, typing continues', async () => {
      await openParagraph(frame, frame.getByText(DEFAULT_TEXT, { exact: true }))
      await page.keyboard.press('End')
      await page.keyboard.type(' X')
      await leaveWindow()
      await page.waitForTimeout(200)
      await expect(host).toBeVisible()
      await returnToWindow()
      await page.waitForTimeout(200)
      await expect(host).toBeVisible()
      await expect(editor).toBeFocused()
      await page.keyboard.type('Y')
      await expect(editor).toHaveText(`${DEFAULT_TEXT} XY`)
      await page.keyboard.press('Enter')
      await expect(host).toHaveCount(0)
      await expect(frame.getByText(`${DEFAULT_TEXT} XY`, { exact: true })).toBeVisible()
    })

    await test.step('back in the window, a press outside the paragraph still commits', async () => {
      await openParagraph(frame, frame.getByText(`${DEFAULT_TEXT} XY`, { exact: true }))
      await page.keyboard.press('End')
      await page.keyboard.type('Z')
      await leaveWindow()
      await page.waitForTimeout(200)
      await returnToWindow()
      const propertiesInput = page.getByRole('textbox', { name: 'Add or create a CSS selector' })
      await propertiesInput.click()
      await expect(host).toHaveCount(0)
      await expect(frame.getByText(`${DEFAULT_TEXT} XYZ`, { exact: true })).toBeVisible()
      await expect(propertiesInput).toBeFocused()
    })

    await test.step('the page becoming hidden (tab switch, minimise) commits', async () => {
      await openParagraph(frame, frame.getByText(`${DEFAULT_TEXT} XYZ`, { exact: true }))
      await page.keyboard.press('End')
      await page.keyboard.type('1')
      await leaveWindow()
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await expect(host).toHaveCount(0)
      await expect(frame.getByText(`${DEFAULT_TEXT} XYZ1`, { exact: true })).toBeVisible()
      await page.evaluate(() => {
        delete (document as { visibilityState?: unknown }).visibilityState
        document.dispatchEvent(new Event('visibilitychange'))
        delete (document as Partial<Document>).hasFocus
        for (const frame of document.querySelectorAll('iframe')) {
          if (frame.contentDocument) delete (frame.contentDocument as Partial<Document>).hasFocus
        }
      })
    })

    await test.step('pagehide (tab closed, navigation) commits', async () => {
      await openParagraph(frame, frame.getByText(`${DEFAULT_TEXT} XYZ1`, { exact: true }))
      await page.keyboard.press('End')
      await page.keyboard.type('2')
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
      await expect(host).toHaveCount(0)
      await expect(frame.getByText(`${DEFAULT_TEXT} XYZ12`, { exact: true })).toBeVisible()
    })
  })
  test('PARA-011 a second window of the same admin cannot open a paragraph that is being edited', async ({ page, browser }, testInfo) => {
    const pageName = `Two windows test ${Date.now().toString(36)}`
    const frame = await pageWithParagraph(page, pageName)
    const second = await browser.newContext({ storageState: OWNER_STATE_FILE, baseURL: testInfo.project.use.baseURL })
    try {
      const page2 = await second.newPage()
      await openSiteEditor(page2)
      await openSitePanel(page2)
      await page2.getByRole('treeitem', { name: `Open page ${pageName}` }).click()
      const frame2 = canvasFrame(page2)
      const paragraph2 = frame2.getByText(DEFAULT_TEXT, { exact: true })
      await expect(paragraph2).toBeVisible()

      // Window 1 opens the paragraph and keeps editing.
      await openParagraph(frame, frame.getByText(DEFAULT_TEXT, { exact: true }))
      // Window 2 sees window 1's presence (the owner has no display name —
      // presence must not depend on one) and is refused.
      // Presence travels through the relay; until it arrives a double-click
      // would open the paragraph here too — then close it and try again.
      const warning = page2.getByText('Someone else is editing this paragraph right now.')
      await expect
        .poll(async () => {
          if (await frame2.locator('[data-paragraph-host]').count()) await page2.keyboard.press('Escape')
          await paragraph2.dblclick()
          return warning.isVisible()
        }, { timeout: 15_000 })
        .toBe(true)
      await expect(frame2.locator('[data-paragraph-host]')).toHaveCount(0)
      // Window 1 is still editing.
      await expect(frame.locator('[data-paragraph-host]')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(frame.locator('[data-paragraph-host]')).toHaveCount(0)
    } finally {
      await second.close()
    }
  })
  test('PARA-012 a press outside the link panel with an unsaved change asks before dropping it', async ({ page }) => {
    const frame = await pageWithParagraph(page, `Unsaved link test ${Date.now().toString(36)}`)
    const host = frame.locator('[data-paragraph-host]')
    const panel = linkPanel(page)
    const link = frame.locator('a', { hasText: 'here.' })

    // A link to start from.
    await openParagraph(frame, frame.getByText(DEFAULT_TEXT, { exact: true }))
    await selectTrailing(page, frame, 'here.')
    await page.keyboard.press('Control+k')
    await panel.getByRole('button', { name: 'URL' }).click()
    await panel.getByLabel('Link URL').fill('https://example.org/alt')
    await panel.getByRole('button', { name: 'Apply' }).click()
    await expect(editorOf(frame)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(link).toHaveAttribute('href', 'https://example.org/alt')

    /**
     * Press on the canvas frame outside the paragraph AND outside the link
     * panel (which floats over the frame and may cover the area right below
     * the paragraph). Boxes are in page coordinates.
     */
    const pressOutside = async () => {
      const body = frame.locator('body')
      const bodyBox = await body.boundingBox()
      const paragraphBox = await host.boundingBox()
      const panelBox = await panel.boundingBox()
      if (!bodyBox || !paragraphBox || !panelBox) throw new Error('canvas frame body, paragraph or link panel has no box')
      type Box = { x: number; y: number; width: number; height: number }
      const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height
      const ys = [paragraphBox.y + paragraphBox.height + 24, paragraphBox.y - 24, paragraphBox.y + paragraphBox.height + 120]
      const xs = [paragraphBox.x + 4, bodyBox.x + bodyBox.width - 16, bodyBox.x + 16]
      const point = ys
        .flatMap((y) => xs.map((x) => ({ x, y })))
        .find((p) => inside(p, bodyBox) && !inside(p, paragraphBox) && !inside(p, panelBox))
      expect(point, 'a canvas point outside paragraph and link panel').toBeDefined()
      // Page coordinates: the canvas iframe is CSS-scaled by the zoom, so an
      // element-relative `position` would not land where the boxes say.
      await page.mouse.click(point!.x, point!.y)
    }

    /** Change the link's URL, then press outside. */
    const changeAndPressOutside = async () => {
      await openParagraph(frame, frame.locator('p', { hasText: 'Add your' }), { position: { x: 4, y: 4 } })
      await editorOf(frame).locator('a', { hasText: 'here.' }).click()
      await expect(panel).toBeVisible()
      await panel.getByLabel('Link URL').fill('https://example.org/neu')
      await pressOutside()
      const notice = panel.getByRole('alert')
      await expect(notice).toContainText('Unsaved link change')
      // Neither discarded nor committed: panel and session stay open.
      await expect(panel).toBeVisible()
      await expect(host).toBeVisible()
      return notice
    }

    await test.step('Discard keeps the old target and the session', async () => {
      const notice = await changeAndPressOutside()
      await notice.getByRole('button', { name: 'Discard' }).click()
      await expect(panel).toBeHidden()
      await expect(host).toBeVisible()
      await expect(editorOf(frame)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(host).toHaveCount(0)
      await expect(link).toHaveAttribute('href', 'https://example.org/alt')
    })

    await test.step('Apply takes the new target', async () => {
      const notice = await changeAndPressOutside()
      await notice.getByRole('button', { name: 'Apply' }).click()
      await expect(panel).toBeHidden()
      await expect(host).toBeVisible()
      await expect(editorOf(frame)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(host).toHaveCount(0)
      await expect(link).toHaveAttribute('href', 'https://example.org/neu')
    })

    await test.step('an invalid draft keeps the notice and marks the field', async () => {
      await openParagraph(frame, frame.locator('p', { hasText: 'Add your' }), { position: { x: 4, y: 4 } })
      await editorOf(frame).locator('a', { hasText: 'here.' }).click()
      await panel.getByLabel('Link URL').fill('')
      await pressOutside()
      const notice = panel.getByRole('alert')
      await expect(notice).toContainText('Unsaved link change')
      await notice.getByRole('button', { name: 'Apply' }).click()
      await expect(notice).toBeVisible()
      await expect(panel.getByLabel('Link URL')).toHaveAttribute('aria-invalid', 'true')
      // Escape in the panel still means: drop the draft, close the panel.
      await panel.getByLabel('Link URL').press('Escape')
      await expect(panel).toBeHidden()
      await expect(host).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(host).toHaveCount(0)
      await expect(link).toHaveAttribute('href', 'https://example.org/neu')
    })

    await test.step('keyboard: tabbing out returns to the panel with the notice; Escape discards', async () => {
      await openParagraph(frame, frame.locator('p', { hasText: 'Add your' }), { position: { x: 4, y: 4 } })
      await editorOf(frame).locator('a', { hasText: 'here.' }).click()
      const input = panel.getByLabel('Link URL')
      await input.fill('https://example.org/tab')
      const notice = panel.getByRole('alert')
      // Shift+Tab until focus leaves the panel (it sits last in the document,
      // so backwards leads into the editor UI); it is pulled back each time.
      for (let i = 0; i < 12 && (await notice.count()) === 0; i++) {
        await page.keyboard.press('Shift+Tab')
        await page.waitForTimeout(50)
      }
      await expect(notice).toContainText('Unsaved link change')
      await expect.poll(() => panel.evaluate((form) => document.activeElement === form)).toBe(true)
      // Enter does not reach any control outside; the session is untouched.
      await page.keyboard.press('Enter')
      await expect(host).toBeVisible()
      await expect(panel).toBeVisible()
      // Escape fired outside the panel discards the draft too.
      await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      await expect(panel).toBeHidden()
      await expect(host).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(host).toHaveCount(0)
      await expect(link).toHaveAttribute('href', 'https://example.org/neu')
    })
  })
  test('PARA-013 the paragraph stays visible while paragraph mode opens; a warm open is quick', async ({ page }) => {
    const frame = await pageWithParagraph(page, 'Opening test')
    const paragraph = frame.getByText(DEFAULT_TEXT, { exact: true })
    const nodeId = await paragraph.evaluate((el) => el.closest('[data-node-id]')?.getAttribute('data-node-id') ?? '')
    expect(nodeId).not.toBe('')

    /**
     * From the double-click on, record the paragraph element's text after
     * every DOM change and every frame, until the host is ready. Returns the
     * texts seen and the ms from the double-click to ready.
     */
    async function openWatched(): Promise<{ texts: string[]; readyMs: number }> {
      const body = frame.locator('body')
      await body.evaluate((_, id) => {
        type Watch = { texts: string[]; start: number; readyMs: number }
        const w = window as unknown as { __paraWatch: Watch }
        const watch: Watch = { texts: [], start: -1, readyMs: -1 }
        w.__paraWatch = watch
        const sample = () => {
          if (watch.start < 0 || watch.readyMs >= 0) return
          const el = document.querySelector(`[data-node-id="${id}"]`)
          watch.texts.push((el?.textContent ?? '').trim())
          if (el?.hasAttribute('data-paragraph-ready')) {
            watch.readyMs = performance.now() - watch.start
            observer.disconnect()
          }
        }
        const observer = new MutationObserver(sample)
        observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
        const frameLoop = () => {
          sample()
          if (watch.readyMs < 0) requestAnimationFrame(frameLoop)
        }
        document.addEventListener('dblclick', () => {
          watch.start = performance.now()
          frameLoop()
        }, { capture: true, once: true })
      }, nodeId)
      await paragraph.dblclick()
      await expect(frame.locator('[data-paragraph-host][data-paragraph-ready]')).toBeVisible()
      const result = await body.evaluate(() => {
        const w = window as unknown as { __paraWatch: { texts: string[]; readyMs: number } }
        return { texts: w.__paraWatch.texts, readyMs: w.__paraWatch.readyMs }
      })
      await page.keyboard.press('Escape')
      await expect(frame.locator('[data-paragraph-host]')).toHaveCount(0)
      return result
    }

    await test.step('first open: the text never disappears', async () => {
      const { texts } = await openWatched()
      expect(texts.length).toBeGreaterThan(0)
      expect(texts.filter((text) => text !== DEFAULT_TEXT)).toEqual([])
    })

    await test.step('warm open: still never blank, and ready within 1 s of the double-click', async () => {
      const { texts, readyMs } = await openWatched()
      expect(texts.filter((text) => text !== DEFAULT_TEXT)).toEqual([])
      expect(readyMs).toBeGreaterThanOrEqual(0)
      // Loose on purpose (CI machines vary); measured ~80–100 ms locally on a
      // production build. The main check is that the text never disappears.
      expect(readyMs).toBeLessThan(1000)
    })
  })
  test('PARA-014 a format variant is recognised as the format; unknown formatting explains the disabled buttons', async ({ page }) => {
    const className = `e2e-hervor-${Date.now().toString(36)}`
    const frame = await pageWithParagraph(page, 'Format variant test')
    const host = frame.locator('[data-paragraph-host]')
    const toolbar = page.getByRole('toolbar', { name: 'Text formatting' })
    const boldButton = toolbar.getByRole('button', { name: 'Bold' })
    const settings = page.getByRole('dialog', { name: 'Settings' })
    const openTextFormats = async () => {
      await page.getByTestId('toolbar-settings-btn').click()
      await expect(settings).toBeVisible()
      await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Text formats' }).click()
    }
    const closeSettings = async () => {
      await page.keyboard.press('Escape')
      await expect(settings).toBeHidden()
    }

    await test.step('a <strong> with the class exists while Bold writes that class', async () => {
      await page.getByTestId('class-picker-input').fill(className)
      await page.getByTestId('class-picker-submit').click()
      await expect(page.getByTestId(`class-chip-${className}`)).toBeVisible()
      await openTextFormats()
      // Earlier specs share this site's settings — start from the defaults.
      await settings.getByRole('button', { name: 'Reset to defaults' }).click()
      await settings.getByRole('combobox', { name: 'Classes for Bold' }).click()
      await page.getByRole('option', { name: className, exact: true }).click()
      await closeSettings()
      await openParagraph(frame, frame.getByText(DEFAULT_TEXT, { exact: true }))
      await selectTrailing(page, frame, 'here.')
      await page.keyboard.press('Control+b')
      await page.keyboard.press('Enter')
      await expect(host).toHaveCount(0)
      await expect(frame.locator('p strong', { hasText: 'here.' })).toHaveClass(new RegExp(`(^|\\s)${className}(\\s|$)`))
    })

    await test.step('without the class in Bold, the word is unknown formatting and the hint says so', async () => {
      await openTextFormats()
      await settings.getByTestId('text-format-bold').getByRole('button', { name: `Remove class ${className}` }).click()
      await closeSettings()
      await openParagraph(frame, frame.locator('p', { hasText: 'Add your' }), { position: { x: 4, y: 4 } })
      await selectTrailing(page, frame, 'here.')
      await expect(boldButton).toHaveAttribute('aria-disabled', 'true')
      await expect(boldButton).toHaveAttribute(
        'aria-description',
        `Unknown formatting (strong.${className}) — add it under Settings → Text formats`,
      )
      await page.keyboard.press('Escape')
      await expect(host).toHaveCount(0)
    })

    await test.step('as a variant of Bold, the word reads as Bold and one click removes it', async () => {
      await openTextFormats()
      await settings.getByRole('combobox', { name: 'Also recognize for Bold' }).click()
      await page.getByRole('option', { name: className, exact: true }).click()
      await expect(settings.getByTestId('text-format-bold').getByText(`strong.${className}`, { exact: true })).toBeVisible()
      await closeSettings()
      await openParagraph(frame, frame.locator('p', { hasText: 'Add your' }), { position: { x: 4, y: 4 } })
      await selectTrailing(page, frame, 'here.')
      await expect(boldButton).toHaveAttribute('aria-pressed', 'true')
      await expect(boldButton).not.toHaveAttribute('aria-description', /.+/)
      await boldButton.click()
      await expect(editorOf(frame).locator('strong')).toHaveCount(0)
      await page.keyboard.press('Enter')
      await expect(host).toHaveCount(0)
      await expect(frame.locator('strong')).toHaveCount(0)
      await expect(frame.getByText(DEFAULT_TEXT, { exact: true })).toBeVisible()
      await openTextFormats()
      await settings.getByRole('button', { name: 'Reset to defaults' }).click()
      await closeSettings()
    })
  })
})
