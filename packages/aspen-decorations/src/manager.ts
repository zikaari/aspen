import { type Disposable, DisposableGroup, type Root, type TreeNode } from 'aspen-core'
import { type ClasslistComposite, DecorationComposite } from './composite'
import type { Decoration } from './decoration'

type DecorationMeta = {
	/**
	 * All the decorations that apply to the node itself.
	 *
	 * Unless they conflict (by having specific decorations applied or negated) they share the data
	 * of their parent's `inheritable`.
	 */
	applicable: DecorationComposite

	/**
	 * All the decorations that apply to the node's children, infinitely unless explicitly negated by
	 * a target on the way down. Leaves have none.
	 *
	 * Unless they conflict they share the data of their parent's `inheritable`.
	 */
	inheritable: DecorationComposite | null
}

/**
 * Notes for contributors:
 * - A target is a node.
 * - A target is a direct target when it is explicitly listed in a decoration's applications or negations.
 * - As opposed to that, other nodes are implicit targets, and simply inherit from their parent's
 *   `inheritable` composite.
 * - All implicit targets "point to" their first parent's `inheritable`, see `DecorationMeta`.
 */
export class DecorationsManager implements Disposable {
	readonly #decorations = new Map<Decoration, DisposableGroup>()
	readonly #meta = new WeakMap<TreeNode, DecorationMeta>()
	readonly #disposables = new DisposableGroup()
	#disposed = false

	constructor(root: Root) {
		if (!root || typeof root.onDidChangeParent !== 'function') {
			throw new TypeError(
				'Unexpected object type. Expected `Root`. Make sure `aspen-core` and `aspen-decorations` versions match',
			)
		}
		// this acts as the "seed" for the rest of the decorations to come
		this.#meta.set(root, {
			applicable: new DecorationComposite(root, 'applicable', null),
			inheritable: new DecorationComposite(root, 'inheritable', null),
		})

		this.#disposables.add(root.onDidChangeParent(this.#switchParent))
		this.#disposables.add(root.onDidDispose((node) => this.#meta.delete(node)))
	}

	/** Permanently disengages the decoration system from the tree. */
	dispose(): void {
		for (const [decoration] of this.#decorations) {
			this.removeDecoration(decoration)
		}
		this.#disposables.dispose()
		this.#disposed = true
	}

	/**
	 * Adds the decoration to the tree. A decoration has no effect unless it targets some nodes: use
	 * `Decoration#addTarget` to have them show up.
	 */
	addDecoration(decoration: Decoration): void {
		if (this.#disposed) {
			throw new Error('DecorationsManager disposed')
		}
		if (this.#decorations.has(decoration)) {
			return
		}

		const subscriptions = new DisposableGroup()
		subscriptions.add(decoration.onDidAddTarget(this.#targetDecoration))
		subscriptions.add(decoration.onDidRemoveTarget(this.#unTargetDecoration))
		subscriptions.add(decoration.onDidNegateTarget(this.#negateDecoration))
		subscriptions.add(decoration.onDidUnNegateTarget(this.#unNegateDecoration))
		this.#decorations.set(decoration, subscriptions)

		for (const [target] of decoration.appliedTargets) {
			this.#targetDecoration(decoration, target)
		}
		for (const [target] of decoration.negatedTargets) {
			this.#negateDecoration(decoration, target)
		}
	}

	/**
	 * Removes the decoration from the tree. Its targets are left intact, so adding the same
	 * decoration again undoes the removal.
	 */
	removeDecoration(decoration: Decoration): void {
		const subscriptions = this.#decorations.get(decoration)
		if (!subscriptions) {
			return
		}

		for (const [target] of decoration.appliedTargets) {
			const meta = this.#meta.get(target)
			if (meta) {
				meta.applicable.remove(decoration)
				meta.inheritable?.remove(decoration)
			}
		}
		for (const [target] of decoration.negatedTargets) {
			const meta = this.#meta.get(target)
			if (meta) {
				meta.applicable.unNegate(decoration)
				meta.inheritable?.unNegate(decoration)
			}
		}

		subscriptions.dispose()
		this.#decorations.delete(decoration)
	}

	/**
	 * Returns the resolved decorations of a node: inheritance is taken into account, along with any
	 * negations that void some or all of it.
	 */
	getDecorations(node: TreeNode): ClasslistComposite | null {
		if (!node || (node.kind !== 'leaf' && node.kind !== 'branch')) {
			return null
		}
		const meta = this.getDecorationData(node)
		return meta ? meta.applicable.compositeCssClasslist : null
	}

	/** @internal */
	getDecorationData(node: TreeNode): DecorationMeta | null {
		if (this.#disposed) {
			return null
		}
		const meta = this.#meta.get(node)
		if (meta) {
			return meta
		}
		// Not a direct target, so it points to its parent's `inheritable` composite (unless negated)
		const parent = node.parent
		if (!parent) {
			return null
		}
		const parentMeta = this.getDecorationData(parent)
		if (!parentMeta?.inheritable) {
			return null
		}
		const ownMeta: DecorationMeta = {
			applicable: new DecorationComposite(node, 'applicable', parentMeta.inheritable),
			inheritable:
				node.kind === 'branch'
					? new DecorationComposite(node, 'inheritable', parentMeta.inheritable)
					: null,
		}
		this.#meta.set(node, ownMeta)
		return ownMeta
	}

	/*
	 * A target can already be gone by the time these run: the tree reports a disposed node to every
	 * listener, and the bookkeeping for it may have been dropped before the decoration got to say
	 * "this target is gone". That is fine, there is nothing left to update then.
	 */

	readonly #targetDecoration = (decoration: Decoration, target: TreeNode): void => {
		const meta = this.getDecorationData(target)
		if (!meta) {
			return
		}
		meta.applicable.add(decoration)
		meta.inheritable?.add(decoration)
	}

	readonly #unTargetDecoration = (decoration: Decoration, target: TreeNode): void => {
		const meta = this.getDecorationData(target)
		if (!meta) {
			return
		}
		meta.applicable.remove(decoration)
		meta.inheritable?.remove(decoration)
	}

	readonly #negateDecoration = (decoration: Decoration, target: TreeNode): void => {
		const meta = this.getDecorationData(target)
		if (!meta) {
			return
		}
		meta.applicable.negate(decoration)
		meta.inheritable?.negate(decoration)
	}

	readonly #unNegateDecoration = (decoration: Decoration, target: TreeNode): void => {
		const meta = this.getDecorationData(target)
		if (!meta) {
			return
		}
		meta.applicable.unNegate(decoration)
		meta.inheritable?.unNegate(decoration)
	}

	readonly #switchParent = (target: TreeNode, _prevParent: TreeNode, newParent: TreeNode): void => {
		const ownMeta = this.#meta.get(target)
		if (!ownMeta) {
			return
		}
		const newParentMeta = this.getDecorationData(newParent)
		if (!newParentMeta?.inheritable) {
			return
		}
		ownMeta.applicable.changeParent(newParentMeta.inheritable)
		ownMeta.inheritable?.changeParent(newParentMeta.inheritable)
	}
}
