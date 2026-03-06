/**
 * Like `Array.prototype.splice`, but for a `Uint32Array`: returns a new array rather than mutating,
 * and never throws a `RangeError` for large `items` since nothing is spread.
 *
 * Returning a fresh array on every change also means the identity of the flat list doubles as its
 * version, which a view can compare cheaply.
 */
export function spliceIds(
	source: Uint32Array,
	start: number,
	deleteCount = 0,
	items?: Uint32Array,
): Uint32Array {
	const insertCount = items ? items.length : 0
	const out = new Uint32Array(source.length - deleteCount + insertCount)
	out.set(source.subarray(0, start))
	if (items) {
		out.set(items, start)
	}
	out.set(source.subarray(start + deleteCount), start + insertCount)
	return out
}
