window.__ModuleLoader__.load({ id: '@smanx/dsh-fixed-providers', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/lock.ts
var LOCKED_ARIA_LABELS = [
  "API key",
  "API \u5BC6\u94A5",
  "Base URL",
  "API \u5730\u5740",
  "Display name",
  "\u663E\u793A\u540D\u79F0",
  "API protocol",
  "API \u534F\u8BAE"
];
var MODEL_FIELD_ARIA_PREFIXES = [
  "Model ID ",
  "\u6A21\u578B ID ",
  "Display name ",
  "\u663E\u793A\u540D\u79F0 ",
  "Capacities ",
  "\u5BB9\u91CF ",
  "Context window ",
  "\u4E0A\u4E0B\u6587\u7A97\u53E3 ",
  "Max output tokens ",
  "\u6700\u5927\u8F93\u51FA token \u6570 ",
  "Delete model ",
  "\u5220\u9664\u6A21\u578B "
];
var MODEL_ACTION_LABELS = [
  "Add model",
  "\u6DFB\u52A0\u6A21\u578B",
  "Fetch available models",
  "\u83B7\u53D6\u53EF\u7528\u6A21\u578B",
  "Restore defaults",
  "\u6062\u590D\u9ED8\u8BA4\u6A21\u578B"
];
var DELETE_LABELS = ["Delete", "\u5220\u9664"];
var CUSTOM_TAG_LABELS = ["Custom", "\u81EA\u5B9A\u4E49"];
var LOCK_HINT = "\u7531\u63D2\u4EF6\u6258\u7BA1\uFF0C\u4E0D\u53EF\u7F16\u8F91 / Managed by the plugin, read-only";
function findManagedTarget(root, targets2) {
  const spans = root.querySelectorAll("span");
  for (const span of spans) {
    const text = span.textContent?.trim();
    if (text === void 0 || text.length === 0) continue;
    const hit = targets2.find((target) => target.displayName === text);
    if (hit !== void 0) return hit;
  }
  return void 0;
}
function lockRow(root, modelsLocked = false) {
  const locked = new Set(LOCKED_ARIA_LABELS);
  for (const field of root.querySelectorAll("input, select, button")) {
    const label = field.getAttribute("aria-label");
    if (label === null) continue;
    const isModelField = modelsLocked && MODEL_FIELD_ARIA_PREFIXES.some((prefix) => label.startsWith(prefix));
    if (!locked.has(label) && !isModelField) continue;
    if (!field.disabled) field.disabled = true;
    field.dataset.fixedProviderLocked = "true";
    field.title = LOCK_HINT;
  }
}
function hideRowChrome(root, modelsLocked = false) {
  for (const button of root.querySelectorAll("button")) {
    const text = button.textContent?.trim() ?? "";
    if (DELETE_LABELS.includes(text)) button.style.display = "none";
    if (modelsLocked && MODEL_ACTION_LABELS.includes(text)) button.style.display = "none";
  }
  for (const span of root.querySelectorAll("span")) {
    const text = span.textContent?.trim() ?? "";
    if (CUSTOM_TAG_LABELS.includes(text)) span.style.display = "none";
  }
}
function scanLocked(root, targets2) {
  for (const row of root.querySelectorAll("li")) {
    const target = findManagedTarget(row, targets2);
    if (target === void 0) continue;
    lockRow(row, target.modelsLocked);
    hideRowChrome(row, target.modelsLocked);
  }
}

// src/client/index.ts
var name = "@smanx/dsh-fixed-providers";
var inject = [];
var MANAGED_ENDPOINT = "/dsh-fixed-providers/managed.json";
var REFRESH_RETRY_MS = 5e3;
var LOCK_CSS = `
[data-fixed-provider-locked] {
  cursor: not-allowed;
  opacity: 0.78;
}
[data-fixed-provider-locked]:disabled {
  cursor: not-allowed;
}
`;
var started = false;
var targets = [];
var targetsReady = false;
var observer;
var fallbackTimer;
var refreshTimer;
var styleTag;
function scan() {
  if (typeof document === "undefined") return;
  if (!targetsReady) return;
  scanLocked(document.body, targets);
}
async function refreshTargets() {
  try {
    const response = await fetch(MANAGED_ENDPOINT);
    if (!response.ok) throw new Error(`host answered ${String(response.status)}`);
    const data = await response.json();
    const providers = typeof data === "object" && data !== null ? data.providers : void 0;
    if (!Array.isArray(providers)) throw new Error("malformed managed list");
    const next = providers.filter((entry) => typeof entry === "object" && entry !== null && typeof entry.route === "string" && typeof entry.displayName === "string").map((entry) => ({
      route: entry.route,
      displayName: entry.displayName,
      modelsLocked: entry.modelsLocked === true
    }));
    targets = next;
    targetsReady = true;
    if (refreshTimer !== void 0) clearInterval(refreshTimer);
    scan();
  } catch (error) {
    console.warn("[@smanx/dsh-fixed-providers] could not fetch the managed provider list", error);
    if (refreshTimer === void 0) refreshTimer = setInterval(() => void refreshTargets(), REFRESH_RETRY_MS);
  }
}
function apply() {
  if (started) return () => void 0;
  started = true;
  if (typeof document !== "undefined" && styleTag === void 0) {
    styleTag = document.createElement("style");
    styleTag.dataset.plugin = name;
    styleTag.textContent = LOCK_CSS;
    document.head.appendChild(styleTag);
  }
  scan();
  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    observer = new MutationObserver(() => scan());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"]
    });
  }
  fallbackTimer = setInterval(() => scan(), 2e3);
  void refreshTargets();
  return () => {
    observer?.disconnect();
    observer = void 0;
    if (fallbackTimer !== void 0) clearInterval(fallbackTimer);
    fallbackTimer = void 0;
    if (refreshTimer !== void 0) clearInterval(refreshTimer);
    refreshTimer = void 0;
    styleTag?.remove();
    styleTag = void 0;
    started = false;
    targetsReady = false;
    targets = [];
  };
}
return module.exports; } });
//# sourceMappingURL=client.js.map
