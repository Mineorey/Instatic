import { Checkbox } from '@ui/components/Checkbox'
import { Select } from '@ui/components/Select'
import { TagPill } from '@ui/components/TagPill'
import type { StyleRule } from '@core/page-tree'
import type { TextFormat } from '@core/text-formats'
import t from './TextFormatsSection.module.css'

/**
 * "Also recognize" for one text format: further class sets (same tag) that
 * paragraph mode reads as this format — e.g. a second, visually equal bold
 * class. Picking a class adds a single-class set; the checkbox adds the bare
 * tag (only offered when the format itself has classes). A set another
 * format of the same tag already claims (`claims`) is not offered — the
 * parser would drop it (`settleVariants`).
 */
export function FormatVariantsPicker({ format, classes, claims, onAdd, onRemove }: {
  format: TextFormat
  classes: StyleRule[]
  /** Class sets claimed by the other formats of the same tag (own classes and variants). */
  claims: { classIds: string[]; label: string }[]
  onAdd: (classIds: string[]) => void
  onRemove: (index: number) => void
}) {
  const byId = new Map(classes.map((c) => [c.id, c]))
  const variants = format.variants ?? []
  const describe = (ids: readonly string[]) =>
    ids.length === 0
      ? `${format.tag} (no class)`
      : `${format.tag}${ids.map((id) => `.${byId.get(id)?.name ?? `missing:${id}`}`).join('')}`
  const isSingle = (ids: readonly string[], id: string) => ids.length === 1 && ids[0] === id
  const available = classes.filter(
    (c) =>
      !isSingle(format.classIds, c.id) &&
      !variants.some((ids) => isSingle(ids, c.id)) &&
      !claims.some((claim) => isSingle(claim.classIds, c.id)),
  )
  const bareIndex = variants.findIndex((ids) => ids.length === 0)
  const bareClaim = claims.find((claim) => claim.classIds.length === 0)
  const bareLabel = `Plain <${format.tag}> without class`
  return (
    <div className={t.picker}>
      {variants.length > 0 && (
        <div className={t.pills}>
          {variants.map((ids, index) => (
            <TagPill
              key={describe(ids)}
              size="xs"
              monospace
              label={describe(ids)}
              muted={ids.some((id) => !byId.has(id))}
              onRemove={() => onRemove(index)}
              removeAriaLabel={`Remove variant ${describe(ids)}`}
            />
          ))}
        </div>
      )}
      <Select
        searchable
        aria-label={`Also recognize for ${format.label}`}
        fieldSize="sm"
        value=""
        placeholder="Add class…"
        options={[{ value: '', label: 'Add class…' }, ...available.map((c) => ({ value: c.id, label: c.name }))]}
        onChange={(e) => { if (e.target.value) onAdd([e.target.value]) }}
      />
      {format.classIds.length > 0 && (
        <label className={t.checkboxRow}>
          <Checkbox
            boxSize="sm"
            checked={bareIndex >= 0}
            disabled={bareIndex < 0 && bareClaim !== undefined}
            onCheckedChange={(checked) => (checked ? onAdd([]) : onRemove(bareIndex))}
          />
          <span>{bareLabel}</span>
          {bareIndex < 0 && bareClaim && <span className={t.claimed}>(used by {bareClaim.label})</span>}
        </label>
      )}
    </div>
  )
}
