import type { TreeNode } from 'aspen-core'
import { PromptHandle } from './prompt-handle'

/** A prompt that stands in for an existing item while it is being renamed. */
export class RenamePromptHandle extends PromptHandle {
	constructor(
		readonly originalLabel: string,
		readonly target: TreeNode,
	) {
		super()
		this.$.value = originalLabel
		this.setSelectionRange(0, originalLabel.lastIndexOf('.'))
	}

	/** The same as the target's, so the prompt takes the place of the item's row. */
	get id(): number {
		return this.target.id
	}

	get depth(): number {
		return this.target.depth
	}
}
