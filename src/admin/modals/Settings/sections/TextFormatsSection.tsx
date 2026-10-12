/**
 * TextFormatsSection — configure the inline formats offered by the paragraph
 * editor (HTML tag + CSS classes + shortcut per format, plus further class
 * sets recognised as the same format) and the classes added to links. Persists `site.settings.textFormats`; "Reset to defaults" removes
 * the key so `resolveTextFormats` falls back to the built-in formats.
 */
import { useState } from 'react'
import { useSiteSettingsController } from '../useSiteSettingsController'
import { isUserVisibleClass } from '@core/page-tree'
import { resolveTextFormats, type InlineFormatTag, type TextFormatsSettings } from '@core/text-formats'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { SkeletonBlock } from '@ui/components/Skeleton'
import { ClassIdsPicker } from './ClassIdsPicker'
import { FormatVariantsPicker } from './FormatVariantsPicker'
import {
  addFormat,
  addVariant,
  removeFormat,
  removeVariant,
  setLinkClasses,
  updateFormat,
  validateShortcut,
} from '../textFormatsEditing'
import s from '../SettingsModal.module.css'
import t from './TextFormatsSection.module.css'

const TAG_OPTIONS: { value: InlineFormatTag; label: string }[] = [
  { value: 'strong', label: 'strong (bold)' },
  { value: 'em', label: 'em (italic)' },
  { value: 'span', label: 'span' },
  { value: 'small', label: 'small' },
]

export function TextFormatsSection() {
  const { site, error, updateSiteSettings } = useSiteSettingsController()
  // Field-local shortcut validation messages, keyed by format id.
  const [shortcutErrors, setShortcutErrors] = useState<Record<string, string>>({})

  if (error) return <p className={s.sectionDescription} role="alert">{error}</p>
  if (!site) return <SkeletonBlock minHeight={200} ariaLabel="Loading site settings" />

  const value = resolveTextFormats(site.settings.textFormats)
  const classes = Object.values(site.styleRules)
    .filter((r) => isUserVisibleClass(r) && (!r.kind || r.kind === 'class'))
    .sort((a, b) => a.name.localeCompare(b.name))
  const save = (next: TextFormatsSettings) => updateSiteSettings({ textFormats: next })
  const clearShortcutError = (id: string) =>
    setShortcutErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })

  return (
    <div>
      <p className={s.sectionDescription}>
        Formats offered when you select text in a paragraph on the canvas. Each format writes the chosen tag and classes.
      </p>
      <section aria-labelledby="tf-formats-heading" className={s.sectionBlock}>
        <h4 id="tf-formats-heading" className={s.subHeading}>Formats</h4>
        {value.formats.map((f) => {
          const shortcutError = shortcutErrors[f.id]
          return (
            <div key={f.id} className={t.format} data-testid={`text-format-${f.id}`}>
              <div>
                <label htmlFor={`tf-label-${f.id}`} className={s.label}>Label</label>
                <Input
                  key={`${f.id}:${f.label}`}
                  id={`tf-label-${f.id}`}
                  defaultValue={f.label}
                  maxLength={40}
                  onBlur={(e) => {
                    const label = e.target.value.trim()
                    if (label && label !== f.label) save(updateFormat(value, f.id, { label }))
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </div>
              <div>
                <label htmlFor={`tf-tag-${f.id}`} className={s.label}>HTML tag</label>
                <Select
                  id={`tf-tag-${f.id}`}
                  value={f.tag}
                  options={TAG_OPTIONS}
                  onChange={(e) => save(updateFormat(value, f.id, { tag: e.target.value as InlineFormatTag }))}
                />
              </div>
              <div>
                <span className={s.label}>Classes</span>
                <ClassIdsPicker
                  label={`Classes for ${f.label}`}
                  value={f.classIds}
                  classes={classes}
                  onChange={(classIds) => save(updateFormat(value, f.id, { classIds }))}
                />
              </div>
              <div>
                <span className={s.label}>Also recognize</span>
                <p className={t.help}>
                  Existing text with these classes counts as {f.label} too. New text gets the classes above.
                </p>
                <FormatVariantsPicker
                  format={f}
                  classes={classes}
                  claims={value.formats
                    .filter((other) => other.id !== f.id && other.tag === f.tag)
                    .flatMap((other) =>
                      [other.classIds, ...(other.variants ?? [])].map((classIds) => ({ classIds, label: other.label })),
                    )}
                  onAdd={(classIds) => save(addVariant(value, f.id, classIds))}
                  onRemove={(index) => save(removeVariant(value, f.id, index))}
                />
              </div>
              <div>
                <label htmlFor={`tf-key-${f.id}`} className={s.label}>Shortcut</label>
                <Input
                  key={`${f.id}:${f.shortcut ?? ''}`}
                  id={`tf-key-${f.id}`}
                  defaultValue={f.shortcut ?? ''}
                  placeholder="Mod-b"
                  invalid={shortcutError !== undefined}
                  aria-describedby={shortcutError ? `tf-key-err-${f.id}` : undefined}
                  onChange={() => { if (shortcutError) clearShortcutError(f.id) }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  onBlur={(e) => {
                    const raw = e.target.value.trim()
                    const problem = validateShortcut(value, f.id, raw)
                    if (problem) {
                      setShortcutErrors((prev) => ({ ...prev, [f.id]: problem }))
                      return
                    }
                    clearShortcutError(f.id)
                    if (raw !== (f.shortcut ?? '')) {
                      save(updateFormat(value, f.id, { shortcut: raw === '' ? undefined : raw }))
                    }
                  }}
                />
                {shortcutError && (
                  <p id={`tf-key-err-${f.id}`} className={t.error} role="alert">{shortcutError}</p>
                )}
              </div>
              <div>
                <Button variant="ghost" size="xs" dangerHover onClick={() => save(removeFormat(value, f.id))}>
                  Remove format
                </Button>
              </div>
            </div>
          )
        })}
        <Button variant="secondary" size="sm" onClick={() => save(addFormat(value))}>Add format</Button>
      </section>
      <section aria-labelledby="tf-link-heading" className={s.sectionBlock}>
        <h4 id="tf-link-heading" className={s.subHeading}>Links</h4>
        <ClassIdsPicker
          label="Classes for links"
          value={value.link.classIds}
          classes={classes}
          onChange={(classIds) => save(setLinkClasses(value, classIds))}
        />
      </section>
      <div className={t.actions}>
        <Button variant="ghost" size="xs" onClick={() => updateSiteSettings({ textFormats: undefined })}>
          Reset to defaults
        </Button>
      </div>
    </div>
  )
}
