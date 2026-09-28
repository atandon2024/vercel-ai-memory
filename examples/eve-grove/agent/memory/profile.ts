// agent/memory/profile.ts
//
// MongoDB-backed durable memory for this Eve agent, using GROVE for automatic
// capture classification.
//
// Embeddings: this example defaults to **Atlas Automated Embedding** (Voyage AI,
// server-side) so you don't need a separate embeddings API key. If you prefer a
// client embedder, see the commented block below.

import { defineMemory } from 'eve/memory'
import { byPrincipal } from 'eve/memory/scope'
import { mongodbMemory } from '@mongodb-developer/vercel-ai-memory/eve'
import { groveModel } from '../lib/grove'

// ─── Stable partition key in local dev (IMPORTANT) ───────────────────────────
//
// Eve partitions every memory read/write by `memory.scope.key`, which is a
// digest of  namespace + scope.  BOTH must be stable for memory to persist:
//
//  • scope:     `byPrincipal` uses the authenticated caller. In the local dev
//               TUI / `eve invoke` there is no real auth, so the anonymous
//               principal changes between runs. We pin a stable dev id.
//
//  • namespace: when omitted, Eve's default namespace includes a sha256 of the
//               BUILD ROOT (`.eve/builds/<id>/…`), which is different on EVERY
//               `eve dev` / `eve invoke` start. So even with a constant scope,
//               the partition key changes each run and the agent "forgets" you.
//               (Verified with `eve traces`: `gen_ai.memory.store.id` differed
//               on every invocation.) Pin an explicit, stable namespace.
//
// Set EVE_MEMORY_PROD=1 to opt back into real per-principal isolation.
const DEV_ID = process.env.DEV_PRINCIPAL_ID ?? 'workshop-user'

const scope = (ctx: Parameters<typeof byPrincipal>[0]) =>
  process.env.EVE_MEMORY_PROD ? byPrincipal(ctx) : [DEV_ID]

export default defineMemory({
  description: 'Durable facts, preferences, history, and procedures per caller.',
  // Stable across builds/restarts. Change it to start a fresh memory space.
  namespace: process.env.MEMORY_NAMESPACE ?? 'eve-grove-memory-agent/profile',
  scope,
  provider: mongodbMemory({
    uri: process.env.MONGODB_URI!,

    // Option A (default): MongoDB Atlas generates embeddings server-side.
    autoEmbed: { model: process.env.VOYAGE_MODEL ?? 'voyage-4' },

    // Automatic capture classifies durable memories using GROVE (chat model).
    capture: 'automatic',
    captureModel: groveModel,
  }),
})

// ─── Option B: use a client-side embedder instead of autoEmbed ───────────────
// import { openai } from '@ai-sdk/openai'   // or any AI SDK embedding provider
//
// provider: mongodbMemory({
//   uri: process.env.MONGODB_URI!,
//   embedder: openai.embedding('text-embedding-3-small'),
//   capture: 'automatic',
//   captureModel: groveModel,
// }),
//
// Note: GROVE's endpoint is chat/completions only, so it is used as the
// captureModel (classification), not as the embedder.
