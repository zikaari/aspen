import type { Change } from './types'

// Bundlers replace `process.env.NODE_ENV`. Module-local so the package needs no `@types/node`.
declare const process: { readonly env: { readonly NODE_ENV?: string } } | undefined

/** Descriptor validation is only worth its cost while developing. */
export const DEV: boolean = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'

export function assertDescriptor(value: unknown): void {
	if (value === null || typeof value !== 'object') {
		throw new TypeError('A descriptor must be an object. See the docs for `Descriptor`')
	}
	const { key, label, kind, metadata } = value as Record<string, unknown>
	if (typeof key !== 'string' || key === '') {
		throw new TypeError("A descriptor needs a non-empty string 'key'")
	}
	if (kind !== 'branch' && kind !== 'leaf') {
		throw new TypeError("A descriptor's 'kind' must be either 'branch' or 'leaf'")
	}
	if (label !== undefined && typeof label !== 'string') {
		throw new TypeError("A descriptor's 'label' must be a string")
	}
	if (metadata !== undefined && (metadata === null || typeof metadata !== 'object')) {
		throw new TypeError("A descriptor's 'metadata' must be an object")
	}
}

const isRef = (value: unknown): boolean => {
	if (Array.isArray(value)) {
		return value.every((segment) => typeof segment === 'string')
	}
	return value !== null && typeof value === 'object' && 'kind' in value && 'id' in value
}

/** Malformed input is a programmer error and throws. Everything else a change can hit is a no-op. */
export function assertChange(change: unknown): asserts change is Change {
	if (change === null || typeof change !== 'object') {
		throw new TypeError('A change must be an object. See the docs for `Change`')
	}
	const value = change as Record<string, unknown>
	switch (value.type) {
		case 'added':
			if (!isRef(value.parent)) {
				throw new TypeError("An 'added' change needs a 'parent' (a branch or a path)")
			}
			assertDescriptor(value.item)
			return
		case 'removed':
			if (!isRef(value.target)) {
				throw new TypeError("A 'removed' change needs a 'target' (a node or a path)")
			}
			return
		case 'moved':
			if (!isRef(value.target) || !isRef(value.to)) {
				throw new TypeError("A 'moved' change needs a 'target' and a 'to' (nodes or paths)")
			}
			if (value.key !== undefined && typeof value.key !== 'string') {
				throw new TypeError("A 'moved' change's 'key' must be a string")
			}
			if (value.item !== undefined) {
				assertDescriptor(value.item)
			}
			return
		case 'invalidated':
			if (!isRef(value.branch)) {
				throw new TypeError("An 'invalidated' change needs a 'branch' (a branch or a path)")
			}
			return
		default:
			throw new TypeError(`Unknown change type '${String(value.type)}'`)
	}
}
