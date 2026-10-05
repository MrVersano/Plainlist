// System-wide Quick Entry: a global shortcut that opens the "New to-do" palette in a small
// floating window above whatever app is in front. Desktop only. main.ts loads this module
// with a dynamic import behind Platform.isDesktopApp, and Electron is reached only through
// `window.require` at runtime, so nothing here runs on mobile.
//
// The window comes from `window.open('about:blank', …, 'popup,…')`, the route Obsidian uses for
// its own popout windows: its main process allows it, and the window shares this renderer, so
// the palette renders straight into it with Preact. The same Capture component, theme CSS and
// save path serve both the modal and the window, with no second bundle, preload script or IPC.

import { Component, Notice, Platform } from 'obsidian';
import { h, render } from 'preact';
import { formatAccelerator } from '../accelerator';
import { startCapture } from '../capture';
import type PlainlistPlugin from '../main';
import { Capture } from '../ui/components/Capture';

// The few Electron APIs used here, typed locally (the project doesn't depend on electron).
interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface ElectronWindow {
	id: number;
	isDestroyed(): boolean;
	isVisible(): boolean;
	isFocused(): boolean;
	show(): void;
	hide(): void;
	focus(): void;
	destroy(): void;
	getBounds(): Rect;
	setBounds(bounds: Rect): void;
	setResizable(resizable: boolean): void;
	setSkipTaskbar(skip: boolean): void;
	setAlwaysOnTop(flag: boolean, level?: string): void;
	setWindowButtonVisibility?(visible: boolean): void;
	on(event: 'blur', listener: () => void): void;
	removeListener(event: 'blur', listener: () => void): void;
}

interface Remote {
	BrowserWindow: { getAllWindows(): ElectronWindow[] };
	globalShortcut: {
		register(accelerator: string, callback: () => void): boolean;
		unregister(accelerator: string): void;
		isRegistered(accelerator: string): boolean;
	};
	screen: {
		getCursorScreenPoint(): { x: number; y: number };
		getDisplayNearestPoint(point: { x: number; y: number }): { workArea: Rect };
	};
}

const WIDTH = 600;
/** Space kept below a popover so its shadow isn't clipped by the window edge. */
const POPOVER_MARGIN = 16;

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** Electron's `remote` module as Obsidian exposes it to plugins, or null when unavailable. */
function electronRemote(): Remote | null {
	try {
		const req = (window as unknown as { require?: (id: string) => unknown }).require;
		const electron = req?.('electron') as { remote?: Remote } | undefined;
		const remote = electron?.remote;
		return remote?.BrowserWindow && remote.globalShortcut && remote.screen ? remote : null;
	} catch (e) {
		console.error('Plainlist: Electron is unavailable', e);
		return null;
	}
}

/** Owns the global shortcut and the floating window. Added as a child of the plugin, so unloading the plugin cleans both up. */
export class QuickEntryService extends Component {
	/** Why the shortcut is not registered, for the settings tab; null when all is well. */
	error: string | null = null;
	private registered: string | null = null;
	private window: QuickEntryWindow | null = null;

	static create(plugin: PlainlistPlugin): QuickEntryService | null {
		const remote = electronRemote();
		if (remote) return new QuickEntryService(plugin, remote);
		console.error('Plainlist: system-wide Quick Entry needs Electron, which this Obsidian build does not expose');
		return null;
	}

	private constructor(
		private plugin: PlainlistPlugin,
		private remote: Remote,
	) {
		super();
	}

	onload(): void {
		this.apply();
		// Reloading the window (Ctrl/Cmd+R) skips onunload; release the shortcut and window anyway,
		// or the shortcut would stay registered to a dead page.
		this.registerDomEvent(window, 'beforeunload', () => this.release());
	}

	onunload(): void {
		this.release();
	}

	/** Registers, re-registers or drops the shortcut to match the settings. */
	apply(): void {
		const { quickEntryEnabled, quickEntryShortcut } = this.plugin.settings;
		const wanted = quickEntryEnabled ? quickEntryShortcut : null;
		if (wanted === this.registered && (wanted || !this.error)) return;
		this.unregisterShortcut();
		this.error = null;
		if (!wanted) {
			this.window?.destroy();
			this.window = null;
			return;
		}
		this.registerShortcut(wanted);
	}

	/** Lets the settings tab record a new shortcut, including the current one, without opening Quick Entry. */
	suspend(): void {
		this.unregisterShortcut();
	}

	private registerShortcut(accelerator: string): void {
		const label = formatAccelerator(accelerator, Platform.isMacOS);
		try {
			if (this.remote.globalShortcut.isRegistered(accelerator)) {
				this.error = `${label} is already in use in Obsidian, perhaps by Plainlist in another vault window.`;
			} else if (this.remote.globalShortcut.register(accelerator, () => void this.open())) {
				this.registered = accelerator;
				return;
			} else {
				this.error = `${label} is already in use by another app or by the system.`;
			}
		} catch (e) {
			console.warn('Plainlist: Electron rejected the Quick Entry shortcut', e);
			this.error = `“${accelerator}” is not a valid shortcut. Record a new one in Plainlist's settings.`;
		}
		console.warn(`Plainlist: could not register the Quick Entry shortcut. ${this.error}`);
		new Notice(`Plainlist: could not set up the quick entry shortcut. ${this.error}`);
	}

	private unregisterShortcut(): void {
		if (!this.registered) return;
		try {
			this.remote.globalShortcut.unregister(this.registered);
		} catch (e) {
			console.error('Plainlist: could not unregister the Quick Entry shortcut', e);
		}
		this.registered = null;
	}

	private release(): void {
		this.unregisterShortcut();
		this.window?.destroy();
		this.window = null;
	}

	private async open(): Promise<void> {
		this.window ??= new QuickEntryWindow(this.plugin, this.remote);
		try {
			await this.window.show();
		} catch (e) {
			console.error('Plainlist: could not open Quick Entry', e);
			new Notice(`Plainlist: could not open quick entry. ${message(e)}`);
			this.window.destroy();
			this.window = null;
		}
	}
}

/** The floating palette. Created on first use, then hidden and shown again rather than recreated. */
class QuickEntryWindow {
	private win: Window | null = null;
	private native: ElectronWindow | null = null;
	private root: HTMLElement | null = null;
	private closeList: { current: (() => boolean) | null } = { current: null };
	private clones = new WeakMap<Element, Element>();
	private observers: { disconnect(): void }[] = [];
	private blurTimer: number | null = null;
	private opening = false;
	/** Set for good by destroy(), so an open still loading the tasks file doesn't create a window afterwards. */
	private destroyed = false;

	constructor(
		private plugin: PlainlistPlugin,
		private remote: Remote,
	) {}

	private get alive(): boolean {
		return !!this.win && !this.win.closed && !!this.native && !this.native.isDestroyed();
	}

	async show(): Promise<void> {
		if (this.alive && this.native?.isVisible()) {
			this.focus();
			return;
		}
		// Shortcut pressed again while the tasks file is still loading.
		if (this.opening) return;
		this.opening = true;
		try {
			const options = await this.plugin.inboxCaptureOptions();
			if (!options) return;
			const session = await startCapture(this.plugin.app, options);
			if (this.destroyed) return;
			if (!this.alive) this.create();
			const { native, root } = this;
			if (!native || !root) return;
			await this.syncTheme();
			if (this.destroyed) return;
			render(null, root);
			render(
				h(Capture, {
					today: options.today,
					weekStart: options.weekStart,
					projects: session.projects,
					initialProject: session.initialProject,
					defaultDate: options.defaultDate,
					closeList: this.closeList,
					onSave: session.save,
					onClose: () => this.hide(),
				}),
				root,
			);
			this.place();
			native.show();
			this.focus();
			// Catch layout that settles after the first paint.
			this.win?.requestAnimationFrame(() => this.fit());
		} finally {
			this.opening = false;
		}
	}

	hide(): void {
		this.clearBlurTimer();
		if (this.root) render(null, this.root);
		if (this.alive) this.native?.hide();
	}

	destroy(): void {
		this.destroyed = true;
		this.teardown();
	}

	private teardown(): void {
		this.clearBlurTimer();
		for (const o of this.observers) o.disconnect();
		this.observers = [];
		if (this.root) render(null, this.root);
		this.root = null;
		try {
			if (this.native && !this.native.isDestroyed()) {
				this.native.removeListener('blur', this.onBlur);
				this.native.destroy();
			}
		} catch (e) {
			console.error('Plainlist: could not close the Quick Entry window', e);
		}
		if (this.win && !this.win.closed) this.win.close();
		this.native = null;
		this.win = null;
	}

	private create(): void {
		this.teardown();
		const before = new Set(this.remote.BrowserWindow.getAllWindows().map((w) => w.id));
		// Obsidian's handler only allows "popup" windows and fixes frame and webPreferences; Electron
		// takes the remaining BrowserWindow options from the feature string. On macOS a panel takes
		// keyboard focus without activating Obsidian, so the app you were in stays in front.
		const features = [
			'popup',
			`width=${WIDTH}`,
			'height=200',
			'alwaysOnTop=yes',
			'skipTaskbar=yes',
			'resizable=no',
			'minimizable=no',
			'maximizable=no',
			'fullscreenable=no',
			...(Platform.isMacOS ? ['type=panel'] : []),
		];
		const background = hexColor(getComputedStyle(document.body).backgroundColor);
		if (background) features.push(`background=${background}`);
		const win = window.open('about:blank', '_blank', features.join(','));
		const native = this.remote.BrowserWindow.getAllWindows().find((w) => !before.has(w.id));
		if (!win || !native) {
			win?.close();
			throw new Error('Obsidian did not open the window.');
		}
		this.win = win;
		this.native = native;

		native.setResizable(false);
		native.setSkipTaskbar(true);
		native.setAlwaysOnTop(true, 'floating');
		native.setWindowButtonVisibility?.(false);
		native.on('blur', this.onBlur);

		const doc = win.document;
		doc.title = 'Plainlist';
		// Built with the main window's helpers; appending adopts them into this document, which has none.
		// The base element resolves Obsidian's relative stylesheet and font URLs as the main window does.
		doc.head.appendChild(createEl('base', { attr: { href: location.href } }));
		const root = doc.body.appendChild(createDiv({ cls: 'pl-quick-entry' }));
		this.root = root;

		doc.addEventListener('keydown', (evt) => {
			// Popovers handle their own Escape and stop it there.
			if (evt.key !== 'Escape' || evt.isComposing || evt.defaultPrevented) return;
			evt.preventDefault();
			if (!this.closeList.current?.()) this.hide();
		});
		// Size the window to the palette, including a project list floating out past its edge.
		const fit = (): void => this.fit();
		const resize = new ResizeObserver(fit);
		resize.observe(root);
		const mutations = new MutationObserver(fit);
		mutations.observe(root, { childList: true, subtree: true });
		this.observers = [resize, mutations];
	}

	/** Hides when another app or window takes focus. The palette's own lists are DOM, so they never blur it. */
	private onBlur = (): void => {
		this.clearBlurTimer();
		this.blurTimer = window.setTimeout(() => {
			this.blurTimer = null;
			if (this.alive && this.native?.isVisible() && !this.native.isFocused()) this.hide();
		}, 50);
	};

	private clearBlurTimer(): void {
		if (this.blurTimer !== null) window.clearTimeout(this.blurTimer);
		this.blurTimer = null;
	}

	private focus(): void {
		if (!this.alive) return;
		this.native?.focus();
		this.win?.focus();
		this.root?.querySelector<HTMLInputElement>('.pl-capture-input')?.focus();
	}

	/** Centres the window near the top of the screen with the mouse pointer, like Spotlight. */
	private place(): void {
		const { screen } = this.remote;
		const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
		const x = workArea.x + Math.round((workArea.width - WIDTH) / 2);
		const y = workArea.y + Math.round(workArea.height * 0.2);
		this.native?.setBounds({ x, y, width: WIDTH, height: this.contentHeight() ?? 200 });
	}

	private fit(): void {
		const height = this.contentHeight();
		if (height === null || !this.native) return;
		const bounds = this.native.getBounds();
		if (bounds.height !== height) this.native.setBounds({ ...bounds, width: WIDTH, height });
	}

	/** The palette's height, including a list floating past its edge; null while nothing is mounted. */
	private contentHeight(): number | null {
		const palette = this.root?.firstElementChild;
		if (!this.alive || !palette) return null;
		let bottom = palette.getBoundingClientRect().bottom;
		for (const el of Array.from(palette.querySelectorAll('.pl-popover'))) {
			bottom = Math.max(bottom, el.getBoundingClientRect().bottom + POPOVER_MARGIN);
		}
		return Math.ceil(bottom);
	}

	/**
	 * Copies the main window's stylesheets, theme classes and CSS variables, so the palette matches
	 * the current theme. Resolves once newly copied stylesheets load, so the palette is measured styled.
	 */
	private async syncTheme(): Promise<void> {
		const doc = this.win?.document;
		if (!doc) return;
		const wanted: Element[] = [];
		const loading: Promise<unknown>[] = [];
		for (const node of Array.from(document.head.children)) {
			const isStyle = node.tagName === 'STYLE';
			if (!isStyle && !(node.tagName === 'LINK' && node.getAttribute('rel') === 'stylesheet')) continue;
			let clone = this.clones.get(node);
			if (!clone || (isStyle && clone.textContent !== node.textContent)) {
				clone = doc.importNode(node, true);
				this.clones.set(node, clone);
				if (!isStyle) {
					const link = clone;
					loading.push(new Promise((resolve) => {
						link.addEventListener('load', resolve, { once: true });
						link.addEventListener('error', resolve, { once: true });
					}));
				}
			}
			wanted.push(clone);
		}
		const current = Array.from(doc.head.querySelectorAll('style, link[rel="stylesheet"]'));
		if (current.length !== wanted.length || current.some((el, i) => el !== wanted[i])) {
			for (const el of current) if (!wanted.includes(el)) el.remove();
			for (const el of wanted) doc.head.appendChild(el);
		}
		doc.documentElement.className = document.documentElement.className;
		doc.documentElement.setAttribute('style', document.documentElement.getAttribute('style') ?? '');
		doc.body.className = `${document.body.className} pl-quick-entry-body`;
		doc.body.setAttribute('style', document.body.getAttribute('style') ?? '');
		if (loading.length) await Promise.race([Promise.all(loading), sleep(1500)]);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** "rgb(30, 30, 30)" → "#1e1e1e", for the window's background before the palette paints. */
function hexColor(color: string): string | null {
	const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
	if (!m) return null;
	return `#${m
		.slice(1, 4)
		.map((n) => Number(n).toString(16).padStart(2, '0'))
		.join('')}`;
}
