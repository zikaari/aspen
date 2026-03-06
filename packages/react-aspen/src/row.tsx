import type { Path, TreeNode } from 'aspen-core'
import { Component, createElement, type ReactElement } from 'react'
import type { NewItemPromptHandle, RenamePromptHandle } from './prompts'
import type { ItemRenderer, ItemType } from './types'

export type RowProps = {
	item: TreeNode | NewItemPromptHandle | RenamePromptHandle
	itemType: ItemType
	depth: number
	expanded: boolean | undefined
	children: ItemRenderer
}

/** What a row shows about its node, to find out when it needs to render again without anything else changing. */
type Place = { key: string; label: string; path: Path }

const samePath = (a: Path, b: Path): boolean =>
	a === b || (a.length === b.length && a.every((segment, i) => segment === b[i]))

const samePlace = (a: Place | null, b: Place | null): boolean =>
	a === b ||
	(a !== null && b !== null && a.key === b.key && a.label === b.label && samePath(a.path, b.path))

/** The node a row is about. For prompts that is the node being renamed, or the one the new item goes into. */
function nodeOf(props: RowProps): TreeNode | null {
	switch (props.itemType) {
		case 'leaf':
		case 'branch':
			return props.item as TreeNode
		case 'renamePrompt':
			return (props.item as RenamePromptHandle).target
		case 'newLeafPrompt':
		case 'newBranchPrompt':
			return (props.item as NewItemPromptHandle).parent
		default:
			return null
	}
}

const placeOf = (props: RowProps): Place | null => {
	const node = nodeOf(props)
	return node ? { key: node.key, label: node.label, path: node.path } : null
}

export class ItemRendererWrap extends Component<RowProps> {
	// used to notice renames and moves, which change nothing about the props
	#lastPlace: Place | null = null

	override render(): ReactElement {
		const { item, itemType, children } = this.props
		return createElement(children, { item, itemType } as Parameters<ItemRenderer>[0])
	}

	override shouldComponentUpdate(nextProps: RowProps): boolean {
		// being specific is faster than iterating over both sets of props looking for a mismatch
		const props = this.props
		if (
			nextProps.item !== props.item ||
			nextProps.expanded !== props.expanded ||
			nextProps.depth !== props.depth ||
			nextProps.itemType !== props.itemType ||
			nextProps.children !== props.children
		) {
			return true
		}
		return !samePlace(placeOf(nextProps), this.#lastPlace)
	}

	override componentDidMount(): void {
		this.#lastPlace = placeOf(this.props)
	}

	override componentDidUpdate(): void {
		this.#lastPlace = placeOf(this.props)
	}
}
