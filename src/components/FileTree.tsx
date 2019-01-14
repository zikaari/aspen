import { Disposable, DisposablesComposite, IDisposable, Notificar } from 'notificar'
import * as React from 'react'
import { Align, FixedSizeList } from 'react-window'
import { Directory, FileEntry, FileType, Root, TreeModel } from '../models'
import { NewFilePromptHandle, PromptHandle, RenamePromptHandle } from '../models/prompt'
import { ItemRendererWrap } from './ItemRendererWrap'
import { IFileTreeHandle, IItemRenderer, IItemRendererProps, ItemType } from './types'

export interface IFileTreeProps {
	width: number
	height: number
	itemHeight: number
	model: TreeModel
	children: IItemRenderer
	onReady?: (handle: IFileTreeHandle) => void
	style?: React.CSSProperties
	className?: string
}

enum FileTreeViewEvent {
	DidChangeModel = 1,
	DidUpdate,
}

const BATCHED_UPDATE_MAX_DEBOUNCE_MS = 4

export class FileTree extends React.Component<IFileTreeProps> {
    /**
     * Index must be one greater than target (the potential parent directory)
     *
     * Must be kept updated at ALL TIMES
     * Doing indexOf every time Root.onDidChangeBranch should be good
     */
	private newFilePromptInsertionIndex: number = -1
	private promptTargetID: number // NumericID <FileEntry | Directory>
	/**
	 * Use `this.promptHandle` when setting to a different handle. The setter ensures the previous one is  disposed off properly
	 */
	private _promptHandle: NewFilePromptHandle | RenamePromptHandle
	private idxTorendererPropsCache: Map<number, IItemRendererProps> = new Map()
	private disposables: DisposablesComposite = new DisposablesComposite()
	private events: Notificar<FileTreeViewEvent> = new Notificar()
	private listRef = React.createRef<FixedSizeList>()

	private batchUpdate = (() => {
		// For every caller who calls `batchUpdate` within `BATCHED_UPDATE_MAX_WAIT_MS`, they are given same `Promise` object they can `await` upon
		let onePromise: Promise<void>
		let resolver
		let timer: number
		const commitUpdate = () => {
			const { root } = this.props.model
			let newFilePromptInsertionIndex: number = -1
			if (this.promptTargetID > -1 &&
				this.promptHandle instanceof NewFilePromptHandle &&
				this.promptHandle.parent.expanded && root.isItemVisibleAtSurface(this.promptHandle.parent) &&
				!this.promptHandle.destroyed) {
				const idx = root.getIndexAtFileEntryID(this.promptTargetID)
				if (idx > -1 || this.promptHandle.parent === root) {
					newFilePromptInsertionIndex = idx + 1
				} else {
					this.promptTargetID = -1
				}
			}
			this.newFilePromptInsertionIndex = newFilePromptInsertionIndex
			this.idxTorendererPropsCache.clear()
			this.forceUpdate(resolver)
		}
		// return () => new Promise((res) => {
		// 	resolver = res
		// 	commitUpdate()
		// })
		return () => {
			if (!onePromise) {
				onePromise = new Promise((res) => resolver = res)
				onePromise.then(() => {
					onePromise = null
					resolver = null
					this.events.dispatch(FileTreeViewEvent.DidUpdate)
				})
			}
			// (re)schedule update commitment
			clearTimeout(timer)
			timer = setTimeout(commitUpdate, BATCHED_UPDATE_MAX_DEBOUNCE_MS) as any
			return onePromise
		}
	})()

	public render() {
		const p = this.props
		return (
			<FixedSizeList
				width={p.width}
				height={p.height}
				// this is absolutely not required, but temporarily using this as a escape hatch to force udpate list (every time its a `new Array`, meaning a re-render)
				itemData={[]}
				itemSize={p.itemHeight}
				itemKey={this.getItemKey}
				itemCount={this.adjustedRowCount}
				overscanCount={5}
				ref={this.listRef}
				onScroll={this.handleListScroll}
				style={p.style}
				className={p.className}>
				{this.renderItem}
			</FixedSizeList>)
	}

	public componentDidMount() {
		const { model, onReady } = this.props
		this.listRef.current.scrollTo(model.state.scrollOffset)
		this.disposables.add(model.onChange(this.batchUpdate))
		this.disposables.add(model.state.onDidLoadState(() => {
			this.listRef.current.scrollTo(model.state.scrollOffset)
		}))
		if (typeof onReady === 'function') {
			const api: IFileTreeHandle = {
				openDirectory: this.openDirectory,
				closeDirectory: this.closeDirectory,
				getFileHandle: this.getFileHandle,
				getModel: () => this.props.model,
				peekABoo: this.peekABoo,
				promptNewFile: this.promptNewFile,
				promptNewDirectory: this.promptNewDirectory,
				promptRename: this.promptRename,
				ensureVisible: this.ensureVisible,
				onDidChangeModel: (callback) => this.events.add(FileTreeViewEvent.DidChangeModel, callback),
				onceDidChangeModel: (callback) => this.events.once(FileTreeViewEvent.DidChangeModel, callback),
				onDidUpdate: (callback) => this.events.add(FileTreeViewEvent.DidUpdate, callback),
				onceDidUpdate: (callback) => this.events.once(FileTreeViewEvent.DidUpdate, callback),
			}

			onReady(api)
		}
	}

	public componentDidUpdate(prevProps: IFileTreeProps) {
		if (this.props.model !== prevProps.model) {
			this.disposables.dispose()
			const { model } = this.props
			this.listRef.current.scrollTo(model.state.scrollOffset)
			this.disposables.add(model.onChange(this.batchUpdate))
			this.disposables.add(model.state.onDidLoadState(() => {
				this.listRef.current.scrollTo(model.state.scrollOffset)
			}))
			this.events.dispatch(FileTreeViewEvent.DidChangeModel, prevProps.model, model)
		}
	}

	public componentWillUnmount() {
		this.disposables.dispose()
	}

	private handleListScroll = ({ scrollOffset }) => {
		this.props.model.state.saveScrollOffset(scrollOffset)
	}

	private getFileHandle = async (path: string, expandTree = true) => {
		const { root } = this.props.model
		const fileH = await root.forceLoadFileEntryAtPath(path)
		if (expandTree && !root.isItemVisibleAtSurface(fileH)) {
			await root.expandDirectory(fileH.parent, true)
		}
		return fileH
	}

	private openDirectory = async (pathOrDirectory: string | Directory) => {
		const { root } = this.props.model
		const directory: Directory = typeof pathOrDirectory === 'string'
			? await root.forceLoadFileEntryAtPath(pathOrDirectory) as Directory
			: pathOrDirectory

		if (directory && directory.constructor === Directory) {
			return root.expandDirectory(directory)
		}
	}

	private closeDirectory = async (pathOrDirectory: string | Directory) => {
		const { root } = this.props.model
		const directory: Directory = typeof pathOrDirectory === 'string'
			? await root.forceLoadFileEntryAtPath(pathOrDirectory) as Directory
			: pathOrDirectory

		if (directory && directory.constructor === Directory) {
			return root.collapseDirectory(directory)
		}
	}

	private peekABoo = async (pathOrFileEntry: string | FileEntry | Directory, timeoutOrAlign?: number | Align, maybeAlign?: Align): Promise<IDisposable> => {
		const { root, state } = this.props.model
		await root.flushEventQueue()

		const timeout = typeof timeoutOrAlign === 'number' && timeoutOrAlign >= 0 ? timeoutOrAlign : void 0
		const align: Align = (typeof timeoutOrAlign === 'string' ? timeoutOrAlign : maybeAlign) || 'center'

		const fileEntry = typeof pathOrFileEntry === 'string'
			? await root.forceLoadFileEntryAtPath(pathOrFileEntry)
			: pathOrFileEntry

		if (!(fileEntry instanceof FileEntry) || fileEntry.constructor === Root) {
			throw new TypeError(`Object not a valid FileEntry`)
		}
		state.reverseStash()
		const idx = root.getIndexAtFileEntry(fileEntry)
		if (idx < 0) {
			state.beginStashing()
			await root.expandDirectory(fileEntry.parent, true)
			state.endStashing()
		}
		this.listRef.current.scrollToItem(idx < 0 ? root.getIndexAtFileEntry(fileEntry) : idx, align)
		const disposable = new Disposable(() => {
			state.reverseStash()
		})
		if (timeout) {
			setTimeout(() => disposable.dispose(), timeout)
		}
		return disposable
	}

	private ensureVisible = async (pathOrFileEntry: string | FileEntry | Directory, align: Align = 'auto'): Promise<void> => {
		const { root, state } = this.props.model
		await root.flushEventQueue()

		const fileEntry = typeof pathOrFileEntry === 'string'
			? await root.forceLoadFileEntryAtPath(pathOrFileEntry)
			: pathOrFileEntry

		if (!(fileEntry instanceof FileEntry) || fileEntry.constructor === Root) {
			throw new TypeError(`Object not a valid FileEntry`)
		}
		if (this.scrollIntoView(fileEntry, align)) {
			state.excludeFromStash(fileEntry)
			return
		}
		state.reverseStash()
		await root.expandDirectory(fileEntry.parent, true)
		this.listRef.current.scrollToItem(root.getIndexAtFileEntry(fileEntry), align)
	}

	private scrollIntoView(fileOrDir: FileEntry | Directory, align: Align = 'center'): boolean {
		const { root } = this.props.model
		const idx = root.getIndexAtFileEntry(fileOrDir)
		if (idx > -1) {
			this.listRef.current.scrollToItem(idx, align)
			return true
		}
		return false
	}

	private promptNewDirectory = (pathOrDirectory: string | Directory): Promise<NewFilePromptHandle> => {
		return this.promptNew(pathOrDirectory, FileType.Directory)
	}

	private promptNewFile = (pathOrDirectory: string | Directory): Promise<NewFilePromptHandle> => {
		return this.promptNew(pathOrDirectory, FileType.File)
	}

	private promptRename = async (pathOrFileEntry: string | FileEntry): Promise<RenamePromptHandle> => {
		const { root } = this.props.model
		await root.flushEventQueue()
		const fileEntry = typeof pathOrFileEntry === 'string'
			? await root.forceLoadFileEntryAtPath(pathOrFileEntry)
			: pathOrFileEntry

		if (!(fileEntry instanceof FileEntry) || fileEntry.constructor === Root) {
			throw new TypeError(`Cannot rename object of type ${typeof fileEntry}`)
		}
		const promptHandle = new RenamePromptHandle(fileEntry.fileName, fileEntry)
		this.promptHandle = promptHandle
		this.promptTargetID = fileEntry.id
		if (!root.isItemVisibleAtSurface(fileEntry)) {
			await root.expandDirectory(fileEntry.parent)
		} else {
			await this.batchUpdate()
		}
		this.listRef.current.scrollToItem(root.getIndexAtFileEntryID(this.promptTargetID))
		return this.promptHandle as RenamePromptHandle
	}

	private async promptNew(pathOrDirectory: string | Directory, type: FileType): Promise<NewFilePromptHandle> {
		const { root } = this.props.model
		await root.flushEventQueue()
		const directory = typeof pathOrDirectory === 'string'
			? await root.forceLoadFileEntryAtPath(pathOrDirectory)
			: pathOrDirectory

		if (!(directory instanceof Directory)) {
			throw new TypeError(`Cannot create new file prompt at object of type ${typeof directory}`)
		}

		if (type !== FileType.File && type !== FileType.Directory) {
			throw new TypeError(`Invalid type supplied. Expected 'FileType.File' or 'FileType.Directory', got ${type}`)
		}

		const promptHandle = new NewFilePromptHandle(type, directory)
		this.promptHandle = promptHandle
		this.promptTargetID = directory.id
		if (directory !== root && (!directory.expanded || !root.isItemVisibleAtSurface(directory))) {
			// will trigger `this.update()` anyway
			await root.expandDirectory(directory)
		} else {
			await this.batchUpdate()
		}
		this.listRef.current.scrollToItem(this.newFilePromptInsertionIndex)
		return this.promptHandle as NewFilePromptHandle
	}

	private set promptHandle(handle: NewFilePromptHandle | RenamePromptHandle) {
		if (this._promptHandle === handle) { return }
		if (this._promptHandle instanceof PromptHandle && !this._promptHandle.destroyed) {
			this._promptHandle.destroy()
		}
		handle.onDestroy(this.batchUpdate)
		this._promptHandle = handle
	}

	private get promptHandle() {
		return this._promptHandle
	}

	private get adjustedRowCount() {
		const { root } = this.props.model
		return (
			this.newFilePromptInsertionIndex > -1 &&
			this.promptHandle && this.promptHandle.constructor === NewFilePromptHandle &&
			!this.promptHandle.destroyed)
			? root.branchSize + 1
			: root.branchSize
	}

	private getItemAtIndex = (index: number): IItemRendererProps => {
		let cached: IItemRendererProps = this.idxTorendererPropsCache.get(index)
		if (!cached) {
			const promptInsertionIdx = this.newFilePromptInsertionIndex
			const { root } = this.props.model
			// new file prompt
			if (promptInsertionIdx > -1 &&
				this.promptHandle && this.promptHandle.constructor === NewFilePromptHandle &&
				!this.promptHandle.destroyed) {
				if (index === promptInsertionIdx) {
					cached = {
						itemType: (this.promptHandle as NewFilePromptHandle).type === FileType.File ? ItemType.NewFilePrompt : ItemType.NewDirectoryPrompt,
						item: this.promptHandle as NewFilePromptHandle,
					} as any
				} else {
					const item = root.getFileEntryAtIndex(index - (index >= promptInsertionIdx ? 1 /* apply virtual backshift */ : 0))
					cached = {
						itemType: item.constructor === Directory ? ItemType.Directory : ItemType.File,
						item,
					} as any
				}
			} else {
				const item = root.getFileEntryAtIndex(index)
				// check for rename prompt
				if (item && item.id === this.promptTargetID &&
					this.promptHandle && this.promptHandle.constructor === RenamePromptHandle &&
					(this.promptHandle as RenamePromptHandle).originalFileName === item.fileName &&
					!this.promptHandle.destroyed) {
					cached = {
						itemType: ItemType.RenamePrompt,
						item: this.promptHandle as RenamePromptHandle,
					}
				} else {
					cached = {
						itemType: item.constructor === Directory ? ItemType.Directory : ItemType.File,
						item,
					} as any
				}
			}
			this.idxTorendererPropsCache.set(index, cached)
		}
		return cached
	}

	private renderItem = ({ index, style }): JSX.Element => {
		const { children, model } = this.props
		const { item, itemType: type } = this.getItemAtIndex(index)
		return <div style={style}>
			<ItemRendererWrap
				item={item}
				depth={item.depth}
				itemType={type}
				expanded={type === ItemType.Directory ? (item as Directory).expanded : void 0}>
				{children}
			</ItemRendererWrap>
		</div>
	}

	private getItemKey = (index: number) => this.getItemAtIndex(index).item.id
}
