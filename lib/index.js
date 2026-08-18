// src/index.ts
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";

// src/config.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
var DEFAULT_API = "openai-completions";
var REMOTE_FETCH_TIMEOUT_MS = 1e4;
function deriveKeyRef(route) {
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}
function fail(entry, index, message) {
  throw new TypeError(`dsh-fixed-providers: provider entry ${index} (${entry?.route ?? "<no route>"}): ${message}`);
}
function normalizeEntry(entry, index) {
  const route = typeof entry?.route === "string" ? entry.route.trim() : "";
  if (route.length === 0) fail(entry, index, "route is required");
  if (/^[a-z][a-z0-9-]*$/.test(route) === false) fail(entry, index, "route must be lowercase letters, digits and dashes, starting with a letter");
  const displayName = typeof entry?.displayName === "string" ? entry.displayName.trim() : "";
  if (displayName.length === 0) fail(entry, index, "displayName is required");
  const baseURL = typeof entry?.baseURL === "string" ? entry.baseURL.trim() : "";
  if (baseURL.length === 0) fail(entry, index, "baseURL is required");
  const api = typeof entry?.api === "string" && entry.api.trim().length > 0 ? entry.api.trim() : DEFAULT_API;
  const apiKeyEnv = typeof entry?.apiKeyEnv === "string" && entry.apiKeyEnv.trim().length > 0 ? entry.apiKeyEnv.trim() : deriveKeyRef(route);
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv) === false) {
    fail(entry, index, `apiKeyEnv must match /^[A-Za-z_][A-Za-z0-9_]*$/ (got "${apiKeyEnv}")`);
  }
  const models = Array.isArray(entry?.models) ? entry.models : [];
  for (const [modelIndex, model] of models.entries()) {
    const id = typeof model?.id === "string" ? model.id.trim() : "";
    if (id.length === 0) fail(entry, index, `models[${modelIndex}].id is required`);
  }
  return {
    route,
    displayName,
    apiKeyEnv,
    api,
    baseURL,
    ...typeof entry?.key === "string" && entry.key.length > 0 ? { key: entry.key } : {},
    defaultModels: models.map((model) => ({ ...model, id: model.id.trim() }))
  };
}
function parseDocument(raw, source) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError(`dsh-fixed-providers: ${source} must be a JSON object with a "providers" array`);
  }
  const doc = raw;
  if (doc.providers !== void 0 && !Array.isArray(doc.providers)) {
    throw new TypeError(`dsh-fixed-providers: ${source} "providers" must be an array`);
  }
  return { ...doc, providers: doc.providers ?? [] };
}
function mergeProviders(local, remote = [], onRemoteInvalid = void 0) {
  const byRoute = /* @__PURE__ */ new Map();
  const index = (entries, lenient) => {
    const seen = /* @__PURE__ */ new Set();
    for (const [entryIndex, entry] of entries.entries()) {
      try {
        const normalized = normalizeEntry(entry, entryIndex);
        if (seen.has(normalized.route)) {
          throw new TypeError(`dsh-fixed-providers: duplicate route "${normalized.route}"`);
        }
        seen.add(normalized.route);
        byRoute.set(normalized.route, entry);
      } catch (error) {
        if (lenient) {
          onRemoteInvalid?.(error);
          continue;
        }
        throw error;
      }
    }
  };
  index(remote, true);
  index(local, false);
  return [...byRoute.values()].map((entry, index2) => normalizeEntry(entry, index2));
}
async function readDocumentFile(path, source) {
  const text = await readFile(path, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`dsh-fixed-providers: ${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseDocument(parsed, source);
}
async function fetchRemoteDocument(url, logger) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      logger.warn(`dsh-fixed-providers: remote provider document ${url} answered ${String(response.status)}; using the local document only`);
      return void 0;
    }
    const parsed = await response.json();
    return parseDocument(parsed, url);
  } catch (error) {
    logger.warn(`dsh-fixed-providers: could not fetch remote provider document ${url}; using the local document only`);
    logger.warn(error);
    return void 0;
  }
}
async function loadConfig(opts = {}, logger = { warn: () => void 0 }) {
  const dshHome = opts.dshHome ?? resolveDshHome(void 0, process.env);
  const packageDir = opts.packageDir ?? fileURLToPath(new URL("..", import.meta.url));
  const configName = opts.configName ?? "dsh-fixed-providers.json";
  const userPath = join(dshHome, configName);
  const shippedPath = join(packageDir, "providers.json");
  let localDoc;
  let localSource = userPath;
  try {
    localDoc = await readDocumentFile(userPath, userPath);
  } catch (error) {
    try {
      localDoc = await readDocumentFile(shippedPath, shippedPath);
      localSource = shippedPath;
    } catch (shippedError) {
      logger.warn(`dsh-fixed-providers: no usable local provider document (${userPath} and ${shippedPath})`);
      logger.warn(error);
      logger.warn(shippedError);
      return { providers: [] };
    }
  }
  const remoteUrl = typeof localDoc.remoteUrl === "string" && localDoc.remoteUrl.trim().length > 0 ? localDoc.remoteUrl.trim() : void 0;
  const remoteDoc = remoteUrl !== void 0 ? await fetchRemoteDocument(remoteUrl, logger) : void 0;
  return {
    providers: mergeProviders(localDoc.providers ?? [], remoteDoc?.providers ?? [], (error) => {
      logger.warn("dsh-fixed-providers: skipped an invalid provider entry from the remote document");
      logger.warn(error);
    }),
    ...localSource === userPath ? { remoteUrl } : {}
  };
}
function managedView(providers) {
  return {
    providers: providers.map((provider) => ({ route: provider.route, displayName: provider.displayName }))
  };
}

// src/guard.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function fixedProfile(fixed) {
  return {
    displayName: fixed.displayName,
    apiKeyEnv: fixed.apiKeyEnv,
    api: fixed.api,
    baseURL: fixed.baseURL,
    models: fixed.defaultModels.map((model) => ({ ...model }))
  };
}
var PROTECTED_KEYS = ["displayName", "apiKeyEnv", "api", "baseURL"];
function enforceOps(providers, fixed) {
  const ops = [];
  for (const provider of fixed) {
    const profile = isRecord(providers) ? providers[provider.route] : void 0;
    if (!isRecord(profile)) {
      ops.push({
        op: "set",
        path: ["providers", provider.route],
        value: fixedProfile(provider)
      });
      continue;
    }
    for (const key of PROTECTED_KEYS) {
      if (profile[key] !== provider[key]) {
        ops.push({
          op: "set",
          path: ["providers", provider.route, key],
          value: provider[key]
        });
      }
    }
  }
  return ops;
}

// src/index.ts
var name = "@smanx/dsh-fixed-providers";
var inject = [];
var NS = settingsNamespace("llm-pi-ai");
var MANAGED_ENDPOINT = "/dsh-fixed-providers/managed.json";
var SEED_TRIES = 20;
var SEED_DELAY_MS = 100;
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function apply(ctx) {
  const config = await loadConfig({}, ctx.logger);
  const providers = config.providers;
  if (providers.length === 0) {
    ctx.logger.warn("@smanx/dsh-fixed-providers: no managed providers configured; staying dormant");
    return;
  }
  ctx.logger.info("@smanx/dsh-fixed-providers: managing %d provider(s): %s", providers.length, providers.map((p) => p.route).join(", "));
  const fixedKeys = /* @__PURE__ */ new Map();
  for (const provider of providers) {
    if (provider.key !== void 0) fixedKeys.set(provider.apiKeyEnv, provider.key);
  }
  const managedRefs = new Set([...fixedKeys.keys()].map((ref) => credentialRef(ref)));
  const view = managedView(providers);
  ctx.inject(["webServer"], (sctx) => {
    sctx.effect(() => sctx.webServer.register({
      kind: "exact",
      path: MANAGED_ENDPOINT,
      handler: (_req, res) => {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-cache"
        });
        res.end(JSON.stringify(view));
      }
    }), "@smanx/dsh-fixed-providers: managed list endpoint");
  });
  ctx.inject(["settings", "credentials"], (sctx) => {
    const settings = sctx.settings;
    const credentials = sctx.credentials;
    const restoreCredential = async (ref) => {
      const key = fixedKeys.get(String(ref));
      if (key === void 0) return;
      let hit;
      try {
        hit = await credentials.resolve(ref);
      } catch (error) {
        ctx.logger.warn(`@smanx/dsh-fixed-providers: could not read credential ${String(ref)}`);
        ctx.logger.warn(error);
        return;
      }
      if (hit !== void 0 && hit.value === key) return;
      try {
        await credentials.set(ref, key);
      } catch (error) {
        ctx.logger.warn(
          `@smanx/dsh-fixed-providers: could not restore the fixed value of ${String(ref)}; the launching environment may provide it read-only`
        );
        ctx.logger.warn(error);
      }
    };
    const enforceFrom = async (value) => {
      const providersValue = isRecord2(value) ? value["providers"] : void 0;
      const ops = enforceOps(isRecord2(providersValue) ? providersValue : void 0, providers);
      if (ops.length === 0) return;
      try {
        await settings.mutate(NS, ops);
      } catch (error) {
        ctx.logger.warn("@smanx/dsh-fixed-providers: failed to re-assert the managed providers");
        ctx.logger.warn(error);
      }
    };
    const seedCredentials = async () => {
      for (const ref of managedRefs) await restoreCredential(ref);
    };
    const seedSettings = async () => {
      for (let attempt = 0; attempt < SEED_TRIES; attempt += 1) {
        const current = settings.get(NS);
        if (current !== void 0) {
          await enforceFrom(current);
          return;
        }
        await delay(SEED_DELAY_MS);
      }
      ctx.logger.warn(
        "@smanx/dsh-fixed-providers: the llm-pi-ai settings namespace is not registered; the managed providers will be enforced on the next settings change"
      );
    };
    ctx.on("settings/updated", (ns, next) => {
      if (ns !== NS) return;
      void enforceFrom(next);
    });
    ctx.on("credentials/updated", (ref) => {
      if (!managedRefs.has(ref)) return;
      void restoreCredential(ref);
    });
    void seedCredentials();
    void seedSettings();
  });
}
export {
  MANAGED_ENDPOINT,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
