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
var DELETE_LABELS = ["Delete", "\u5220\u9664"];
var CUSTOM_TAG_LABELS = ["Custom", "\u81EA\u5B9A\u4E49"];
var LOCK_HINT = "\u7531\u63D2\u4EF6\u6258\u7BA1\uFF0C\u4E0D\u53EF\u7F16\u8F91 / Managed by the plugin, read-only";
function isManagedRow(root, targets2) {
  const spans = root.querySelectorAll("span");
  for (const span of spans) {
    const text = span.textContent?.trim();
    if (text === void 0 || text.length === 0) continue;
    if (targets2.some((target) => target.displayName === text)) return true;
  }
  return false;
}
function lockRow(root) {
  const locked = new Set(LOCKED_ARIA_LABELS);
  for (const field of root.querySelectorAll("input, select")) {
    const label = field.getAttribute("aria-label");
    if (label === null || !locked.has(label)) continue;
    if (!field.disabled) field.disabled = true;
    field.dataset.fixedProviderLocked = "true";
    field.title = LOCK_HINT;
  }
}
function hideRowChrome(root) {
  for (const button of root.querySelectorAll("button")) {
    const text = button.textContent?.trim() ?? "";
    if (DELETE_LABELS.includes(text)) button.style.display = "none";
  }
  for (const span of root.querySelectorAll("span")) {
    const text = span.textContent?.trim() ?? "";
    if (CUSTOM_TAG_LABELS.includes(text)) span.style.display = "none";
  }
}
function scanLocked(root, targets2) {
  for (const row of root.querySelectorAll("li")) {
    if (!isManagedRow(row, targets2)) continue;
    lockRow(row);
    hideRowChrome(row);
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
    const next = providers.filter((entry) => typeof entry === "object" && entry !== null && typeof entry.route === "string" && typeof entry.displayName === "string").map((entry) => ({ route: entry.route, displayName: entry.displayName }));
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
