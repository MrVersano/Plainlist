import { Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { Clock } from './clock';
import { VIEW_ICON, VIEW_TYPE } from './constants';
import type { ListId } from './model/lists';
import { DEFAULT_SETTINGS, firstDayOfWeek, PlainlistSettings, PlainlistSettingTab } from './settings';
import { ensureTasksFile } from './tasksFile';
import { CaptureModal } from './ui/CaptureModal';
import { PlainlistView } from './ui/PlainlistView';
import { installViewSwitch } from './viewSwitch';

export default class PlainlistPlugin extends Plugin {
	settings!: PlainlistSettings;
	clock = new Clock();
	forceMarkdown = new WeakMap<WorkspaceLeaf, string>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new PlainlistSettingTab(this.app, this));
		this.clock.start(this);
		this.registerView(VIEW_TYPE, (leaf) => new PlainlistView(leaf, this));
		installViewSwitch(this);

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

		this.addRibbonIcon(VIEW_ICON, 'Open Plainlist', () => void this.openTasksFile());
	}

	weekStart(): 0 | 1 {
		return firstDayOfWeek(this.settings.weekStart);
	}

	async openTasksFile(): Promise<void> {
		try {
			const file = await ensureTasksFile(this.app, this.settings.tasksFile);
			const existing = this.app.workspace
				.getLeavesOfType(VIEW_TYPE)
				.find((l) => l.view instanceof PlainlistView && l.view.file === file);
			if (existing) {
				await this.app.workspace.revealLeaf(existing);
				return;
			}
			await this.openInPlainlist(this.app.workspace.getLeaf(false), file);
		} catch (e) {
			new Notice(`Plainlist: could not open the tasks file. ${e instanceof Error ? e.message : String(e)}`);
		}
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
		try {
			const file = await ensureTasksFile(this.app, this.settings.tasksFile);
			this.openCapture(file, { kind: 'inbox' });
		} catch (e) {
			new Notice(`Plainlist: could not open the tasks file. ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	openCapture(file: TFile, list: ListId): void {
		const today = this.clock.today;
		new CaptureModal(this.app, {
			file,
			today,
			weekStart: this.weekStart(),
			project: list.kind === 'project' ? list.path : null,
			defaultDate: list.kind === 'today' ? today : list.kind === 'someday' ? 'someday' : null,
		}).open();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<PlainlistSettings>);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
