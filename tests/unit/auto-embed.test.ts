import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MongoMemoryStore } from '../../src/store'
import { resolveConfig } from '../../src/config'
import { EmbeddingAdapter } from '../../src/embeddings'
import { mockEmbedder } from '../helpers/mock-embedder'

const URI = 'mongodb://localhost:27017'

// Build a fake MongoClient whose db() records createSearchIndexes commands and
// exposes aggregate pipelines captured per collection.
function makeClient() {
  const commands: any[] = []
  const pipelines: any[] = []
  const collection = () => ({
    createIndex: vi.fn().mockResolvedValue(undefined),
    updateOne: vi.fn().mockResolvedValue(undefined),
    updateMany: vi.fn().mockResolvedValue(undefined),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'x' }),
    insertMany: vi.fn().mockResolvedValue(undefined),
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    aggregate: vi.fn().mockImplementation((pipeline: any) => {
      pipelines.push(pipeline)
      return { toArray: vi.fn().mockResolvedValue([]) }
    }),
  })
  const db = {
    collection: vi.fn().mockImplementation(() => collection()),
    command: vi.fn().mockImplementation((cmd: any) => {
      commands.push(cmd)
      return Promise.resolve(undefined)
    }),
  }
  const client = { db: vi.fn().mockReturnValue(db) } as any
  return { client, commands, pipelines }
}

describe('core store — client embedding mode is unchanged (default)', () => {
  let ctx: ReturnType<typeof makeClient>
  let store: MongoMemoryStore

  beforeEach(async () => {
    ctx = makeClient()
    const config = resolveConfig({ uri: URI, embedder: mockEmbedder })
    store = new MongoMemoryStore(ctx.client, new EmbeddingAdapter(mockEmbedder), config)
    await store.bootstrap()
  })

  it('bootstrap creates vectorSearch indexes with type:"vector" on "embedding"', () => {
    const idxCmds = ctx.commands.filter((c) => c.createSearchIndexes)
    expect(idxCmds.length).toBeGreaterThan(0)
    const field = idxCmds[0].indexes[0].definition.fields[0]
    expect(field.type).toBe('vector')
    expect(field.path).toBe('embedding')
    expect(field.numDimensions).toBeGreaterThan(0)
  })

  it('search issues $vectorSearch with queryVector (not query text)', async () => {
    await store.semanticSearch('alice', 'hello')
    const stage = ctx.pipelines[0][0].$vectorSearch
    expect(Array.isArray(stage.queryVector)).toBe(true)
    expect(stage.query).toBeUndefined()
    expect(stage.path).toBe('embedding')
  })
})

describe('core store — Atlas Automated Embedding mode (opt-in)', () => {
  let ctx: ReturnType<typeof makeClient>
  let store: MongoMemoryStore

  beforeEach(async () => {
    ctx = makeClient()
    const config = resolveConfig({ uri: URI, autoEmbed: { model: 'voyage-3-large' } })
    store = new MongoMemoryStore(ctx.client, new EmbeddingAdapter(null), config)
    await store.bootstrap()
  })

  it('bootstrap creates indexes with type:"autoEmbed" + model on "embed_text"', () => {
    const idxCmds = ctx.commands.filter((c) => c.createSearchIndexes)
    expect(idxCmds.length).toBeGreaterThan(0)
    const field = idxCmds[0].indexes[0].definition.fields[0]
    expect(field.type).toBe('autoEmbed')
    expect(field.modality).toBe('text')
    expect(field.path).toBe('embed_text')
    expect(field.model).toBe('voyage-3-large')
  })

  it('search issues $vectorSearch with query text (not queryVector)', async () => {
    await store.semanticSearch('alice', 'hello world')
    const stage = ctx.pipelines[0][0].$vectorSearch
    expect(stage.query).toBe('hello world')
    expect(stage.queryVector).toBeUndefined()
    expect(stage.path).toBe('embed_text')
  })

  it('save stores embed_text (no client embedding) via upsert', async () => {
    const config = resolveConfig({ uri: URI, autoEmbed: { model: 'voyage-3-large' } })
    const client = makeClient()
    const s = new MongoMemoryStore(client.client, new EmbeddingAdapter(null), config)
    // Just assert it does not attempt client embedding (would throw).
    await expect(s.semanticSave('alice', 'Pref', 'likes tea')).resolves.toBeUndefined()
  })
})

describe('resolveConfig — embedding mode validation', () => {
  it('requires exactly one of embedder / autoEmbed', () => {
    expect(() => resolveConfig({ uri: URI } as any)).toThrow(/embedder.*required/)
    expect(() =>
      resolveConfig({ uri: URI, embedder: mockEmbedder, autoEmbed: { model: 'm' } } as any)
    ).toThrow(/exactly one/)
  })

  it('sets autoEmbed on the resolved config', () => {
    const c = resolveConfig({ uri: URI, autoEmbed: { model: 'voyage-3-large' } })
    expect(c.autoEmbed).toEqual({ model: 'voyage-3-large' })
    const c2 = resolveConfig({ uri: URI, embedder: mockEmbedder })
    expect(c2.autoEmbed).toBeNull()
  })
})
