// Module-local so the package needs neither the DOM lib nor `@types/node`.
declare const console: { error(...data: unknown[]): void }

/** The last resort for failures that have nobody to throw to. */
export function logError(error: unknown): void {
	console.error('[aspen]', error)
}
