import type { Branch } from './branch'
import type { TreeNode } from './node'
import type { Path } from './types'

const show = (path: Path): string => JSON.stringify(path)

/** `Root#resolve` could not find the node. */
export class NotFoundError extends Error {
	override readonly name: string = 'NotFoundError'
	readonly path: Path
	/** The deepest node that was reached. */
	readonly reached: TreeNode

	constructor(path: Path, reached: TreeNode) {
		super(`Nothing at ${show(path)}, stopped at ${show(reached.path)}`)
		this.path = path
		this.reached = reached
	}
}

/** A sibling with the same key already exists. */
export class KeyCollisionError extends Error {
	override readonly name: string = 'KeyCollisionError'
	readonly key: string
	/** The node that is in the way. Remove it first, then retry. */
	readonly occupant: TreeNode

	constructor(key: string, occupant: TreeNode) {
		super(`A sibling with key '${key}' already exists at ${show(occupant.path)}`)
		this.key = key
		this.occupant = occupant
	}
}

/** The same host-provided list contained a key more than once. */
export class DuplicateKeyError extends Error {
	override readonly name: string = 'DuplicateKeyError'
	readonly key: string
	readonly branch: Branch

	constructor(key: string, branch: Branch) {
		super(`Duplicate key '${key}' among the children of ${show(branch.path)}`)
		this.key = key
		this.branch = branch
	}
}

/** A branch cannot be moved into itself or one of its own descendants. */
export class CycleError extends Error {
	override readonly name: string = 'CycleError'
	readonly node: TreeNode
	readonly target: Branch

	constructor(node: TreeNode, target: Branch) {
		super(`Cannot move ${show(node.path)} into ${show(target.path)}, which is inside it`)
		this.node = node
		this.target = target
	}
}

/** The operation needs the branch's children, but they are not loaded. Await `ensureLoaded()` first. */
export class NotLoadedError extends Error {
	override readonly name: string = 'NotLoadedError'
	readonly branch: Branch

	constructor(branch: Branch) {
		super(`The children of ${show(branch.path)} are not loaded`)
		this.branch = branch
	}
}
