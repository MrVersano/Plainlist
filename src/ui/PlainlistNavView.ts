import { ItemView, Notice, Platform, TFile, WorkspaceLeaf } from 'obsidian';
import { h, render } from 'preact';
import { NAV_VIEW_TYPE, VIEW_ICON } from '../constants';
import type { ListId } from '../model/lists';
import type PlainlistPlugin from '../main';
import type { Workspace } from '../store';
import type { UndoEntry } from '../undo';
import { Nav, NavPlaceholder } from './components/Nav';
import { EnvContext, type Env } from './env';
import { confirmModal, promptModal } from './modals';
import { HOLD_MS, TOUCH_SLOP } from './reorder';

/**
 * The lists and projects, in Obsidian's left sidebar. It follows the Plainlist tab used
 * last, or the tasks file when none is open, and shows its lists in that tab.
 */
export class PlainlistNavView extends ItemView {
	private host: HTMLElement | null = null;
	/** The file whose lists are shown; null when the tasks file doesn't exist yet. */
	private file: TFile | null = null;
	private shared: { workspace: Workspace; release: () => void; env: Env | null } | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: PlainlistPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return NAV_VIEW_TYPE;
	}

	getIcon(): string {
		return VIEW_ICON;
	}

	getDisplayText(): string {
		return 'Plainlist';
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('pl-nav-view');
		this.host = this.contentEl.createDiv({ cls: 'pl-host' });
		this.register(this.plugin.onViewsChange(() => void this.refresh()));
		this.tapOnTouchEnd();
		// The tasks file may be created, renamed or deleted. Not before the layout is ready:
		// every file in the vault is "created" while Obsidian starts.
		this.app.workspace.onLayoutReady(() => {
			const { vault } = this.app;
			this.registerEvent(vault.on('create', () => void this.refresh()));
			this.registerEvent(vault.on('delete', () => void this.refresh()));
			this.registerEvent(vault.on('rename', () => void this.refresh()));
		});
		await this.refresh();
	}

	async onClose(): Promise<void> {
		if (this.host) render(null, this.host);
		this.host = null;
		this.letGo();
	}

	/**
	 * Takes a tap on a button when the finger lifts, not from its click. In the mobile drawer
	 * the first tap after picking a list (which makes the Plainlist tab the active pane) lost
	 * its click, so a list or project took two taps.
	 */
	private tapOnTouchEnd(): void {
		let start: { x: number; y: number; t: number } | null = null;
		this.registerDomEvent(
			this.contentEl,
			'touchstart',
			(e) => {
				const t = e.touches[0];
				start = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, t: e.timeStamp } : null;
			},
			{ passive: true },
		);
		this.registerDomEvent(this.contentEl, 'touchend', (e) => {
			const from = start;
			start = null;
			const t = e.changedTouches[0];
			// A held touch opens the row's menu, and a moving one scrolls or drags.
			if (!from || !t || e.timeStamp - from.t >= HOLD_MS || Math.hypot(t.clientX - from.x, t.clientY - from.y) > TOUCH_SLOP) return;
			const button = (e.target as HTMLElement | null)?.closest('button');
			if (!button || !this.contentEl.contains(button)) return;
			// No click of its own follows, so it can't act twice.
			e.preventDefault();
			button.click();
		});
	}

	private letGo(): void {
		this.shared?.release();
		this.shared = null;
	}

	/** Picks up the file to follow, loading it if it changed, and draws the sidebar. */
	private async refresh(): Promise<void> {
		const file = this.plugin.followedFile();
		if (file !== this.file) {
			this.letGo();
			this.file = file;
			if (file) {
				const { workspace, loaded, release } = this.plugin.pool.acquire(file);
				const shared: { workspace: Workspace; release: () => void; env: Env | null } = { workspace, release, env: null };
				this.shared = shared;
				try {
					await loaded;
				} catch (e) {
					console.error('Plainlist: could not read the tasks file', e);
					return;
				}
				// Another file may have taken its place meanwhile.
				if (this.shared !== shared) return;
				shared.env = this.makeEnv(file, workspace);
			}
		}
		this.draw();
	}

	private draw(): void {
		if (!this.host) return;
		if (!this.file) {
			render(h(NavPlaceholder, { onSelect: (list: ListId) => this.select(list) }), this.host);
			return;
		}
		const env = this.shared?.env;
		// Still loading; drawn once it is.
		if (!env) return;
		const view = this.plugin.followedView();
		const list = view && view.file === this.file ? view.list : null;
		render(
			h(EnvContext.Provider, {
				value: env,
				children: h(Nav, {
					list,
					onSelect: (next: ListId) => this.select(next),
					undoToast: (message: string, entry: UndoEntry | null) => this.toast(message, entry),
				}),
			}),
			this.host,
		);
	}

	private select(list: ListId): void {
		const shown = this.file ? this.plugin.showListIn(this.file, list) : this.plugin.showList(list);
		// On a phone or tablet the sidebar covers the list; get it out of the way once the list is showing.
		if (Platform.isMobile) void shown.then(() => this.app.workspace.leftSplit.collapse());
	}

	/** A notice offering to undo, as the list's own toast does. */
	private toast(message: string, entry: UndoEntry | null): void {
		const workspace = this.shared?.workspace;
		const notice = new Notice(
			createFragment((f) => {
				f.createSpan({ text: message });
				if (!entry || !workspace) return;
				const undo = f.createEl('button', { cls: 'pl-notice-undo', text: 'Undo' });
				undo.addEventListener('click', () => {
					notice.hide();
					if (workspace.undo.take(entry)) void entry.undo();
				});
			}),
			5000,
		);
	}

	private makeEnv(file: TFile, workspace: Workspace): Env {
		const { app, plugin } = this;
		return {
			app,
			workspace,
			clock: plugin.clock,
			component: this,
			weekStart: () => plugin.weekStart(),
			linkTitle: plugin.linkTitle,
			openCapture: (list) => plugin.openCapture(file, list),
			boards: plugin.boards,
			isPhone: Platform.isPhone,
			confirm: (title, message, cta, destructive) => confirmModal(app, title, message, cta, destructive),
			prompt: (title, placeholder, initial, cta) => promptModal(app, title, placeholder, initial, cta),
			hint: () => null,
			sidebar: plugin.areaFolding,
			todayOrder: {
				get: () => plugin.settings.todayOrder,
				set: (keys) => plugin.setTodayOrder(keys),
				byProject: () => plugin.settings.groupTodayByProject,
				subscribe: (fn) => plugin.onTodayOrderChange(fn),
			},
			onReveal: () => () => {},
			onCommand: () => () => {},
		};
	}
}
