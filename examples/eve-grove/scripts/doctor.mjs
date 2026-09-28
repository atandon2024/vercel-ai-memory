// scripts/doctor.mjs
//
// Prints the durable memory collections and their vector search indexes so you
// can verify Atlas Automated Embedding is actually set up. Run:
//
//   node scripts/doctor.mjs
//
// (loads env from your shell; make sure MONGODB_URI is exported)

import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI
if (!uri) {
  console.error('MONGODB_URI is not set.')
  process.exit(1)
}

const DB = process.env.MEMORY_DB ?? 'agent_memory'
const COLLECTIONS = ['semantic_memory', 'procedural_memory', 'episodic_memory']

const client = new MongoClient(uri)
await client.connect()
try {
  const db = client.db(DB)
  console.log(`\nDatabase: ${DB}\n`)
  for (const name of COLLECTIONS) {
    const col = db.collection(name)
    const count = await col.countDocuments()
    let indexes = []
    try {
      indexes = await col.listSearchIndexes().toArray()
    } catch (e) {
      console.log(`  ${name}: (listSearchIndexes failed: ${e.message})`)
      continue
    }
    console.log(`  ${name}  — docs: ${count}`)
    if (indexes.length === 0) {
      console.log('    ⚠️  NO search indexes on this collection')
    }
    for (const ix of indexes) {
      const def = ix.latestDefinition ?? ix.definition ?? {}
      const field = (def.fields ?? []).find(
        (f) => f.type === 'vector' || f.type === 'autoEmbed'
      )
      console.log(
        `    • ${ix.name}  status=${ix.status ?? '?'}  type=${field?.type ?? '?'}` +
          (field?.model ? `  model=${field.model}` : '') +
          (field?.path ? `  path=${field.path}` : '')
      )
    }
  }
  console.log('')
} finally {
  await client.close()
}
