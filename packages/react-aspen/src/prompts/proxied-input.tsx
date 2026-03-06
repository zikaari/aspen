import {
	Component,
	createRef,
	forwardRef,
	type ReactElement,
	type Ref,
	type RefObject,
} from 'react'

export type ProxiedInputProps = {
	innerRef?: Ref<HTMLInputElement> | undefined
	className?: string | undefined
	id?: string | undefined
	style?: Record<string, string | number | undefined> | undefined
}

type InternalProps = ProxiedInputProps & {
	inputElement: HTMLInputElement
}

/**
 * Renders a placeholder `<input>` and swaps the real, persistent one in as soon as it mounts.
 *
 * Prompts must be managed outside of React's rendering: in a virtualized list, rows are destroyed as
 * the user scrolls far enough, but the input's state (its value, selection, undo history, IME
 * composition) has to survive that.
 */
class ProxiedInput extends Component<InternalProps> {
	readonly #placeholder: RefObject<HTMLInputElement | null> = createRef<HTMLInputElement>()

	override render(): ReactElement {
		// styling the placeholder as well avoids a flash of unstyled content in between
		return (
			<input
				type="text"
				className={this.props.className}
				id={this.props.id}
				style={this.props.style}
				ref={this.#placeholder}
			/>
		)
	}

	override componentDidMount(): void {
		const { innerRef, inputElement } = this.props
		const placeholder = this.#placeholder.current
		placeholder?.parentElement?.replaceChild(inputElement, placeholder)
		this.#applyAttributes()
		inputElement.focus()
		if (typeof innerRef === 'function') {
			innerRef(inputElement)
		} else if (innerRef && innerRef.current === null) {
			;(innerRef as { current: HTMLInputElement | null }).current = inputElement
		}
	}

	override componentWillUnmount(): void {
		const { innerRef, inputElement } = this.props
		const placeholder = this.#placeholder.current
		if (placeholder) {
			inputElement.parentElement?.replaceChild(placeholder, inputElement)
		}
		if (innerRef && typeof innerRef === 'object' && innerRef.current) {
			;(innerRef as { current: HTMLInputElement | null }).current = null
		}
	}

	override shouldComponentUpdate(nextProps: InternalProps): boolean {
		this.#applyAttributes(nextProps)
		return false
	}

	#applyAttributes(props: InternalProps = this.props): void {
		const { className, id, inputElement, style } = props
		if (typeof className === 'string') {
			inputElement.className = className
		}
		if (typeof id === 'string') {
			inputElement.id = id
		}
		if (style !== null && typeof style === 'object') {
			for (const prop of Object.keys(style)) {
				const value = style[prop]
				if (typeof value === 'string' && prop in inputElement.style) {
					;(inputElement.style as unknown as Record<string, string>)[prop] = value
				}
			}
		}
	}
}

const Input = forwardRef<HTMLInputElement, InternalProps>((props, ref) => (
	<ProxiedInput {...props} innerRef={ref} />
))

export function bindInputElement(
	element: HTMLInputElement,
): (props: ProxiedInputProps) => ReactElement {
	return (props) => <Input {...props} inputElement={element} />
}
