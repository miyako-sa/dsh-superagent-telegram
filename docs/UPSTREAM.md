# Upstream

The plugin is written against `deepseek-ai/dsh-superagent-prototype`. That repository is read-only for us and has its Issues
disabled, so we watch it rather than ask it.

| Date | Upstream `main` | Notes |
| --- | --- | --- |
| 2026-11-02 | `6337fc823ce20251c8de8085948165c81aaa701e` | First observation. Contract as read from the host installed on the maintainer's machine (`0.2.1-rc.3`, DSH `0.2.1-rc.3`, Node 24). |

Each commit records the upstream commit it was written against as an `Upstream-commit:` trailer.
[`../scripts/upstream-check.sh`](../scripts/upstream-check.sh) and
[`../.github/workflows/upstream.yml`](../.github/workflows/upstream.yml) compare this value with upstream.
