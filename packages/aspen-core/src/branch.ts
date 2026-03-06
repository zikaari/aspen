import { DuplicateKeyError, KeyCollisionError, NotLoadedError } from './errors'
import { spliceIds } from './flat'
import { Leaf, TreeNode } from './node'
import type { Change, Descriptor } from './types'
import { assertDescriptor, DEV } from './validate'

/** Below this many children a linear scan beats building a lookup table. */
const INDEX_THRESHOLD = 24

/** True when the node is an expanded branch whose visible descendants are inlined in an ancestor's list. */
function isInline(node: TreeNode): boolean {
	return node.kind === 'branch' && (node as Branch)._expanded && (node as Branch)._flat === null
}

/**
 * A node that can have children, loaded lazily through `Host#getChildren`.
 *
 * **How the flat list works.** `Root` owns a `Uint32Array` of the ids of every visible row, in order,
 * so `Root#getNodeAtIndex` is O(1). A collapsed branch owns the list of its own visible descendants
 * (so it can be spliced back in cheaply). Expanding a branch hands its list up to the nearest
 * owning ancestor, and collapsing takes it back. `branchSize` is the length of the list a branch is
 * in charge of, recursively.
 */
export class Branch extends TreeNode {
	override readonly kind: 'branch' = 'branch'

	/** @internal */
	_children: TreeNode[] | null = null
	/** @internal Number of visible rows below this branch, recursively. */
	_branchSize: number = 0
	/** @internal The list this branch owns. `null` when it is inlined in an ancestor's list (or unloaded). */
	_flat: Uint32Array | null = null
	/** @internal */
	_expanded: boolean = false
	/** @internal */
	_observed: boolean = false
	/** @internal */
	_stopObserving: (() => void) | null = null
	/** @internal The load or reload currently in flight. */
	_loading: Promise<void> | null = null
	/** @internal A reload that is waiting for the current load to finish. */
	_followUp: Promise<void> | null = null
	/** @internal Changes that arrived while a load was in flight. */
	_queue: Change[] = []
	/** @internal Bumped to abandon an in-flight load (unload, dispose). */
	_gen: number = 0
	/** @internal Lazily built key lookup for large branches. */
	_index: Map<string, TreeNode> | null = null

	/** A copy of the children, or `null` when they are not loaded. */
	get children(): TreeNode[] | null {
		return this._children ? this._children.slice() : null
	}

	get childCount(): number {
		return this._children ? this._children.length : 0
	}

	get loaded(): boolean {
		return this._children !== null
	}

	get expanded(): boolean {
		return this._expanded
	}

	/**
	 * Number of visible rows this branch is in charge of, recursively.
	 *
	 * When a branch is expanded its rows are owned by an ancestor higher up, and when it is collapsed
	 * they are owned by the branch itself.
	 */
	get branchSize(): number {
		return this._branchSize
	}

	/** The direct child with this key, if the children are loaded and one exists. */
	child(key: string): TreeNode | undefined {
		const children = this._children
		if (!children) {
			return undefined
		}
		if (children.length < INDEX_THRESHOLD) {
			for (const child of children) {
				if (child._key === key) {
					return child
				}
			}
			return undefined
		}
		let index = this._index
		if (!index) {
			index = new Map()
			for (const child of children) {
				index.set(child._key, child)
			}
			this._index = index
		}
		return index.get(key)
	}

	/**
	 * Resolves once the children are loaded, and any load or reload in flight has finished.
	 * Does not change the `expanded` state.
	 */
	async ensureLoaded(): Promise<void> {
		if (this._loading) {
			await this._loading
			if (this._followUp) {
				await this._followUp
			}
			return
		}
		if (this._children === null) {
			await this._startLoad()
		}
	}

	async setExpanded(ensureVisible: boolean = true): Promise<void> {
		if (this._expanded || this._disposed) {
			return
		}
		this._expanded = true
		if (this._children === null) {
			try {
				await this._startLoad()
			} catch (error) {
				this._expanded = false
				throw error
			}
			// maybe `setCollapsed` was called, or the branch was unloaded, in the meantime
			if (!this._expanded || this._children === null) {
				return
			}
		}

		const parent = this._parent
		if (ensureVisible && parent && (parent as TreeNode) !== (this.root as TreeNode)) {
			await parent.setExpanded(true)
		}

		// async again (the user might have changed their mind in the meantime)
		if (this._expanded && this._children !== null && !this._disposed) {
			this._expandBranch(this)
			this._emitExpansion(true)
		}
	}

	setCollapsed(): void {
		if (!this._expanded) {
			return
		}
		// a branch that owns its list (not yet inlined) has nothing to take back from an ancestor
		if (this._children && this._parent && this._flat === null) {
			this._shrinkBranch(this)
		}
		this._expanded = false
		this._emitExpansion(false)
	}

	/**
	 * Creates a child from the descriptor and inserts it at its sorted position.
	 *
	 * @throws {KeyCollisionError} when a sibling already has the key.
	 * @throws {NotLoadedError} when the children are not loaded. Await `ensureLoaded()` first.
	 */
	add(descriptor: Descriptor): TreeNode {
		if (this._children === null) {
			throw new NotLoadedError(this)
		}
		if (DEV) {
			assertDescriptor(descriptor)
		}
		const occupant = this.child(descriptor.key)
		if (occupant) {
			throw new KeyCollisionError(descriptor.key, occupant)
		}
		const node = this._createChild(descriptor)
		this._insert(node)
		return node
	}

	/**
	 * Fetches the children again and reconciles them by key: nodes that are still there keep their
	 * identity, expansion state and everything below them. Starts an initial load if there is none yet.
	 * If a load is already in flight, one more reload runs after it, so the result is never stale.
	 */
	reload(): Promise<void> {
		if (!this._loading) {
			return this._startLoad()
		}
		if (!this._followUp) {
			const run = (): Promise<void> => {
				this._followUp = null
				return this._startLoad()
			}
			this._followUp = this._loading.then(run, run)
		}
		return this._followUp
	}

	/**
	 * Forgets the children, collapses the branch and stops observing it. The next `ensureLoaded()`
	 * (or `setExpanded()`) loads from the host again.
	 */
	unload(): void {
		if (this._children === null && !this._loading) {
			return
		}
		this._gen++
		this.setCollapsed()
		this._endObserving()
		const children = this._children
		this._children = null
		this._index = null
		this._branchSize = 0
		this._flat = null
		this._queue = []
		this._loading = null
		this._followUp = null
		if (children) {
			for (const child of children) {
				child._parent = null
				child._dispose()
			}
		}
	}

	/** @internal Keeps `children`, the flat list and the lookup table in step with each other. */
	_insert(item: TreeNode): void {
		const children = this._children as TreeNode[]
		if (children.includes(item)) {
			return
		}
		const itemBranch = item.kind === 'branch' ? (item as Branch) : null
		const branchSizeIncrease = 1 + (itemBranch?._expanded ? itemBranch._branchSize : 0)
		children.push(item)
		children.sort(this.root._comparator)
		this._branchSize += branchSizeIncrease

		// find the first owner of the flat list
		let master: Branch = this
		while (!master._flat) {
			const parent: Branch | null = master._parent
			if (!parent) {
				throw new Error('[aspen] invariant broken: no ancestor owns the flat list')
			}
			master = parent
			master._branchSize += branchSizeIncrease
		}

		let relativeInsertionIndex = children.indexOf(item)
		const leadingSibling = children[relativeInsertionIndex - 1]
		if (leadingSibling) {
			const siblingIdx = master._flat.indexOf(leadingSibling.id)
			relativeInsertionIndex =
				siblingIdx +
				(leadingSibling.kind === 'branch' && (leadingSibling as Branch)._expanded
					? (leadingSibling as Branch)._branchSize
					: 0)
		} else {
			// `indexOf` is -1 when this branch itself owns the list, which means "at the very start"
			relativeInsertionIndex = master._flat.indexOf(this.id)
		}
		const absInsertionIndex = relativeInsertionIndex + 1 // +1 to make room for itself

		const rows = new Uint32Array(branchSizeIncrease)
		rows[0] = item.id
		if (itemBranch?._expanded && itemBranch._flat) {
			rows.set(itemBranch._flat, 1)
			itemBranch._setFlat(null)
		}
		master._setFlat(spliceIds(master._flat, absInsertionIndex, 0, rows))
		this._index?.set(item._key, item)
	}

	/**
	 * @internal Takes the item out of `children` and out of the flat list. If it is an expanded
	 * branch it keeps the rows below it, so it can be inserted somewhere else.
	 */
	_unlink(item: TreeNode): void {
		const children = this._children as TreeNode[]
		const idx = children.indexOf(item)
		if (idx === -1) {
			return
		}
		children.splice(idx, 1)
		if (this._index?.get(item._key) === item) {
			this._index.delete(item._key)
		}
		const itemBranch = item.kind === 'branch' ? (item as Branch) : null
		const branchSizeDecrease = 1 + (itemBranch?._expanded ? itemBranch._branchSize : 0)
		this._branchSize -= branchSizeDecrease

		// find the first owner of the flat list
		let master: Branch = this
		while (!master._flat) {
			const parent: Branch | null = master._parent
			if (!parent) {
				throw new Error('[aspen] invariant broken: no ancestor owns the flat list')
			}
			master = parent
			master._branchSize -= branchSizeDecrease
		}

		const removalBeginIdx = master._flat.indexOf(item.id)
		if (removalBeginIdx === -1) {
			return
		}
		// an expanded branch does not own its rows (someone higher up does), except while it is in transit
		if (itemBranch?._expanded) {
			itemBranch._setFlat(
				master._flat.slice(removalBeginIdx + 1, removalBeginIdx + branchSizeDecrease),
			)
		}
		master._setFlat(spliceIds(master._flat, removalBeginIdx, branchSizeDecrease))
	}

	/** @internal Unlinks the child and disposes of it, and everything below it. */
	_removeChild(node: TreeNode): void {
		if (this._children === null || !this._children.includes(node)) {
			return
		}
		// remember where it was, for anyone still holding a reference
		node._pathCache = node.path
		this._unlink(node)
		node._parent = null
		node._dispose()
	}

	/** @internal */
	_createChild(descriptor: Descriptor): TreeNode {
		const root = this.root
		const id = root._allocateId()
		const node =
			descriptor.kind === 'branch'
				? new Branch(root, this, id, descriptor.key, descriptor.label, descriptor.metadata)
				: new Leaf(root, this, id, descriptor.key, descriptor.label, descriptor.metadata)
		root._registry.set(id, node)
		return node
	}

	/** @internal Hands this branch's rows to the nearest owning ancestor. */
	_expandBranch(branch: Branch): void {
		if (this !== branch) {
			this._branchSize += branch._branchSize
		}
		// when `this` itself is collapsed, it simply adopts the rows without propagating any further up
		if (this !== branch && this._flat) {
			const injectionStartIdx = this._flat.indexOf(branch.id) + 1
			this._setFlat(spliceIds(this._flat, injectionStartIdx, 0, branch._flat ?? undefined))
			// [critical] take the ownership away from the branch
			branch._setFlat(null)
		} else if (this._parent) {
			this._parent._expandBranch(branch)
		}
	}

	/** @internal Takes this branch's rows back from the ancestor that owns them. */
	_shrinkBranch(branch: Branch): void {
		if (this !== branch) {
			// this branch still has the same rows, but from its parent's frame of reference they are gone
			this._branchSize -= branch._branchSize
		}
		if (this !== branch && this._flat) {
			const removalStartIdx = this._flat.indexOf(branch.id) + 1
			// [critical] give the ownership back to the branch
			const rows = this._flat.slice(removalStartIdx, removalStartIdx + branch._branchSize)
			branch._setFlat(rows)
			this._setFlat(spliceIds(this._flat, removalStartIdx, rows.length))
		} else if (this._parent) {
			this._parent._shrinkBranch(branch)
		}
	}

	/** @internal The root overrides it to announce that the visible rows changed. */
	_setFlat(flat: Uint32Array | null): void {
		this._flat = flat
	}

	/** @internal */
	_emitExpansion(expanded: boolean): void {
		const root = this.root
		root._events.emit('didChangeExpansion', this, expanded, root.isVisibleAtSurface(this))
	}

	/** @internal */
	_startLoad(): Promise<void> {
		if (this._loading) {
			return this._loading
		}
		const gen = this._gen
		const promise: Promise<void> = this._runLoad(gen).finally(() => {
			if (this._loading === promise) {
				this._loading = null
			}
			this._drain()
		})
		this._loading = promise
		return promise
	}

	/** @internal */
	async _runLoad(gen: number): Promise<void> {
		const host = this.root.host
		const firstLoad = this._children === null
		// start watching *before* listing, so nothing that happens in between is lost
		if (firstLoad) {
			this._beginObserving()
		}
		let descriptors: readonly Descriptor[]
		try {
			descriptors = (await host.getChildren(this)) ?? []
		} catch (error) {
			if (firstLoad) {
				this._endObserving()
			}
			throw error
		}
		if (gen !== this._gen || this._disposed) {
			return // unloaded or disposed in the meantime
		}
		this._setChildren(descriptors)
	}

	/** @internal Applies changes that were held back while loading. */
	_drain(): void {
		const queued = this._queue
		if (queued.length === 0) {
			return
		}
		this._queue = []
		if (this._children === null || this._disposed) {
			return
		}
		for (const change of queued) {
			this.root.apply(change)
		}
	}

	/** @internal Sets (or reconciles) the children from what the host returned. */
	_setChildren(descriptors: readonly Descriptor[]): void {
		const root = this.root

		const unique = new Map<string, Descriptor>()
		for (const descriptor of descriptors) {
			if (DEV) {
				assertDescriptor(descriptor)
			}
			if (unique.has(descriptor.key)) {
				const error = new DuplicateKeyError(descriptor.key, this)
				if (DEV) {
					throw error
				}
				root._report(error)
				continue
			}
			unique.set(descriptor.key, descriptor)
		}

		const previous = this._children
		const previousByKey = new Map<string, TreeNode>()
		if (previous) {
			for (const child of previous) {
				previousByKey.set(child._key, child)
			}
		}

		// keep the nodes that are still there, create the new ones
		const next: TreeNode[] = []
		const updates: Array<[TreeNode, Descriptor]> = []
		for (const descriptor of unique.values()) {
			const existing = previousByKey.get(descriptor.key)
			if (existing && existing.kind === descriptor.kind) {
				previousByKey.delete(descriptor.key)
				existing._label = descriptor.label
				updates.push([existing, descriptor])
				next.push(existing)
			} else {
				next.push(this._createChild(descriptor))
			}
		}
		const removed = [...previousByKey.values()]
		next.sort(root._comparator)

		// If this branch is inlined in an ancestor's list, take ownership of its slice first
		const inlined = previous !== null && this._flat === null
		if (inlined) {
			this._shrinkBranch(this)
		}
		const previousFlat = this._flat

		// Where each child's rows start inside the old list, found by hopping from child to child
		const rowsStart = new Map<number, number>()
		if (previousFlat) {
			let i = 0
			while (i < previousFlat.length) {
				const id = previousFlat[i] as number
				const child = root._registry.get(id)
				rowsStart.set(id, i + 1)
				i += 1 + (child && isInline(child) ? (child as Branch)._branchSize : 0)
			}
		}

		let total = next.length
		for (const child of next) {
			if (isInline(child)) {
				total += (child as Branch)._branchSize
			}
		}
		const flat = new Uint32Array(total)
		let o = 0
		for (const child of next) {
			flat[o++] = child.id
			if (isInline(child)) {
				const start = rowsStart.get(child.id)
				if (start === undefined || previousFlat === null) {
					throw new Error('[aspen] invariant broken: rows of an expanded child went missing')
				}
				const size = (child as Branch)._branchSize
				flat.set(previousFlat.subarray(start, start + size), o)
				o += size
			}
		}

		this._children = next
		this._index = null
		this._branchSize = flat.length
		this._setFlat(flat)
		if (inlined) {
			this._expandBranch(this)
		}

		for (const node of removed) {
			node._parent = null
			node._dispose()
		}
		for (const [node, descriptor] of updates) {
			node._syncMetadata(descriptor.metadata)
		}
	}

	/** @internal */
	_beginObserving(): void {
		const host = this.root.host
		if (!host.observe || this._observed) {
			return
		}
		this._observed = true
		const stop = host.observe(this)
		this._stopObserving = typeof stop === 'function' ? stop : null
	}

	/** @internal */
	_endObserving(): void {
		const stop = this._stopObserving
		this._observed = false
		this._stopObserving = null
		if (stop) {
			try {
				stop()
			} catch (error) {
				this.root._report(error)
			}
		}
	}

	/** @internal Holds a change back until the load in flight is done. */
	_defer(change: Change): void {
		this._queue.push(change)
	}

	/** @internal */
	override _relocated(): void {
		super._relocated()
		// the host may be watching by address, so it has to watch the new one
		if (this._observed) {
			this._endObserving()
			this._beginObserving()
		}
		if (this._children) {
			for (const child of this._children) {
				child._depth = this._depth + 1
				child._relocated()
			}
		}
	}

	/** @internal */
	override _dispose(): void {
		if (this._disposed) {
			return
		}
		this._gen++
		this._endObserving()
		const children = this._children
		this._children = null
		this._index = null
		this._queue = []
		if (children) {
			for (const child of children) {
				child._dispose()
			}
		}
		super._dispose()
	}
}
