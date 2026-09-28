import { generateText } from 'ai'
import type { LanguageModel } from 'ai'
import type { MemoryOperationContext } from 'eve/memory'
import type { MongoMemoryStore } from '../store'
import type { EveMemoryTiers } from './types'

/** A durable memory extracted from a conversation, ready to persist. */
export interface ExtractedMemory {
  type: 'semantic' | 'episodic' | 'procedural'
  /** Entity name / event type / task label. */
  label: string
  /** The knowledge statement / event narrative / procedure description. */
  content: string
  /** Optional importance 1–10. */
  importance?: number
}

/**
 * Persist an extracted memory through the existing store, **scoped** by the
 * trusted Eve scope key (used as the store `userId`). Shared by automatic
 * capture and the agent-driven `remember` tool.
 *
 * Idempotency (Eve contract: "treat `operationId` as an idempotency key — eve
 * may replay a handler with the same ID"):
 *   - semantic / procedural saves are upserts on `(scope, label)`, so a replay
 *     is naturally a no-op.
 *   - episodic saves are inserts (events accumulate by design), so when an
 *     `operationId` is supplied we tag the event with it and skip the insert if
 *     an identical event for the same scope + operation already exists.
 */
export async function persistExtracted(
  store: MongoMemoryStore,
  scope: string,
  mem: ExtractedMemory,
  operationId?: string
): Promise<void> {
  const importance = mem.importance
  switch (mem.type) {
    case 'semantic':
      await store.semanticSave(scope, mem.label, mem.content, { importance })
      return
    case 'procedural':
      await store.proceduralSave(scope, mem.label, mem.content, { importance })
      return
    case 'episodic': {
      if (operationId) {
        const exists = await store.episodicExists(scope, {
          event_type: mem.label,
          description: mem.content,
          'context.eve_operation_id': operationId,
        })
        if (exists) return
      }
      await store.episodicSave(scope, mem.label, mem.content, {
        importance,
        ...(operationId ? { context: { eve_operation_id: operationId } } : {}),
      })
      return
    }
  }
}

/** Extract plain text from Eve capture messages. */
function messagesToTranscript(
  messages: MemoryOperationContext['messages']
): string {
  if (!Array.isArray(messages)) return ''
  const lines: string[] = []
  for (const m of messages) {
    const role = typeof m.role === 'string' ? m.role : 'message'
    const content = m.content
    let text = ''
    if (typeof content === 'string') text = content
    else if (Array.isArray(content)) {
      text = content
        .map((p) =>
          p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string'
            ? (p as { text: string }).text
            : ''
        )
        .filter(Boolean)
        .join('\n')
    }
    if (text.trim()) lines.push(`${role}: ${text.trim()}`)
  }
  return lines.join('\n')
}

const EXTRACTION_PROMPT = `You extract DURABLE, long-term memories from a conversation for a per-user memory store.

Classify each memory as exactly one of:
- "semantic"   : stable facts or preferences about the user/entities.
- "episodic"   : notable events/outcomes/interactions.
- "procedural" : reusable how-to knowledge / workflows the user wants followed.

Rules:
- Only include information that will still matter in future sessions.
- Never include secrets (passwords, tokens, payment data, keys, one-time codes).
- If nothing durable is present, return an empty array.

Return ONLY minified JSON of the form:
{"memories":[{"type":"semantic","label":"<short label>","content":"<statement>","importance":<1-10>}]}

Conversation:
`

/** Parse the model's JSON output into extracted memories, defensively. */
export function parseExtraction(text: string): ExtractedMemory[] {
  if (!text) return []
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  const arr = (parsed as { memories?: unknown })?.memories
  if (!Array.isArray(arr)) return []
  const out: ExtractedMemory[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const type = o.type
    const label = o.label
    const content = o.content
    if (
      (type === 'semantic' || type === 'episodic' || type === 'procedural') &&
      typeof label === 'string' &&
      label.trim() &&
      typeof content === 'string' &&
      content.trim()
    ) {
      const importance =
        typeof o.importance === 'number' ? o.importance : undefined
      out.push({ type, label: label.trim(), content: content.trim(), importance })
    }
  }
  return out
}

interface CaptureDeps {
  store: MongoMemoryStore
  tiers: Required<EveMemoryTiers>
  captureModel?: LanguageModel
  ensureConnected: () => Promise<void>
}

let warnedNoModel = false

/**
 * Build the Eve `capture["turn.completed"]` handler for `capture: "automatic"`.
 *
 * Uses `captureModel` (or a model surfaced on the capture context, if any) to
 * extract & classify durable memories, then persists them via the existing
 * store — all partitioned by the trusted scope key. Falls back to a lightweight
 * heuristic (store the last substantive user turn as a semantic memory) when no
 * model is available, so automatic capture still does something useful.
 */
export function createCaptureHandler(deps: CaptureDeps) {
  const { store, tiers, captureModel, ensureConnected } = deps

  return async function turnCompleted(
    ctx: MemoryOperationContext
  ): Promise<void> {
    await ensureConnected()

    const scope = ctx.memory.scope.key
    const transcript = messagesToTranscript(ctx.messages)
    if (!transcript.trim()) return

    const model =
      (captureModel ?? (ctx.model as LanguageModel | undefined)) || undefined

    let extracted: ExtractedMemory[] = []
    if (model) {
      try {
        const { text } = await generateText({
          model,
          prompt: EXTRACTION_PROMPT + transcript,
        })
        extracted = parseExtraction(text)
      } catch {
        extracted = []
      }
    } else {
      if (!warnedNoModel) {
        warnedNoModel = true
        // eslint-disable-next-line no-console
        console.info(
          '[mongodb-memory/eve] capture:"automatic" has no captureModel — using a ' +
            'heuristic fallback. Provide `captureModel` for full LLM classification.'
        )
      }
      extracted = heuristicExtract(ctx.messages)
    }

    const filtered = extracted.filter((m) => tiers[m.type])
    for (const mem of filtered) {
      try {
        // Pass the Eve operationId so a replayed `turn.completed` is idempotent.
        await persistExtracted(store, scope, mem, ctx.operationId)
      } catch {
        // Capture is best-effort per the Eve contract; never fail the turn.
      }
    }
  }
}

/** Minimal no-model fallback: keep the last substantive user turn as a fact. */
export function heuristicExtract(
  messages: MemoryOperationContext['messages']
): ExtractedMemory[] {
  if (!Array.isArray(messages)) return []
  let lastUser = ''
  for (const m of messages) {
    if (m.role === 'user') {
      const c = m.content
      if (typeof c === 'string' && c.trim()) lastUser = c.trim()
    }
  }
  if (!lastUser) return []
  return [
    {
      type: 'semantic',
      label: 'User statement',
      content: lastUser.slice(0, 500),
    },
  ]
}

