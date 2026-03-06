import type { Branch, Disposable, Leaf, Path, TreeNode } from 'aspen-core'
import type { TreeModel } from 'aspen-tree-model'
import type { ReactElement } from 'react'
import type { NewItemPromptHandle } from './prompts/new-item-prompt-handle'
import type { RenamePromptHandle } from './prompts/rename-prompt-handle'

/** Where to put an item when scrolling to it. Same as `react-window`'s. */
export type Align = 'auto' | 'smart' | 'center' | 'end' | 'start'

/** What kind of row a renderer is asked to render. */
export const ItemType = {
	Leaf: 'leaf',
	Branch: 'branch',
	NewLeafPrompt: 'newLeafPrompt',
	NewBranchPrompt: 'newBranchPrompt',
	RenamePrompt: 'renamePrompt',
} as const

export type ItemType = (typeof ItemType)[keyof typeof ItemType]

export type ItemRendererProps =
	| { readonly item: Leaf; readonly itemType: 'leaf' }
	| { readonly item: Branch; readonly itemType: 'branch' }
	| { readonly item: NewItemPromptHandle; readonly itemType: 'newLeafPrompt' }
	| { readonly item: NewItemPromptHandle; readonly itemType: 'newBranchPrompt' }
	| { readonly item: RenamePromptHandle; readonly itemType: 'renamePrompt' }

/**
 * Renders one row. It is rendered as a component, so it may use hooks.
 *
 * Do not make it a `PureComponent`: you could miss changes made deep within `item`. Aspen works
 * hard to skip updates that are not needed.
 */
export type ItemRenderer = (props: ItemRendererProps) => ReactElement

/** What `Tree` hands out through `onReady`. */
export type TreeHandle = {
	/**
	 * Shows a prompt for a new leaf inside the branch. Expands whatever is needed to show it.
	 * Resolves to a handle for interacting with the input box.
	 */
	promptNewLeaf(at: Branch | Path): Promise<NewItemPromptHandle>

	/** Like `promptNewLeaf`, for a new branch. */
	promptNewBranch(at: Branch | Path): Promise<NewItemPromptHandle>

	/** Shows a rename prompt in place of the item. Expands whatever is needed to show it. */
	promptRename(target: TreeNode | Path): Promise<RenamePromptHandle>

	/** Expands a branch, and the branches on the way to it. It stays expanded until closed. */
	openBranch(target: Branch | Path): Promise<void>

	/** Collapses a branch, if it is expanded. */
	closeBranch(target: Branch | Path): Promise<void>

	/**
	 * The temporary version of `ensureVisible`: it cleans up the mess it makes. Once you dispose of the
	 * result, or the `timeout` expires, the branches it had to expand are closed again.
	 */
	peekABoo(target: TreeNode | Path, timeout?: number): Promise<Disposable>
	peekABoo(target: TreeNode | Path, align?: Align): Promise<Disposable>
	peekABoo(target: TreeNode | Path, timeout: number, align?: Align): Promise<Disposable>

	/**
	 * Scrolls to the item, expanding the branches on the way if needed. Unlike `peekABoo` it leaves
	 * the tree as it is. Use `getNode` if you only need the node and no scrolling.
	 */
	ensureVisible(target: TreeNode | Path, align?: Align): Promise<void>

	/**
	 * Returns the node at the path. It expands the branches leading to it (unless told otherwise) but
	 * does not scroll, unlike `ensureVisible`.
	 */
	getNode(path: Path, expandTree?: boolean): Promise<TreeNode>

	/** The `TreeModel` this tree is currently showing. */
	getModel(): TreeModel

	onDidChangeModel(listener: (prevModel: TreeModel, newModel: TreeModel) => void): Disposable
	onceDidChangeModel(listener: (prevModel: TreeModel, newModel: TreeModel) => void): Disposable

	/** The tree rendered after a change. */
	onDidUpdate(listener: () => void): Disposable
	onceDidUpdate(listener: () => void): Disposable
}
