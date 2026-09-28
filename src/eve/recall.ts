import type { MemoryOperationContext, RecallResult } from 'eve/memory'
import type { MongoMemoryStore } from '../store'
import type {
  SemanticMemory,
  EpisodicMemory,
  ProceduralMemory,
} from '../types'
import type { EveMemoryTiers, EveRecallOptions } from './types'

/** Extract the user query text from the recall context, defensively. */
export function extractUserTurn(ctx: MemoryOperationContext): string {
  const msgs = ctx.turn?.input
  if (!Array.isArray(msgs)) return typeof msgs === 'string' ? msgs : ''
  // Prefer the latest user message; fall back to the last message with text.
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m && m.role === 'user') { const t = messageText(m); if (t) return t }
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = messageText(msgs[i]); if (t) return t
  }
  return ''
}

/** Extract plain text from an AI SDK ModelMessage (string or parts array). */
function messageText(m: { role?: string; content?: unknown } | undefined): string {
  if (!m) return ''
  const c = m.content
  if (typeof c === 'string') return c.trim()
  if (!Array.isArray(c)) return ''
  const parts: string[] = []
  for (const p of c as Array<Record<string, unknown>>) {
    if (p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string') {
      parts.push(p.text)
    }
  }
  return parts.join(' ').trim()
}

interface RecallDeps {
  store: MongoMemoryStore
  tiers: Required<EveMemoryTiers>
  recall: Required<EveRecallOptions>
  ensureConnected: () => Promise<void>
}

/**
 * Build the Eve `recall["turn.started"]` handler.
 *
 * Runs semantic / episodic / procedural search in parallel, **partitioned by
 * the trusted `ctx.memory.scope.key`** (used as the store `userId`), and
 * converts hits into Eve recall messages. The model never supplies the scope.
 */
export function createRecallHandler(deps: RecallDeps) {
  const { store, tiers, recall, ensureConnected } = deps

  return async function turnStarted(
    ctx: MemoryOperationContext
  ): Promise<RecallResult> {
    await ensureConnected()

    const scope = ctx.memory.scope.key
    const query = extractUserTurn(ctx)

    // No query text → nothing meaningful to retrieve. Return empty rather than
    // embedding an empty string.
    if (!query.trim()) return { messages: [] }

    const [semantic, episodic, procedural] = await Promise.all([
      tiers.semantic
        ? store.semanticSearch(scope, query, recall.limit)
        : Promise.resolve<SemanticMemory[]>([]),
      tiers.episodic
        ? store.episodicSearch(scope, query, recall.limit)
        : Promise.resolve<EpisodicMemory[]>([]),
      tiers.procedural
        ? store.proceduralSearch(scope, query, recall.limit)
        : Promise.resolve<ProceduralMemory[]>([]),
    ])

    return { messages: convertToEveContext({ semantic, episodic, procedural }) }
  }
}

interface Retrieved {
  semantic: SemanticMemory[]
  episodic: EpisodicMemory[]
  procedural: ProceduralMemory[]
}

/**
 * Convert retrieved MongoDB memories into Eve recall messages.
 * Each message carries a stable, scope-local `id` (the Mongo `_id`) so Eve can
 * attribute and supersede recalled records across turns.
 */
export function convertToEveContext(r: Retrieved): RecallResult['messages'] {
  const messages: RecallResult['messages'] = []

  for (const m of r.semantic) {
    messages.push({
      id: String(m._id),
      content: `Known fact — ${m.name}: ${m.description}`,
    })
  }
  for (const m of r.episodic) {
    messages.push({
      id: String(m._id),
      content: `Past event [${m.event_type}]: ${m.description}`,
    })
  }
  for (const m of r.procedural) {
    messages.push({
      id: String(m._id),
      content: `Procedure — ${m.task}: ${m.description}`,
    })
  }

  return messages
}
