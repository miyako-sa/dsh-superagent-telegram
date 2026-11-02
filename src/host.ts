/**
 * Host helpers of `dsh-superagent` this plugin needs, declared over the contract subset in `./contract.ts`.
 *
 * The upstream helpers `sourceContext(host, kind)` and `health(state, code, values)` do nothing but read from, and write to,
 * the host: `sourceContext` returns `host.context(kind)`, and `health` renders one of the host's fixed English templates. Both
 * are re-expressed here so the plugin compiles without the host's internal modules.
 */
import type { Health, SourceContext, SourceHost } from './contract.ts'

/** Returns the context for one Source kind (`dsh-superagent` `sourceContext`). */
export const sourceContext = (host: SourceHost, kind: { kind: string; health: readonly string[] }): SourceContext =>
  host.context(kind)

/** Builds a health value with its host template code; the panel localizes `code` in the interface language. */
export const health = (state: Health['state'], code: string, values: Record<string, string> = {}): Health =>
  ({ state, detail: fill(HEALTH_TEXT[code] ?? code, values), code, ...Object.keys(values).length ? { values } : {} })

/** The host's health templates the plugin can report (`dsh-superagent` `HEALTH_TEXT`). */
export const HEALTH_TEXT: Record<string, string> = {
  setupPending: 'Waiting for the deployment check',
  sourceOff: 'Off',
  pollFailures: '{count} consecutive failed polls; last: {error}',
}

/** Substitutes `{name}` placeholders (`dsh-superagent` `fill`). */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match)
}
