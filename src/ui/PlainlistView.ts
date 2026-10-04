import { FileView, Platform, TFile, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { h, render } from 'preact';
import { NEW_TODO_COMMAND, VIEW_ICON, VIEW_TYPE } from '../constants';
import type { ListId } from '../model/lists';
import type PlainlistPlugin from '../main';
import { Store } from '../store';
import { App } from './components/App';
import { EnvContext, type Env } from './env';
import { confirmModal, promptModal } from './modals';
import { hotkeyLabel } from './obsidian';

const LIST_KINDS = new Set(['inbox', 'today', 'upcoming', 'nodate', 'someday', 'completed', 'project']);

function isListId(value: unknown): value is ListId {
	if (!value || typeof value !== 'object') return false;
	const v = value as { kind?: unknown; name?: unknown };
	return typeof v.kind === 'string' && LIST_KINDS.has(v.kind) && (v.kind !== 'project' || typeof v.name === 'string');
}

export class PlainlistView extends FileView {
	store: Store | null = null;
	list: ListId = { kind: 'today' };
	private root: HTMLElement | null = null;

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
		this.store = new Store(this.app, file);
		await this.store.load();
		this.mount(file, this.store);
	}

	async onUnloadFile(): Promise<void> {
		this.unmount();
		this.store?.dispose();
		this.store = null;
	}

	async onClose(): Promise<void> {
		this.unmount();
		this.store?.dispose();
		this.store = null;
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), list: this.list };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const list = (state as { list?: unknown } | null)?.list;
		if (isListId(list) && JSON.stringify(list) !== JSON.stringify(this.list)) {
			this.list = list;
			// Re-mount so the UI starts on the restored list.
			if (this.store && this.file) this.mount(this.file, this.store);
		}
		await super.setState(state, result);
	}

	openCapture(list: ListId = this.list): void {
		if (!this.file) return;
		this.plugin.openCapture(this.file, list);
	}

	private mount(file: TFile, store: Store): void {
		this.unmount();
		this.root = this.contentEl.createDiv({ cls: 'pl-host' });
		const env: Env = {
			app: this.app,
			file,
			store,
			clock: this.plugin.clock,
			component: this,
			weekStart: () => this.plugin.weekStart(),
			openCapture: (list) => this.openCapture(list),
			confirm: (title, message, cta) => confirmModal(this.app, title, message, cta),
			prompt: (title, placeholder) => promptModal(this.app, title, placeholder),
			hint: () => (Platform.isMobile ? null : { hotkey: hotkeyLabel(this.app, NEW_TODO_COMMAND) }),
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
		if (!this.root) return;
		render(null, this.root);
		this.root.remove();
		this.root = null;
	}
}
