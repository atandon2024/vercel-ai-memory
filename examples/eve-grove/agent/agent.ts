// agent/agent.ts
//
// GROVE is a DIRECT provider (a regular AI SDK dependency: @ai-sdk/openai-compatible).
// Requests go straight to GROVE — Eve does NOT route through the AI Gateway.
//
// Why the "AI Gateway context window metadata" error appears:
// Eve's compaction needs one number — the model's context window. It keeps a
// built-in table of those sizes keyed by AI Gateway model IDs, and that table is
// the ONLY place it knows context windows from. A direct-provider model isn't in
// that table, so compaction won't compile until you supply the number yourself.
//
// Escape hatch (confirmed in eve@0.55 types — PublicAgentDefinition): set
// `modelContextWindowTokens` at the AGENT level. Eve then uses this value
// verbatim and SKIPS the AI Gateway lookup entirely.

import { defineAgent } from 'eve'
import { groveModel } from './lib/grove'

export default defineAgent({
  model: groveModel,
  // gpt-6-astra's context window (adjust to the real value). No Gateway involved.
  modelContextWindowTokens: Number(process.env.GROVE_CONTEXT_WINDOW ?? 128_000),
})


