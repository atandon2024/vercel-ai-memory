import { embed } from 'ai'
import type { EmbeddingModel } from 'ai'

/**
 * Embedding adapter wrapping any Vercel AI SDK EmbeddingModel.
 * Dimensions are auto-detected on the first call and cached.
 *
 * In **Atlas Automated Embedding** mode there is no client-side model — the
 * adapter is constructed with `null` and its `embedText` / `getDimensions`
 * methods are never called by the store (all embedding happens server-side).
 * They throw a clear error if invoked, guarding against accidental misuse.
 */
export class EmbeddingAdapter {
  private model: EmbeddingModel | null
  private _dimensions: number | null = null

  constructor(model: EmbeddingModel | null) {
    this.model = model
  }

  /** True when this adapter has no client-side embedding model (auto-embed mode). */
  get isAutoEmbed(): boolean {
    return this.model === null
  }

  /**
   * Embed a single text string.
   * Also caches the detected dimension on first call.
   */
  async embedText(text: string): Promise<number[]> {
    if (!this.model) {
      throw new Error(
        '[mongodb-memory] embedText called with no client embedder — this store ' +
          'is configured for Atlas Automated Embedding (autoEmbed).'
      )
    }
    const result = await embed({
      model: this.model,
      value: text,
    })
    if (this._dimensions === null) {
      this._dimensions = result.embedding.length
    }
    return result.embedding
  }

  /**
   * Returns the embedding dimensions, probing if not yet detected.
   * Safe to call before any real embedding — uses a short sentinel string.
   */
  async getDimensions(): Promise<number> {
    if (this._dimensions !== null) return this._dimensions
    await this.embedText('__dim_probe__')
    return this._dimensions!
  }
}
