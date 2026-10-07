import { Notice, type ObsidianProtocolData, Platform, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import type { CaptureOptions } from './capture';
import { Clock } from './clock';
import { VIEW_ICON, VIEW_TYPE } from './constants';
import type { QuickEntryService } from './desktop/QuickEntryService';
import { allItems, type ListId } from './model/lists';
import { DEFAULT_SETTINGS, firstDayOfWeek, PlainlistSettings, PlainlistSettingTab } from './settings';
import { patchText } from './model/apply';
import { addTask, refOf } from './model/patch';
import { Workspace } from './store';
import { ensureTasksFile } from './tasksFile';
import { CaptureModal } from './ui/CaptureModal';
import { BLOCK_LANGUAGE, DayEmbed, WorkspacePool } from './ui/DayEmbed';
import { PlainlistView } from './ui/PlainlistView';
import { TaskSearchModal } from './ui/TaskSearchModal';
import { installViewSwitch } from './viewSwitch';
import { withParams } from './xcallback';

export default class PlainlistPlugin extends Plugin {
	settings!: PlainlistSettings;
	clock = new Clock();
	forceMarkdown = new WeakMap<WorkspaceLeaf, string>();
	/** System-wide Quick Entry; desktop only, null until loaded or when unavailable. */
	quickEntry: QuickEntryService | null = null;
	/** Lists showing Today's order: the view and lists in notes. */
	private todayOrderListeners = new Set<() => void>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new PlainlistSettingTab(this.app, this));
		this.clock.start(this);
		this.registerView(VIEW_TYPE, (leaf) => new PlainlistView(leaf, this));
		installViewSwitch(this);
		// ```plainlist blocks in notes: `Today`, or `Note Title` in a daily note.
		const pool = new WorkspacePool(this.app);
		this.registerMarkdownCodeBlockProcessor(BLOCK_LANGUAGE, (source, el, ctx) => {
			ctx.addChild(new DayEmbed(this, pool, source, el, ctx));
		});
		// Keep a renamed project's to-dos in their place in Today.
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				const prefix = `${oldPath}\u0000`;
				if (!this.settings.todayOrder.some((k) => k.startsWith(prefix))) return;
				this.setTodayOrder(this.settings.todayOrder.map((k) => (k.startsWith(prefix) ? file.path + k.slice(oldPath.length) : k)));
			}),
		);

		this.addCommand({
			id: 'open',
			name: 'Open',
			callback: () => void this.openTasksFile(),
		});

		// No default hotkey (plugin guidelines); the README suggests Mod+Shift+N.
		this.addCommand({
			id: 'new-todo',
			name: 'New to-do',
			callback: () => void this.newTodo(),
		});

		this.addCommand({
			id: 'search',
			name: 'Search to-dos',
			callback: () => void this.searchTasks(),
		});

		// No default hotkeys; users can map them in Settings → Hotkeys.
		const goTo: { id: string; name: string; list: ListId }[] = [
			{ id: 'go-to-inbox', name: 'Go to Inbox', list: { kind: 'inbox' } },
			{ id: 'go-to-today', name: 'Go to Today', list: { kind: 'today' } },
			{ id: 'go-to-upcoming', name: 'Go to Upcoming', list: { kind: 'upcoming' } },
			{ id: 'go-to-no-date', name: 'Go to No Date', list: { kind: 'nodate' } },
			{ id: 'go-to-someday', name: 'Go to Someday', list: { kind: 'someday' } },
		];
		for (const { id, name, list } of goTo) {
			this.addCommand({ id, name, callback: () => void this.showList(list) });
		}

		this.addCommand({
			id: 'toggle-markdown',
			name: 'Switch between task list and Markdown',
			checkCallback: (checking) => {
				const leaf = this.app.workspace.getMostRecentLeaf();
				const view = leaf?.view;
				const file = view && 'file' in view ? (view.file as TFile | null) : null;
				if (!leaf || !file) return false;
				const inPlainlist = view?.getViewType() === VIEW_TYPE;
				if (!inPlainlist && view?.getViewType() !== 'markdown') return false;
				if (!checking) void (inPlainlist ? this.openAsMarkdown(leaf) : this.openInPlainlist(leaf, file));
				return true;
			},
		});

		// obsidian://plainlist-add?title=…, with x-callback-url's x-success, x-error and x-cancel.
		this.registerObsidianProtocolHandler('plainlist-add', (params) => void this.addFromUrl(params));

		this.addRibbonIcon(VIEW_ICON, 'Open Plainlist', () => void this.openTasksFile());

		if (Platform.isDesktopApp) void this.loadQuickEntry();
	}

	/** Loads the Electron-backed Quick Entry module on desktop. Its failure leaves the rest of the plugin working. */
	private async loadQuickEntry(): Promise<void> {
		try {
			const { QuickEntryService } = await import('./desktop/QuickEntryService');
			const service = QuickEntryService.create(this);
			// addChild loads it now, or never if the plugin was unloaded meanwhile.
			if (service) this.quickEntry = this.addChild(service);
		} catch (e) {
			console.error('Plainlist: could not start system-wide Quick Entry', e);
			if (this.settings.quickEntryEnabled) new Notice('Plainlist: system-wide quick entry is unavailable. See the console for details.');
		}
	}

	weekStart(): 0 | 1 {
		return firstDayOfWeek(this.settings.weekStart);
	}

	async openTasksFile(): Promise<void> {
		try {
			await this.showFile(await ensureTasksFile(this.app, this.settings.tasksFile));
		} catch (e) {
			new Notice(`Plainlist: could not open the tasks file. ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private viewOf(file: TFile): PlainlistView | null {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof PlainlistView && leaf.view.file === file) return leaf.view;
		}
		return null;
	}

	/** Brings up the Plainlist tab showing `file`, opening one if needed. */
	private async showFile(file: TFile): Promise<PlainlistView | null> {
		const existing = this.viewOf(file);
		if (existing) {
			await this.app.workspace.revealLeaf(existing.leaf);
			return existing;
		}
		const leaf = this.app.workspace.getLeaf(false);
		await this.openInPlainlist(leaf, file);
		return leaf.view instanceof PlainlistView ? leaf.view : null;
	}

	/** Shows `list` in the active Plainlist view, or in the tasks file's view. */
	async showList(list: ListId): Promise<void> {
		try {
			const file = this.app.workspace.getActiveViewOfType(PlainlistView)?.file ?? (await ensureTasksFile(this.app, this.settings.tasksFile));
			const view = await this.showFile(file);
			if (!view) return;
			this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
			view.showList(list);
		} catch (e) {
			new Notice(`Plainlist: could not open the tasks file. ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/**
	 * Fuzzy-finds a to-do in the active Plainlist view's note (or the tasks file) and its
	 * projects, then shows it there. Reads the notes itself when no view has them open.
	 */
	async searchTasks(): Promise<void> {
		let file: TFile;
		try {
			file = this.app.workspace.getActiveViewOfType(PlainlistView)?.file ?? (await ensureTasksFile(this.app, this.settings.tasksFile));
		} catch (e) {
			new Notice(`Plainlist: could not open the tasks file. ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		const shown = this.viewOf(file)?.workspace;
		const workspace = shown ?? new Workspace(this.app, file);
		if (!shown) await workspace.load();
		new TaskSearchModal(
			this.app,
			allItems(workspace.sources()).filter((i) => this.settings.searchCompleted || !i.task.done),
			this.clock.today,
			(item) => {
				void this.showFile(file).then((view) => view?.reveal({ path: item.path, ref: refOf(item.task) }));
			},
			() => {
				if (!shown) workspace.dispose();
			},
		).open();
	}

	async openInPlainlist(leaf: WorkspaceLeaf, file?: TFile): Promise<void> {
		const target = file ?? (leaf.view as { file?: TFile | null }).file;
		if (!target) return;
		this.forceMarkdown.delete(leaf);
		await leaf.setViewState({ type: VIEW_TYPE, state: { file: target.path }, active: true });
	}

	async openAsMarkdown(leaf: WorkspaceLeaf): Promise<void> {
		const file = (leaf.view as { file?: TFile | null }).file;
		if (!file) return;
		this.forceMarkdown.set(leaf, file.path);
		await leaf.setViewState({ type: 'markdown', state: { file: file.path }, active: true });
	}

	/** Opens the capture palette, defaulting to the active Plainlist view's file and list. */
	async newTodo(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(PlainlistView);
		if (view?.file) {
			view.openCapture();
			return;
		}
		const options = await this.inboxCaptureOptions();
		if (options) new CaptureModal(this.app, options).open();
	}

	openCapture(file: TFile, list: ListId): void {
		new CaptureModal(this.app, this.captureOptions(file, list)).open();
	}

	captureOptions(file: TFile, list: ListId): CaptureOptions {
		const today = this.clock.today;
		return {
			file,
			today,
			weekStart: this.weekStart(),
			project: list.kind === 'project' ? list.path : null,
			defaultDate: list.kind === 'today' ? today : list.kind === 'someday' ? 'someday' : null,
		};
	}

	/** Options for a palette that adds to the Inbox of the tasks file, as "New to-do" does outside the view. */
	async inboxCaptureOptions(): Promise<CaptureOptions | null> {
		try {
			const file = await ensureTasksFile(this.app, this.settings.tasksFile);
			return this.captureOptions(file, { kind: 'inbox' });
		} catch (e) {
			new Notice(`Plainlist: could not open the tasks file. ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}

	/**
	 * Adds `title` to the Inbox of the tasks file as typed, with no date, or with `palette=true`
	 * opens the New to-do palette filled in with it. Then opens the caller's x-success, x-error
	 * (with `errorMessage`) or x-cancel URL, if given.
	 */
	private async addFromUrl(params: ObsidianProtocolData): Promise<void> {
		const callback = (key: 'x-success' | 'x-error' | 'x-cancel', extra?: Record<string, string>): void => {
			const url = withParams(params[key], extra);
			if (url) window.open(url);
		};
		const fail = (message: string): void => {
			new Notice(`Plainlist: ${message}`);
			callback('x-error', { errorMessage: message.charAt(0).toUpperCase() + message.slice(1) });
		};
		const title = (params.title ?? '').replace(/\s+/g, ' ').trim();

		let file: TFile;
		try {
			file = await ensureTasksFile(this.app, this.settings.tasksFile);
		} catch (e) {
			fail(`could not open the tasks file. ${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		if (params.palette === 'true') {
			new CaptureModal(this.app, this.captureOptions(file, { kind: 'inbox' }), {
				initialText: title,
				onDone: (saved) => callback(saved ? 'x-success' : 'x-cancel'),
			}).open();
			return;
		}

		if (!title) {
			fail('the link has no title to add.');
			return;
		}
		try {
			await this.app.vault.process(file, (text) => patchText(text, (doc) => addTask(doc, { title, date: null }, 'inbox')));
		} catch (e) {
			fail(`could not save. ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		new Notice(`Added to the Inbox: ${title}`);
		callback('x-success');
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<PlainlistSettings>);
	}

	setTodayOrder(keys: string[]): void {
		this.settings.todayOrder = keys;
		void this.saveSettings();
		for (const fn of this.todayOrderListeners) fn();
	}

	onTodayOrderChange(fn: () => void): () => void {
		this.todayOrderListeners.add(fn);
		return () => this.todayOrderListeners.delete(fn);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
