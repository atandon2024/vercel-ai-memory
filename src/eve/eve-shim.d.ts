/**
 * Minimal ambient declarations for the parts of the `eve` package this adapter
 * uses. `eve` is an **optional peer dependency** — consumers who import
 * `@mongodb-developer/vercel-ai-memory/eve` install it themselves. These
 * declarations let the adapter type-check and build here without adding a hard
 * dependency, and they intentionally mirror the public Eve provider contract:
 *   https://eve.dev/docs/memory/custom-provider
 *
 * When the real `eve` package is installed in a consumer project, its own type
 * definitions take precedence.
 */
declare module 'eve/memory' {
  /** Opaque, versioned digest of namespace + scope. Partition key for all I/O. */
  export interface MemoryScope {
    key: string
    namespace: string
    value: string | string[]
  }

  /** Context passed to every provider handler. */
  export interface MemoryOperationContext {
    memory: { scope: MemoryScope }
    /** Present on recall (`turn.started`): the current user turn / query. */
    turn?: { id?: string; input?: Array<{ role?: string; content?: unknown }>; sequence?: number }
    /** Present on capture (`turn.completed`): the settled turn messages. */
    messages?: Array<{ role?: string; content?: unknown }>
    /** Stable idempotency key for the operation. */
    operationId: string
    /**
     * Some deployments surface the session/agent language model on the context;
     * the adapter uses it as a fallback capture model when present.
     */
    model?: unknown
  }

  /** A single recalled memory placed into model context (user-role, attributed). */
  export interface RecalledMessage {
    id?: string
    content: string
  }

  export interface RecallResult {
    messages: RecalledMessage[]
  }

  export interface MemoryProviderDefinition {
    recall: {
      'turn.started'(ctx: MemoryOperationContext): Promise<RecallResult> | RecallResult
      'compaction.completed'?(
        ctx: MemoryOperationContext
      ): Promise<RecallResult> | RecallResult
    }
    capture?: {
      'turn.completed'?(ctx: MemoryOperationContext): Promise<void> | void
      'compaction.requested'?(ctx: MemoryOperationContext): Promise<void> | void
    }
    tools?(ctx: MemoryOperationContext): Promise<Record<string, unknown>> | Record<string, unknown>
  }

  export function defineMemoryProvider(
    def: MemoryProviderDefinition
  ): MemoryProviderDefinition

  export function defineMemory(def: unknown): unknown
}

declare module 'eve/tools' {
  export function defineTool<T = unknown>(def: {
    description: string
    inputSchema: unknown
    approval?: unknown
    execute(input: T): Promise<unknown> | unknown
  }): unknown
  export function disableTool(): unknown
}

declare module 'eve/memory/scope' {
  export const byPrincipal: (ctx: unknown) => string | string[] | null
}
