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
 * React re-renders can reset `disabled`, so callers re-scan on DOM changes
 * (the entry point observes mutations and re-applies idempotently).
 */

export interface LockTarget {
  displayName: string
  route: string
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

/** Button labels of the destructive row action we hide for managed rows. */
export const DELETE_LABELS: readonly string[] = ['Delete', '删除']

/** Row tag labels we hide for managed rows ("Custom"). */
export const CUSTOM_TAG_LABELS: readonly string[] = ['Custom', '自定义']

/** Tooltip shown on a locked field. */
export const LOCK_HINT = '由插件托管，不可编辑 / Managed by the plugin, read-only'

export function isManagedRow(root: Element, targets: readonly LockTarget[]): boolean {
  const spans = root.querySelectorAll('span')
  for (const span of spans) {
    const text = span.textContent?.trim()
    if (text === undefined || text.length === 0) continue
    if (targets.some((target) => target.displayName === text)) return true
  }
  return false
}

/** Disable every locked field inside one managed row card (idempotent). */
export function lockRow(root: Element): void {
  const locked = new Set(LOCKED_ARIA_LABELS)
  for (const field of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) {
    const label = field.getAttribute('aria-label')
    if (label === null || !locked.has(label)) continue
    // Only write when the value changes: an identical write still fires an
    // attribute mutation in some DOM implementations, which would re-trigger
    // the observer and loop.
    if (!field.disabled) field.disabled = true
    field.dataset.fixedProviderLocked = 'true'
    field.title = LOCK_HINT
  }
}

/** Hide the destructive row action and the "Custom" tag of managed rows. */
export function hideRowChrome(root: Element): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
    const text = button.textContent?.trim() ?? ''
    if (DELETE_LABELS.includes(text)) button.style.display = 'none'
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
    if (!isManagedRow(row, targets)) continue
    lockRow(row)
    hideRowChrome(row)
  }
}
