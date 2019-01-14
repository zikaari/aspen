import { Directory, FileEntry, FileType } from '../'
import { PromptHandle } from './PromptHandle'

export class NewFilePromptHandle extends PromptHandle {
	private _id: number = FileEntry.nextId()
	constructor(public readonly type: FileType, public readonly parent: Directory) {
		super()
	}

	get id(): number {
		return this._id
	}

	get depth() {
		return this.parent.depth + 1
	}
}
