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
  providers: readonly { route: string; displayName: string }[]
}

const DEFAULT_API = 'openai-completions'
const REMOTE_FETCH_TIMEOUT_MS = 10_000

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

  return {
    providers: mergeProviders(localDoc.providers ?? [], remoteDoc?.providers ?? [], (error) => {
      logger.warn('dsh-fixed-providers: skipped an invalid provider entry from the remote document')
      logger.warn(error)
    }),
    ...localSource === userPath ? { remoteUrl } : {},
  }
}

/** The client-safe view of the managed providers (routes + display names only). */
export function managedView(providers: readonly FixedProvider[]): ManagedView {
  return {
    providers: providers.map((provider) => ({ route: provider.route, displayName: provider.displayName })),
  }
}
