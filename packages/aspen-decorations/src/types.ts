/** How far a decoration reaches from the node it targets. */
export const TargetMatchMode = {
	None: 'none',
	/** Only the node itself. */
	Self: 'self',
	/** Everything below the node, but not the node itself. */
	Children: 'children',
	SelfAndChildren: 'selfAndChildren',
} as const

export type TargetMatchMode = (typeof TargetMatchMode)[keyof typeof TargetMatchMode]
