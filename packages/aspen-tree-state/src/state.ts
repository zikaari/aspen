import { type Branch, type Disposable, DisposableGroup, Emitter, type TreeNode } from 'aspen-core'
import type { TreeModel } from 'aspen-tree-model'

/** What gets saved. Plain data, safe to `JSON.stringify`. */
export type SerializableState = {
	/**
	 * Lets consumers that stored a state (possibly years ago) be told apart from newer ones, should
	 * the format ever have to change again.
	 */
	specVersion: 2
	scrollPosition: number
	expandedBranches: {
		/** Expanded branches that can be seen, as paths from the root. */
		atSurface: string[][]
		/** Expanded branches buried inside a collapsed branch. */
		buried: string[][]
	}
}

/** What a state before 2.0 looked like: relative path strings in the host's path style. */
export type LegacyState = {
	specVersion: 1
	scrollPosition: number
	expandedDirectories: {
		atSurface: string[]
		buried: string[]
	}
}

export type TreeStateChange = 'scrollOffset' | 'expansion' | 'paths'

export type TreeStateOptions = {
	/** Leave out branches that are expanded but buried inside a collapsed branch. */
	readonly atSurfaceOnly?: boolean | undefined
}

type StateEvents = {
	change: [reason: TreeStateChange]
}

/**
 * Tracks a tree's expansion state and scroll offset, and restores it later.
 *
 * Snapshots are computed from the live tree when asked for, so they are always accurate: collapsing
 * a branch moves the branches below it from "at surface" to "buried" without anything to keep in sync.
 */
export class TreeState implements Disposable {
	readonly #model: TreeModel
	readonly #atSurfaceOnly: boolean
	readonly #expanded = new Set<Branch>()
	readonly #events = new Emitter<StateEvents>()
	readonly #subscriptions = new DisposableGroup()
	#pathsChanged = false

	constructor(model: TreeModel, options: TreeStateOptions = {}) {
		this.#model = model
		this.#atSurfaceOnly = options.atSurfaceOnly ?? false
		const root = model.root

		// pick up what is already expanded
		const pending: Branch[] = [root]
		for (let branch = pending.pop(); branch; branch = pending.pop()) {
			for (const child of branch.children ?? []) {
				if (child.kind === 'branch') {
					pending.push(child as Branch)
					if ((child as Branch).expanded) {
						this.#expanded.add(child as Branch)
					}
				}
			}
		}

		this.#subscriptions.add(
			root.onDidChangeExpansionState((branch, expanded) => {
				if (expanded) {
					this.#expanded.add(branch)
				} else {
					this.#expanded.delete(branch)
				}
				this.#events.emit('change', 'expansion')
			}),
		)
		this.#subscriptions.add(
			root.onDidDispose((node) => {
				if (this.#expanded.delete(node as Branch)) {
					this.#events.emit('change', 'expansion')
				}
			}),
		)
		// A move fires for every node below the one that moved. One notification is enough
		this.#subscriptions.add(
			root.onDidChangePath((node) => {
				if (!this.#expanded.has(node as Branch) || this.#pathsChanged) {
					return
				}
				this.#pathsChanged = true
				Promise.resolve().then(() => {
					this.#pathsChanged = false
					this.#events.emit('change', 'paths')
				})
			}),
		)
		this.#subscriptions.add(
			model.onDidChangeScrollOffset(() => this.#events.emit('change', 'scrollOffset')),
		)
	}

	/** Called whenever what `snapshot()` would return has changed. */
	onChange(listener: (reason: TreeStateChange) => void): Disposable {
		return this.#events.on('change', listener)
	}

	snapshot(): SerializableState {
		const root = this.#model.root
		const atSurface: Branch[] = []
		const buried: Branch[] = []
		for (const branch of this.#expanded) {
			if (branch.disposed) {
				continue
			}
			;(root.isVisibleAtSurface(branch) ? atSurface : buried).push(branch)
		}
		// Ancestors first, so they are there by the time their descendants are restored. Then by
		// path, so the same tree state always serializes to the same string
		const byDepthThenPath = (a: Branch, b: Branch): number => {
			if (a.depth !== b.depth) {
				return a.depth - b.depth
			}
			const left = a.path
			const right = b.path
			for (let i = 0; i < left.length; i++) {
				const l = left[i] as string
				const r = right[i] as string
				if (l !== r) {
					return l < r ? -1 : 1
				}
			}
			return 0
		}
		const toPaths = (branches: Branch[]): string[][] =>
			branches.sort(byDepthThenPath).map((branch) => [...branch.path])
		return {
			specVersion: 2,
			scrollPosition: this.#model.scrollOffset,
			expandedBranches: {
				atSurface: toPaths(atSurface),
				buried: this.#atSurfaceOnly ? [] : toPaths(buried),
			},
		}
	}

	/** The snapshot as JSON, ready to be stored. */
	toString(): string {
		return JSON.stringify(this.snapshot())
	}

	/**
	 * Restores a saved state. Branches that no longer exist are skipped.
	 *
	 * Call it, and wait for it, **before** handing the model to a view.
	 */
	async load(state: SerializableState | string): Promise<void> {
		const parsed: SerializableState = typeof state === 'string' ? JSON.parse(state) : state
		if (parsed?.specVersion !== 2) {
			throw new Error(
				'Unsupported tree state. States from before 2.0 can be upgraded with `migrateLegacyState`',
			)
		}
		const root = this.#model.root
		const expand = async (path: string[], ensureVisible: boolean): Promise<void> => {
			try {
				const node: TreeNode = await root.resolve(path)
				if (node.kind === 'branch') {
					await (node as Branch).setExpanded(ensureVisible)
				}
			} catch {
				// whatever was saved may be gone by now, which is fine
			}
		}
		for (const path of parsed.expandedBranches.buried) {
			await expand(path, false)
		}
		for (const path of parsed.expandedBranches.atSurface) {
			await expand(path, true)
		}
		this.#model.restoreScrollOffset(parsed.scrollPosition)
	}

	dispose(): void {
		this.#subscriptions.dispose()
		this.#expanded.clear()
		this.#events.clear()
	}
}

/**
 * Upgrades a state saved before 2.0. Those stored relative path strings in the host's path style,
 * so tell it the separator: `/` for the unix style (the default), `\` for Windows.
 */
export function migrateLegacyState(
	state: LegacyState | string,
	options: { readonly separator?: string } = {},
): SerializableState {
	const legacy: LegacyState = typeof state === 'string' ? JSON.parse(state) : state
	if (legacy?.specVersion !== 1) {
		throw new Error('Not a state from before 2.0')
	}
	const separator = options.separator ?? '/'
	const toPath = (path: string): string[] =>
		path.split(separator).filter((segment) => segment !== '')
	return {
		specVersion: 2,
		scrollPosition: legacy.scrollPosition,
		expandedBranches: {
			atSurface: legacy.expandedDirectories.atSurface.map(toPath),
			buried: legacy.expandedDirectories.buried.map(toPath),
		},
	}
}
