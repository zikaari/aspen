import { DisposablesComposite, IDisposable, Notificar } from 'notificar'
import { bindInputElement, IProxiedInputProps } from '../../components/ProxiedInput'

const delay = (ms) => new Promise((res) => setTimeout(res, ms))
const isArray = Array.isArray
const isProduction = typeof process === 'undefined' || process.env.NODE_ENV !== 'production' ? false : true

enum PromptEvent {
	Change = 1,
	Commit,
	Cancel,
	Focus,
	Blur,
	Destroy,
}

/**
 * Prompts MUST be managed outside of React's and (react-virtualized's) rendering algorithms
 * Since we're using react-virtualized, typical React input elements would get destroyed once user scrolls quite far up/down
 * But the input's state MUST BE PRESERVED (example: value, undo/redo history) we do this by managing a "manual" HTMLInputElement outside of React
 */
export abstract class PromptHandle {
	public readonly $: HTMLInputElement
	public readonly ProxiedInput: (props: IProxiedInputProps) => JSX.Element
	private events: Notificar<PromptEvent> = new Notificar()
	private disposables: DisposablesComposite = new DisposablesComposite()
	private isInPendingCommitState: boolean = false
	private _destroyed: boolean = false
	constructor() {
		this.$ = document.createElement('input')
		this.$.setAttribute('type', 'text')
		this.ProxiedInput = bindInputElement(this.$)
		this.$.addEventListener('click', this.handleClick)
		this.$.addEventListener('keyup', this.handleKeyup)
		this.$.addEventListener('keydown', this.handleKeydown)
		this.$.addEventListener('focus', this.handleFocus)
		this.$.addEventListener('blur', this.handleBlur)

		if (!isProduction) {
			delay(2000).then(() => {
				if (!this._destroyed && !this.$.isConnected) {
					console.error(`PromptHandle created but never used. A potential memory leak vector.`)
				}
			})
		}
	}

	abstract get id(): number

	abstract get depth(): number

	get destroyed() {
		return this._destroyed
	}

	public onChange(callback: (value: string) => void): IDisposable {
		return this.disposables.add(
			this.events.add(PromptEvent.Change, callback))
	}

	/**
	 * Callback called right after user hits Enter key on prompt handle
	 *
	 * User's input is *not* processed in any way or shape therefore hosts must verify the input and check for any invalid characters etc.
	 * If everything is green and a file is indeed created (and/or moved) successfuly, hosts can either dispatch a watch event at the parent Directory or
	 * use `Root#inotify` method.
	 */
	public onCommit(callback: (value: string) => void): IDisposable {
		return this.disposables.add(
			this.events.add(PromptEvent.Commit, callback))
	}

	public onCancel(callback: (value: string) => void): IDisposable {
		return this.disposables.add(
			this.events.add(PromptEvent.Cancel, callback))
	}

	public onFocus(callback: (value: string) => void): IDisposable {
		return this.disposables.add(
			this.events.add(PromptEvent.Focus, callback))
	}

	public onBlur(callback: (value: string) => void): IDisposable {
		return this.disposables.add(
			this.events.add(PromptEvent.Blur, callback))
	}

	public onDestroy(callback: (value: string) => void): IDisposable {
		return this.disposables.add(
			this.events.add(PromptEvent.Destroy, callback))
	}

	public focus(): void {
		this.$.focus()
	}

	public setSelectionRange(start: number, end: number): void {
		this.$.setSelectionRange(start, end)
	}

	public addClassName(classname: string): void {
		this.$.classList.add(classname)
	}

	public removeClassName(classname: string): void {
		this.$.classList.remove(classname)
	}

	public destroy(): void {
		if (this._destroyed) {
			return
		}
		this._destroyed = true
		this.$.removeEventListener('click', this.handleClick)
		this.$.removeEventListener('keyup', this.handleKeyup)
		this.$.removeEventListener('keydown', this.handleKeydown)
		this.$.removeEventListener('focus', this.handleFocus)
		this.$.removeEventListener('blur', this.handleBlur)
		this.$.disabled = false
		this.events.dispatch(PromptEvent.Destroy)
		this.disposables.dispose()

		if (!isProduction) {
			delay(1000).then(() => {
				if (this.$.isConnected) {
					console.error(`[INTERNAL] A PromptHandle associated HTMLInputElement, which is now obsolete, is still mounted in the DOM. PromptHandles are useless once destroyed.`)
				}
			})
		}
	}

	private handleClick = (ev) => {
		ev.stopPropagation()
	}

	private handleKeyup = (ev) => {
		this.events.dispatch(PromptEvent.Change, this.$.value)
	}

	private handleKeydown = async (ev) => {
		if (ev.key === 'Escape') {
			if ((await Promise.all(
				this.events.dispatchWithReturn<boolean>(PromptEvent.Cancel, this.$.value))
			).some((r) => r === false)) {
				return
			}
			this.destroy()
		}

		if (ev.key === 'Enter') {
			this.isInPendingCommitState = true
			this.$.disabled = true
			if ((await Promise.all(
				this.events.dispatchWithReturn<boolean>(PromptEvent.Commit, this.$.value))
			).some((r) => r === false)) {
				this.isInPendingCommitState = false
				this.$.disabled = false
				this.$.focus()
				return
			}
			this.isInPendingCommitState = false
			this.$.disabled = false
			this.destroy()
		}
	}

	private handleFocus = () => {
		this.events.dispatch(PromptEvent.Focus, this.$.value)
	}

	private handleBlur = async (ev) => {
		await delay(0) // CRITICAL: If `input` was "unmounted" due to `react-virtualized`, the `isConnecteed` property isn't updated until after next tick

		// If input isn't in the DOM but also not "manually" destroyed, that just means `react-virtualized` had it "unmount" due to it not being in the viewport
		if (!this.$.isConnected && !this.destroyed) {
			return
		}
		if ((await Promise.all(
			this.events.dispatchWithReturn<boolean>(PromptEvent.Blur, this.$.value))
		).some((r) => r === false)) {
			return
		}

		if (!this.isInPendingCommitState) {
			this.destroy()
		}
	}
}
