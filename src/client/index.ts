/**
 * @smanx/dsh-fixed-providers client entry: the browser half that locks the
 * managed providers' URL/key fields in the Models settings page.
 *
 * The managed set is dynamic (local JSON + remote JSON merged host-side), so
 * this half fetches the client-safe list the host serves at
 * `/dsh-fixed-providers/managed.json`
 * ({ providers: [{route, displayName, modelsLocked}] }) and locks every row
 * card whose display name is on that list. The server-side guard
 * (src/index.ts) enforces the same boundary authoritatively; this half makes
 * it visible and un-editable in the UI.
 */

import { scanLocked, type LockTarget } from './lock.ts'

export const name = '@smanx/dsh-fixed-providers'

/** No framework service is needed; the client talks to the DOM and one endpoint. */
export const inject: readonly string[] = []

/** Host-served, client-safe list of the managed providers (no secrets). */
const MANAGED_ENDPOINT = '/dsh-fixed-providers/managed.json'

/** Retry cadence while the endpoint is unavailable (host still booting). */
const REFRESH_RETRY_MS = 5000

/** CSS injected once: locked fields look disabled and get a "no" cursor. */
const LOCK_CSS = `
[data-fixed-provider-locked] {
  cursor: not-allowed;
  opacity: 0.78;
}
[data-fixed-provider-locked]:disabled {
  cursor: not-allowed;
}
`

let started = false
let targets: readonly LockTarget[] = []
let targetsReady = false
let observer: MutationObserver | undefined
let fallbackTimer: ReturnType<typeof setInterval> | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined
let styleTag: HTMLStyleElement | undefined

function scan(): void {
  if (typeof document === 'undefined') return
  if (!targetsReady) return
  scanLocked(document.body, targets)
}

/** Fetch the managed provider list from the host (same origin, no CORS). */
async function refreshTargets(): Promise<void> {
  try {
    const response = await fetch(MANAGED_ENDPOINT)
    if (!response.ok) throw new Error(`host answered ${String(response.status)}`)
    const data: unknown = await response.json()
    const providers = typeof data === 'object' && data !== null ? (data as { providers?: unknown }).providers : undefined
    if (!Array.isArray(providers)) throw new Error('malformed managed list')
    const next = providers
      .filter((entry): entry is { route: unknown; displayName: unknown; modelsLocked?: unknown } =>
        typeof entry === 'object' && entry !== null &&
        typeof (entry as { route?: unknown }).route === 'string' &&
        typeof (entry as { displayName?: unknown }).displayName === 'string')
      .map((entry) => ({
        route: entry.route as string,
        displayName: entry.displayName as string,
        modelsLocked: entry.modelsLocked === true,
      }))
    targets = next
    targetsReady = true
    if (refreshTimer !== undefined) clearInterval(refreshTimer)
    scan()
  } catch (error) {
    console.warn('[@smanx/dsh-fixed-providers] could not fetch the managed provider list', error)
    if (refreshTimer === undefined) refreshTimer = setInterval(() => void refreshTargets(), REFRESH_RETRY_MS)
  }
}

export function apply(): () => void {
  if (started) return () => undefined
  started = true
  if (typeof document !== 'undefined' && styleTag === undefined) {
    styleTag = document.createElement('style')
    styleTag.dataset.plugin = name
    styleTag.textContent = LOCK_CSS
    document.head.appendChild(styleTag)
  }
  scan()
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    observer = new MutationObserver(() => scan())
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    })
  }
  // Belt and suspenders: React may swap nodes without a matching mutation
  // that re-triggers the lock, so re-scan slowly regardless.
  fallbackTimer = setInterval(() => scan(), 2000)
  void refreshTargets()
  return () => {
    observer?.disconnect()
    observer = undefined
    if (fallbackTimer !== undefined) clearInterval(fallbackTimer)
    fallbackTimer = undefined
    if (refreshTimer !== undefined) clearInterval(refreshTimer)
    refreshTimer = undefined
    styleTag?.remove()
    styleTag = undefined
    started = false
    targetsReady = false
    targets = []
  }
}
