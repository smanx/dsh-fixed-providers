/**
 * @smanx/dsh-fixed-providers build.
 *
 * The web server serves exactly one file per plugin
 * (/plugins/@smanx/dsh-fixed-providers/client.js), so the client half is one
 * CJS bundle wrapped in the ModuleLoader factory handshake; the bundle is
 * self-contained (no @deepseek-ai or react imports), so nothing stays
 * external. The host half is plain ESM for Node. tsc then emits the lib/types
 * declarations.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

mkdirSync('lib', { recursive: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: true,
  external: ['@deepseek-ai/*', '@deepseek-ai/cordis'],
  logLevel: 'info',
})

await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  banner: {
    js: "window.__ModuleLoader__.load({ id: '@smanx/dsh-fixed-providers', factory: (require) => { var module = { exports: {} }; var exports = module.exports;",
  },
  footer: {
    js: 'return module.exports; } });',
  },
  logLevel: 'info',
})

// Cross-platform tsc invocation (node + the JS entry, not a .bin shim).
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { stdio: 'inherit' })
