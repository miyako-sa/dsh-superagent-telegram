/**
 * The part of `dsh-superagent`'s Source contract this plugin is written against.
 *
 * `dsh-superagent` 0.2.1-rc.3 does not publish these types on its package entry: `SourceKind`, `SourceContext` and
 * `SourceHost` live in its `lib/kind-*.d.ts` chunk, which is not reachable through `exports`. Copying the subset used here
 * keeps the plugin compiling against whatever revision is installed, and `npm run verify:host` checks at run time that the
 * installed host still answers the same way (`ctx.orchestrator`, `ctx.orchestrator.sources.register`, `ctx.orchestrator.context`).
 *
 * Members are widened to `unknown` where the plugin never inspects them, so a host change there cannot break the plugin.
 */

/** A localized label the panel renders in the interface language. */
export interface Localized { zh: string; en: string }

/** Key of a KV record whose value has type `V` (`dsh-superagent` `Key`); `record` and `family` build one. */
export type Key<V> = string & { readonly __value?: V }
/** Family of KV records sharing a prefix (`dsh-superagent` `Family`). */
export type Family<V, A extends unknown[]> = ((...name: A) => Key<V>) & { readonly prefix: string }

/** A message the plugin asks the host to deliver to a conversation. */
export interface OutboundMessage {
  readonly id: string
  readonly text: string
  /** Files the message carries after its text, as absolute host paths. */
  readonly attachments?: readonly { path: string; name?: string }[]
  readonly channel: { source: string; thread: string; address: Record<string, string> }
  readonly [key: string]: unknown
}

/** UI link for a channel address (`dsh-superagent` `ChannelLink`). */
export interface ChannelLink { url: string; label: Localized; triggerId?: string }

/** Health reported for one of the entries a kind declares. */
export interface Health {
  readonly state: 'starting' | 'ready' | 'paused' | 'error'
  readonly detail: string
  readonly at?: string
  readonly code?: string
  readonly values?: Record<string, string>
}

/** How a Source receives one message: whether it listens, whether the message can only be observed, and the admission row. */
export interface ScopeResult {
  readonly listened: boolean
  readonly observed?: boolean
  readonly row?: string
  readonly reason?: string
}

/** A normalized message the plugin turns into a Trigger. */
export interface Trigger {
  readonly id: string
  readonly source: string
  readonly at: string
  readonly threads: readonly { source: string; id: string }[]
  readonly channel: { source: string; thread: string; address: Record<string, string> }
  readonly text: string
  readonly meta: Record<string, unknown>
  readonly [key: string]: unknown
}

/** What a Source kind needs from the host to poll, ingest Triggers, describe Threads and report health. */
export interface SourceContext {
  readonly commands: unknown
  /** Deployment facts; only the state directory is read. */
  readonly deployment: { readonly stateDir: string }
  readonly ready: Promise<void>
  configured(): boolean
  config<C extends Record<string, unknown>>(kind: string): C | undefined
  receive(trigger: Trigger): unknown
  atomic<T>(work: () => T): T
  state: {
    get<V>(key: Key<V>): V | undefined
    set<V>(key: Key<V>, value: V | undefined): void
    keys<V>(family: Family<V, never>): Key<V>[]
  }
  threads: {
    get(key: string): unknown
    describe(key: string, description: { label?: string; url?: string; facts?: Record<string, unknown> }): void
    patch(key: string, meta: Record<string, unknown>): void
  }
  tickets: {
    get(id: string): unknown
    open(): { id: string }[]
    bindThread(id: string, thread: unknown, own: boolean): void
    threadClosed(thread: unknown, outcome: 'merged' | 'closed', at: string): void
  }
  triggers: { get(id: string): Trigger | undefined; latest(thread: string): Trigger | undefined }
  notify(message: OutboundMessage): void
  report(entry: string, health: Health): void
}

/** Normalized message returned by thread context readers (`dsh-superagent` `ContextMessage`). */
export interface ContextMessage {
  id: string; from: string; at: string; text: string
  bot?: true; deleted?: true; reply_to?: string; url?: string
}
export type ContextPartName = 'thread' | 'root' | 'parent'
export interface ContextPart { messages: ContextMessage[]; next?: string | undefined; body: Record<string, unknown>; status?: string }

/** The agent that receives an image as a model-visible attachment; only `ctx.get('attachments')` is used. */
export interface ImageReadingAgent {
  ctx: { get(name: 'attachments'): { imageLimits: { maxImageBytes: number; maxMessageImageBytes: number }
    saveImage(input: { data: Uint8Array; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; name?: string }): Promise<unknown> } | undefined }
}

/** Bounded thread context reader used by assessments to inspect messages and images around a Trigger (`dsh-superagent` `ThreadContext`). */
export interface ThreadContext<C> {
  messageId(trigger: Trigger): string
  read(commands: unknown, trigger: Trigger, part: ContextPartName, cursor: string | undefined, config: C): Promise<ContextPart>
  /** Image keys of this message that `image` can read. */
  images?(text: string): string[]
  /** Reads one image of a message in the Trigger's Thread as an attachment for `agent`. */
  image?(agent: ImageReadingAgent, commands: unknown, trigger: Trigger, message: { id: string; text: string }, key: string,
    stateDir: string, signal: AbortSignal): Promise<unknown>
}

/** One Source plugin: configuration, UI fields, Policy part, reply channel, and the poll loop in `apply`. */
export interface SourceKind<C extends Record<string, unknown> = Record<string, unknown>> {
  readonly kind: string
  readonly title: { zh: string; en: string }
  readonly description: { zh: string; en: string }
  readonly schema: { parse(value: unknown): C }
  readonly fields: readonly unknown[]
  readonly health: readonly string[]
  readonly scope?: (trigger: { meta: Record<string, unknown> }, config: C) => ScopeResult
  readonly channel?: {
    allowed?: (address: Record<string, string>, config: C) => boolean
    send: (host: Pick<SourceContext, 'commands'>, message: OutboundMessage) => Promise<'sent' | 'gone'>
    link: (address: Record<string, string>, links: Record<string, unknown>) => ChannelLink
  }
  readonly repliesTo?: (trigger: Trigger) => string | undefined
  /** Thread context and image reading, for assessments that inspect the messages around a Trigger. */
  readonly threadContext?: ThreadContext<never>
  readonly policy?: {
    readonly schema: unknown
    readonly fields: readonly unknown[]
    readonly explicit: { zh: string; en: string }
    readonly unnamed?: { person: { zh: string; en: string }; bot: { zh: string; en: string } }
    rows?(config: Record<string, unknown>): unknown[]
    readonly sync?: { label: unknown; ready(part: unknown): boolean; run(host: unknown, part: unknown, signal: AbortSignal): Promise<unknown> }
  }
  readonly environment?: {
    readonly variables: readonly { key: string; description: { zh: string; en: string } }[]
    values(input: { trigger?: Trigger }): Record<string, string>
  }
}

/** The `orchestrator` service `dsh-superagent` puts on the Cordis context. */
export interface SourceHost {
  readonly sources: {
    register(kind: SourceKind<never>): () => void
    /** The configured instance of one kind, while the plugin is installed. */
    instance<C extends Record<string, unknown>>(id: string): { config: C } | undefined
  }
  context(kind: { kind: string; health: readonly string[] }): SourceContext
}

/** Serialized settings, as the host stores them. */
export interface SerializedSettings {
  readonly sources: Record<string, { enabled: boolean; config: Record<string, unknown> }>
  readonly policy: { sources: Record<string, Record<string, unknown>> }
}
