# dsh-superagent-telegram

A **Telegram Source plugin** for [`dsh-superagent`](https://github.com/deepseek-ai/dsh-superagent-prototype): Telegram messages
become Triggers, pass the host's Policy, open Tickets, and the worker's replies go back to the chat they came from.

Part of the [miyako-sa](https://github.com/miyako-sa) organization. **Unofficial**: not maintained by, and not affiliated with,
DeepSeek AI.

---

## What it does

It registers a Source kind named `telegram` on the host's `orchestrator` service and runs one long-poll loop. The host keeps
doing what it already does; this plugin only adds Telegram as another Source beside `github` and `feishu`.

- **Receiving** — direct messages, listed groups and channels (`@ only` or `all`), forum topics, replies, edits (opt-in), and
  channel posts (opt-in). Each message becomes a Trigger named after the message, so it stays stable across restarts.
- **Policy** — allowed Telegram users, an admission table per chat, and optional "sync from chat administrators".
- **Replying** — worker replies, acknowledgements and questions go back to the same chat and forum topic, HTML-formatted, split
  at Telegram's 4096-character limit, threaded under the message they answer.
- **Environment** — a ticket that started on Telegram gets `DSH_SUPERAGENT_TELEGRAM_CHAT` and `DSH_SUPERAGENT_TELEGRAM_THREAD`.
- **Health** — the `telegram` health entry shows `ready`, `paused` or `error` with a token-free detail.

- **Media** — photos, documents, videos, audio, voice notes, animations, video notes and stickers. The message text keeps a
  placeholder naming the Telegram file id (`[photo AgAC…]`, `[document: report.pdf BQ…]`), and the files themselves are
  downloaded (Bot API limit: 20 MB per file) into `<stateDir>/telegram-media/<token-hash>/` with the paths published as a
  `telegram-files` fact on the Thread, so a worker can open them.
- **Image reading** — during assessment the model can read an image of the message it is judging; it is committed through
  `ctx.attachments` and shown to the model, never executed or exposed.

## Requirements

- `dsh-superagent` **0.2.1-rc.3 or newer** (the `orchestrator` service and `SourceKind` contract this plugin is written against).
- Node.js `^22.19.0 || >=24.0.0` (same as the host).
- A Telegram bot token from [@BotFather](https://t.me/BotFather).

## Install

The host resolves plugin packages from its own profile, so install it next to `dsh-superagent` and add the bundle to the profile.
From the `dsh-superagent` checkout:

```bash
# 1. the package (npm is used only once the package is published; until then, clone and build it)
git clone https://github.com/miyako-sa/dsh-superagent-telegram
cd dsh-superagent-telegram && pnpm install && pnpm build

# 2. mount it into the host profile
cd <dsh-superagent checkout>
pnpm add file:../dsh-superagent-telegram
```

Add the bundle after the host's own bundle, so its `insert` row lands on top of the host's tree (the profile file `dsh-superagent`
loads, usually `$DSH_HOME/profiles/<profile>/package.json`). A host older than this plugin still ships its own Telegram Source:
remove that entry and `src/sources/telegram*.ts` first, or two registrations of the `telegram` kind collide.

```json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-superagent", "dsh-superagent-telegram"] } }
```

```bash
systemctl restart dsh-superagent     # or: scripts/dsh-superagent restart
```

The plugin declares `inject = ['orchestrator']`, so a host without `dsh-superagent` leaves it inert instead of crashing.

## Configure

1. Put the token in the host's environment file (`$DSH_HOME/.env`), which accepts non-`DSH_` names:

   ```dotenv
   TELEGRAM_BOT_TOKEN=123456:ABC...
   ```

2. In the panel, open **Settings → Sources → Telegram**: switch it on and set *Token environment variable* to
   `TELEGRAM_BOT_TOKEN` (the plugin's own default is `DSH_SUPERAGENT_TELEGRAM_TOKEN`).
3. In **Policy → Telegram**, list the users who may originate work, and set the admission table for each chat.
4. Restart the host so the new environment variable is read. The `telegram` health entry then reads `ready`.

The token is read from the environment only. It is never written to settings, logs, or health details.

## How it talks to the host

`dsh-superagent` 0.2.1-rc.3 does not export its Source types on the package entry (`SourceKind` lives in an internal `lib/kind-*.d.ts`
chunk), so this plugin keeps its own copy of the subset it uses in [`src/contract.ts`](src/contract.ts) and reaches the host only
through the `orchestrator` service at run time. Two host helpers are pure functions and are reproduced here with their upstream
semantics: `key()` and `threadKey()` in [`src/ids.ts`](src/ids.ts) (pinned by tests — a Trigger id must stay equal across
restarts), and `sourceContext()` in [`src/host.ts`](src/host.ts).

If the host later publishes this contract, `contract.ts`, `ids.ts` and `host.ts` can shrink to re-exports.

## Keeping up with upstream

The upstream prototype is read-only and does not take issues, so this repository watches it:

- [`scripts/upstream-check.sh`](scripts/upstream-check.sh) fetches `deepseek-ai/dsh-superagent-prototype` `main`, compares it with
  the last observed commit, and prints a one-line report. It runs on a schedule (cron/CI) and sends no LLM call — it is a plain
  programmatic check.
- [`docs/UPSTREAM.md`](docs/UPSTREAM.md) records the upstream commit each change was written against; each commit carries it
  as an `Upstream-commit:` trailer.
- When upstream changes, read the diff of `src/sources/*` and `lib/kind-*.d.ts`: those are the parts this plugin depends on.
  Anything that changes `SourceKind`, `SourceContext`, `key()` or `threadKey()` is a breaking change for this plugin first.

## Layout

```
src/
  index.ts             plugin entry: registers the kind, starts and stops the poll loop
  telegram.ts          Source kind: config schema, scope, policy, reply channel, environment
  telegram-api.ts      minimal Bot API client over fetch, retry classification
  telegram-loops.ts    long-poll loop, offset handling, health
  telegram-trigger.ts  Bot API payloads → Trigger, mention detection, placeholders
  telegram-channel.ts  outbound replies: HTML, 4096-splitting, deep links
  telegram-media.ts    what a message carries: photo sizes, documents, video/audio/voice, placeholders, image keys
  telegram-download.ts bounded `getFile` downloads with caching and a token-scoped directory
  telegram-context.ts  thread context around a Trigger and images as model-visible attachments
  contract.ts          the host contract subset this plugin is written against
  host.ts / ids.ts / kv.ts  host helpers reproduced, and the plugin's KV keys
tests/                 52 unit tests (vitest)
```

## Development

```bash
pnpm install
pnpm check          # typecheck + tests + build
```

No network is touched by the tests: the Telegram API is exercised through its pure pieces (Trigger translation, HTML, splitting,
kind scope/policy).

## License

MIT, matching `dsh-superagent`. The Telegram Source implementation originates from
[`dsh-superagent`](https://github.com/deepseek-ai/dsh-superagent-prototype) (Copyright © 2026 DeepSeek Harness Team, MIT) and is
maintained here as a standalone plugin; see [`LICENSE`](LICENSE).
