import type { Branch } from './branch'
import type { TreeNode } from './node'

/** Whether a node can have children (`branch`) or never can (`leaf`). */
export type Kind = 'branch' | 'leaf'

/**
 * Address of a node: the keys of all its ancestors from the root, ending with its own key.
 * The root itself is `[]`. Keys are unique among siblings, so a path is unique across the tree.
 */
export type Path = readonly string[]

/** Free-form data attached to a node. Aspen never reads it. */
// biome-ignore lint/suspicious/noExplicitAny: metadata is deliberately free-form and mutated by reference by consumers
export type Metadata = Record<string, any>

/** The raw, minimal description of a node, as returned by `Host#getChildren`. */
export type Descriptor = {
	/** Unique among siblings. Becomes the node's path segment. */
	readonly key: string
	/** Display text. Defaults to `key`. Changing it never changes the node's path. */
	readonly label?: string | undefined
	readonly kind: Kind
	readonly metadata?: Metadata | undefined
}

export type Disposable = {
	dispose(): void
}

/** Called by Aspen when it no longer needs to observe a branch. */
export type StopObserving = () => void

export type SortComparator = (a: TreeNode, b: TreeNode) => number

/** How a tree talks to its data source. */
export type Host = {
	/**
	 * Called whenever a branch needs its children. Do not sort them: Aspen sorts with `sortComparator`.
	 * The branch's address is `branch.path`.
	 */
	getChildren(branch: Branch): readonly Descriptor[] | Promise<readonly Descriptor[]>

	/**
	 * Defaults to branches first, then ascending by label.
	 * Avoid `instanceof` in here, compare `node.kind` instead.
	 */
	sortComparator?: SortComparator | undefined

	/**
	 * Called right *before* the first `getChildren` of a branch (so no change can slip through
	 * between listing and watching), and again after the branch is moved. The returned function is
	 * called when the branch is unloaded, disposed or moved. Feed the changes you observe to `Root#apply`.
	 */
	// biome-ignore lint/suspicious/noConfusingVoidType: callbacks that return nothing must be assignable
	observe?: ((branch: Branch) => StopObserving | void) | undefined
}

export type NodeRef = TreeNode | Path
export type BranchRef = Branch | Path

/**
 * A change in the world that Aspen should converge to. Fed to `Root#apply`.
 *
 * Host events are truth, so they are idempotent: adding what exists updates it, removing what does not
 * exist does nothing, and moving onto an occupied key replaces the occupant.
 */
export type Change =
	| { readonly type: 'added'; readonly parent: BranchRef; readonly item: Descriptor }
	| { readonly type: 'removed'; readonly target: NodeRef }
	| {
			readonly type: 'moved'
			readonly target: NodeRef
			readonly to: BranchRef
			/** New key, when the move is also a rename. */
			readonly key?: string | undefined
			/**
			 * Describes the node at its destination. Only needed when the source is not loaded, in
			 * which case the node cannot be moved and is created at the destination instead.
			 */
			readonly item?: Descriptor | undefined
	  }
	/** The branch's children may be stale. Reload and reconcile by key. Avoid dispatching it at all costs. */
	| { readonly type: 'invalidated'; readonly branch: BranchRef }

export type MetadataChangeType = 'added' | 'updated' | 'removed'

export type MetadataChange = {
	readonly type: MetadataChangeType
	readonly key: string
	readonly prevValue: unknown
	readonly value: unknown
}

export type RootOptions = {
	/** Handy for hosts that need to identify the root in `getChildren`. */
	readonly metadata?: Metadata | undefined
}

export type TreeEvents = {
	didChangeExpansion: [branch: Branch, expanded: boolean, visibleAtSurface: boolean]
	didChangeParent: [node: TreeNode, prevParent: Branch, newParent: Branch]
	didChangePath: [node: TreeNode]
	didDispose: [node: TreeNode]
	/** The flat list of visible rows was replaced. */
	didUpdate: []
	didChangeMetadata: [node: TreeNode, change: MetadataChange]
	error: [error: unknown]
}
