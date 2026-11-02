/**
 * The two content-derived identifier helpers of `dsh-superagent` this plugin uses.
 *
 * Copied from `src/core/ids.ts` and `src/core/model.ts` of `dsh-superagent` (MIT) because those modules are not published
 * on its package entry. Both are pure and stable: a Trigger id must stay equal across restarts and upgrades, so these two
 * functions are pinned by `tests/ids.spec.ts` and must keep producing the same values as the upstream host.
 */
import { createHash } from 'node:crypto'

/** Stable content-derived identifier (`dsh-superagent` `key`): equal inputs always produce the same id. */
export function key(...values: string[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)
}

/** Stable key of a Thread across the whole domain (`dsh-superagent` `threadKey`). */
export const threadKey = (ref: { source: string; id: string }): string => `${ref.source}:${ref.id}`
