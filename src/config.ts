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

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** One model row inside a provider entry. */
export interface FixedModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: readonly string[]
}

/** A fully normalized managed provider (what the guards enforce). */
export interface FixedProvider {
  route: string
  displayName: string
  apiKeyEnv: string
  api: string
  baseURL: string
  /** Fixed credential value; absent when the key is environment-provided. */
  key?: string
  defaultModels: readonly FixedModel[]
  /**
   * True when the model catalog is fetched from the upstream `/models`
   * endpoint rather than the configured `models` list; the guard then
   * re-asserts `models` too, and the client locks the model editor.
   */
  dynamicModels: boolean
}

/** A raw provider entry as read from a JSON document. */
export interface ProviderEntry {
  route: string
  displayName: string
  apiKeyEnv?: string
  api?: string
  baseURL: string
  key?: string
  models?: readonly FixedModel[]
}

/** One configuration document (local or remote). */
export interface ProviderDocument {
  remoteUrl?: string
  providers?: readonly ProviderEntry[]
}

/** The safe view served to the browser client (no secrets). */
export interface ManagedView {
  providers: readonly { route: string; displayName: string; modelsLocked: boolean }[]
}

const DEFAULT_API = 'openai-completions'
const REMOTE_FETCH_TIMEOUT_MS = 10_000

/**
 * Providers whose model catalog is fetched from the upstream `/models`
 * endpoint instead of the configured `models` list, keyed by route. Only the
 * free-zen gateway is listed: it publishes its free tier under ids ending in
 * `-free`, and that set changes upstream without notice. The configured
 * `models` list stays as the fallback for a failed or empty fetch.
 */
export const UPSTREAM_MODEL_CATALOG: Readonly<Record<string, { path: string; filter: RegExp }>> = {
  'free-zen': { path: '/models', filter: /-free$/ },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Conventional credential reference for a route (`llm-proxy` → `LLM_PROXY_API_KEY`). */
export function deriveKeyRef(route: string): string {
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

function fail(entry: ProviderEntry | undefined, index: number, message: string): never {
  throw new TypeError(`dsh-fixed-providers: provider entry ${index} (${entry?.route ?? '<no route>'}): ${message}`)
}

/** Normalize one raw entry into the enforced provider shape; throws on invalid input. */
export function normalizeEntry(entry: ProviderEntry, index: number): FixedProvider {
  const route = typeof entry?.route === 'string' ? entry.route.trim() : ''
  if (route.length === 0) fail(entry, index, 'route is required')
  if (/^[a-z][a-z0-9-]*$/.test(route) === false) fail(entry, index, 'route must be lowercase letters, digits and dashes, starting with a letter')
  const displayName = typeof entry?.displayName === 'string' ? entry.displayName.trim() : ''
  if (displayName.length === 0) fail(entry, index, 'displayName is required')
  const baseURL = typeof entry?.baseURL === 'string' ? entry.baseURL.trim() : ''
  if (baseURL.length === 0) fail(entry, index, 'baseURL is required')
  const api = typeof entry?.api === 'string' && entry.api.trim().length > 0 ? entry.api.trim() : DEFAULT_API
  const apiKeyEnv = typeof entry?.apiKeyEnv === 'string' && entry.apiKeyEnv.trim().length > 0 ? entry.apiKeyEnv.trim() : deriveKeyRef(route)
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv) === false) {
    fail(entry, index, `apiKeyEnv must match /^[A-Za-z_][A-Za-z0-9_]*$/ (got "${apiKeyEnv}")`)
  }
  const models = Array.isArray(entry?.models) ? entry.models : []
  for (const [modelIndex, model] of models.entries()) {
    const id = typeof model?.id === 'string' ? model.id.trim() : ''
    if (id.length === 0) fail(entry, index, `models[${modelIndex}].id is required`)
  }
  return {
    route,
    displayName,
    apiKeyEnv,
    api,
    baseURL,
    ...typeof entry?.key === 'string' && entry.key.length > 0 ? { key: entry.key } : {},
    defaultModels: models.map((model) => ({ ...model, id: model.id.trim() })),
    dynamicModels: UPSTREAM_MODEL_CATALOG[route] !== undefined,
  }
}

/** Parse and normalize one document's provider list. */
export function parseDocument(raw: unknown, source: string): ProviderDocument {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError(`dsh-fixed-providers: ${source} must be a JSON object with a "providers" array`)
  }
  const doc = raw as ProviderDocument
  if (doc.providers !== undefined && !Array.isArray(doc.providers)) {
    throw new TypeError(`dsh-fixed-providers: ${source} "providers" must be an array`)
  }
  return { ...doc, providers: doc.providers ?? [] }
}

/**
 * Merge two provider lists by route: remote entries first, then local entries,
 * with the local entry replacing the remote one on the same route.
 *
 * Remote entries are validated leniently — an invalid one is skipped and
 * reported through `onRemoteInvalid` so a bad remote document cannot take the
 * plugin down. Local entries are validated strictly (a config bug should be
 * loud). Duplicate routes within one document throw.
 */
export function mergeProviders(
  local: readonly ProviderEntry[],
  remote: readonly ProviderEntry[] = [],
  onRemoteInvalid: ((error: unknown) => void) | undefined = undefined,
): FixedProvider[] {
  const byRoute = new Map<string, ProviderEntry>()
  const index = (entries: readonly ProviderEntry[], lenient: boolean) => {
    // Duplicate detection is per document: a local entry may legitimately
    // override a remote one on the same route.
    const seen = new Set<string>()
    for (const [entryIndex, entry] of entries.entries()) {
      try {
        const normalized = normalizeEntry(entry, entryIndex)
        if (seen.has(normalized.route)) {
          throw new TypeError(`dsh-fixed-providers: duplicate route "${normalized.route}"`)
        }
        seen.add(normalized.route)
        byRoute.set(normalized.route, entry)
      } catch (error) {
        if (lenient) {
          onRemoteInvalid?.(error)
          continue
        }
        throw error
      }
    }
  }
  index(remote, true)
  index(local, false)
  return [...byRoute.values()].map((entry, index) => normalizeEntry(entry, index))
}

/** Read one JSON document from disk. */
async function readDocumentFile(path: string, source: string): Promise<ProviderDocument> {
  const text = await readFile(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new TypeError(`dsh-fixed-providers: ${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseDocument(parsed, source)
}

/** Fetch one remote JSON document; resolves undefined on any failure. */
async function fetchRemoteDocument(url: string, logger: { warn: (...args: unknown[]) => void }): Promise<ProviderDocument | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS) })
    if (!response.ok) {
      logger.warn(`dsh-fixed-providers: remote provider document ${url} answered ${String(response.status)}; using the local document only`)
      return undefined
    }
    const parsed: unknown = await response.json()
    return parseDocument(parsed, url)
  } catch (error) {
    logger.warn(`dsh-fixed-providers: could not fetch remote provider document ${url}; using the local document only`)
    logger.warn(error)
    return undefined
  }
}

/** Join a provider base URL and an endpoint path without doubling the slash. */
function modelsEndpoint(baseURL: string, path: string): string {
  const base = baseURL.replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

/** Extract the model ids from an OpenAI-compatible `/models` payload. */
function extractModelIds(payload: unknown): string[] {
  const list = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload['data'])
      ? payload['data']
      : isRecord(payload) && Array.isArray(payload['models'])
        ? payload['models']
        : undefined
  if (list === undefined) return []
  const ids: string[] = []
  for (const item of list) {
    const id = typeof item === 'string'
      ? item
      : isRecord(item) && typeof item['id'] === 'string'
        ? item['id']
        : undefined
    if (id !== undefined && id.trim().length > 0) ids.push(id.trim())
  }
  return [...new Set(ids)]
}

/**
 * Fetch and filter one provider's model catalog from its upstream `/models`
 * endpoint; resolves undefined on any failure so the caller keeps the
 * configured `models` as the fallback.
 */
async function fetchUpstreamModels(
  provider: FixedProvider,
  rule: { path: string; filter: RegExp },
  logger: { warn: (...args: unknown[]) => void },
): Promise<FixedModel[] | undefined> {
  const url = modelsEndpoint(provider.baseURL, rule.path)
  const key = provider.key ?? process.env[provider.apiKeyEnv]
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        ...key !== undefined && key.length > 0 ? { authorization: `Bearer ${key}` } : {},
      },
      signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) {
      logger.warn(`dsh-fixed-providers: upstream model catalog ${url} answered ${String(response.status)}; keeping the configured models`)
      return undefined
    }
    const ids = extractModelIds(await response.json()).filter((id) => rule.filter.test(id))
    if (ids.length === 0) {
      logger.warn(`dsh-fixed-providers: upstream model catalog ${url} matched no model for ${String(rule.filter)}; keeping the configured models`)
      return undefined
    }
    return ids.map((id) => ({ id }))
  } catch (error) {
    logger.warn(`dsh-fixed-providers: could not fetch the upstream model catalog ${url}; keeping the configured models`)
    logger.warn(error)
    return undefined
  }
}

/**
 * Replace the model catalog of every upstream-sourced provider with the live
 * list from its `/models` endpoint. A provider whose fetch fails — or whose
 * filter matches nothing — keeps its configured `models` list.
 */
export async function resolveDynamicModels(
  providers: readonly FixedProvider[],
  logger: { warn: (...args: unknown[]) => void },
): Promise<FixedProvider[]> {
  return Promise.all(providers.map(async (provider) => {
    const rule = UPSTREAM_MODEL_CATALOG[provider.route]
    if (rule === undefined) return provider
    const models = await fetchUpstreamModels(provider, rule, logger)
    return models === undefined ? provider : { ...provider, defaultModels: models }
  }))
}

export interface LoadConfigOptions {
  /** The harness home directory; defaults to `resolveDshHome()`. */
  dshHome?: string
  /** The plugin package root holding the shipped `providers.json`; defaults to the package directory. */
  packageDir?: string
  /** Configuration filename inside `dshHome`; defaults to `dsh-fixed-providers.json`. */
  configName?: string
}

export interface LoadedConfig {
  providers: readonly FixedProvider[]
  /** The remote URL the config asked for (served to the client for diagnostics). */
  remoteUrl?: string
}

/**
 * Load and merge the managed provider configuration: the local document
 * (`<dshHome>/<configName>`, falling back to `<packageDir>/providers.json`)
 * plus the remote document it names. Failures fall back in order: an invalid
 * or absent local override uses the shipped defaults; an unreachable remote
 * keeps the local result. A completely empty merged set resolves to an empty
 * list (the plugin then stays dormant).
 */
export async function loadConfig(
  opts: LoadConfigOptions = {},
  logger: { warn: (...args: unknown[]) => void } = { warn: () => undefined },
): Promise<LoadedConfig> {
  const dshHome = opts.dshHome ?? resolveDshHome(undefined, process.env)
  const packageDir = opts.packageDir ?? fileURLToPath(new URL('..', import.meta.url))
  const configName = opts.configName ?? 'dsh-fixed-providers.json'

  // Local document: the user override wins; the shipped default is the fallback.
  const userPath = join(dshHome, configName)
  const shippedPath = join(packageDir, 'providers.json')
  let localDoc: ProviderDocument
  let localSource = userPath
  try {
    localDoc = await readDocumentFile(userPath, userPath)
  } catch (error) {
    try {
      localDoc = await readDocumentFile(shippedPath, shippedPath)
      localSource = shippedPath
    } catch (shippedError) {
      logger.warn(`dsh-fixed-providers: no usable local provider document (${userPath} and ${shippedPath})`)
      logger.warn(error)
      logger.warn(shippedError)
      return { providers: [] }
    }
  }

  const remoteUrl = typeof localDoc.remoteUrl === 'string' && localDoc.remoteUrl.trim().length > 0 ? localDoc.remoteUrl.trim() : undefined
  const remoteDoc = remoteUrl !== undefined ? await fetchRemoteDocument(remoteUrl, logger) : undefined

  const merged = mergeProviders(localDoc.providers ?? [], remoteDoc?.providers ?? [], (error) => {
    logger.warn('dsh-fixed-providers: skipped an invalid provider entry from the remote document')
    logger.warn(error)
  })

  return {
    providers: await resolveDynamicModels(merged, logger),
    ...localSource === userPath ? { remoteUrl } : {},
  }
}

/** The client-safe view of the managed providers (routes + display names only). */
export function managedView(providers: readonly FixedProvider[]): ManagedView {
  return {
    providers: providers.map((provider) => ({
      route: provider.route,
      displayName: provider.displayName,
      modelsLocked: provider.dynamicModels,
    })),
  }
}
