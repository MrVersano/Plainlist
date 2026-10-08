// The "New to-do" palette's data and save path, shared by the in-app modal and the
// desktop-only system-wide Quick Entry window.

import { App, Notice, TFile } from 'obsidian';
import { patchText } from './model/apply';
import { parse } from './model/parse';
import { addTask, PatchConflict, type LineRef } from './model/patch';
import { resolveProjects } from './projects';
import type { CaptureResult } from './ui/components/Capture';
import type { PickerProject } from './ui/components/popovers';

export interface CaptureOptions {
	/** The task file. */
	file: TFile;
	today: string;
	weekStart: 0 | 1;
	/** Project note path to preselect, or null for the Inbox. */
	project: string | null;
	/** A heading in that project's note to preselect. */
	heading?: LineRef | null;
	defaultDate: string | null;
}

export interface CaptureSession {
	options: CaptureOptions;
	projects: PickerProject[];
	/** The preselected project, if it is still an open project. */
	initialProject: string | null;
	/** The preselected heading, if it is still in that project's note. */
	initialHeading: LineRef | null;
	/** Writes the to-do. Shows a notice and returns false on failure. */
	save: (result: CaptureResult) => Promise<boolean>;
}

/** Reads the open projects for the palette. Writes go straight to the notes, so no view needs to be open. */
export async function startCapture(app: App, options: CaptureOptions): Promise<CaptureSession> {
	const doc = parse(await app.vault.read(options.file));
	const projects = resolveProjects(app, options.file, doc).filter((p) => p.file && !p.done);
	const notes = new Map<string, TFile>();
	for (const p of projects) if (p.file) notes.set(p.path, p.file);
	const headings = new Map<string, PickerProject['headings']>();
	await Promise.all(
		projects.map(async (p) => p.file && headings.set(p.path, parse(await app.vault.cachedRead(p.file)).headings)),
	);

	const save = async (result: CaptureResult): Promise<boolean> => {
		const note = result.project === null ? null : notes.get(result.project);
		const file = note ?? options.file;
		const task = { title: result.title, date: result.date, repeat: result.repeat };
		const dest = !note ? 'inbox' : result.heading ? { heading: result.heading } : 'note';
		try {
			await app.vault.process(file, (text) => patchText(text, (doc) => addTask(doc, task, dest)));
			return true;
		} catch (e) {
			new Notice(
				e instanceof PatchConflict
					? `${file.name} changed — please try again`
					: `Plainlist could not save: ${e instanceof Error ? e.message : String(e)}`,
			);
			return false;
		}
	};

	const initialProject = options.project !== null && notes.has(options.project) ? options.project : null;
	const wanted = options.heading;
	const found = initialProject && wanted ? headings.get(initialProject)?.find((h) => h.text === wanted.text) : undefined;
	return {
		options,
		projects: projects.map((p) => ({ name: p.name, path: p.path, headings: headings.get(p.path) })),
		initialProject,
		initialHeading: found ? { line: found.line, text: found.text } : null,
		save,
	};
}
