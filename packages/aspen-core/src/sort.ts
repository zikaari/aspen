import type { TreeNode } from './node'

/** Branches first, then ascending by label (plain code unit order, so it is locale independent). */
export function defaultSort(a: TreeNode, b: TreeNode): number {
	if (a.kind !== b.kind) {
		return a.kind === 'branch' ? -1 : 1
	}
	const left = a.label
	const right = b.label
	return left > right ? 1 : left < right ? -1 : 0
}
