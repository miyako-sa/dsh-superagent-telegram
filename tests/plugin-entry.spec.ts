/**
 * The plugin must stay inert-but-correct when the host is present: it registers exactly one Source kind and starts one
 * poll loop, and disposing the effects stops the loop. This is the only test that exercises `apply` as the host calls it.
 */
import { describe, expect, it, vi } from 'vitest'
import { apply, name, inject, telegramKind } from '../src/index.ts'

const fakeHost = () => {
  const registered: unknown[] = []
  const reports: { entry: string; health: unknown }[] = []
  return {
    registered, reports,
    orchestrator: {
      sources: { register: (kind: unknown) => { registered.push(kind); return () => {} }, instance: () => undefined },
      context: () => ({
        configured: () => false, config: () => undefined, ready: Promise.resolve(), receive: vi.fn(), atomic: (work: () => unknown) => work(),
        state: { get: () => undefined, set: () => {}, keys: () => [] },
        threads: { get: () => undefined, describe: () => {}, patch: () => {} },
        tickets: { get: () => undefined, open: () => [], bindThread: () => {}, threadClosed: () => {} },
        triggers: { get: () => undefined, latest: () => undefined },
        notify: () => {}, report: (entry: string, health: unknown) => { reports.push({ entry, health }) },
      }),
    },
  }
}

describe('plugin entry', () => {
  it('names itself and requires the orchestrator service', () => {
    expect(name).toBe('dsh-superagent-telegram')
    expect(inject).toEqual(['orchestrator'])
  })
  it('registers the telegram Source kind and starts the poll loop, which a dispose stops', async () => {
    const host = fakeHost()
    const disposers: unknown[] = []
    const ctx = { orchestrator: host.orchestrator, effect: (work: () => unknown) => { disposers.push(work()) } }
    apply(ctx as never)
    expect(host.registered).toEqual([telegramKind])
    expect(disposers).toHaveLength(2)
    const stop = disposers[1] as () => Promise<void>
    await stop()
    // A stopped loop does not linger: the second effect resolved, and health was never forced into an error.
    expect(host.reports.filter(report => (report.health as { state: string }).state === 'error')).toEqual([])
  })
})
