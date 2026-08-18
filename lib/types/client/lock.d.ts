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
    displayName: string;
    route: string;
}
/** aria-labels of the fields that must not be user-editable (en + zh). */
export declare const LOCKED_ARIA_LABELS: readonly string[];
/** Button labels of the destructive row action we hide for managed rows. */
export declare const DELETE_LABELS: readonly string[];
/** Row tag labels we hide for managed rows ("Custom"). */
export declare const CUSTOM_TAG_LABELS: readonly string[];
/** Tooltip shown on a locked field. */
export declare const LOCK_HINT = "\u7531\u63D2\u4EF6\u6258\u7BA1\uFF0C\u4E0D\u53EF\u7F16\u8F91 / Managed by the plugin, read-only";
export declare function isManagedRow(root: Element, targets: readonly LockTarget[]): boolean;
/** Disable every locked field inside one managed row card (idempotent). */
export declare function lockRow(root: Element): void;
/** Hide the destructive row action and the "Custom" tag of managed rows. */
export declare function hideRowChrome(root: Element): void;
/**
 * Scan the document for managed provider row cards and lock them.
 * Safe to call repeatedly; every operation is idempotent.
 */
export declare function scanLocked(root: ParentNode, targets: readonly LockTarget[]): void;
