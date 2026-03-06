import type { Branch, Kind } from 'aspen-core'
import { PromptHandle } from './prompt-handle'

let nextId = 1

/** A prompt for an item that does not exist yet, shown inside `parent`. */
export class NewItemPromptHandle extends PromptHandle {
	readonly #id: string = `new-item-prompt:${nextId++}`

	constructor(
		/** Whether the prompt is for a new leaf or a new branch. */
		readonly kind: Kind,
		readonly parent: Branch,
	) {
		super()
	}

	get id(): string {
		return this.#id
	}

	get depth(): number {
		return this.parent.depth + 1
	}
}
