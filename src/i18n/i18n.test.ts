import { expect, test } from 'bun:test'
import { loadCatalogRaw } from '../engine/levels'
import { collect } from '../../scripts/i18n-extract'
import { feedbackKeys } from '../../scripts/i18n-levels'
import enDict from './en.json'
import feedbackEn from './feedback.en.json'
import levelsEn from './levels.en.json'

const count = (s: string): number => (s.match(/\{\}/g) ?? []).length

test('every t()/T() string in src has an English entry with matching placeholders', () => {
  const dict = enDict as Record<string, string>
  const missing: string[] = []
  const mismatch: string[] = []
  for (const key of collect().keys()) {
    const en = dict[key]
    if (en === undefined) missing.push(key)
    else if (count(en) !== count(key)) mismatch.push(key)
  }
  expect(missing).toEqual([])
  expect(mismatch).toEqual([])
})

test('feedback translations keep placeholders', () => {
  for (const [k, v] of Object.entries(feedbackEn as Record<string, string>)) expect(count(v)).toBe(count(k))
})

test('every feedback message printed by a level check has an English translation', () => {
  const have = feedbackEn as Record<string, string>
  expect([...feedbackKeys().keys()].filter((k) => !(k in have))).toEqual([])
})

test('every level and stage has a complete English translation', () => {
  const en = levelsEn as unknown as Record<string, { title?: string; story?: string; goal?: string; reveal?: string; hints?: string[]; subtitle?: string; intro?: string }>
  const cat = loadCatalogRaw()
  for (const l of cat.levels) {
    const e = en[l.id]
    expect(e, l.id).toBeDefined()
    expect(e!.title && e!.story && e!.goal, l.id).toBeTruthy()
    expect(e!.hints?.length, l.id).toBe(l.hints.length)
    if (l.reveal) expect(e!.reveal, l.id).toBeTruthy()
  }
  for (const s of cat.stages) expect(en[`stage:${s.id}`]?.intro, String(s.id)).toBeTruthy()
})
