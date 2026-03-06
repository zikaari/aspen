import type { Branch, Disposable, Root, TreeNode } from 'aspen-core'

// bit flags
const EXPANDED = 1
const COLLAPSED = 2
const DISABLED = 4

/**
 * Records branch expansions and collapses, so they can be undone later.
 *
 * Used for peeking at an item temporarily, without leaving a mess of expanded branches behind:
 * `begin()`, expand whatever leads to the item, `end()`, and once done looking, `reverse()`.
 */
export class Stash implements Disposable {
	readonly #root: Root
	readonly #subscription: Disposable
	#recording = false
	#keyframes: Map<Branch, number> | null = null
	readonly #lockingBranches = new Set<Branch>()

	constructor(root: Root) {
		this.#root = root
		this.#subscription = root.onDidChangeExpansionState(this.#handleExpansionChange)
	}

	/** Starts recording expansions and collapses. */
	begin(): void {
		this.#recording = true
		this.#keyframes = new Map()
	}

	/** Stops recording. What was recorded stays available to `reverse()`. */
	end(): void {
		this.#recording = false
		this.#lockingBranches.clear()
	}

	/** Undoes everything that was recorded, and forgets it. */
	async reverse(): Promise<void> {
		if (!this.#keyframes) {
			return
		}
		this.end()
		const keyframes = [...this.#keyframes]
		this.#keyframes = null
		for (const [target, flags] of keyframes) {
			// the target may have been disposed in the meantime
			if (target.disposed || (flags & DISABLED) === DISABLED) {
				continue
			}
			if ((flags & EXPANDED) === EXPANDED) {
				target.setCollapsed()
			} else if ((flags & COLLAPSED) === COLLAPSED) {
				await target.setExpanded(true)
			}
		}
	}

	/** Keeps the branches leading to this node from being closed by `reverse()`. */
	exclude(node: TreeNode): void {
		if (this.#keyframes && !this.#recording) {
			const branch = node.kind === 'leaf' ? node.parent : (node as Branch)
			if (branch) {
				this.#handleExpansionChange(branch, true, this.#root.isVisibleAtSurface(node))
			}
		}
	}

	dispose(): void {
		this.#subscription.dispose()
		this.#keyframes = null
		this.#lockingBranches.clear()
	}

	readonly #handleExpansionChange = (
		target: Branch,
		isExpanded: boolean,
		_visibleAtSurface: boolean,
	): void => {
		const keyframes = this.#keyframes
		if (!keyframes) {
			return
		}
		if (this.#recording) {
			keyframes.set(target, isExpanded ? EXPANDED : COLLAPSED)
			return
		}
		// Something was expanded "manually" (by the user) after recording ended, so the branches
		// leading to it must not be undone
		if (isExpanded) {
			for (let branch: Branch | null = target; branch; branch = branch.parent) {
				const flags = keyframes.get(branch)
				if (flags !== undefined) {
					keyframes.set(branch, flags | DISABLED)
				}
			}
			this.#lockingBranches.add(target)
		}
		// ...until that is closed again
		if (!isExpanded && this.#lockingBranches.has(target)) {
			for (let branch: Branch | null = target; branch; branch = branch.parent) {
				const flags = keyframes.get(branch)
				if (flags !== undefined) {
					keyframes.set(branch, flags & ~DISABLED)
				}
			}
			this.#lockingBranches.delete(target)
		}
	}
}
