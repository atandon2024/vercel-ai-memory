import { describe, it, expect, beforeAll } from 'vitest'
import { MongoClient } from 'mongodb'
import {
  getTestStore,
  bootstrapOnce,
  ATLAS_URI,
  TEST_DB,
} from '../../helpers/atlas-client'
import { EmbeddingAdapter } from '../../../src/embeddings'
import { MongoMemoryStore } from '../../../src/store'
import { mockEmbedder } from '../../helpers/mock-embedder'
import type { SemanticMemory } from '../../../src/types'

/**
 * Eve adapter integration tests (Atlas-gated).
 *
 * The Eve adapter partitions EVERY read/write by the trusted `scope.key`, which
 * it passes as the store `userId`. These tests exercise that exact contract
 * against real Atlas Vector Search to prove:
 *   #4 memories persist across new Eve "sessions" (a brand-new store instance)
 *   #5 recall returns only memories for the current scope
 *   #6 two principals cannot retrieve each other's memories
 *
 * Note on ranking: the deterministic mock embedder does not produce
 * semantically meaningful vector rankings, so — like the other integration
 * tests in this repo — durable persistence is verified with a direct scoped
 * read, and vector search is used to verify **scope partitioning** (which is
 * ranking-independent because the scope filter is applied inside
 * `$vectorSearch`).
 */
let store: MongoMemoryStore

const ALICE = 'eve-scope-alice'
const BOB = 'eve-scope-bob'

beforeAll(async () => {
  await bootstrapOnce()
  store = await getTestStore()
})

describe('Eve scope partitioning over Atlas (#4/#5/#6)', () => {
  it('persists durable memory across a brand-new Eve session (#4)', async () => {
    // Simulate an Eve turn: capture a durable preference under Alice's scope.
    await store.semanticSave(
      ALICE,
      'MeetingPrefs',
      'Prioritize architecture risks, joint opportunities, and unresolved action items in meeting briefs',
      { importance: 9 }
    )

    // A brand-new Eve session = a fresh MongoClient + store over the same DB and
    // the same scope key. The memory must still be there.
    const freshClient = new MongoClient(ATLAS_URI as string, {
      appName: 'eve-integration-new-session',
    })
    await freshClient.connect()
    try {
      const freshStore = new MongoMemoryStore(
        freshClient,
        new EmbeddingAdapter(mockEmbedder),
        TEST_DB
      )

      // Direct scoped read (ranking-independent) proves persistence + scoping.
      const col = (
        freshStore as unknown as {
          semantic: {
            findOne: (q: object) => Promise<SemanticMemory | null>
          }
        }
      ).semantic
      const doc = await col.findOne({
        user_id: ALICE,
        name: 'MeetingPrefs',
        is_latest: true,
      })
      expect(doc).not.toBeNull()
      expect(doc?.description).toMatch(/architecture risks/i)
    } finally {
      await freshClient.close()
    }
  })

  it('recall returns only the current scope, never another principal (#5/#6)', async () => {
    await store.semanticSave(ALICE, 'Alice-Secret', 'Alice works in technical partnerships', {
      importance: 8,
    })
    await store.semanticSave(BOB, 'Bob-Secret', 'Bob works in finance operations', {
      importance: 8,
    })

    const aliceHits = await store.semanticSearch(ALICE, 'what is my role', 10)
    const bobHits = await store.semanticSearch(BOB, 'what is my role', 10)

    // Every returned doc must belong to the querying scope.
    expect(aliceHits.every((r) => r.user_id === ALICE)).toBe(true)
    expect(bobHits.every((r) => r.user_id === BOB)).toBe(true)

    // Cross-contamination check: Alice must not see Bob's fact and vice-versa.
    expect(aliceHits.some((r) => /finance operations/i.test(r.description))).toBe(false)
    expect(bobHits.some((r) => /technical partnerships/i.test(r.description))).toBe(false)
  })

  it('episodic + procedural are also scope-partitioned', async () => {
    await store.episodicSave(ALICE, 'meeting', 'Acme flagged EU data residency as a blocker', {
      importance: 7,
    })
    await store.proceduralSave(ALICE, 'Brief Prep', 'Always list unresolved action items first')

    const bobEpisodic = await store.episodicSearch(BOB, 'EU data residency', 10)
    const bobProcedural = await store.proceduralSearch(BOB, 'action items', 10)

    expect(bobEpisodic.some((r) => /data residency/i.test(r.description))).toBe(false)
    expect(bobProcedural.some((r) => /action items/i.test(r.description))).toBe(false)
  })
})

