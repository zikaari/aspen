import { logError } from './log'
import type { Disposable } from './types'

// biome-ignore lint/suspicious/noExplicitAny: listener signatures are enforced by the `Events` map
type Listener = (...args: any[]) => unknown

/** Disposes everything added to it, all at once. */
export class DisposableGroup implements Disposable {
	readonly #items = new Set<Disposable>()

	add<T extends Disposable>(item: T): T {
		this.#items.add(item)
		return item
	}

	dispose(): void {
		const items = [...this.#items]
		this.#items.clear()
		for (const item of items) {
			item.dispose()
		}
	}
}

/**
 * A small, typed event emitter.
 *
 * Listeners are snapshotted before every emit, so subscribing or unsubscribing from inside a
 * listener is safe. A throwing listener never prevents the others from running.
 */
export class Emitter<Events extends Record<string, unknown[]>> {
	readonly #listeners = new Map<keyof Events, Set<Listener>>()
	readonly #onError: (error: unknown) => void

	constructor(onError: (error: unknown) => void = logError) {
		this.#onError = onError
	}

	on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): Disposable {
		let listeners = this.#listeners.get(event)
		if (!listeners) {
			listeners = new Set()
			this.#listeners.set(event, listeners)
		}
		const set = listeners
		set.add(listener)
		return {
			dispose: () => {
				set.delete(listener)
			},
		}
	}

	once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): Disposable {
		const subscription = this.on(event, (...args: Events[K]) => {
			subscription.dispose()
			listener(...args)
		})
		return subscription
	}

	emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
		const listeners = this.#listeners.get(event)
		if (!listeners || listeners.size === 0) {
			return
		}
		for (const listener of [...listeners]) {
			try {
				listener(...args)
			} catch (error) {
				this.#onError(error)
			}
		}
	}

	/** Like `emit`, but gives back whatever the listeners returned (e.g. promises to wait for). */
	collect<K extends keyof Events, R = unknown>(event: K, ...args: Events[K]): R[] {
		const listeners = this.#listeners.get(event)
		if (!listeners || listeners.size === 0) {
			return []
		}
		const results: R[] = []
		for (const listener of [...listeners]) {
			try {
				results.push(listener(...args) as R)
			} catch (error) {
				this.#onError(error)
			}
		}
		return results
	}

	has(event: keyof Events): boolean {
		const listeners = this.#listeners.get(event)
		return listeners !== undefined && listeners.size > 0
	}

	clear(event?: keyof Events): void {
		if (event === undefined) {
			this.#listeners.clear()
		} else {
			this.#listeners.delete(event)
		}
	}
}
