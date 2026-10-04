import { App, Modal, Notice, TFile } from 'obsidian';
import { h, render } from 'preact';
import { patchText } from '../model/apply';
import { parse } from '../model/parse';
import { addTask, PatchConflict } from '../model/patch';
import { Capture, type CaptureResult } from './components/Capture';

export interface CaptureOptions {
	file: TFile;
	today: string;
	weekStart: 0 | 1;
	project: string | null;
	defaultDate: string | null;
}

/** The "New to-do" palette. Writes straight to the file, so it works with the view closed. */
export class CaptureModal extends Modal {
	constructor(
		app: App,
		private options: CaptureOptions,
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		this.modalEl.addClass('pl-capture-modal');
		this.containerEl.addClass('pl-capture-container');
		const projects = parse(await this.app.vault.read(this.options.file)).projects.map((p) => p.name);
		const { today, weekStart, defaultDate } = this.options;
		const project = this.options.project !== null && projects.includes(this.options.project) ? this.options.project : null;
		render(
			h(Capture, {
				today,
				weekStart,
				projects,
				initialProject: project,
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
		try {
			await this.app.vault.process(this.options.file, (text) => patchText(text, (doc) => addTask(doc, result)));
			return true;
		} catch (e) {
			new Notice(
				e instanceof PatchConflict
					? `${this.options.file.name} changed — please try again`
					: `Plainlist could not save: ${e instanceof Error ? e.message : String(e)}`,
			);
			return false;
		}
	}
}
