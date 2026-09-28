import { describe, it, expect, vi } from 'vitest'
import { parseExtraction, heuristicExtract } from '../../../src/eve/capture'
import { normalizeImportance } from '../../../src/eve/tools'

vi.mock('eve/tools', () => ({ defineTool: (def: unknown) => def, disableTool: () => ({}) }))
vi.mock('eve/memory', () => ({ defineMemoryProvider: (def: unknown) => def }))

describe('/eve tools — importance normalization (remember tool)', () => {
  it('scales confidence-style fractions (0–1) onto the 1–10 scale', () => {
    // Regression: GROVE emitted importance:0.9 and the old min(1) schema rejected
    // it (AI_InvalidToolInputError), wasting a tool round-trip.
    expect(normalizeImportance(0.9)).toBe(9)
    expect(normalizeImportance(0.5)).toBe(5)
    expect(normalizeImportance(0.05)).toBe(1) // 0.5 → rounds to 1 (clamped min)
    expect(normalizeImportance(1)).toBe(10) // 1 is treated as "fraction = 100%"
  })

  it('passes integers in 1–10 through and rounds non-integers', () => {
    expect(normalizeImportance(7)).toBe(7)
    expect(normalizeImportance(7.4)).toBe(7)
    expect(normalizeImportance(7.6)).toBe(8)
  })

  it('clamps out-of-range values', () => {
    expect(normalizeImportance(0)).toBe(1)
    expect(normalizeImportance(-3)).toBe(1)
    expect(normalizeImportance(42)).toBe(10)
  })

  it('leaves undefined / NaN as undefined (store default applies)', () => {
    expect(normalizeImportance(undefined)).toBeUndefined()
    expect(normalizeImportance(Number.NaN)).toBeUndefined()
  })
})

describe('/eve capture — extraction parsing (#9)', () => {
  it('parses well-formed JSON with mixed tiers', () => {
    const text =
      'Here you go: {"memories":[' +
      '{"type":"semantic","label":"Pref","content":"Prefers architecture risks","importance":8},' +
      '{"type":"episodic","label":"Acme","content":"EU data residency blocker"}' +
      ']} done'
    const out = parseExtraction(text)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ type: 'semantic', importance: 8 })
    expect(out[1]).toMatchObject({ type: 'episodic', label: 'Acme' })
  })

  it('returns [] for junk / no JSON', () => {
    expect(parseExtraction('no json here')).toEqual([])
    expect(parseExtraction('')).toEqual([])
    expect(parseExtraction('{bad json}')).toEqual([])
  })

  it('drops entries with invalid type or missing fields', () => {
    const text =
      '{"memories":[' +
      '{"type":"bogus","label":"x","content":"y"},' +
      '{"type":"semantic","label":"","content":"y"},' +
      '{"type":"procedural","label":"ok","content":"do the thing"}' +
      ']}'
    const out = parseExtraction(text)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('procedural')
  })

  it('heuristic fallback keeps the last user turn as a semantic memory', () => {
    const out = heuristicExtract([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'I prefer concise briefs' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'semantic', content: 'I prefer concise briefs' })
  })

  it('heuristic fallback returns [] with no user turns', () => {
    expect(heuristicExtract([{ role: 'assistant', content: 'hi' }])).toEqual([])
    expect(heuristicExtract(undefined)).toEqual([])
  })
})
