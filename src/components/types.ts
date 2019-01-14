import { IDisposable } from 'notificar'
import { Align } from 'react-window'
import { Directory, FileEntry, TreeModel } from '../models'
import { NewFilePromptHandle, RenamePromptHandle } from '../models/prompt'

export enum ItemType {
	File = 1,
	Directory,
	NewFilePrompt,
	NewDirectoryPrompt,
	RenamePrompt,
}

interface IItemRendererFileProps {
	item: FileEntry
	itemType: ItemType.File
}

interface IItemRendererDirectoryProps {
	item: Directory
	itemType: ItemType.Directory
}

interface IItemRendererNewFileProps {
	item: NewFilePromptHandle
	itemType: ItemType.NewFilePrompt
}

interface IItemRendererNewDirectoryProps {
	item: NewFilePromptHandle
	itemType: ItemType.NewDirectoryPrompt
}

interface IItemRendererRenamePromptProps {
	item: RenamePromptHandle
	itemType: ItemType.RenamePrompt
}

export type IItemRendererProps = IItemRendererFileProps | IItemRendererDirectoryProps | IItemRendererNewFileProps | IItemRendererNewDirectoryProps | IItemRendererRenamePromptProps

export type IItemRenderer = (props: IItemRendererProps) => JSX.Element

export interface IFileTreeHandle {
    /**
     * Triggers a new file promt at given directory.
     * Expands directories if needed.
     * Returns a `Promise` which resolves to `IPromptHandle` you can use to interact with `input` box
     */
	promptNewFile(at: string): Promise<NewFilePromptHandle>
	promptNewFile(at: Directory): Promise<NewFilePromptHandle>

    /**
     * Triggers a new directory promt at given directory.
     * Expands directories if needed.
     * Returns a `Promise` which resolves to `IPromptHandle` you can use to interact with `input` box
     */
	promptNewDirectory(at: string): Promise<NewFilePromptHandle>
	promptNewDirectory(at: Directory): Promise<NewFilePromptHandle>

    /**
     * Triggers a rename promt at given path.
     * Expands directories if needed.
     * Returns a `Promise` which resolves to `IPromptHandle` you can use to interact with `input` box
     */
	promptRename(path: string): Promise<RenamePromptHandle>
	promptRename(directory: Directory): Promise<RenamePromptHandle>
	promptRename(fileEntry: FileEntry): Promise<RenamePromptHandle>

    /**
     * Opens/Expands a directory
     * Expands the directories in the way if needed.
     * Directory remains expanded indefinitely, until closeDirectory is called
     */
	openDirectory(path: string): Promise<void>
	openDirectory(directory: Directory): Promise<void>

    /**
     * Closes/Collapses a directory if open
     */
	closeDirectory(path: string): void
	closeDirectory(directory: Directory): void

	/**
	 * The temporary version of `ensureVisible`.
	 * Unlike `ensureVisible`, this method will cleanup the mess it creates to show the file.
	 * Once you call `dispose()` or `timeout` expires, it'll close the directories it had to expand on its way to the file you specified
	 */
	peekABoo(path: string, timeout?: number): Promise<IDisposable>
	peekABoo(fileEntry: FileEntry, timeout?: number): Promise<IDisposable>
	peekABoo(directory: Directory, timeout?: number): Promise<IDisposable>

	peekABoo(path: string, align?: Align): Promise<IDisposable>
	peekABoo(fileEntry: FileEntry, align?: Align): Promise<IDisposable>
	peekABoo(directory: Directory, align?: Align): Promise<IDisposable>

	peekABoo(path: string, timeout: number, align?: Align): Promise<IDisposable>
	peekABoo(fileEntry: FileEntry, timeout: number, align?: Align): Promise<IDisposable>
	peekABoo(directory: Directory, timeout: number, align?: Align): Promise<IDisposable>

	/**
	 * Will make its way and scroll to the specified file or path.
	 * It'll expand the directories on the way to file if necessary and unlike `peekABoo` this operation will leave the tree state as is.
	 * If you want to "see" the file quickly (for a few seconds), use `peekABoo` instead.
	 *
	 * If you just need the handle to file without altering scroll state, then use `getFileHandle` instead.
	 *
	 */
	ensureVisible(path: string, align?: Align): Promise<void>
	ensureVisible(fileEntry: FileEntry, align?: Align): Promise<void>
	ensureVisible(directory: Directory, align?: Align): Promise<void>

	/**
	 * Returns handle to FileEntry at given path
	 *
	 * By default this method will expand the directories leading to said file (if not already), but will not alter scroll state of tree (unlike `ensureVisible`)
	 * If you wish to just get the handle and not expand any directory on the way, pass `false` as second argument
	 */
	getFileHandle(path: string, expandTree?: boolean): Promise<FileEntry | Directory>

	/**
	 * Returns the current `TreeModel` this `FileTree` is attached to
	 */
	getModel(): TreeModel

	// EVENTS //
	onDidChangeModel(callback: (prevModel: TreeModel, newModel: TreeModel) => void): IDisposable
	onceDidChangeModel(callback: (prevModel: TreeModel, newModel: TreeModel) => void): IDisposable

	onDidUpdate(callback: () => void): IDisposable
	onceDidUpdate(callback: () => void): IDisposable
}
