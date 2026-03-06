import { type Disposable, Emitter, type Host, Root, type RootOptions } from 'aspen-core'
import { Stash } from './stash'

type ModelEvents = {
	didChange: []
	didChangeScrollOffset: [offset: number]
	didRestoreScrollOffset: [offset: number]
}

/**
 * What a tree view binds to: the `Root`, the scroll offset, and a `Stash`.
 *
 * Subclass it to attach add-ons next to the root:
 *
 * ```ts
 * class MyModel extends TreeModel {
 *   readonly decorations = new DecorationsManager(this.root)
 * }
 * ```
 */
export class TreeModel implements Disposable {
	readonly root: Root
	readonly stash: Stash

	readonly #events = new Emitter<ModelEvents>()
	readonly #subscription: Disposable
	#scrollOffset: number = 0

	constructor(host: Host, options?: RootOptions) {
		this.root = new Root(host, options)
		this.stash = new Stash(this.root)
		this.#subscription = this.root.onDidUpdate(() => this.#events.emit('didChange'))
	}

	/** Where the view is scrolled to, in pixels. */
	get scrollOffset(): number {
		return this.#scrollOffset
	}

	/** Fires whenever the visible rows change, so a view knows when to render again. */
	onChange(listener: () => void): Disposable {
		return this.#events.on('didChange', listener)
	}

	/** For the view to call as the user scrolls. */
	saveScrollOffset(offset: number): void {
		this.#scrollOffset = offset
		this.#events.emit('didChangeScrollOffset', offset)
	}

	/** For add-ons that restore a saved position. The view scrolls there when it hears about it. */
	restoreScrollOffset(offset: number): void {
		if (typeof offset !== 'number' || !(offset > -1)) {
			return
		}
		this.#scrollOffset = offset
		this.#events.emit('didRestoreScrollOffset', offset)
	}

	/** The user scrolled. Does not fire when a position is restored, see `onDidRestoreScrollOffset`. */
	onDidChangeScrollOffset(listener: (offset: number) => void): Disposable {
		return this.#events.on('didChangeScrollOffset', listener)
	}

	onDidRestoreScrollOffset(listener: (offset: number) => void): Disposable {
		return this.#events.on('didRestoreScrollOffset', listener)
	}

	/** Disposes of the whole tree and everything watching it. */
	dispose(): void {
		this.#subscription.dispose()
		this.stash.dispose()
		this.root.dispose()
		this.#events.clear()
	}
}
