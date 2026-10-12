import { Select } from '@ui/components/Select'
import { TagPill } from '@ui/components/TagPill'
import type { StyleRule } from '@core/page-tree'
import t from './TextFormatsSection.module.css'

export function ClassIdsPicker({ label, value, classes, onChange }: {
  label: string
  value: string[]
  classes: StyleRule[]
  onChange: (next: string[]) => void
}) {
  const byId = new Map(classes.map((c) => [c.id, c]))
  const available = classes.filter((c) => !value.includes(c.id))
  return (
    <div className={t.picker}>
      {value.length > 0 && (
        <div className={t.pills}>
          {value.map((id) => (
            <TagPill
              key={id}
              size="xs"
              monospace
              label={byId.get(id)?.name ?? `missing: ${id}`}
              muted={!byId.has(id)}
              onRemove={() => onChange(value.filter((v) => v !== id))}
              removeAriaLabel={`Remove class ${byId.get(id)?.name ?? id}`}
            />
          ))}
        </div>
      )}
      <Select
        searchable
        aria-label={label}
        fieldSize="sm"
        value=""
        placeholder="Add class…"
        options={[{ value: '', label: 'Add class…' }, ...available.map((c) => ({ value: c.id, label: c.name }))]}
        onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]) }}
      />
    </div>
  )
}
