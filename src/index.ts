/**
 * @smanx/dsh-fixed-providers host entry.
 *
 * The managed providers are configured through JSON documents — a local file
 * (`<DSH_HOME>/dsh-fixed-providers.json`, falling back to the shipped
 * `providers.json` in the package) merged with an optional remote JSON
 * document fetched over HTTP (see src/config.ts). At startup the plugin:
 *
 * 1. **Loads and merges** the provider configuration (local wins on conflicts).
 * 2. **Seeds** the merged providers into the `llm-pi-ai` settings namespace
 *    (served by the stock pi-ai adapter) with their fixed
 *    `displayName` / `apiKeyEnv` / `api` / `baseURL`, and stores the fixed API
 *    keys through the credentials seam.
 * 3. **Guards** — on every `settings/updated` for `llm-pi-ai` it re-asserts
 *    the protected fields (reverting edits and re-creating deleted routes),
 *    and on every `credentials/updated` it restores the fixed keys. The user's
 *    `models` list of each managed provider is never touched.
 * 4. **Serves** a client-safe JSON list of the managed providers (routes +
 *    display names only, no secrets) so the browser half can lock their
 *    URL/key inputs in the Models page.
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialProvider, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace, type SettingsProvider } from '@deepseek-ai/dsh-settings'
// Type-only import: activates the `ctx.webServer` augmentation.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { loadConfig, managedView, type FixedProvider } from './config.ts'
import { enforceOps } from './guard.ts'

export const name = '@smanx/dsh-fixed-providers'

/** No hard service dependency: the plugin activates when the seams exist. */
export const inject: readonly string[] = []

/** The settings namespace the managed profiles live in (owned by llm-pi-ai). */
const NS = settingsNamespace('llm-pi-ai')

/** Endpoint serving the client-safe managed provider list. */
export const MANAGED_ENDPOINT = '/dsh-fixed-providers/managed.json'

const SEED_TRIES = 20
const SEED_DELAY_MS = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function apply(ctx: Context): Promise<void> {
  const config = await loadConfig({}, ctx.logger)
  const providers: readonly FixedProvider[] = config.providers
  if (providers.length === 0) {
    ctx.logger.warn('@smanx/dsh-fixed-providers: no managed providers configured; staying dormant')
    return
  }
  ctx.logger.info('@smanx/dsh-fixed-providers: managing %d provider(s): %s', providers.length, providers.map((p) => p.route).join(', '))

  // Fixed keys by credential reference (a ref shared by providers must agree).
  const fixedKeys = new Map<string, string>()
  for (const provider of providers) {
    if (provider.key !== undefined) fixedKeys.set(provider.apiKeyEnv, provider.key)
  }
  const managedRefs = new Set([...fixedKeys.keys()].map((ref) => credentialRef(ref)))

  // Serve the client-safe managed list so the browser half can lock the rows.
  const view = managedView(providers)
  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => sctx.webServer.register({
      kind: 'exact',
      path: MANAGED_ENDPOINT,
      handler: (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-cache',
        })
        res.end(JSON.stringify(view))
      },
    }), '@smanx/dsh-fixed-providers: managed list endpoint')
  })

  ctx.inject(['settings', 'credentials'], (sctx) => {
    const settings: SettingsProvider = sctx.settings
    const credentials: CredentialProvider = sctx.credentials

    /** Restore one managed credential to its fixed value. Converges by design. */
    const restoreCredential = async (ref: CredentialRef): Promise<void> => {
      const key = fixedKeys.get(String(ref))
      if (key === undefined) return
      let hit: { value: string } | undefined
      try {
        hit = await credentials.resolve(ref)
      } catch (error) {
        ctx.logger.warn(`@smanx/dsh-fixed-providers: could not read credential ${String(ref)}`)
        ctx.logger.warn(error)
        return
      }
      if (hit !== undefined && hit.value === key) return
      try {
        await credentials.set(ref, key)
      } catch (error) {
        // The launching environment may supply the ref read-only (env wins).
        ctx.logger.warn(
          `@smanx/dsh-fixed-providers: could not restore the fixed value of ${String(ref)}; the launching environment may provide it read-only`,
        )
        ctx.logger.warn(error)
      }
    }

    /** Re-assert the managed provider profiles against one resolved value. */
    const enforceFrom = async (value: unknown): Promise<void> => {
      const providersValue = isRecord(value) ? value['providers'] : undefined
      const ops = enforceOps(isRecord(providersValue) ? providersValue : undefined, providers)
      if (ops.length === 0) return
      try {
        await settings.mutate(NS, ops)
      } catch (error) {
        ctx.logger.warn('@smanx/dsh-fixed-providers: failed to re-assert the managed providers')
        ctx.logger.warn(error)
      }
    }

    /** Seed every managed credential at boot. */
    const seedCredentials = async (): Promise<void> => {
      for (const ref of managedRefs) await restoreCredential(ref)
    }

    /** Seed the managed profiles once the llm-pi-ai namespace is registered. */
    const seedSettings = async (): Promise<void> => {
      for (let attempt = 0; attempt < SEED_TRIES; attempt += 1) {
        const current = settings.get(NS)
        if (current !== undefined) {
          await enforceFrom(current)
          return
        }
        await delay(SEED_DELAY_MS)
      }
      ctx.logger.warn(
        '@smanx/dsh-fixed-providers: the llm-pi-ai settings namespace is not registered; the managed providers will be enforced on the next settings change',
      )
    }

    // Guards first: no user change can escape while seeding runs.
    ctx.on('settings/updated', (ns, next) => {
      if (ns !== NS) return
      void enforceFrom(next)
    })
    ctx.on('credentials/updated', (ref) => {
      if (!managedRefs.has(ref)) return
      void restoreCredential(ref)
    })

    void seedCredentials()
    void seedSettings()
  })
}
