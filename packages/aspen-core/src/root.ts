import { Branch } from './branch'
import { Emitter } from './emitter'
import { NotFoundError } from './errors'
import { logError } from './log'
import type { TreeNode } from './node'
import { defaultSort } from './sort'
import type {
	BranchRef,
	Change,
	Descriptor,
	Disposable,
	Host,
	MetadataChange,
	NodeRef,
	Path,
	RootOptions,
	SortComparator,
	TreeEvents,
} from './types'
import { assertChange } from './validate'

const MAX_ID = 0xffffffff

const isPath = (ref: unknown): ref is Path => Array.isArray(ref)

/** Whether `node` is `branch` itself or one of its ancestors. */
const encloses = (node: TreeNode, branch: Branch): boolean => {
	for (let ancestor: Branch | null = branch; ancestor; ancestor = ancestor._parent) {
		if ((ancestor as TreeNode) === node) {
			return true
		}
	}
	return false
}

/**
 * The top of a tree. It is a `Branch` that is always expanded, owns the list of every visible row,
 * and starts loading as soon as it is created.
 */
export class Root extends Branch {
	readonly host: Host

	/** @internal */
	readonly _events: Emitter<TreeEvents>
	/** @internal Bumped whenever something moves or is renamed, which invalidates cached paths. */
	_epoch: number = 0
	/** @internal */
	readonly _registry: Map<number, TreeNode> = new Map()
	/** @internal */
	_nextId: number = 1
	#reporting: boolean = false

	constructor(host: Host, options: RootOptions = {}) {
		super(null, null, 0, '', undefined, options.metadata)
		this.host = host
		this._events = new Emitter<TreeEvents>((error) => this._report(error))
		this._registry.set(this.id, this)
		this._expanded = true
		this._startLoad().catch((error) => this._report(error))
	}

	override get expanded(): boolean {
		return true
	}

	// The root can neither be expanded nor collapsed
	override async setExpanded(): Promise<void> {}
	override setCollapsed(): void {}
	override unload(): void {}

	// -- Lookups ------------------------------------------------------------------------------

	/**
	 * Looks a node up among what is already loaded. Never loads anything and never throws.
	 * Use `resolve` to reach into branches that are not loaded yet.
	 */
	get(path: Path): TreeNode | undefined {
		let node: TreeNode = this
		for (const key of path) {
			if (node.kind !== 'branch') {
				return undefined
			}
			const next = (node as Branch).child(key)
			if (!next) {
				return undefined
			}
			node = next
		}
		return node
	}

	/**
	 * Like `get`, but loads the branches on the way when needed. It leaves their expansion state
	 * alone, and waits for loads and reloads in flight.
	 *
	 * @throws {NotFoundError} when there is nothing at `path`.
	 */
	async resolve(path: Path): Promise<TreeNode> {
		let node: TreeNode = this
		for (const key of path) {
			if (node.kind !== 'branch') {
				throw new NotFoundError(path, node)
			}
			const branch = node as Branch
			await branch.ensureLoaded()
			const next = branch.child(key)
			if (!next) {
				throw new NotFoundError(path, node)
			}
			node = next
		}
		return node
	}

	/**
	 * Looks a node up by its row number among the visible rows. Windowing libraries ask for this
	 * with an arbitrary index. The number of rows is `branchSize`.
	 */
	getNodeAtIndex(index: number): TreeNode | undefined {
		const flat = this._flat
		if (!flat || index < 0 || index >= flat.length) {
			return undefined
		}
		return this._registry.get(flat[index] as number)
	}

	/** The row number of the node, or -1 when it is not among the visible rows. */
	getIndexOf(node: TreeNode): number {
		return this._flat ? this._flat.indexOf(node.id) : -1
	}

	/**
	 * Whether the node is among the visible rows, as opposed to being buried inside a collapsed
	 * branch. "Visible" here means it *can* be seen if scrolled to, not that it is on screen.
	 */
	isVisibleAtSurface(node: TreeNode): boolean {
		return (node as TreeNode) === (this as TreeNode) || this.getIndexOf(node) > -1
	}

	// -- Changes ------------------------------------------------------------------------------

	/**
	 * Tells the tree about something that happened in the world, for example a file watcher event.
	 *
	 * It is synchronous: once it returns, the change is applied. The exceptions are changes for a
	 * branch that is loading (held back and applied in order once it is done) and `invalidated`,
	 * which starts a reload. Changes for things that are not loaded are ignored. Whatever goes wrong is
	 * reported through `onError`, nothing is thrown, except for malformed input.
	 */
	apply(change: Change): void {
		assertChange(change)
		try {
			this.#apply(change)
		} catch (error) {
			this._report(error)
		}
	}

	#apply(change: Change): void {
		switch (change.type) {
			case 'added': {
				const parent = this.#branch(change.parent)
				if (!parent) {
					return
				}
				if (parent._loading) {
					parent._defer(change)
					return
				}
				if (parent._children === null) {
					return // not loaded, the host is asked for the children when they are needed
				}
				this.#upsert(parent, change.item)
				return
			}

			case 'removed': {
				const located = this.#locate(change.target)
				if (!located) {
					return
				}
				if (located.parent._loading) {
					located.parent._defer(change)
					return
				}
				if (located.node) {
					located.parent._removeChild(located.node)
				}
				return
			}

			case 'moved': {
				const source = this.#locate(change.target)
				const destination = this.#branch(change.to)
				const busy = source?.parent._loading
					? source.parent
					: destination?._loading
						? destination
						: undefined
				if (busy) {
					busy._defer(change)
					return
				}
				const node = source?.node
				if (!node) {
					// The source is not loaded, or already gone. It can still appear at its destination.
					if (destination && destination._children !== null && change.item) {
						this.#upsert(destination, change.item)
					}
					return
				}
				if (!destination || destination._children === null) {
					// it moved out of the part of the tree that is loaded
					node.remove()
					return
				}
				if (encloses(node, destination)) {
					throw new Error(
						`[aspen] ignored a move of ${JSON.stringify(node.path)} into itself or one of its descendants`,
					)
				}
				const key = change.key ?? node.key
				const occupant = destination.child(key)
				if (occupant && occupant !== node) {
					destination._removeChild(occupant)
				}
				node.move(destination, key)
				return
			}

			case 'invalidated': {
				const branch = this.#branch(change.branch)
				if (!branch || (branch._children === null && !branch._loading)) {
					return
				}
				branch.reload().catch((error) => this._report(error))
				return
			}
		}
	}

	/** Adds the item, or updates the sibling that has its key. */
	#upsert(parent: Branch, item: Descriptor): void {
		const existing = parent.child(item.key)
		if (existing) {
			if (existing.kind === item.kind) {
				existing.setLabel(item.label)
				existing._syncMetadata(item.metadata)
				return
			}
			parent._removeChild(existing)
		}
		parent.add(item)
	}

	#branch(ref: BranchRef): Branch | undefined {
		const node = isPath(ref) ? this.get(ref) : ref
		if (!node || node.root !== this || node._disposed || node.kind !== 'branch') {
			return undefined
		}
		return node as Branch
	}

	#locate(ref: NodeRef): { parent: Branch; node: TreeNode | undefined } | undefined {
		if (isPath(ref)) {
			if (ref.length === 0) {
				return undefined
			}
			const parent = this.#branch(ref.slice(0, -1))
			if (!parent) {
				return undefined
			}
			return { parent, node: parent.child(ref[ref.length - 1] as string) }
		}
		if (ref.root !== this || ref._disposed || !ref._parent) {
			return undefined
		}
		return { parent: ref._parent, node: ref }
	}

	// -- Events -------------------------------------------------------------------------------

	onDidChangeExpansionState(
		listener: (branch: Branch, expanded: boolean, visibleAtSurface: boolean) => void,
	): Disposable {
		return this._events.on('didChangeExpansion', listener)
	}

	onDidChangeParent(
		listener: (node: TreeNode, prevParent: Branch, newParent: Branch) => void,
	): Disposable {
		return this._events.on('didChangeParent', listener)
	}

	/** Fires for the node that moved or was renamed, and for each loaded node below it. */
	onDidChangePath(listener: (node: TreeNode) => void): Disposable {
		return this._events.on('didChangePath', listener)
	}

	/** Fires for every disposed node, including those below a removed branch. */
	onDidDispose(listener: (node: TreeNode) => void): Disposable {
		return this._events.on('didDispose', listener)
	}

	/** The list of visible rows was replaced. */
	onDidUpdate(listener: () => void): Disposable {
		return this._events.on('didUpdate', listener)
	}

	onDidChangeMetadata(listener: (node: TreeNode, change: MetadataChange) => void): Disposable {
		return this._events.on('didChangeMetadata', listener)
	}

	/** Failures that have nobody to throw to, like a reload started by `apply`. */
	onError(listener: (error: unknown) => void): Disposable {
		return this._events.on('error', listener)
	}

	// -- Lifecycle ----------------------------------------------------------------------------

	/** Stops observing every branch and disposes of the whole tree. */
	dispose(): void {
		if (this._disposed) {
			return
		}
		super._dispose()
		this._events.clear()
	}

	/** @internal */
	get _comparator(): SortComparator {
		const host = this.host
		const sort = host.sortComparator
		return sort ? (a, b) => sort.call(host, a, b) : defaultSort
	}

	/** @internal */
	_allocateId(): number {
		if (this._nextId > MAX_ID) {
			throw new Error('[aspen] ran out of node ids')
		}
		return this._nextId++
	}

	/** @internal */
	_report(error: unknown): void {
		if (this.#reporting || !this._events.has('error')) {
			logError(error)
			return
		}
		this.#reporting = true
		try {
			this._events.emit('error', error)
		} finally {
			this.#reporting = false
		}
	}

	/** @internal The root announces when the visible rows change. */
	override _setFlat(flat: Uint32Array | null): void {
		this._flat = flat
		this._events.emit('didUpdate')
	}
}
