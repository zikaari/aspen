import {
	type Branch,
	type Disposable,
	Emitter,
	type Leaf,
	type Root,
	type TreeNode,
} from 'aspen-core'
import { TargetMatchMode } from './types'

type DecorationEvents = {
	addTarget: [decoration: Decoration, target: TreeNode, flags: TargetMatchMode]
	removeTarget: [decoration: Decoration, target: TreeNode]
	negateTarget: [decoration: Decoration, target: TreeNode, flags: TargetMatchMode]
	unNegateTarget: [decoration: Decoration, target: TreeNode]
	addCSSClassname: [decoration: Decoration, classname: string]
	removeCSSClassname: [decoration: Decoration, classname: string]
	enabled: [decoration: Decoration]
	disabled: [decoration: Decoration]
}

const isNode = (target: unknown): target is TreeNode =>
	target !== null &&
	typeof target === 'object' &&
	((target as TreeNode).kind === 'leaf' || (target as TreeNode).kind === 'branch')

/** A set of CSS classes, and the nodes it applies to (or is negated on). */
export class Decoration {
	/** Do not mutate directly, use `Decoration#addCSSClass()` and `Decoration#removeCSSClass()`. */
	readonly cssClasslist: Set<string>

	readonly #appliedTargets = new Map<TreeNode, TargetMatchMode>()
	readonly #negatedTargets = new Map<TreeNode, TargetMatchMode>()
	readonly #events = new Emitter<DecorationEvents>()
	/** Targets go away when they are disposed. One subscription per tree is enough to learn about that. */
	readonly #watchedRoots = new Map<Root, { targets: number; subscription: Disposable }>()
	#disabled = false

	constructor(...cssClasslist: string[]) {
		if (!cssClasslist.every((classname) => typeof classname === 'string')) {
			throw new TypeError('classlist must be of type `Array<string>`')
		}
		this.cssClasslist = new Set(cssClasslist)
	}

	get disabled(): boolean {
		return this.#disabled
	}

	set disabled(disabled: boolean) {
		this.#disabled = disabled
		this.#events.emit(disabled ? 'disabled' : 'enabled', this)
	}

	get appliedTargets(): ReadonlyMap<TreeNode, TargetMatchMode> {
		return this.#appliedTargets
	}

	get negatedTargets(): ReadonlyMap<TreeNode, TargetMatchMode> {
		return this.#negatedTargets
	}

	addCSSClass(classname: string): void {
		if (this.cssClasslist.has(classname)) {
			return
		}
		this.cssClasslist.add(classname)
		this.#events.emit('addCSSClassname', this, classname)
	}

	removeCSSClass(classname: string): void {
		if (!this.cssClasslist.has(classname)) {
			return
		}
		this.cssClasslist.delete(classname)
		this.#events.emit('removeCSSClassname', this, classname)
	}

	addTarget(branch: Branch, flags: TargetMatchMode): void
	addTarget(leaf: Leaf): void
	addTarget(target: TreeNode, flags: TargetMatchMode = TargetMatchMode.Self): void {
		if (!isNode(target) || this.#appliedTargets.get(target) === flags) {
			return
		}
		const isNew = !this.#appliedTargets.has(target)
		this.#appliedTargets.set(target, flags)
		this.#events.emit('addTarget', this, target, flags)
		if (isNew) {
			this.#watch(target.root)
		}
	}

	removeTarget(branch: Branch): void
	removeTarget(leaf: Leaf): void
	removeTarget(target: TreeNode): void {
		if (this.#appliedTargets.delete(target)) {
			this.#events.emit('removeTarget', this, target)
			this.#unwatch(target.root)
		}
	}

	negateTarget(branch: Branch, flags: TargetMatchMode): void
	negateTarget(leaf: Leaf): void
	negateTarget(target: TreeNode, flags: TargetMatchMode = TargetMatchMode.Self): void {
		if (!isNode(target) || this.#negatedTargets.get(target) === flags) {
			return
		}
		const isNew = !this.#negatedTargets.has(target)
		this.#negatedTargets.set(target, flags)
		this.#events.emit('negateTarget', this, target, flags)
		if (isNew) {
			this.#watch(target.root)
		}
	}

	unNegateTarget(branch: Branch): void
	unNegateTarget(leaf: Leaf): void
	unNegateTarget(target: TreeNode): void {
		if (this.#negatedTargets.delete(target)) {
			this.#events.emit('unNegateTarget', this, target)
			this.#unwatch(target.root)
		}
	}

	onDidAddTarget(
		listener: (decoration: Decoration, target: TreeNode, flags: TargetMatchMode) => void,
	): Disposable {
		return this.#events.on('addTarget', listener)
	}

	onDidRemoveTarget(listener: (decoration: Decoration, target: TreeNode) => void): Disposable {
		return this.#events.on('removeTarget', listener)
	}

	onDidNegateTarget(
		listener: (decoration: Decoration, target: TreeNode, flags: TargetMatchMode) => void,
	): Disposable {
		return this.#events.on('negateTarget', listener)
	}

	onDidUnNegateTarget(listener: (decoration: Decoration, target: TreeNode) => void): Disposable {
		return this.#events.on('unNegateTarget', listener)
	}

	onDidRemoveCSSClassname(
		listener: (decoration: Decoration, classname: string) => void,
	): Disposable {
		return this.#events.on('removeCSSClassname', listener)
	}

	onDidAddCSSClassname(listener: (decoration: Decoration, classname: string) => void): Disposable {
		return this.#events.on('addCSSClassname', listener)
	}

	onDidEnableDecoration(listener: (decoration: Decoration) => void): Disposable {
		return this.#events.on('enabled', listener)
	}

	onDidDisableDecoration(listener: (decoration: Decoration) => void): Disposable {
		return this.#events.on('disabled', listener)
	}

	#watch(root: Root): void {
		const watched = this.#watchedRoots.get(root)
		if (watched) {
			watched.targets++
			return
		}
		const subscription = root.onDidDispose((node) => {
			if (this.#appliedTargets.has(node)) {
				this.removeTarget(node as Leaf)
			}
			if (this.#negatedTargets.has(node)) {
				this.unNegateTarget(node as Leaf)
			}
		})
		this.#watchedRoots.set(root, { targets: 1, subscription })
	}

	#unwatch(root: Root): void {
		const watched = this.#watchedRoots.get(root)
		if (watched && --watched.targets <= 0) {
			watched.subscription.dispose()
			this.#watchedRoots.delete(root)
		}
	}
}
