# @smanx/dsh-fixed-providers

> English | [中文](README.md)

A **managed-provider** plugin for DeepSeek Harness: after installation and a
web-server restart, the providers defined in JSON configuration appear in
Settings → Models. Their base URL and API key are **locked (read-only)**; only
each provider's **model list is user-editable**.

Providers are configured through **JSON documents** — nothing is hard-coded in
the plugin's source:

- On startup the plugin reads the **local JSON** (the shipped `providers.json`
  by default, overridable at `$DSH_HOME/dsh-fixed-providers.json`);
- it also fetches the **remote JSON** named by `remoteUrl` in the local file;
- it **merges the providers from both documents** (deduplicated by route, local
  wins), then seeds and locks them.

```
Plugin startup
  -> read local JSON ($DSH_HOME/dsh-fixed-providers.json, falling back to the shipped providers.json)
  -> fetch the remote JSON at remoteUrl (on failure, local-only)
  -> merge the providers of both documents (same route: local overrides remote)
  -> seed the merged result into llm-pi-ai settings (URL / key / protocol fixed) and store the fixed keys
  -> re-assert the protected fields on every settings change (edits/deletions are reverted)
  -> the host serves a client-safe list of the managed providers (no secrets) and the client locks their rows
  -> only the model lists stay editable
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
| `providers[].models` | no | Default model list (written only when the provider is first created; edit it in the UI afterwards) |

### Merge rules

- Both documents provide a `providers` array; remote entries are collected
  first, then local entries **override by route** (local wins on conflicts).
- Invalid entries in the **local** document fail loudly (a config bug should
  be visible); invalid entries in the **remote** document are skipped with a
  warning and never take the plugin down.
- A failed remote fetch (network/timeout/non-200) only warns; the local result
  is used.

## How it works

The plugin registers no adapter of its own; it writes the managed providers
into the stock `llm-pi-ai` settings namespace, served by the pi-ai adapter:

- **Load** — merges the local and remote JSON documents at startup.
- **Seed** — ensures `llm-pi-ai.providers.<route>` exists with
  `displayName`, `apiKeyEnv`, `api` and `baseURL` equal to the configured
  values, and stores the fixed keys through the credentials seam.
- **Guard** — listens to `settings/updated` for the `llm-pi-ai` namespace and
  re-asserts the protected fields after every change: editing the URL, changing
  the key reference, or deleting a whole provider is reverted right after the
  write. `models` is never touched. It also listens to `credentials/updated`
  and restores the fixed keys. The guard only touches the managed routes;
  providers you configured yourself are never affected.
- **Client lock** — the host serves the client-safe managed list at
  `/dsh-fixed-providers/managed.json` (routes + display names only, **no
  secrets**); the browser half disables the API-key / base-URL /
  display-name / API-protocol inputs of those rows and hides their delete
  button and "Custom" tag. The model lists remain editable.

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

## Dependencies & boundaries

| Aspect | Impact |
| --- | --- |
| Token usage | None — no prompt or tool is injected. |
| Model calls | Go through the `llm-pi-ai` adapter, identical to configuring these providers by hand. |
| Session logs | Untouched. |
| Permissions | Writes only the managed routes of the `llm-pi-ai` settings section and the fixed credential refs; never touches providers you configured yourself or other settings such as `agent-default-model`. |
| Network | One GET to `remoteUrl` at startup (10s timeout); a failure does not affect the local configuration. |

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
configuration (model lists are preserved).

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
- If several providers share one `apiKeyEnv`, the plugin enforces one of their
  `key` values (use the same key for shared references).
- The "Custom" tag is hidden, but the directory entry is still flagged as
  declared by pi-ai; this has no functional impact.

## License

MIT
