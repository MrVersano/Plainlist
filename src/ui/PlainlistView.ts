import { App as ObsidianApp, FileView, Platform, TFile, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { h, render } from 'preact';
import { NEW_TODO_COMMAND, VIEW_ICON, VIEW_TYPE } from '../constants';
import type { ListId } from '../model/lists';
import type PlainlistPlugin from '../main';
import { Workspace, type TaskRef } from '../store';
import { App } from './components/App';
import { EnvContext, type Env, type SelectionCommand, type SidebarLayout } from './env';
import { confirmModal, promptModal } from './modals';
import { hotkeyLabel } from './obsidian';

const SIDEBAR_KEY = 'plainlist-sidebar';
const SIDEBAR_WIDTH = 220;

function loadSidebar(app: ObsidianApp): SidebarLayout {
	const saved = app.loadLocalStorage(SIDEBAR_KEY) as Partial<SidebarLayout> | null;
	return {
		width: typeof saved?.width === 'number' ? saved.width : SIDEBAR_WIDTH,
		hidden: saved?.hidden === true,
	};
}

const LIST_KINDS = new Set(['inbox', 'today', 'upcoming', 'nodate', 'someday', 'completed', 'project']);

function isListId(value: unknown): value is ListId {
	if (!value || typeof value !== 'object') return false;
	const v = value as { kind?: unknown; path?: unknown };
	return typeof v.kind === 'string' && LIST_KINDS.has(v.kind) && (v.kind !== 'project' || typeof v.path === 'string');
}

export class PlainlistView extends FileView {
	workspace: Workspace | null = null;
	list: ListId = { kind: 'today' };
	private root: HTMLElement | null = null;
	/** A reveal made before the UI was mounted, handed to it when it subscribes. */
	private pendingReveal: TaskRef | null = null;
	private revealListener: ((target: TaskRef) => void) | null = null;
	private selectionListener: ((command: SelectionCommand) => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: PlainlistPlugin,
	) {
		super(leaf);
		this.navigation = true;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getIcon(): string {
		return VIEW_ICON;
	}

	getDisplayText(): string {
		return this.file?.basename ?? 'Plainlist';
	}

	// Declining lets Obsidian open other notes from this tab as Markdown; the view-state
	// hook brings marked notes back here.
	canAcceptExtension(): boolean {
		return false;
	}

	async onOpen(): Promise<void> {
		this.addAction('file-text', 'Open as Markdown', () => void this.plugin.openAsMarkdown(this.leaf));
		this.contentEl.addClass('pl-view');
		// At midnight, yesterday's open to-dos move to the new day.
		this.register(this.plugin.clock.subscribe(() => this.workspace?.tidy(this.plugin.clock.today, this.plugin.weekStart())));
		// Take keyboard focus when this tab becomes active, so N and the arrow keys work.
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf === this.leaf && !this.contentEl.contains(document.activeElement)) {
					this.contentEl.querySelector<HTMLElement>('.pl-root')?.focus({ preventScroll: true });
				}
			}),
		);
	}

	async onLoadFile(file: TFile): Promise<void> {
		this.workspace = new Workspace(this.app, file);
		await this.workspace.load();
		this.workspace.tidy(this.plugin.clock.today, this.plugin.weekStart());
		this.mount(this.workspace);
	}

	async onUnloadFile(): Promise<void> {
		this.unmount();
		this.workspace?.dispose();
		this.workspace = null;
	}

	async onClose(): Promise<void> {
		this.unmount();
		this.workspace?.dispose();
		this.workspace = null;
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), list: this.list };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const list = (state as { list?: unknown } | null)?.list;
		if (isListId(list) && JSON.stringify(list) !== JSON.stringify(this.list)) {
			this.list = list;
			// Re-mount so the UI starts on the restored list.
			if (this.workspace) this.mount(this.workspace);
		}
		await super.setState(state, result);
	}

	/** Switches to `list` and focuses the view, so the keyboard works there straight away. */
	showList(list: ListId): void {
		if (JSON.stringify(list) !== JSON.stringify(this.list)) {
			this.list = list;
			if (this.workspace) this.mount(this.workspace);
			this.app.workspace.requestSaveLayout();
		}
		this.contentEl.querySelector<HTMLElement>('.pl-root')?.focus({ preventScroll: true });
	}

	openCapture(list: ListId = this.list): void {
		if (!this.file) return;
		this.plugin.openCapture(this.file, list);
	}

	/** Shows a to-do: switches to a list that has it, scrolls to it and highlights it briefly. */
	reveal(target: TaskRef): void {
		if (this.revealListener) this.revealListener(target);
		else this.pendingReveal = target;
	}

	/** Opens the picker for moving or scheduling the selected to-dos. */
	selectionCommand(command: SelectionCommand): void {
		this.selectionListener?.(command);
	}

	private mount(workspace: Workspace): void {
		this.unmount();
		this.root = this.contentEl.createDiv({ cls: 'pl-host' });
		const env: Env = {
			app: this.app,
			workspace,
			clock: this.plugin.clock,
			component: this,
			weekStart: () => this.plugin.weekStart(),
			openCapture: (list) => this.openCapture(list),
			confirm: (title, message, cta, destructive) => confirmModal(this.app, title, message, cta, destructive),
			prompt: (title, placeholder, initial, cta) => promptModal(this.app, title, placeholder, initial, cta),
			sidebar: {
				load: () => loadSidebar(this.app),
				save: (layout) => this.app.saveLocalStorage(SIDEBAR_KEY, layout),
			},
			todayOrder: {
				get: () => this.plugin.settings.todayOrder,
				set: (keys) => this.plugin.setTodayOrder(keys),
				subscribe: (fn) => this.plugin.onTodayOrderChange(fn),
			},
			hint: () => (Platform.isMobile ? null : { hotkey: hotkeyLabel(this.app, NEW_TODO_COMMAND) }),
			onReveal: (fn) => {
				this.revealListener = fn;
				const pending = this.pendingReveal;
				this.pendingReveal = null;
				if (pending) fn(pending);
				return () => {
					if (this.revealListener === fn) this.revealListener = null;
				};
			},
			onSelectionCommand: (fn) => {
				this.selectionListener = fn;
				return () => {
					if (this.selectionListener === fn) this.selectionListener = null;
				};
			},
		};
		render(
			h(EnvContext.Provider, {
				value: env,
				children: h(App, {
					key: JSON.stringify(this.list),
					initialList: this.list,
					onListChange: (list: ListId) => {
						this.list = list;
						this.app.workspace.requestSaveLayout();
					},
				}),
			}),
			this.root,
		);
	}

	private unmount(): void {
		// Preact may run the old UI's effect cleanups later; it must not take reveals meanwhile.
		this.revealListener = null;
		this.selectionListener = null;
		if (!this.root) return;
		render(null, this.root);
		this.root.remove();
		this.root = null;
	}
}
