import type { Branch } from './branch'
import { CycleError, KeyCollisionError, NotLoadedError } from './errors'
import type { Root } from './root'
import type { Kind, Metadata, MetadataChange, Path } from './types'

/**
 * Anything in the tree. Either a `Branch` (can have children) or a `Leaf` (cannot).
 *
 * Members prefixed with an underscore are internal to Aspen's packages and are not part of the API.
 */
export abstract class TreeNode {
	/** Unique within its tree. This is what the flat `Uint32Array` stores. */
	readonly id: number
	readonly root: Root
	abstract readonly kind: Kind

	/** @internal */
	_key: string
	/** @internal */
	_label: string | undefined
	/** @internal */
	_parent: Branch | null
	/** @internal */
	_depth: number
	/** @internal */
	_disposed: boolean = false
	/** @internal */
	_metadata: Metadata
	/** @internal */
	_pathCache: Path | null = null
	/** @internal */
	_pathEpoch: number = -1

	/** @internal Use `Branch#add` instead of constructing nodes directly. */
	constructor(
		root: Root | null,
		parent: Branch | null,
		id: number,
		key: string,
		label: string | undefined,
		metadata: Metadata | undefined,
	) {
		this.id = id
		this.root = root ?? (this as unknown as Root)
		this._parent = parent
		this._key = key
		this._label = label
		this._depth = parent ? parent._depth + 1 : 0
		this._metadata = { ...metadata }
	}

	/** Unique among siblings. The last segment of `path`. */
	get key(): string {
		return this._key
	}

	/** Display text. Falls back to `key`. */
	get label(): string {
		return this._label ?? this._key
	}

	get parent(): Branch | null {
		return this._parent
	}

	/** How many levels below the root this node is. */
	get depth(): number {
		return this._depth
	}

	/**
	 * Once a node is disposed, let go of all references to it.
	 * The `path` of a disposed node is the last known one, or best effort if it was never read.
	 */
	get disposed(): boolean {
		return this._disposed
	}

	/**
	 * The keys of every ancestor, ending with this node's own key. The root is `[]`.
	 * Derived on demand and cached until anything in the tree moves or is renamed.
	 */
	get path(): Path {
		const root = this.root
		if (this._pathCache && (this._disposed || this._pathEpoch === root._epoch)) {
			return this._pathCache
		}
		const segments: string[] = []
		for (let node: TreeNode = this; node._parent; node = node._parent) {
			segments.push(node._key)
		}
		segments.reverse()
		this._pathCache = Object.freeze(segments)
		this._pathEpoch = root._epoch
		return this._pathCache
	}

	// biome-ignore lint/suspicious/noExplicitAny: metadata is free-form
	getMetadata(key: string): any {
		return this._metadata[key]
	}

	// biome-ignore lint/suspicious/noExplicitAny: metadata is free-form
	addMetadata(key: string, value: any): void {
		const existed = Object.hasOwn(this._metadata, key)
		const prevValue: unknown = this._metadata[key]
		this._metadata[key] = value
		this.#emitMetadata({ type: existed ? 'updated' : 'added', key, prevValue, value })
	}

	removeMetadata(key: string): void {
		if (!Object.hasOwn(this._metadata, key)) {
			return
		}
		const prevValue: unknown = this._metadata[key]
		delete this._metadata[key]
		this.#emitMetadata({ type: 'removed', key, prevValue, value: undefined })
	}

	/** Changes the display text and re-sorts the node among its siblings. Never changes `path`. */
	setLabel(label: string | undefined): void {
		if (this._label === label) {
			return
		}
		this._label = label
		const parent = this._parent
		if (parent?._children) {
			parent._unlink(this)
			parent._insert(this)
		}
	}

	/**
	 * Moves the node under `to`, optionally giving it a new key. Moving within the same branch with a
	 * new key is how you rename.
	 *
	 * The node keeps its identity, expansion state and (for a branch) everything below it.
	 *
	 * @throws {KeyCollisionError} when a sibling already has the key. Remove it first.
	 * @throws {CycleError} when `to` is this node or one of its descendants.
	 * @throws {NotLoadedError} when the children of `to` are not loaded.
	 */
	move(to: Branch, key: string = this._key): void {
		const root = this.root
		if ((this as TreeNode) === (root as TreeNode)) {
			throw new Error('The root cannot be moved')
		}
		if (this._disposed) {
			throw new Error('A disposed node cannot be moved')
		}
		if (to.root !== root) {
			throw new Error('A node cannot be moved into a different tree')
		}
		for (let ancestor: Branch | null = to; ancestor; ancestor = ancestor._parent) {
			if ((ancestor as TreeNode) === this) {
				throw new CycleError(this, to)
			}
		}
		if (to._children === null) {
			throw new NotLoadedError(to)
		}
		const prevParent = this._parent as Branch
		const parentChanged = prevParent !== to
		if (!parentChanged && key === this._key) {
			return
		}
		const occupant = to.child(key)
		if (occupant && occupant !== this) {
			throw new KeyCollisionError(key, occupant)
		}

		root._epoch++
		prevParent._unlink(this)
		this._key = key
		this._parent = to
		this._depth = to._depth + 1
		to._insert(this)
		if (parentChanged) {
			root._events.emit('didChangeParent', this, prevParent, to)
		}
		this._relocated()
	}

	/** Removes the node, and everything below it, from the tree and disposes of it. */
	remove(): void {
		if ((this as TreeNode) === (this.root as TreeNode)) {
			throw new Error('The root cannot be removed')
		}
		this._parent?._removeChild(this)
	}

	/** @internal Applies the metadata a host described. Keys the host did not mention are left alone. */
	_syncMetadata(metadata: Metadata | undefined): void {
		if (!metadata) {
			return
		}
		for (const key of Object.keys(metadata)) {
			if (!Object.hasOwn(this._metadata, key) || !Object.is(this._metadata[key], metadata[key])) {
				this.addMetadata(key, metadata[key])
			}
		}
	}

	/** @internal Called after this node's path changed. Branches extend it to cover their subtree. */
	_relocated(): void {
		this.root._events.emit('didChangePath', this)
	}

	/** @internal Branches extend it to cover their subtree. */
	_dispose(): void {
		if (this._disposed) {
			return
		}
		this._disposed = true
		this.root._registry.delete(this.id)
		this.root._events.emit('didDispose', this)
	}

	#emitMetadata(change: MetadataChange): void {
		this.root._events.emit('didChangeMetadata', this, change)
	}
}

/** A node that never has children. */
export class Leaf extends TreeNode {
	override readonly kind: 'leaf' = 'leaf'
}

export function isBranch(node: TreeNode): node is Branch {
	return node.kind === 'branch'
}

export function isLeaf(node: TreeNode): node is Leaf {
	return node.kind === 'leaf'
}
