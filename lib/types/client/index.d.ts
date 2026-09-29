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
export declare const name = "@smanx/dsh-fixed-providers";
/** No framework service is needed; the client talks to the DOM and one endpoint. */
export declare const inject: readonly string[];
export declare function apply(): () => void;
