/**
 * The two built-in, plugin-managed providers.
 *
 * Everything here is owned by this plugin and must not be changed by the
 * user: `displayName`, `apiKeyEnv`, `api` and `baseURL` are re-asserted on
 * every settings change (see src/guard.ts), and the credential value in
 * `key` is restored whenever it is overwritten or removed. Only the `models`
 * list of each provider is user-editable.
 *
 * `defaultModels` is used when a managed profile is (re)created; an existing
 * profile keeps whatever models the user chose.
 */
export interface FixedModel {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    input?: readonly string[];
}
export interface FixedProvider {
    /** Provider route id inside the `llm-pi-ai` settings namespace. */
    route: string;
    /** Shown in the Models page provider list. */
    displayName: string;
    /** Credential reference the fixed API key is stored under. */
    apiKeyEnv: string;
    /** Wire protocol accepted by the pi-ai adapter. */
    api: string;
    /** The fixed endpoint. */
    baseURL: string;
    /** The fixed API key value (stored through the credentials seam). */
    key: string;
    /** Models written when the managed profile is first created. */
    defaultModels: readonly FixedModel[];
}
export declare const FIXED_PROVIDERS: readonly FixedProvider[];
/**
 * The settings profile fields this plugin re-asserts on every change.
 * Everything else in a managed profile — most importantly `models` — is left
 * to the user.
 */
export declare const PROTECTED_KEYS: readonly ["displayName", "apiKeyEnv", "api", "baseURL"];
/** Every credential reference the plugin manages (deduplicated). */
export declare function managedCredentialRefs(): readonly string[];
/** The fixed key for one managed credential reference. */
export declare function fixedKeyFor(ref: string): string | undefined;
