import { DisposableGroup, type TreeNode } from 'aspen-core'
import type { Decoration } from './decoration'
import { TargetMatchMode } from './types'

/**
 * The "consumer level" part of a decoration: the classnames of every decoration that applies to a
 * node, with inheritance and negation taken into account.
 *
 * For performance reasons this is one of the few places that does not use `Disposable`s and uses
 * `addChangeListener`/`removeChangeListener` instead. Remember to pass the same **named** function
 * reference to both, from `componentDidMount` and `componentWillUnmount`.
 *
 * Note: you should also implement a `componentDidUpdate` hook, where you unsubscribe from the
 * previous composite and subscribe to the new one.
 */
export class ClasslistComposite {
	classlist: ReadonlyArray<string> = []

	/** @internal */
	constructor(
		/**
		 * Registers a function to be called when the composited classlist changes.
		 *
		 * *Remember not to use an anonymous function: pass a named function reference instead.*
		 */
		readonly addChangeListener: (namedCallback: () => void) => void,
		/**
		 * Unregisters a previously registered listener.
		 *
		 * *Remember not to use an anonymous function: pass a named function reference instead.*
		 */
		readonly removeChangeListener: (namedCallback: () => void) => void,
	) {}
}

export type CompositeType = 'applicable' | 'inheritable'

type ChangeReason = 'target' | 'untarget'

const isSelf = (mode: TargetMatchMode | undefined): boolean =>
	mode === TargetMatchMode.Self || mode === TargetMatchMode.SelfAndChildren

const isChildren = (mode: TargetMatchMode | undefined): boolean =>
	mode === TargetMatchMode.Children || mode === TargetMatchMode.SelfAndChildren

/**
 * When several decorations apply to a target, they are grouped into a `DecorationComposite`.
 *
 * @internal
 */
export class DecorationComposite {
	// The next three are only constructed when a composite owns its data (because of a direct
	// application or negation). Until then it simply shares its parent's
	renderedDecorations: Map<Decoration, DisposableGroup>
	targetedDecorations: Set<Decoration> | undefined
	negatedDecorations: Set<Decoration> | undefined

	parent: DecorationComposite | null
	compositeCssClasslist: ClasslistComposite

	readonly #target: TreeNode
	readonly #type: CompositeType
	#selfOwned: boolean
	readonly #linkedComposites = new Set<DecorationComposite>()
	readonly #classlistChangeCallbacks = new Set<() => void>()

	constructor(target: TreeNode, type: CompositeType, parent: DecorationComposite | null) {
		this.#target = target
		this.#type = type
		this.parent = parent

		this.compositeCssClasslist = new ClasslistComposite(
			(callback) => {
				this.#classlistChangeCallbacks.add(callback)
			},
			(callback) => {
				this.#classlistChangeCallbacks.delete(callback)
			},
		)

		if (parent) {
			this.#selfOwned = false
			this.renderedDecorations = parent.renderedDecorations
			this.compositeCssClasslist.classlist = parent.compositeCssClasslist.classlist
			parent.#linkedComposites.add(this)
		} else {
			this.renderedDecorations = new Map()
			this.targetedDecorations = new Set()
			this.negatedDecorations = new Set()
			this.compositeCssClasslist.classlist = []
			this.#selfOwned = true
		}
	}

	changeParent(newParent: DecorationComposite): void {
		if (!this.#selfOwned) {
			this.#parentOwn(newParent)
			return
		}

		// first purge all the decorations (unless applicable)
		for (const [decoration] of this.renderedDecorations) {
			this.#recursiveRefresh(this, false, 'untarget', decoration, false)
		}
		if (this.parent !== newParent) {
			if (this.parent) {
				this.parent.#linkedComposites.delete(this)
			}
			this.parent = newParent
			newParent.#linkedComposites.add(this)
		}

		// then add all the inherited decorations (unless not applicable)
		for (const [decoration] of newParent.renderedDecorations) {
			this.#recursiveRefresh(this, false, 'target', decoration, false)
		}
	}

	add(decoration: Decoration): void {
		const applicationMode = decoration.appliedTargets.get(this.#target)

		if (this.#type === 'applicable' && !isSelf(applicationMode)) {
			return
		}
		if (this.#type === 'inheritable' && !isChildren(applicationMode)) {
			return
		}

		if (!this.#selfOwned) {
			this.#selfOwn('target', decoration)
			this.targetedDecorations?.add(decoration)
			return
		}
		if (this.targetedDecorations?.has(decoration)) {
			return
		}
		this.targetedDecorations?.add(decoration)
		this.#recursiveRefresh(this, false, 'target', decoration)
	}

	remove(decoration: Decoration): void {
		// a composite that does not own its data would not have had the decoration to begin with
		if (!this.#selfOwned) {
			return
		}
		if (this.targetedDecorations?.delete(decoration)) {
			if (
				this.negatedDecorations?.size === 0 &&
				this.targetedDecorations.size === 0 &&
				this.parent
			) {
				this.#parentOwn(null, 'untarget', decoration)
				return
			}
			this.#recursiveRefresh(this, false, 'untarget', decoration)
		}
	}

	negate(decoration: Decoration): void {
		const negationMode = decoration.negatedTargets.get(this.#target)

		if (this.#type === 'applicable' && !isSelf(negationMode)) {
			return
		}
		if (this.#type === 'inheritable' && !isChildren(negationMode)) {
			return
		}

		if (!this.#selfOwned) {
			this.#selfOwn('untarget', decoration)
			this.negatedDecorations?.add(decoration)
			return
		}
		if (this.negatedDecorations?.has(decoration)) {
			return
		}
		this.negatedDecorations?.add(decoration)
		if (this.renderedDecorations.has(decoration)) {
			this.#removeDecorationClasslist(decoration)
		}
	}

	/** Un-negating does not mean "explicitly apply". */
	unNegate(decoration: Decoration): void {
		// a composite that does not own its data would not have been negated to begin with
		if (!this.#selfOwned) {
			return
		}
		if (this.negatedDecorations?.delete(decoration)) {
			if (
				this.negatedDecorations.size === 0 &&
				this.targetedDecorations?.size === 0 &&
				this.parent
			) {
				this.#parentOwn()
				return
			}
			if (
				// currently not present
				!this.renderedDecorations.has(decoration) &&
				// **and** either the parent or itself has it applied
				(this.parent?.renderedDecorations.has(decoration) ||
					decoration.appliedTargets.has(this.#target))
			) {
				this.#recursiveRefresh(this, false, 'target', decoration)
			}
		}
	}

	#selfOwn(reason: ChangeReason, decoration: Decoration): void {
		if (this.#selfOwned) {
			throw new Error('DecorationComposite is already self owned')
		}
		const parent = this.parent as DecorationComposite
		this.#selfOwned = true
		this.compositeCssClasslist.classlist = []
		this.renderedDecorations = new Map()
		this.targetedDecorations = new Set()
		this.negatedDecorations = new Set()

		// first process all the inherited decorations
		for (const [inheritedDecoration] of parent.renderedDecorations) {
			// the fate of the decoration (second arg) is decided in `#recursiveRefresh`
			if (inheritedDecoration !== decoration) {
				this.#processCompositeAlteration('target', inheritedDecoration)
			}
		}

		// perhaps negation is why this composite branched off
		if (
			reason === 'untarget' &&
			// the parent had it
			parent.renderedDecorations.has(decoration) &&
			// this one won't
			!this.renderedDecorations.has(decoration)
		) {
			// announce the change
			this.#notifyClasslistChange(false)
		}

		// then move on to the main business
		this.#recursiveRefresh(this, true, reason, decoration)
	}

	#parentOwn(
		newParent?: DecorationComposite | null,
		reason?: ChangeReason,
		decoration?: Decoration,
	): void {
		this.#selfOwned = false
		this.targetedDecorations = undefined
		this.negatedDecorations = undefined
		if (newParent && this.parent !== newParent) {
			if (this.parent) {
				this.parent.#linkedComposites.delete(this)
			}
			newParent.#linkedComposites.add(this)
			this.parent = newParent
		}

		this.#recursiveRefresh(this, true, reason, decoration)
	}

	#processCompositeAlteration(reason: ChangeReason, decoration: Decoration): boolean {
		if (!this.#selfOwned) {
			throw new Error('DecorationComposite is not self owned')
		}
		if (reason === 'untarget') {
			const disposable = this.renderedDecorations.get(decoration)
			if (disposable) {
				const applicationMode = decoration.appliedTargets.get(this.#target)

				if (isSelf(applicationMode) && this.#type === 'applicable') {
					return false
				}
				if (isChildren(applicationMode) && this.#type === 'inheritable') {
					return false
				}

				this.#removeDecorationClasslist(decoration, false)
				disposable.dispose()
				return this.renderedDecorations.delete(decoration)
			}
			return false
		}

		const negationMode = decoration.negatedTargets.get(this.#target)

		if (isSelf(negationMode) && this.#type === 'applicable') {
			return false
		}
		if (isChildren(negationMode) && this.#type === 'inheritable') {
			return false
		}

		if (!this.renderedDecorations.has(decoration)) {
			const disposables = new DisposableGroup()

			disposables.add(decoration.onDidAddCSSClassname(this.#handleDecorationDidAddClassname))
			disposables.add(decoration.onDidRemoveCSSClassname(this.#handleDecorationDidRemoveClassname))
			disposables.add(decoration.onDidDisableDecoration(this.#removeDecorationClasslist))
			disposables.add(decoration.onDidEnableDecoration(this.#mergeDecorationClasslist))
			this.renderedDecorations.set(decoration, disposables)
			if (!decoration.disabled) {
				;(this.compositeCssClasslist.classlist as string[]).push(...decoration.cssClasslist)
				return true
			}
		}
		return false
	}

	#recursiveRefresh(
		origin: DecorationComposite,
		updateReferences: boolean,
		reason?: ChangeReason,
		decoration?: Decoration,
		notifyListeners = true,
	): void {
		// references changed
		if (!this.#selfOwned && updateReferences && this.parent) {
			this.renderedDecorations = this.parent.renderedDecorations
			this.compositeCssClasslist.classlist = this.parent.compositeCssClasslist.classlist
		}

		if (this.#selfOwned && updateReferences && origin !== this) {
			// purge all the decorations (unless applicable)
			for (const [renderedDecoration] of this.renderedDecorations) {
				this.#processCompositeAlteration('untarget', renderedDecoration)
			}

			// then add all the inherited decorations (unless not applicable)
			for (const [inheritedDecoration] of this.parent?.renderedDecorations ?? []) {
				this.#processCompositeAlteration('target', inheritedDecoration)
			}

			if (notifyListeners) {
				this.#notifyClasslistChange(false)
			}
		} else if (
			this.#selfOwned &&
			reason === 'untarget' &&
			decoration &&
			this.renderedDecorations.has(decoration)
		) {
			this.#processCompositeAlteration(reason, decoration)
			if (notifyListeners) {
				this.#notifyClasslistChange(false)
			}
		} else if (
			this.#selfOwned &&
			reason === 'target' &&
			decoration &&
			this.#processCompositeAlteration(reason, decoration) &&
			notifyListeners
		) {
			this.#notifyClasslistChange(false)
		} else if (!this.#selfOwned && notifyListeners) {
			this.#notifyClasslistChange(false)
		}

		for (const linkedComposite of this.#linkedComposites) {
			linkedComposite.#recursiveRefresh(
				origin,
				updateReferences,
				reason,
				decoration,
				notifyListeners,
			)
		}
	}

	readonly #handleDecorationDidAddClassname = (
		_decoration: Decoration,
		classname: string,
	): void => {
		this.#assertSelfOwned()
		;(this.compositeCssClasslist.classlist as string[]).push(classname)
		this.#notifyClasslistChange()
	}

	readonly #handleDecorationDidRemoveClassname = (
		_decoration: Decoration,
		classname: string,
	): void => {
		this.#assertSelfOwned()
		const idx = this.compositeCssClasslist.classlist.indexOf(classname)
		if (idx > -1) {
			;(this.compositeCssClasslist.classlist as string[]).splice(idx, 1)
			this.#notifyClasslistChange()
		}
	}

	readonly #mergeDecorationClasslist = (decoration: Decoration): void => {
		this.#assertSelfOwned()
		;(this.compositeCssClasslist.classlist as string[]).push(...decoration.cssClasslist)
		this.#notifyClasslistChange()
	}

	readonly #removeDecorationClasslist = (decoration: Decoration, notifyAll = true): void => {
		this.#assertSelfOwned()
		for (const classname of decoration.cssClasslist) {
			const idx = this.compositeCssClasslist.classlist.indexOf(classname)
			if (idx > -1) {
				;(this.compositeCssClasslist.classlist as string[]).splice(idx, 1)
			}
		}
		if (notifyAll) {
			this.#notifyClasslistChange()
		}
	}

	#assertSelfOwned(): void {
		if (!this.#selfOwned) {
			throw new Error(
				'[INTERNAL] A non-self owned composite must not be in charge of Decoration events',
			)
		}
	}

	#notifyClasslistChange(recursive = true): void {
		// It is important not to iterate over the set directly: if a callback adds or removes a
		// callback (inside another callback) the loop could go on forever
		for (const callback of [...this.#classlistChangeCallbacks]) {
			callback()
		}
		if (recursive) {
			for (const linkedComposite of this.#linkedComposites) {
				if (!linkedComposite.#selfOwned) {
					linkedComposite.#notifyClasslistChange()
				}
			}
		}
	}
}
