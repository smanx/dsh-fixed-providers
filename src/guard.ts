/**
 * Pure enforcement logic for the managed providers: given the resolved
 * `llm-pi-ai` settings value, produce the minimal `settings.mutate` path ops
 * that restore every managed provider's protected fields. Kept free of any
 * cordis/settings import so it is unit-testable in isolation.
 */

import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'

import type { FixedProvider } from './config.ts'

/** One path-addressed edit, mirroring `SettingsPathOp` from dsh-settings. */
export type PathOp = SettingsPathOp

/** A profile subtree as stored in the user section of `llm-pi-ai`. */
export type ProviderProfiles = Record<string, unknown> | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The complete profile written when a managed route is (re)created. */
export function fixedProfile(fixed: FixedProvider): Record<string, unknown> {
  return {
    displayName: fixed.displayName,
    apiKeyEnv: fixed.apiKeyEnv,
    api: fixed.api,
    baseURL: fixed.baseURL,
    models: fixed.defaultModels.map((model) => ({ ...model })),
  }
}

/**
 * The settings profile fields this plugin re-asserts on every change.
 * Everything else in a managed profile — most importantly `models` for a
 * static provider — is left to the user.
 */
export const PROTECTED_KEYS = ['displayName', 'apiKeyEnv', 'api', 'baseURL'] as const

/** A key-order-insensitive rendering of a model list, for equality checks. */
function canonicalModels(value: unknown): string {
  if (!Array.isArray(value)) return JSON.stringify(value ?? null)
  return JSON.stringify(value.map((model) => {
    if (!isRecord(model)) return model
    const ordered: Record<string, unknown> = {}
    for (const key of Object.keys(model).sort()) ordered[key] = model[key]
    return ordered
  }))
}

/**
 * Compute the ops that make `providers` match the fixed state.
 *
 * - A missing managed route is recreated wholesale (with the default models).
 * - A present route's protected fields are re-asserted one by one.
 * - For an upstream-sourced provider (`dynamicModels`) the `models` list is
 *   re-asserted too, so the catalog keeps tracking the upstream endpoint.
 * - Everything else — a static provider's `models` list, extra profile fields
 *   — is never touched.
 *
 * @param providers - the resolved `providers` dict of `llm-pi-ai`.
 * @param fixed - the managed provider definitions to enforce.
 * @returns the ops to apply, empty when the state already matches.
 */
export function enforceOps(providers: ProviderProfiles, fixed: readonly FixedProvider[]): PathOp[] {
  const ops: PathOp[] = []
  for (const provider of fixed) {
    const profile = isRecord(providers) ? providers[provider.route] : undefined
    if (!isRecord(profile)) {
      ops.push({
        op: 'set',
        path: ['providers', provider.route],
        value: fixedProfile(provider),
      })
      continue
    }
    for (const key of PROTECTED_KEYS) {
      if (profile[key] !== provider[key]) {
        ops.push({
          op: 'set',
          path: ['providers', provider.route, key],
          value: provider[key],
        })
      }
    }
    if (provider.dynamicModels && canonicalModels(profile['models']) !== canonicalModels(provider.defaultModels)) {
      ops.push({
        op: 'set',
        path: ['providers', provider.route, 'models'],
        value: provider.defaultModels.map((model) => ({ ...model })),
      })
    }
  }
  return ops
}
