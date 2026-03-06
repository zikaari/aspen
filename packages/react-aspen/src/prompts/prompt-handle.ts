import { type Disposable, DisposableGroup, Emitter } from 'aspen-core'
import type { ReactElement } from 'react'
import { bindInputElement, type ProxiedInputProps } from './proxied-input'

// Bundlers replace `process.env.NODE_ENV`. Module-local so the package needs no `@types/node`.
declare const process: { readonly env: { readonly NODE_ENV?: string } } | undefined

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const isProduction = typeof process !== 'undefined' && process.env.NODE_ENV === 'production'

type PromptEvents = {
	change: [value: string]
	commit: [value: string]
	cancel: [value: string]
	focus: [value: string]
	blur: [value: string]
	destroy: []
}

/** A listener that returns `false` (or a promise of it) stops what would have happened next. */
export type PromptListener = (value: string) => unknown

/**
 * Prompts must be managed outside of React's rendering algorithm. In a virtualized list, typical
 * React inputs are destroyed once the user scrolls far enough, but the input's state (its value,
 * undo history...) must be preserved. So the `<input>` is a persistent element managed by hand, and
 * `ProxiedInput` swaps it in wherever the row is rendered.
 */
export abstract class PromptHandle {
	/** The persistent input element. */
	readonly $: HTMLInputElement
	/** Render this in your row, where the input should show up. */
	readonly ProxiedInput: (props: ProxiedInputProps) => ReactElement

	readonly #events = new Emitter<PromptEvents>()
	readonly #disposables = new DisposableGroup()
	#isInPendingCommitState = false
	#destroyed = false

	constructor() {
		this.$ = document.createElement('input')
		this.$.setAttribute('type', 'text')
		this.ProxiedInput = bindInputElement(this.$)
		this.$.addEventListener('click', this.#handleClick)
		this.$.addEventListener('keydown', this.#handleKeydown)
		this.$.addEventListener('keyup', this.#handleKeyup)
		this.$.addEventListener('focus', this.#handleFocus)
		this.$.addEventListener('blur', this.#handleBlur)

		if (!isProduction) {
			delay(2000).then(() => {
				if (!this.#destroyed && !this.$.isConnected) {
					console.error('PromptHandle created but never used. A potential memory leak vector.')
				}
			})
		}
	}

	/** Unique among rows, and what the row is keyed by. */
	abstract get id(): number | string

	abstract get depth(): number

	get destroyed(): boolean {
		return this.#destroyed
	}

	onChange(listener: PromptListener): Disposable {
		return this.#disposables.add(this.#events.on('change', listener))
	}

	/**
	 * Called right after the user hits Enter.
	 *
	 * The input is not processed in any way, so hosts must check it and look for any invalid
	 * characters. If everything is fine and the item was indeed created (or moved), tell the tree
	 * with `Root#apply`. Return `false` to keep the prompt open.
	 */
	onCommit(listener: PromptListener): Disposable {
		return this.#disposables.add(this.#events.on('commit', listener))
	}

	/** Called when the user hits Escape. Return `false` to keep the prompt open. */
	onCancel(listener: PromptListener): Disposable {
		return this.#disposables.add(this.#events.on('cancel', listener))
	}

	onFocus(listener: PromptListener): Disposable {
		return this.#disposables.add(this.#events.on('focus', listener))
	}

	/** Called when the input loses focus. Return `false` to keep the prompt open. */
	onBlur(listener: PromptListener): Disposable {
		return this.#disposables.add(this.#events.on('blur', listener))
	}

	onDestroy(listener: () => void): Disposable {
		return this.#disposables.add(this.#events.on('destroy', listener))
	}

	focus(): void {
		this.$.focus()
	}

	setSelectionRange(start: number, end: number): void {
		this.$.setSelectionRange(start, end)
	}

	addClassName(classname: string): void {
		this.$.classList.add(classname)
	}

	removeClassName(classname: string): void {
		this.$.classList.remove(classname)
	}

	destroy(): void {
		if (this.#destroyed) {
			return
		}
		this.#destroyed = true
		this.$.removeEventListener('click', this.#handleClick)
		this.$.removeEventListener('keydown', this.#handleKeydown)
		this.$.removeEventListener('keyup', this.#handleKeyup)
		this.$.removeEventListener('focus', this.#handleFocus)
		this.$.removeEventListener('blur', this.#handleBlur)
		this.$.disabled = false
		this.#events.emit('destroy')
		this.#disposables.dispose()

		if (!isProduction) {
			delay(1000).then(() => {
				if (this.$.isConnected) {
					console.error(
						'[INTERNAL] A PromptHandle associated HTMLInputElement, which is now obsolete, is still mounted in the DOM. PromptHandles are useless once destroyed.',
					)
				}
			})
		}
	}

	/** Whether any of the listeners said `false`. */
	async #vetoed(event: 'cancel' | 'commit' | 'blur'): Promise<boolean> {
		const results = await Promise.all(this.#events.collect(event, this.$.value))
		return results.some((result) => result === false)
	}

	readonly #handleClick = (event: Event): void => {
		event.stopPropagation()
	}

	readonly #handleKeyup = (): void => {
		this.#events.emit('change', this.$.value)
	}

	readonly #handleKeydown = async (event: KeyboardEvent): Promise<void> => {
		if (event.key === 'Escape') {
			if (await this.#vetoed('cancel')) {
				return
			}
			this.destroy()
		}

		if (event.key === 'Enter') {
			this.#isInPendingCommitState = true
			this.$.disabled = true
			if (await this.#vetoed('commit')) {
				this.#isInPendingCommitState = false
				this.$.disabled = false
				this.$.focus()
				return
			}
			this.#isInPendingCommitState = false
			this.$.disabled = false
			this.destroy()
		}
	}

	readonly #handleFocus = (): void => {
		this.#events.emit('focus', this.$.value)
	}

	readonly #handleBlur = async (): Promise<void> => {
		// Critical: if the input was unmounted because of the virtualization, `isConnected` is not
		// updated until after the next tick
		await delay(0)

		// If the input is not in the DOM but also not destroyed by hand, the virtualized list just
		// unmounted it because it is out of the viewport
		if (!this.$.isConnected && !this.#destroyed) {
			return
		}
		if (await this.#vetoed('blur')) {
			return
		}

		if (!this.#isInPendingCommitState) {
			this.destroy()
		}
	}
}
