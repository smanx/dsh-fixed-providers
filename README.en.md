# @smanx/dsh-fixed-providers

> English | [中文](README.md)

A **managed-provider** plugin for DeepSeek Harness: after installation and a
web-server restart, the providers defined in JSON configuration appear in
Settings → Models. Their base URL and API key are **locked (read-only)**; only
each provider's **model list is user-editable** — except `free-zen`, whose
catalog the plugin fetches from upstream and locks (see
[Dynamic model catalog](#dynamic-model-catalog-free-zen)).

Providers are configured through **JSON documents** — nothing is hard-coded in
the plugin's source:

- On startup the plugin reads the **local JSON** (the shipped `providers.json`
  by default, overridable at `$DSH_HOME/dsh-fixed-providers.json`);
- it also fetches the **remote JSON** named by `remoteUrl` in the local file;
- it **merges the providers from both documents** (deduplicated by route, local
  wins), then seeds and locks them;
- for a dynamic provider such as `free-zen` it then fetches and filters the
  model catalog from the provider's upstream `/models` endpoint.

```
Plugin startup
  -> read local JSON ($DSH_HOME/dsh-fixed-providers.json, falling back to the shipped providers.json)
  -> fetch the remote JSON at remoteUrl (on failure, local-only)
  -> merge the providers of both documents (same route: local overrides remote)
  -> for free-zen fetch upstream /models and keep the -free ids (falling back to the configured models)
  -> seed the merged result into llm-pi-ai settings (URL / key / protocol fixed) and store the fixed keys
  -> re-assert the protected fields on every settings change (edits/deletions are reverted)
  -> free-zen's catalog is re-asserted too (manual edits are reverted)
  -> the host serves a client-safe list of the managed providers (no secrets); the client locks their rows
  -> the other providers' model lists stay editable
```

> The managed providers use **dedicated route ids**, so they **coexist without
> conflicts** with providers you configure yourself — all of them show in the
> list at once.

## Configuration files

### Locations (in priority order)

1. `$DSH_HOME/dsh-fixed-providers.json` — user override (recommended;
   `$DSH_HOME` defaults to `~/.dsh`)
2. `providers.json` inside the plugin package — the shipped defaults

### Shape

```json
{
  "remoteUrl": "https://example.com/providers.json",
  "providers": [
    {
      "route": "my-fixed-provider",
      "displayName": "My Fixed Provider",
      "apiKeyEnv": "MY_FIXED_PROVIDER_API_KEY",
      "api": "openai-completions",
      "baseURL": "https://api.example.com/v1",
      "key": "your-fixed-key",
      "models": [
        { "id": "my-model", "contextWindow": 1000000, "maxTokens": 200000 },
        { "id": "my-vision-model", "contextWindow": 256000, "maxTokens": 330000, "input": ["text", "image"] }
      ]
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `remoteUrl` | no | URL of the remote JSON; when set, it is fetched and merged at startup |
| `providers[].route` | yes | Route id: lowercase letter first, then lowercase letters/digits/dashes; unique within one document |
| `providers[].displayName` | yes | Name shown in the Models list (should be unique across all providers) |
| `providers[].baseURL` | yes | The API endpoint (a locked field) |
| `providers[].api` | no | Wire protocol; defaults to `openai-completions` |
| `providers[].apiKeyEnv` | no | Credential reference; defaults to the derived `<ROUTE>_API_KEY` |
| `providers[].key` | no | The fixed key value; when present the plugin stores/restores it, otherwise the environment provides it |
| `providers[].models` | no | Default model list (written only when the provider is first created; edit it in the UI afterwards). For `free-zen` it is only the fallback used when the upstream fetch fails |

### Merge rules

- Both documents provide a `providers` array; remote entries are collected
  first, then local entries **override by route** (local wins on conflicts).
- Invalid entries in the **local** document fail loudly (a config bug should
  be visible); invalid entries in the **remote** document are skipped with a
  warning and never take the plugin down.
- A failed remote fetch (network/timeout/non-200) only warns; the local result
  is used.

### Dynamic model catalog (free-zen)

`free-zen`'s `models` list is **not used verbatim** — it is the **fallback**.
At startup (and on every settings change, when the guard re-asserts) the plugin:

1. requests the upstream `{baseURL}/models` (`https://opencode.ai/zen/v1/models`)
   with `Authorization: Bearer <key>`;
2. reads every model id from the OpenAI-shaped `{ data: [{ id }] }`;
3. **keeps only the ids ending in `-free`** as the provider's catalog;
4. falls back to the configured `models` when the fetch fails
   (network/timeout/non-200) or the filter matches nothing.

That catalog is **fully managed**: the guard rewrites it back to the upstream
result on every settings change, and the UI locks the model inputs plus the
add/remove-model and "Fetch available models" / "Restore defaults" actions, so a
manual edit is never silently reverted.

> The rule currently applies to **`free-zen` only** (declared per route in
> `UPSTREAM_MODEL_CATALOG` in `src/config.ts`); every other provider's `models`
> stays under your control.

## How it works

The plugin registers no adapter of its own; it writes the managed providers
into the stock `llm-pi-ai` settings namespace, served by the pi-ai adapter:

- **Load** — merges the local and remote JSON documents at startup, then
  resolves each dynamic provider's catalog.
- **Seed** — ensures `llm-pi-ai.providers.<route>` exists with
  `displayName`, `apiKeyEnv`, `api` and `baseURL` equal to the configured
  values, and stores the fixed keys through the credentials seam.
- **Guard** — listens to `settings/document-updated` for the `llm-pi-ai`
  namespace, re-reads that namespace and re-asserts the protected fields after
  every change: editing the URL, changing the key reference, or deleting a
  whole provider is reverted right after the write. A static provider's
  `models` is never touched; a dynamic provider's (`free-zen`) `models` is
  re-asserted to the upstream result. It also listens to
  `credentials/reference-updated` and restores the fixed keys. The guard only
  touches the managed routes; providers you configured yourself are never
  affected.
- **Client lock** — the host serves the client-safe managed list at
  `/dsh-fixed-providers/managed.json` (routes, display names and a
  "models-locked" flag only, **no secrets**); the browser half disables the
  API-key / base-URL / display-name / API-protocol inputs of those rows and
  hides their delete button and "Custom" tag. For a dynamic provider it also
  disables the model inputs and hides the add/remove-model, fetch and
  restore-default actions.

Even if you edit `settings.yaml` or `credentials.yaml` directly, protected
fields are restored on the next settings change (or restart).

## Install

**Option A — online (git repository)**

```sh
dsh plugin --profile web add github:smanx/dsh-fixed-providers#master
```

**Option B — from the source checkout (local development)**

```sh
dsh plugin --profile web add file:C:/mydata/codes/dsh-fixed-providers
```

After installing, **restart the web server once** so the host plugin and the
client bundle join the boot manifest, then refresh the page.

> Requires `@deepseek-ai/dsh-llm-pi-ai` in the profile (shipped with
> `dsh-web-app`). In environments without `settings` / `credentials` seams
> (e.g. pure headless), the plugin stays dormant.

> Compatibility: built against the settings/credentials seam shipped with
> `@deepseek-ai/dsh@0.1.7-rc.2` — settings are read through
> `settings.describe()`, and changes arrive as `settings/document-updated` and
> `credentials/reference-updated`. Older harness builds exposing the removed
> `settings.get()` / `settings/updated` / `credentials/updated` API are not
> supported.

## Dependencies & boundaries

| Aspect | Impact |
| --- | --- |
| Token usage | None — no prompt or tool is injected. |
| Model calls | Go through the `llm-pi-ai` adapter, identical to configuring these providers by hand. |
| Session logs | Untouched. |
| Permissions | Writes only the managed routes of the `llm-pi-ai` settings section and the fixed credential refs; never touches providers you configured yourself or other settings such as `agent-default-model`. |
| Network | One GET to `remoteUrl` at startup (10s timeout), plus one GET to each dynamic provider's (`free-zen`) upstream `/models` (also 10s timeout); a failure does not affect the local configuration. |

## Development

```sh
pnpm install
pnpm run check    # typecheck + vitest + client-bundle e2e check + build (lib/ is committed)
pnpm run test     # vitest (config merge / guard enforcement / client DOM lock)
pnpm run test:bundle # e2e check of the built lib/client.js (ModuleLoader handshake + real DOM)
pnpm run build    # esbuild host + client bundles, tsc declarations
```

## Changing the configuration

Changing the **configuration does not require a rebuild**: edit
`$DSH_HOME/dsh-fixed-providers.json` (or the package's `providers.json`) and
restart the web server; the guard then updates the old values to the new
configuration (static providers keep their model lists; `free-zen` re-fetches
from upstream).

Changing **code** (defaults, paths, timeouts) requires `pnpm run build` and a
reinstall.

## Known limitations

- The client lock matches rows by display name in the DOM; if a future release
  restructures the Models page, the lock may need updating.
- The server guard is event-driven: two extremely fast consecutive writes
  (e.g. a script changing the URL twice in a row) converge to the fixed value
  after the last write — eventually consistent.
- Configuration is read **at startup**; changing a JSON file (local or remote)
  requires a server restart.
- `free-zen`'s catalog is fetched **once at startup**; upstream additions and
  removals only appear after a server restart. When upstream is unreachable or
  the filter matches nothing, the configured `models` fallback is used.
- `free-zen`'s model editor is locked in the UI and reverted server-side, so its
  models **cannot be edited by hand** — this is the intended fully-managed
  behavior.
- If several providers share one `apiKeyEnv`, the plugin enforces one of their
  `key` values (use the same key for shared references).
- The "Custom" tag is hidden, but the directory entry is still flagged as
  declared by pi-ai; this has no functional impact.

## License

MIT
