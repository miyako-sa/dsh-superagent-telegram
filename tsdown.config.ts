import { defineConfig } from 'tsdown'

// One ESM entry: the Cordis plugin that registers the `telegram` Source kind on `ctx.orchestrator` and runs its poll loop.
// `dsh-superagent` itself is never bundled; the plugin talks to it only through the `orchestrator` service at run time.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  fixedExtension: false,
  platform: 'node',
  target: 'es2024',
  dts: true,
  clean: true,
  deps: { neverBundle: [/^@deepseek-ai\//, 'zod'] },
})
