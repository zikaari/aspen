import { Directory, FileEntry } from '../'
import { PromptHandle } from './PromptHandle'

export class RenamePromptHandle extends PromptHandle {
	constructor(public readonly originalFileName: string, public readonly target: FileEntry | Directory) {
		super()
		this.$.value = originalFileName
		this.setSelectionRange(0, originalFileName.lastIndexOf('.'))
	}

	get id(): number {
		return this.target.id
	}

	get depth() {
		return this.target.depth
	}
}
