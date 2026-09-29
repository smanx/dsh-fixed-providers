/**
 * Browser-side locking of the managed providers' fields in the Models
 * settings page (pure DOM — no framework imports, unit-testable in jsdom).
 *
 * The stock Models editor renders every pi-ai provider with editable URL/key
 * inputs; this module finds the row card of each managed provider (matched by
 * display name) and disables every field except the model list:
 *   - the API key input
 *   - the base URL input
 *   - the display-name input and API-protocol select (declared routes)
 * It also hides the delete button and the "Custom" tag for those rows.
 *
 * A provider whose catalog is upstream-sourced (`modelsLocked`) also has its
 * model fields locked and its catalog actions hidden — the host re-asserts
 * that list, so manual edits would not survive.
 *
 * React re-renders can reset `disabled`, so callers re-scan on DOM changes
 * (the entry point observes mutations and re-applies idempotently).
 */

export interface LockTarget {
  displayName: string
  route: string
  /** True when the provider's model catalog is managed too (upstream-sourced). */
  modelsLocked: boolean
}

/** aria-labels of the fields that must not be user-editable (en + zh). */
export const LOCKED_ARIA_LABELS: readonly string[] = [
  'API key',
  'API 密钥',
  'Base URL',
  'API 地址',
  'Display name',
  '显示名称',
  'API protocol',
  'API 协议',
]

/**
 * aria-label prefixes of the model-catalog fields locked when the catalog is
 * managed (en + zh). The stock editor indexes every label with its row number
 * ("Model ID 1"), so a prefix match is required; the trailing space keeps the
 * provider-level "Display name" out of this set.
 */
export const MODEL_FIELD_ARIA_PREFIXES: readonly string[] = [
  'Model ID ',
  '模型 ID ',
  'Display name ',
  '显示名称 ',
  'Capacities ',
  '容量 ',
  'Context window ',
  '上下文窗口 ',
  'Max output tokens ',
  '最大输出 token 数 ',
  'Delete model ',
  '删除模型 ',
]

/** Model-catalog action buttons hidden when the catalog is managed (en + zh). */
export const MODEL_ACTION_LABELS: readonly string[] = [
  'Add model',
  '添加模型',
  'Fetch available models',
  '获取可用模型',
  'Restore defaults',
  '恢复默认模型',
]

/** Button labels of the destructive row action we hide for managed rows. */
export const DELETE_LABELS: readonly string[] = ['Delete', '删除']

/** Row tag labels we hide for managed rows ("Custom"). */
export const CUSTOM_TAG_LABELS: readonly string[] = ['Custom', '自定义']

/** Tooltip shown on a locked field. */
export const LOCK_HINT = '由插件托管，不可编辑 / Managed by the plugin, read-only'

/** The managed target whose display name labels this row card, if any. */
export function findManagedTarget(root: Element, targets: readonly LockTarget[]): LockTarget | undefined {
  const spans = root.querySelectorAll('span')
  for (const span of spans) {
    const text = span.textContent?.trim()
    if (text === undefined || text.length === 0) continue
    const hit = targets.find((target) => target.displayName === text)
    if (hit !== undefined) return hit
  }
  return undefined
}

export function isManagedRow(root: Element, targets: readonly LockTarget[]): boolean {
  return findManagedTarget(root, targets) !== undefined
}

/**
 * Disable every locked field inside one managed row card (idempotent). Model
 * fields join the locked set only when `modelsLocked` is set.
 */
export function lockRow(root: Element, modelsLocked = false): void {
  const locked = new Set(LOCKED_ARIA_LABELS)
  for (const field of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')) {
    const label = field.getAttribute('aria-label')
    if (label === null) continue
    const isModelField = modelsLocked && MODEL_FIELD_ARIA_PREFIXES.some((prefix) => label.startsWith(prefix))
    if (!locked.has(label) && !isModelField) continue
    // Only write when the value changes: an identical write still fires an
    // attribute mutation in some DOM implementations, which would re-trigger
    // the observer and loop.
    if (!field.disabled) field.disabled = true
    field.dataset.fixedProviderLocked = 'true'
    field.title = LOCK_HINT
  }
}

/** Hide the destructive row action and the "Custom" tag of managed rows. */
export function hideRowChrome(root: Element, modelsLocked = false): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
    const text = button.textContent?.trim() ?? ''
    if (DELETE_LABELS.includes(text)) button.style.display = 'none'
    if (modelsLocked && MODEL_ACTION_LABELS.includes(text)) button.style.display = 'none'
  }
  for (const span of root.querySelectorAll<HTMLSpanElement>('span')) {
    const text = span.textContent?.trim() ?? ''
    if (CUSTOM_TAG_LABELS.includes(text)) span.style.display = 'none'
  }
}

/**
 * Scan the document for managed provider row cards and lock them.
 * Safe to call repeatedly; every operation is idempotent.
 */
export function scanLocked(root: ParentNode, targets: readonly LockTarget[]): void {
  for (const row of root.querySelectorAll('li')) {
    const target = findManagedTarget(row, targets)
    if (target === undefined) continue
    lockRow(row, target.modelsLocked)
    hideRowChrome(row, target.modelsLocked)
  }
}
