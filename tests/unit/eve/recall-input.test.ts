import { describe, it, expect } from 'vitest'
import { extractUserTurn } from '../../../src/eve/recall'

// Eve passes `turn.input` as an AI SDK ModelMessage[] (NOT a string). This
// suite locks in that contract — the earlier bug was extractUserTurn treating
// input as a string, returning '', and making recall always search empty.
describe('extractUserTurn (Eve turn.input is ModelMessage[])', () => {
  it('reads text from the latest user message in the array', () => {
    const ctx: any = {
      turn: {
        input: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
          { role: 'user', content: 'what is my name' },
        ],
      },
    }
    expect(extractUserTurn(ctx)).toBe('what is my name')
  })

  it('reads text from content parts arrays', () => {
    const ctx: any = {
      turn: {
        input: [{ role: 'user', content: [{ type: 'text', text: 'prepare my meeting' }] }],
      },
    }
    expect(extractUserTurn(ctx)).toBe('prepare my meeting')
  })

  it('falls back to the last message with text when no user role', () => {
    const ctx: any = {
      turn: { input: [{ role: 'assistant', content: 'only assistant text' }] },
    }
    expect(extractUserTurn(ctx)).toBe('only assistant text')
  })

  it('returns empty string when there is no input', () => {
    expect(extractUserTurn({} as any)).toBe('')
    expect(extractUserTurn({ turn: { input: [] } } as any)).toBe('')
  })

  it('still tolerates a plain string (defensive)', () => {
    expect(extractUserTurn({ turn: { input: 'legacy' } } as any)).toBe('legacy')
  })
})
