import { describe, it, expect } from 'bun:test'
import { normalizeRuns, type Run } from '@core/paragraph'

const t = (text: string): Run => ({ kind: 'text', text })
const b = (text: string): Run => ({ kind: 'format', formatId: 'bold', text })
const fx = (nodeId: string, text: string): Run => ({ kind: 'fixed', nodeId, text })
const l = (text: string, href = '/a'): Run => ({ kind: 'link', text, href, target: '_self', classIds: [] })

describe('normalizeRuns', () => {
  it('merges adjacent equal runs and drops empty ones', () => {
    expect(normalizeRuns([t('a'), t(''), t('b'), b('c'), b('d')])).toEqual([t('ab'), b('cd')])
  })
  it('never merges fixed runs', () => {
    expect(normalizeRuns([fx('x', 'a'), fx('y', 'b')])).toEqual([fx('x', 'a'), fx('y', 'b')])
  })
  it('merges links only with identical target data', () => {
    expect(normalizeRuns([l('a'), l('b')])).toEqual([l('ab')])
    expect(normalizeRuns([l('a', '/x'), l('b', '/y')])).toEqual([l('a', '/x'), l('b', '/y')])
  })
  it('moves boundary spaces out of formatted runs', () => {
    expect(normalizeRuns([t('based on'), b(' plan '), t('for')])).toEqual([t('based on '), b('plan'), t(' for')])
  })
  it('collapses double spaces created at joins and trims paragraph edges', () => {
    expect(normalizeRuns([t('  based on '), b(' plan'), t('  for  ')])).toEqual([t('based on '), b('plan'), t(' for')])
  })
  it('turns a whitespace-only formatted run into plain text', () => {
    expect(normalizeRuns([t('a'), b(' '), t('b')])).toEqual([t('a b')])
  })
  it('keeps hard line breaks', () => {
    expect(normalizeRuns([t('Zeile 1\nZeile 2')])).toEqual([t('Zeile 1\nZeile 2')])
  })
  it('preserves spaces around hard line breaks', () => {
    expect(normalizeRuns([t('a \n b')])).toEqual([t('a \n b')])
    expect(normalizeRuns([b('x '), t('\ny')])).toEqual([b('x'), t(' \ny')])
  })
  it('keeps empty fixed runs (unknown nodes are never deleted)', () => {
    expect(normalizeRuns([t('a'), fx('x', ''), t('b')])).toEqual([t('a'), fx('x', ''), t('b')])
  })
  it('preserves fixed runs at paragraph edges with spaces', () => {
    expect(normalizeRuns([t(' '), fx('x', ' a ')])).toEqual([fx('x', ' a ')])
  })
  it('preserves NBSP in formatted runs (not treated as boundary space)', () => {
    // NBSP (U+00A0) should not be split as boundary space
    const nbsp = ' '
    expect(normalizeRuns([b(`${nbsp}x${nbsp}`)])).toEqual([b(`${nbsp}x${nbsp}`)])
  })
  it('trims line breaks at paragraph edges, keeps them inside', () => {
    expect(normalizeRuns([t('a\n')])).toEqual([t('a')])
    expect(normalizeRuns([t('\na')])).toEqual([t('a')])
    expect(normalizeRuns([t('a\nb')])).toEqual([t('a\nb')])
    expect(normalizeRuns([t('\n \n'), b('x'), t(' \n')])).toEqual([b('x')])
    expect(normalizeRuns([b('x'), t('\n'), b('y')])).toEqual([b('x'), t('\n'), b('y')])
  })
  it('is idempotent across various inputs', () => {
    const inputs = [
      [t('a \n'), b('x'), t('\n\n')],
      [t('\n'), fx('x', 'a'), t(' \n ')],
      [t(' a  '), b(' b '), b('c'), t(''), l(' d '), fx('x', 'e'), t('  f ')],
      [t('a'), fx('x', ''), t('b')],
      [b('x '), t('\ny')],
      [t(' '), fx('y', ' a ')],
    ]
    for (const input of inputs) {
      const once = normalizeRuns(input)
      expect(normalizeRuns(once)).toEqual(once)
    }
  })
})
