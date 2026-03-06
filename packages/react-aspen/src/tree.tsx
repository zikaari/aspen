import {
	type Branch,
	type Disposable,
	DisposableGroup,
	Emitter,
	type Kind,
	type Leaf,
	type Path,
	type TreeNode,
} from 'aspen-core'
import type { TreeModel } from 'aspen-tree-model'
import { Component, type CSSProperties, createRef, type ReactElement } from 'react'
import { FixedSizeList } from 'react-window'
import { NewItemPromptHandle, type PromptHandle, RenamePromptHandle } from './prompts'
import { ItemRendererWrap } from './row'
import type { Align, ItemRenderer, ItemRendererProps, TreeHandle } from './types'

export type TreeProps = {
	width: number
	height: number
	/** In pixels. Every row has the same height. */
	itemHeight: number
	model: TreeModel
	/** Renders one row, see `ItemRenderer`. */
	children: ItemRenderer
	onReady?: ((handle: TreeHandle) => void) | undefined
	style?: CSSProperties | undefined
	className?: string | undefined
	/**
	 * Row props are cached by row number until the next update. Turn the cache off if your renderer
	 * depends on something the cache cannot know about.
	 */
	disableCache?: boolean | undefined
}

type TreeEvents = {
	didChangeModel: [prevModel: TreeModel, newModel: TreeModel]
	didUpdate: []
}

const BATCHED_UPDATE_MAX_DEBOUNCE_MS = 4

const isPath = (target: unknown): target is Path => Array.isArray(target)

export class Tree extends Component<TreeProps> {
	/**
	 * Must be one greater than the index of the target (the potential parent), and kept up to date
	 * at all times: it is recalculated on every update.
	 */
	#newItemPromptInsertionIndex = -1
	/** The node a prompt is about: where a new item goes into, or what is being renamed. */
	#promptTarget: TreeNode | null = null
	#prompt: NewItemPromptHandle | RenamePromptHandle | null = null
	readonly #rowPropsCache = new Map<number, ItemRendererProps>()
	#disposables = new DisposableGroup()
	readonly #events = new Emitter<TreeEvents>()
	readonly #list = createRef<FixedSizeList>()

	readonly #batchUpdate: () => Promise<void> = (() => {
		// Everyone who calls it within `BATCHED_UPDATE_MAX_DEBOUNCE_MS` of each other is given the
		// same `Promise` to wait on
		let onePromise: Promise<void> | null = null
		let resolver: (() => void) | null = null
		let timer: ReturnType<typeof setTimeout> | undefined

		const commitUpdate = (): void => {
			const { root } = this.props.model
			let insertionIndex = -1
			const prompt = this.#prompt
			if (
				this.#promptTarget &&
				prompt instanceof NewItemPromptHandle &&
				prompt.parent.expanded &&
				root.isVisibleAtSurface(prompt.parent) &&
				!prompt.destroyed
			) {
				const idx = root.getIndexOf(this.#promptTarget)
				if (idx > -1 || (prompt.parent as TreeNode) === (root as TreeNode)) {
					insertionIndex = idx + 1
				} else {
					this.#promptTarget = null
				}
			}
			this.#newItemPromptInsertionIndex = insertionIndex
			if (!this.props.disableCache) {
				this.#rowPropsCache.clear()
			}
			this.forceUpdate(resolver ?? undefined)
		}

		return () => {
			if (!onePromise) {
				const promise = new Promise<void>((resolve) => {
					resolver = resolve
				})
				onePromise = promise
				promise.then(() => {
					onePromise = null
					resolver = null
					this.#events.emit('didUpdate')
				})
			}
			// (re)schedule the commit
			clearTimeout(timer)
			timer = setTimeout(commitUpdate, BATCHED_UPDATE_MAX_DEBOUNCE_MS)
			return onePromise
		}
	})()

	override render(): ReactElement {
		const p = this.props
		return (
			<FixedSizeList
				width={p.width}
				height={p.height}
				// not required, but handy as an escape hatch to force the list to update (a new array
				// every time means a new render)
				itemData={[]}
				itemSize={p.itemHeight}
				itemKey={this.#getItemKey}
				itemCount={this.#adjustedRowCount}
				overscanCount={5}
				ref={this.#list}
				onScroll={this.#handleListScroll}
				style={p.style}
				className={p.className}
			>
				{this.#renderItem}
			</FixedSizeList>
		)
	}

	override componentDidMount(): void {
		const { model, onReady } = this.props
		this.#subscribe(model)
		if (typeof onReady === 'function') {
			onReady(this.#createHandle())
		}
	}

	override componentDidUpdate(prevProps: TreeProps): void {
		if (this.props.model !== prevProps.model) {
			this.#disposables.dispose()
			// whatever was cached or being prompted for belongs to the previous model
			this.#prompt?.destroy()
			this.#prompt = null
			this.#promptTarget = null
			this.#newItemPromptInsertionIndex = -1
			this.#rowPropsCache.clear()
			this.#subscribe(this.props.model)
			this.#events.emit('didChangeModel', prevProps.model, this.props.model)
			this.forceUpdate()
		}
	}

	override componentWillUnmount(): void {
		this.#disposables.dispose()
		this.#prompt?.destroy()
	}

	#subscribe(model: TreeModel): void {
		this.#disposables = new DisposableGroup()
		this.#list.current?.scrollTo(model.scrollOffset)
		this.#disposables.add(model.onChange(() => void this.#batchUpdate()))
		this.#disposables.add(
			model.onDidRestoreScrollOffset((offset) => this.#list.current?.scrollTo(offset)),
		)
	}

	#createHandle(): TreeHandle {
		return {
			promptNewLeaf: (at) => this.#promptNew(at, 'leaf'),
			promptNewBranch: (at) => this.#promptNew(at, 'branch'),
			promptRename: this.#promptRename,
			openBranch: this.#openBranch,
			closeBranch: this.#closeBranch,
			peekABoo: this.#peekABoo,
			ensureVisible: this.#ensureVisible,
			getNode: this.#getNode,
			getModel: () => this.props.model,
			onDidChangeModel: (listener) => this.#events.on('didChangeModel', listener),
			onceDidChangeModel: (listener) => this.#events.once('didChangeModel', listener),
			onDidUpdate: (listener) => this.#events.on('didUpdate', listener),
			onceDidUpdate: (listener) => this.#events.once('didUpdate', listener),
		}
	}

	readonly #handleListScroll = ({ scrollOffset }: { scrollOffset: number }): void => {
		this.props.model.saveScrollOffset(scrollOffset)
	}

	readonly #getNode = async (path: Path, expandTree = true): Promise<TreeNode> => {
		const { root } = this.props.model
		const node = await root.resolve(path)
		if (expandTree && node.parent && !root.isVisibleAtSurface(node)) {
			await node.parent.setExpanded(true)
		}
		return node
	}

	async #toNode(target: TreeNode | Path): Promise<TreeNode> {
		return isPath(target) ? await this.props.model.root.resolve(target) : target
	}

	readonly #openBranch = async (target: Branch | Path): Promise<void> => {
		const node = await this.#toNode(target)
		if (node.kind === 'branch') {
			return (node as Branch).setExpanded()
		}
	}

	readonly #closeBranch = async (target: Branch | Path): Promise<void> => {
		const node = await this.#toNode(target)
		if (node.kind === 'branch') {
			;(node as Branch).setCollapsed()
		}
	}

	readonly #peekABoo: TreeHandle['peekABoo'] = async (
		target: TreeNode | Path,
		timeoutOrAlign?: number | Align,
		maybeAlign?: Align,
	): Promise<Disposable> => {
		const { root, stash } = this.props.model
		const timeout =
			typeof timeoutOrAlign === 'number' && timeoutOrAlign >= 0 ? timeoutOrAlign : undefined
		const align: Align =
			(typeof timeoutOrAlign === 'string' ? timeoutOrAlign : maybeAlign) ?? 'center'

		const node = await this.#toNode(target)
		if ((node as TreeNode) === (root as TreeNode)) {
			throw new TypeError('The root cannot be peeked at')
		}
		this.#reverseStash()
		const idx = root.getIndexOf(node)
		if (idx < 0) {
			stash.begin()
			await node.parent?.setExpanded(true)
			stash.end()
		}
		this.#list.current?.scrollToItem(idx < 0 ? root.getIndexOf(node) : idx, align)
		const disposable: Disposable = { dispose: () => this.#reverseStash() }
		if (timeout) {
			setTimeout(() => disposable.dispose(), timeout)
		}
		return disposable
	}

	readonly #ensureVisible = async (
		target: TreeNode | Path,
		align: Align = 'auto',
	): Promise<void> => {
		const { root, stash } = this.props.model
		const node = await this.#toNode(target)
		if ((node as TreeNode) === (root as TreeNode)) {
			throw new TypeError('The root cannot be scrolled to')
		}
		if (this.#scrollIntoView(node, align)) {
			stash.exclude(node)
			return
		}
		this.#reverseStash()
		await node.parent?.setExpanded(true)
		this.#list.current?.scrollToItem(root.getIndexOf(node), align)
	}

	#reverseStash(): void {
		this.props.model.stash.reverse().catch((error) => console.error('[aspen]', error))
	}

	#scrollIntoView(node: TreeNode, align: Align = 'center'): boolean {
		const idx = this.props.model.root.getIndexOf(node)
		if (idx > -1) {
			this.#list.current?.scrollToItem(idx, align)
			return true
		}
		return false
	}

	readonly #promptRename = async (target: TreeNode | Path): Promise<RenamePromptHandle> => {
		const { root } = this.props.model
		const node = await this.#toNode(target)
		if ((node as TreeNode) === (root as TreeNode)) {
			throw new TypeError('The root cannot be renamed')
		}
		const prompt = new RenamePromptHandle(node.label, node)
		this.#setPrompt(prompt)
		this.#promptTarget = node
		if (!root.isVisibleAtSurface(node)) {
			await node.parent?.setExpanded()
		} else {
			await this.#batchUpdate()
		}
		this.#list.current?.scrollToItem(root.getIndexOf(node))
		return prompt
	}

	async #promptNew(target: Branch | Path, kind: Kind): Promise<NewItemPromptHandle> {
		const { root } = this.props.model
		const node = await this.#toNode(target)
		if (node.kind !== 'branch') {
			throw new TypeError('A new item can only be prompted for inside a branch')
		}
		const parent = node as Branch
		const prompt = new NewItemPromptHandle(kind, parent)
		this.#setPrompt(prompt)
		this.#promptTarget = parent
		if (
			(parent as TreeNode) !== (root as TreeNode) &&
			(!parent.expanded || !root.isVisibleAtSurface(parent))
		) {
			// will cause an update anyway
			await parent.setExpanded()
		} else {
			await this.#batchUpdate()
		}
		this.#list.current?.scrollToItem(this.#newItemPromptInsertionIndex)
		return prompt
	}

	/** Makes sure the previous prompt is destroyed properly. */
	#setPrompt(prompt: NewItemPromptHandle | RenamePromptHandle): void {
		if (this.#prompt === prompt) {
			return
		}
		if (this.#prompt && !this.#prompt.destroyed) {
			this.#prompt.destroy()
		}
		prompt.onDestroy(() => void this.#batchUpdate())
		this.#prompt = prompt
	}

	get #adjustedRowCount(): number {
		const { root } = this.props.model
		const prompt = this.#prompt
		return this.#newItemPromptInsertionIndex > -1 &&
			prompt instanceof NewItemPromptHandle &&
			!prompt.destroyed
			? root.branchSize + 1
			: root.branchSize
	}

	#getItemAtIndex(index: number): ItemRendererProps {
		let cached: ItemRendererProps | undefined
		if (!this.props.disableCache) {
			cached = this.#rowPropsCache.get(index)
		}
		if (!cached) {
			cached = this.#computeItemAtIndex(index)
			if (!this.props.disableCache) {
				this.#rowPropsCache.set(index, cached)
			}
		}
		return cached
	}

	#computeItemAtIndex(index: number): ItemRendererProps {
		const prompt = this.#prompt
		const insertionIndex = this.#newItemPromptInsertionIndex
		const rowFor = (node: TreeNode): ItemRendererProps =>
			node.kind === 'branch'
				? { item: node as Branch, itemType: 'branch' }
				: { item: node as Leaf, itemType: 'leaf' }

		// new item prompt
		if (insertionIndex > -1 && prompt instanceof NewItemPromptHandle && !prompt.destroyed) {
			if (index === insertionIndex) {
				return {
					item: prompt,
					itemType: prompt.kind === 'leaf' ? 'newLeafPrompt' : 'newBranchPrompt',
				}
			}
			// apply the virtual backshift for the rows after the prompt
			return rowFor(this.#nodeAt(index - (index >= insertionIndex ? 1 : 0)))
		}

		const node = this.#nodeAt(index)
		// rename prompt
		if (
			prompt instanceof RenamePromptHandle &&
			!prompt.destroyed &&
			node === this.#promptTarget &&
			prompt.originalLabel === node.label
		) {
			return { item: prompt, itemType: 'renamePrompt' }
		}
		return rowFor(node)
	}

	#nodeAt(index: number): TreeNode {
		const node = this.props.model.root.getNodeAtIndex(index)
		if (!node) {
			throw new Error(`[aspen] no row at index ${index}`)
		}
		return node
	}

	readonly #renderItem = ({
		index,
		style,
	}: {
		index: number
		style: CSSProperties
	}): ReactElement => {
		const { children } = this.props
		const props = this.#getItemAtIndex(index)
		const { item, itemType } = props
		const expanded = itemType === 'branch' ? (item as Branch).expanded : undefined
		return (
			<div style={style}>
				<ItemRendererWrap
					item={item}
					depth={(item as TreeNode | PromptHandle).depth}
					itemType={itemType}
					expanded={expanded}
				>
					{children}
				</ItemRendererWrap>
			</div>
		)
	}

	readonly #getItemKey = (index: number): number | string => this.#getItemAtIndex(index).item.id
}
