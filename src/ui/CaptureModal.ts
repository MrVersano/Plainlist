import { App, Modal, Notice, TFile } from 'obsidian';
import { h, render } from 'preact';
import { patchText } from '../model/apply';
import { parse } from '../model/parse';
import { addTask, PatchConflict } from '../model/patch';
import { resolveProjects } from '../projects';
import { Capture, type CaptureResult } from './components/Capture';

export interface CaptureOptions {
	/** The task file. */
	file: TFile;
	today: string;
	weekStart: 0 | 1;
	/** Project note path to preselect, or null for the Inbox. */
	project: string | null;
	defaultDate: string | null;
}

/** The "New to-do" palette. Writes straight to the notes, so it works with the view closed. */
export class CaptureModal extends Modal {
	private notes = new Map<string, TFile>();

	constructor(
		app: App,
		private options: CaptureOptions,
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		this.modalEl.addClass('pl-capture-modal');
		this.containerEl.addClass('pl-capture-container');
		const doc = parse(await this.app.vault.read(this.options.file));
		const projects = resolveProjects(this.app, this.options.file, doc).filter((p) => p.file);
		for (const p of projects) if (p.file) this.notes.set(p.path, p.file);
		const { today, weekStart, defaultDate } = this.options;
		const initial = this.options.project !== null && this.notes.has(this.options.project) ? this.options.project : null;
		render(
			h(Capture, {
				today,
				weekStart,
				projects: projects.map((p) => ({ name: p.name, path: p.path })),
				initialProject: initial,
				defaultDate,
				onSave: (result) => this.save(result),
				onClose: () => this.close(),
			}),
			this.contentEl,
		);
	}

	onClose(): void {
		render(null, this.contentEl);
	}

	private async save(result: CaptureResult): Promise<boolean> {
		const note = result.project === null ? null : this.notes.get(result.project);
		const file = note ?? this.options.file;
		const task = { title: result.title, date: result.date };
		try {
			await this.app.vault.process(file, (text) => patchText(text, (doc) => addTask(doc, task, note ? 'note' : 'inbox')));
			return true;
		} catch (e) {
			new Notice(
				e instanceof PatchConflict
					? `${file.name} changed — please try again`
					: `Plainlist could not save: ${e instanceof Error ? e.message : String(e)}`,
			);
			return false;
		}
	}
}
