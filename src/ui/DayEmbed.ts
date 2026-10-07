import { App, MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownView, TFile } from 'obsidian';
import { h, render } from 'preact';
import { dailyNoteFormat, dateFromTitle } from '../dailyNote';
import type PlainlistPlugin from '../main';
import { Workspace } from '../store';
import { tasksFilePath } from '../tasksFile';
import { CaptureModal } from './CaptureModal';
import { DayList } from './components/DayList';
import { EnvContext, type Env } from './env';
import { confirmModal, promptModal } from './modals';

export const BLOCK_LANGUAGE = 'plainlist';

/** What a `plainlist` code block shows: `Today`, or `Note Title` for the day the note is named after. */
type Block = { kind: 'today' } | { kind: 'title' };

export function parseBlock(source: string): Block | null {
	const first = source.split('\n').find((l) => l.trim()) ?? '';
	const words = first.trim().replace(/\s+/g, ' ').toLowerCase();
	if (words === 'today') return { kind: 'today' };
	if (words === 'note title') return { kind: 'title' };
	return null;
}

interface Shared {
	workspace: Workspace;
	loaded: Promise<void>;
	users: number;
}

/** One loaded Workspace per task file, shared by every block showing it, disposed with the last. */
export class WorkspacePool {
	private open = new Map<string, Shared>();

	constructor(private app: App) {}

	acquire(file: TFile): { workspace: Workspace; loaded: Promise<void>; release: () => void } {
		const key = file.path;
		let shared = this.open.get(key);
		if (!shared) {
			const workspace = new Workspace(this.app, file);
			shared = { workspace, loaded: workspace.load(), users: 0 };
			this.open.set(key, shared);
		}
		const entry = shared;
		entry.users++;
		let released = false;
		return {
			workspace: entry.workspace,
			loaded: entry.loaded,
			release: () => {
				if (released) return;
				released = true;
				if (--entry.users > 0) return;
				entry.workspace.dispose();
				if (this.open.get(key) === entry) this.open.delete(key);
			},
		};
	}
}

/** A `plainlist` code block, rendered as an interactive list. */
export class DayEmbed extends MarkdownRenderChild {
	private release: (() => void) | null = null;
	private mounted = false;

	constructor(
		private plugin: PlainlistPlugin,
		private pool: WorkspacePool,
		private source: string,
		containerEl: HTMLElement,
		private ctx: MarkdownPostProcessorContext,
	) {
		super(containerEl);
	}

	private get sourcePath(): string {
		return this.ctx.sourcePath;
	}

	onload(): void {
		const { app } = this.plugin;
		const block = parseBlock(this.source);
		if (!block) return this.message('Unknown Plainlist block. Write “Today” or “Note Title” inside it.');

		let date: string | null = null;
		if (block.kind === 'title') {
			const note = app.vault.getFileByPath(this.sourcePath);
			date = note ? dateFromTitle(app, note) : null;
			if (!date) {
				const name = note?.basename ?? this.sourcePath;
				return this.message(`“${name}” is not a date. Name the note like ${dailyNoteFormat(app)} to show that day's to-dos.`);
			}
		}

		const path = tasksFilePath(this.plugin.settings.tasksFile);
		const file = app.vault.getFileByPath(path);
		if (!file) return this.message(`The tasks file ${path} was not found. Open Plainlist once to create it.`);

		const { workspace, loaded, release } = this.pool.acquire(file);
		this.release = release;
		loaded.then(
			() => {
				// The block may have been unloaded (the note closed or edited) while the notes loaded.
				if (this.release) this.mount(workspace, file, date);
			},
			(e: unknown) => this.message(`Could not read ${path}: ${e instanceof Error ? e.message : String(e)}`),
		);
	}

	onunload(): void {
		if (this.mounted) render(null, this.containerEl);
		this.mounted = false;
		this.release?.();
		this.release = null;
	}

	/**
	 * Hands the keyboard back to the note: the cursor goes to the line after the block. With no
	 * line there (or in Reading view) the list just lets go of focus, as the cursor on the block
	 * would show its source.
	 */
	private exit(): void {
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const end = this.ctx.getSectionInfo(this.containerEl)?.lineEnd;
		if (view && view.getMode() === 'source' && view.containerEl.contains(this.containerEl) && end !== undefined && end < view.editor.lastLine()) {
			view.editor.setCursor({ line: end + 1, ch: 0 });
			view.editor.focus();
			return;
		}
		(this.containerEl.ownerDocument.activeElement as HTMLElement | null)?.blur();
	}

	private message(text: string): void {
		this.containerEl.empty();
		this.containerEl.createDiv({ cls: 'pl-embed-message', text });
	}

	private mount(workspace: Workspace, file: TFile, date: string | null): void {
		const { app, clock } = this.plugin;
		const env: Env = {
			app,
			workspace,
			clock,
			component: this,
			weekStart: () => this.plugin.weekStart(),
			openCapture: (list) => this.plugin.openCapture(file, list),
			confirm: (title, message, cta, destructive) => confirmModal(app, title, message, cta, destructive),
			prompt: (title, placeholder, initial, cta) => promptModal(app, title, placeholder, initial, cta),
			hint: () => null,
			sidebar: { load: () => ({ width: 0, hidden: true }), save: () => {} },
			todayOrder: {
				get: () => this.plugin.settings.todayOrder,
				set: (keys) => this.plugin.setTodayOrder(keys),
				byProject: () => this.plugin.settings.groupTodayByProject,
				subscribe: (fn) => this.plugin.onTodayOrderChange(fn),
			},
			onReveal: () => () => {},
			onSelectionCommand: () => () => {},
		};
		const onAdd = (day: string): void => {
			const options = this.plugin.captureOptions(file, { kind: 'today' });
			new CaptureModal(app, { ...options, defaultDate: day }).open();
		};
		this.containerEl.empty();
		this.containerEl.addClass('pl-embed-host');
		render(h(EnvContext.Provider, { value: env, children: h(DayList, { date, onAdd, onExit: () => this.exit() }) }), this.containerEl);
		this.mounted = true;
	}
}
