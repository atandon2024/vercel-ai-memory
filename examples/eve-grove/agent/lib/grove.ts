// agent/lib/grove.ts
//
// GROVE is an OpenAI-compatible chat/completions gateway (Azure APIM style).
// It authenticates with an `api-key` header (NOT `Authorization: Bearer`), so we
// pass the key via `headers` and leave `apiKey` unset.
//
// Mirrors this curl:
//   curl -X POST "https://grove-gateway-prod.azure-api.net/grove-foundry-prod/openai/v1/chat/completions" \
//     -H "Content-Type: application/json" \
//     -H "api-key: $GROVE_API_KEY" \
//     -d '{ "model": "gpt-6-astra", "messages": [{ "role": "user", "content": "Hello!" }] }'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

const GROVE_BASE_URL =
  process.env.GROVE_BASE_URL ??
  'https://grove-gateway-prod.azure-api.net/grove-foundry-prod/openai/v1'

if (!process.env.GROVE_API_KEY) {
  // Fail loud & early — otherwise the gateway returns 401s that are hard to trace.
  throw new Error('GROVE_API_KEY is not set. Export it before running the agent.')
}

/**
 * The GROVE provider instance. Reuse it for both the agent model and the
 * memory capture model.
 */
export const grove = createOpenAICompatible({
  name: '',
  baseURL: GROVE_BASE_URL,
  // GROVE uses the Azure-style `api-key` header instead of Bearer auth.
  headers: {
    'api-key': process.env.GROVE_API_KEY,
  },
  includeUsage: true,
})

/** The chat model your curl uses. Override with GROVE_MODEL if needed. */
export const groveModel = grove.chatModel(process.env.GROVE_MODEL ?? 'gpt-6-astra')
