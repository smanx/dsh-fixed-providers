/**
 * @smanx/dsh-fixed-providers host entry.
 *
 * The managed providers are configured through JSON documents — a local file
 * (`<DSH_HOME>/dsh-fixed-providers.json`, falling back to the shipped
 * `providers.json` in the package) merged with an optional remote JSON
 * document fetched over HTTP (see src/config.ts). At startup the plugin:
 *
 * 1. **Loads and merges** the provider configuration (local wins on conflicts)
 *    and resolves each upstream-sourced provider's model catalog.
 * 2. **Seeds** the merged providers into the `llm-pi-ai` settings namespace
 *    (served by the stock pi-ai adapter) with their fixed
 *    `displayName` / `apiKeyEnv` / `api` / `baseURL`, and stores the fixed API
 *    keys through the credentials seam.
 * 3. **Guards** — on every `settings/updated` for `llm-pi-ai` it re-asserts
 *    the protected fields (reverting edits and re-creating deleted routes),
 *    and on every `credentials/updated` it restores the fixed keys. A static
 *    provider's `models` list is never touched; an upstream-sourced provider
 *    (`dynamicModels`) has its `models` re-asserted too, so its catalog keeps
 *    tracking the upstream `/models` endpoint.
 * 4. **Serves** a client-safe JSON list of the managed providers (routes +
 *    display names only, no secrets) so the browser half can lock their
 *    URL/key inputs in the Models page.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "@smanx/dsh-fixed-providers";
/** No hard service dependency: the plugin activates when the seams exist. */
export declare const inject: readonly string[];
/** Endpoint serving the client-safe managed provider list. */
export declare const MANAGED_ENDPOINT = "/dsh-fixed-providers/managed.json";
export declare function apply(ctx: Context): Promise<void>;
