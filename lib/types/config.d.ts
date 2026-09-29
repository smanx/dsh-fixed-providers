/**
 * Configuration model for @smanx/dsh-fixed-providers.
 *
 * The managed providers are no longer hard-coded: they come from a local JSON
 * document (defaults shipped in the package as `providers.json`, overridable
 * at `<DSH_HOME>/dsh-fixed-providers.json`) plus an optional remote JSON
 * document fetched over HTTP. The two documents are merged by provider route
 * (the local document wins on conflicts) and the result is the fixed set the
 * plugin seeds and guards.
 *
 * A provider listed in {@link UPSTREAM_MODEL_CATALOG} (currently only
 * `free-zen`) does not use its configured `models` verbatim: its catalog is
 * fetched from the provider's upstream `/models` endpoint and filtered, with
 * the configured list kept as the fallback.
 *
 * Document shape (both local and remote):
 * ```json
 * {
 *   "remoteUrl": "https://example.com/providers.json",
 *   "providers": [
 *     {
 *       "route": "builtin-llm-proxy",
 *       "displayName": "Built-in LLM Proxy",
 *       "apiKeyEnv": "BUILTIN_LLM_PROXY_API_KEY",
 *       "api": "openai-completions",
 *       "baseURL": "https://.../v1",
 *       "key": "test",
 *       "models": [ { "id": "model-a", "contextWindow": 1000000, "maxTokens": 200000 } ]
 *     }
 *   ]
 * }
 * ```
 * `route`, `displayName` and `baseURL` are required; `api` defaults to
 * `openai-completions`, `apiKeyEnv` defaults to the conventional
 * `<ROUTE>_API_KEY` reference, and `key` (when present) is the fixed value
 * the plugin stores through the credentials seam.
 */
/** One model row inside a provider entry. */
export interface FixedModel {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    input?: readonly string[];
}
/** A fully normalized managed provider (what the guards enforce). */
export interface FixedProvider {
    route: string;
    displayName: string;
    apiKeyEnv: string;
    api: string;
    baseURL: string;
    /** Fixed credential value; absent when the key is environment-provided. */
    key?: string;
    defaultModels: readonly FixedModel[];
    /**
     * True when the model catalog is fetched from the upstream `/models`
     * endpoint rather than the configured `models` list; the guard then
     * re-asserts `models` too, and the client locks the model editor.
     */
    dynamicModels: boolean;
}
/** A raw provider entry as read from a JSON document. */
export interface ProviderEntry {
    route: string;
    displayName: string;
    apiKeyEnv?: string;
    api?: string;
    baseURL: string;
    key?: string;
    models?: readonly FixedModel[];
}
/** One configuration document (local or remote). */
export interface ProviderDocument {
    remoteUrl?: string;
    providers?: readonly ProviderEntry[];
}
/** The safe view served to the browser client (no secrets). */
export interface ManagedView {
    providers: readonly {
        route: string;
        displayName: string;
        modelsLocked: boolean;
    }[];
}
/**
 * Providers whose model catalog is fetched from the upstream `/models`
 * endpoint instead of the configured `models` list, keyed by route. Only the
 * free-zen gateway is listed: it publishes its free tier under ids ending in
 * `-free`, and that set changes upstream without notice. The configured
 * `models` list stays as the fallback for a failed or empty fetch.
 */
export declare const UPSTREAM_MODEL_CATALOG: Readonly<Record<string, {
    path: string;
    filter: RegExp;
}>>;
/** Conventional credential reference for a route (`llm-proxy` → `LLM_PROXY_API_KEY`). */
export declare function deriveKeyRef(route: string): string;
/** Normalize one raw entry into the enforced provider shape; throws on invalid input. */
export declare function normalizeEntry(entry: ProviderEntry, index: number): FixedProvider;
/** Parse and normalize one document's provider list. */
export declare function parseDocument(raw: unknown, source: string): ProviderDocument;
/**
 * Merge two provider lists by route: remote entries first, then local entries,
 * with the local entry replacing the remote one on the same route.
 *
 * Remote entries are validated leniently — an invalid one is skipped and
 * reported through `onRemoteInvalid` so a bad remote document cannot take the
 * plugin down. Local entries are validated strictly (a config bug should be
 * loud). Duplicate routes within one document throw.
 */
export declare function mergeProviders(local: readonly ProviderEntry[], remote?: readonly ProviderEntry[], onRemoteInvalid?: ((error: unknown) => void) | undefined): FixedProvider[];
/**
 * Replace the model catalog of every upstream-sourced provider with the live
 * list from its `/models` endpoint. A provider whose fetch fails — or whose
 * filter matches nothing — keeps its configured `models` list.
 */
export declare function resolveDynamicModels(providers: readonly FixedProvider[], logger: {
    warn: (...args: unknown[]) => void;
}): Promise<FixedProvider[]>;
export interface LoadConfigOptions {
    /** The harness home directory; defaults to `resolveDshHome()`. */
    dshHome?: string;
    /** The plugin package root holding the shipped `providers.json`; defaults to the package directory. */
    packageDir?: string;
    /** Configuration filename inside `dshHome`; defaults to `dsh-fixed-providers.json`. */
    configName?: string;
}
export interface LoadedConfig {
    providers: readonly FixedProvider[];
    /** The remote URL the config asked for (served to the client for diagnostics). */
    remoteUrl?: string;
}
/**
 * Load and merge the managed provider configuration: the local document
 * (`<dshHome>/<configName>`, falling back to `<packageDir>/providers.json`)
 * plus the remote document it names. Failures fall back in order: an invalid
 * or absent local override uses the shipped defaults; an unreachable remote
 * keeps the local result. A completely empty merged set resolves to an empty
 * list (the plugin then stays dormant).
 */
export declare function loadConfig(opts?: LoadConfigOptions, logger?: {
    warn: (...args: unknown[]) => void;
}): Promise<LoadedConfig>;
/** The client-safe view of the managed providers (routes + display names only). */
export declare function managedView(providers: readonly FixedProvider[]): ManagedView;
