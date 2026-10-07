import { App, Notice, TAbstractFile, TFile } from 'obsidian';
import { applyEdits, mapLine } from './model/apply';
import type { ProjectInfo, Source } from './model/lists';
import { parse } from './model/parse';
import {
	addArea,
	addProjectLink,
	addTask,
	addTasks,
	completeOpenTasks,
	completeRepeating,
	reopenTasks,
	rollOverdueTasks,
	spawnRepeats,
	undoRepeat,
	setProjectDone,
	extractTask,
	extractTasks,
	insertTaskLines,
	moveProjectLink,
	moveProjectToArea,
	moveTaskToHeading,
	moveTasksToHeading,
	PatchConflict,
	refOf,
	removeArea,
	removeProjectLink,
	renameArea,
	replaceProjectLink,
	type LineRef,
	type NewTask,
	type Place,
	type Reopen,
	type Repeated,
} from './model/patch';
import type { Area, Doc, LineEdit } from './model/types';
import { notePath, projectNameError, resolveProjects } from './projects';
import { UndoStack, type Change } from './undo';

/** A to-do's location: the note it is in and its line there. */
export interface TaskRef {
	path: string;
	ref: LineRef;
}

/** A to-do location that `run` reads when the action executes and updates once it is applied. */
export interface TrackBox {
	current: TaskRef;
}

export interface RunResult {
	ok: boolean;
	/** What was written, note by note, so it can be undone. */
	changes?: Change[];
}

/** Both results' changes, in the order they were made. */
function joined(a: RunResult, b: RunResult): Change[] {
	return [...(a.changes ?? []), ...(b.changes ?? [])];
}

/** Finds a line by index and exact text, or by exact text alone when it is unique. */
export function locateLine(doc: Doc, ref: LineRef): number | null {
	if (doc.lines[ref.line] === ref.text) return ref.line;
	const first = doc.lines.indexOf(ref.text);
	if (first === -1 || doc.lines.indexOf(ref.text, first + 1) !== -1) return null;
	return first;
}

interface FileState {
	file: TFile;
	text: string;
	doc: Doc;
}

/**
 * The task file plus the project notes it links to. Each note's text is the source of
 * truth: every action goes through `vault.process`, and changes made elsewhere arrive
 * through vault events.
 */
export class Workspace {
	master: FileState;
	projects: ProjectInfo[] = [];
	/** Actions that can be undone, newest last. */
	readonly undo = new UndoStack();
	private notes = new Map<string, FileState>();
	private listeners = new Set<() => void>();
	private queue: Promise<unknown> = Promise.resolve();
	private disposers: (() => void)[] = [];
	private resolving: Promise<void> | null = null;
	private resolveAgain = false;
	/** The day and week start `tidy` last ran with; notes changed elsewhere are tidied with them. */
	private today = '';
	private weekStart: 0 | 1 = 1;

	constructor(
		private app: App,
		masterFile: TFile,
	) {
		this.master = { file: masterFile, text: '', doc: parse('') };
		const { vault, metadataCache } = app;
		const vaultRefs = [
			vault.on('modify', (f) => void this.onModify(f)),
			vault.on('create', () => this.scheduleResolve()),
			vault.on('delete', () => this.scheduleResolve()),
			vault.on('rename', () => this.scheduleResolve()),
		];
		const cacheRef = metadataCache.on('resolved', () => this.scheduleResolve());
		this.disposers.push(() => {
			for (const r of vaultRefs) vault.offref(r);
			metadataCache.offref(cacheRef);
		});
	}

	get masterPath(): string {
		return this.master.file.path;
	}

	async load(): Promise<void> {
		const text = await this.app.vault.read(this.master.file);
		this.master = { ...this.master, text, doc: parse(text) };
		await this.resolve();
	}

	dispose(): void {
		for (const d of this.disposers) d();
		this.listeners.clear();
	}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	/** The task file first, then each project note that exists. */
	sources(): Source[] {
		const out: Source[] = [{ path: this.masterPath, doc: this.master.doc, project: null }];
		for (const p of this.projects) {
			const note = this.notes.get(p.path);
			if (note) out.push({ path: p.path, doc: note.doc, project: p });
		}
		return out;
	}

	doc(path: string): Doc | null {
		return path === this.masterPath ? this.master.doc : (this.notes.get(path)?.doc ?? null);
	}

	/**
	 * Applies an action atomically against the latest content of one note. Actions run one
	 * at a time. When `box` points into this note it follows the to-do to where it ends up,
	 * and is updated before listeners hear about the change, so the UI keeps its place.
	 */
	run(path: string, makeEdits: (doc: Doc) => LineEdit[], box?: TrackBox): Promise<RunResult> {
		const job = this.queue.then(() => this.apply(path, makeEdits, box));
		this.queue = job;
		return job;
	}

	/**
	 * Adds a to-do to the Inbox (project null), to the end of a project note's to-dos, or
	 * under one of its headings.
	 */
	addTask(projectPath: string | null, task: NewTask, heading: LineRef | null = null): Promise<RunResult> {
		if (projectPath === null) return this.run(this.masterPath, (d) => addTask(d, task, 'inbox'));
		return this.run(projectPath, (d) => addTask(d, task, heading ? { heading } : 'note'));
	}

	/** Adds several to-dos, in order, to the Inbox (project null) or the end of a project note's to-dos. */
	addTasks(projectPath: string | null, tasks: NewTask[]): Promise<RunResult> {
		if (projectPath === null) return this.run(this.masterPath, (d) => addTasks(d, tasks, 'inbox'));
		return this.run(projectPath, (d) => addTasks(d, tasks, 'note'));
	}

	/**
	 * Moves a to-do (and anything nested under it) to a project note, under one of its
	 * headings if given, or to the Inbox when `projectPath` is null. Given a TrackBox, it
	 * reads the to-do's location when the move runs and points the box at the moved to-do afterwards.
	 */
	moveTask(source: TaskRef | TrackBox, projectPath: string | null, heading: LineRef | null = null): Promise<RunResult> {
		const box = 'current' in source ? source : undefined;
		const job = this.queue.then(async () => {
			const from = box ? box.current : (source as TaskRef);
			const to = projectPath ?? this.masterPath;
			if (to === from.path) {
				// To-dos elsewhere in the task file already count as Inbox items; they stay where they are.
				if (to === this.masterPath) return { ok: true };
				const landed: { at: LineRef | null } = { at: null };
				const res = await this.apply(to, (d) => {
					const r = moveTaskToHeading(d, from.ref, heading);
					landed.at = r.landed;
					return r.edits;
				});
				if (box && landed.at) box.current = { path: to, ref: landed.at };
				this.notify();
				return res;
			}
			const fromDoc = this.doc(from.path);
			if (!fromDoc) return { ok: false };
			let lines: string[];
			try {
				lines = extractTask(fromDoc, from.ref).lines;
			} catch (e) {
				this.report(from.path, e);
				return { ok: false };
			}
			// Write the copy first, so a failure can only leave a duplicate, never lose the to-do.
			const landed: { at: TaskRef | null } = { at: null };
			const added = await this.apply(to, (d) => {
				const ins = insertTaskLines(d, lines, to === this.masterPath ? 'inbox' : heading ? { heading } : 'note');
				landed.at = { path: to, ref: { line: ins.edit.at + ins.offset, text: ins.edit.insert[ins.offset] ?? '' } };
				return [ins.edit];
			});
			if (!added.ok) return added;
			const removed = await this.apply(from.path, (d) => extractTask(d, from.ref).edits);
			if (box && landed.at) box.current = landed.at;
			this.notify();
			return { ok: removed.ok, changes: joined(added, removed) };
		});
		this.queue = job;
		return job;
	}

	/**
	 * Moves several to-dos, as `moveTask` does, keeping their order. Each note they come from
	 * is changed once: their copies go in first, then they are removed from it.
	 */
	moveTasks(sources: TaskRef[], projectPath: string | null, heading: LineRef | null = null): Promise<RunResult> {
		const job = this.queue.then(async () => {
			const to = projectPath ?? this.masterPath;
			const byPath = new Map<string, LineRef[]>();
			for (const s of sources) byPath.set(s.path, [...(byPath.get(s.path) ?? []), s.ref]);
			let ok = true;
			const changes: Change[] = [];
			const step = (r: RunResult): boolean => {
				changes.push(...(r.changes ?? []));
				return r.ok;
			};
			for (const [path, refs] of byPath) {
				if (to === path) {
					if (to === this.masterPath) continue;
					ok = step(await this.apply(to, (d) => moveTasksToHeading(d, refs, heading))) && ok;
					continue;
				}
				const fromDoc = this.doc(path);
				if (!fromDoc) {
					ok = false;
					continue;
				}
				let lines: string[];
				try {
					lines = extractTasks(fromDoc, refs).lines;
				} catch (e) {
					this.report(path, e);
					ok = false;
					continue;
				}
				if (!lines.length) continue;
				const added = await this.apply(to, (d) => [insertTaskLines(d, lines, to === this.masterPath ? 'inbox' : heading ? { heading } : 'note').edit]);
				if (!step(added)) return { ok: false, changes };
				ok = step(await this.apply(path, (d) => extractTasks(d, refs).edits)) && ok;
			}
			this.notify();
			return { ok, changes };
		});
		this.queue = job;
		return job;
	}

	/**
	 * Daily upkeep in every note: schedules the next one for repeating to-dos ticked by hand,
	 * then moves overdue to-dos to today, so the date in the note matches where they show.
	 */
	tidy(today: string, weekStart: 0 | 1): void {
		this.today = today;
		this.weekStart = weekStart;
		for (const s of this.sources()) this.tidyNote(s.path, s.doc, true);
	}

	private tidyNote(path: string, doc: Doc, roll: boolean): void {
		const { today, weekStart } = this;
		if (!today) return;
		if (spawnRepeats(doc, today, weekStart).length) void this.run(path, (d) => spawnRepeats(d, today, weekStart));
		if (roll && rollOverdueTasks(doc, today).length) void this.run(path, (d) => rollOverdueTasks(d, today));
	}

	/**
	 * Completes a repeating to-do and adds the next one. Returns the next one's date and an
	 * undo, or null when it failed or the to-do has no rule.
	 */
	async completeRepeating(path: string, ref: LineRef, today: string, weekStart: 0 | 1, box?: TrackBox): Promise<{ date: string; undo: () => void } | null> {
		const holder: { repeated: Repeated | null } = { repeated: null };
		const res = await this.run(
			path,
			(d) => {
				const r = completeRepeating(d, box?.current.path === path ? box.current.ref : ref, today, weekStart);
				holder.repeated = r?.repeated ?? null;
				return r?.edits ?? [];
			},
			box,
		);
		const done = holder.repeated;
		if (!res.ok || !done) return null;
		return { date: done.date, undo: () => void this.run(path, (d) => undoRepeat(d, done)) };
	}

	// --- Projects -----------------------------------------------------------

	async createProject(name: string): Promise<ProjectInfo | null> {
		const error = projectNameError(name);
		if (error) {
			new Notice(error);
			return null;
		}
		const folder = this.app.fileManager.getNewFileParent(this.masterPath);
		const path = notePath(folder.path, name);
		if (this.app.vault.getAbstractFileByPath(path)) {
			new Notice(`${path} already exists. Pick it from the list to add it as a project.`);
			return null;
		}
		const file = await this.app.vault.create(path, '');
		return this.importProject(file);
	}

	async importProject(file: TFile): Promise<ProjectInfo | null> {
		const link = this.app.fileManager.generateMarkdownLink(file, this.masterPath);
		const res = await this.run(this.masterPath, (d) => addProjectLink(d, link));
		if (!res.ok) return null;
		await this.resolve();
		return this.projects.find((p) => p.path === file.path) ?? null;
	}

	/** Open to-dos in a project's note. */
	openTaskCount(project: ProjectInfo): number {
		return this.doc(project.path)?.tasks.filter((t) => !t.done).length ?? 0;
	}

	/**
	 * Completes a project: its note's open to-dos first, then its link in the task file.
	 * Returns an undo that reopens the project and exactly the to-dos it completed.
	 */
	async completeProject(project: ProjectInfo, today: string): Promise<(() => void) | null> {
		let completed: Reopen[] = [];
		if (project.exists && this.openTaskCount(project) > 0) {
			const res = await this.run(project.path, (d) => {
				const r = completeOpenTasks(d, today);
				completed = r.completed;
				return r.edits;
			});
			if (!res.ok) return null;
		}
		const res = await this.run(this.masterPath, (d) => setProjectDone(d, refOf(project), true, today));
		if (!res.ok) return null;
		const done = { ...project, text: this.master.doc.projectLinks.find((l) => l.line === project.line)?.text ?? project.text };
		return () => {
			void this.reopenProject(done);
			if (completed.length) void this.run(project.path, (d) => reopenTasks(d, completed));
		};
	}

	/** Reopens a project. Its to-dos stay as they are. */
	reopenProject(project: ProjectInfo): Promise<RunResult> {
		return this.run(this.masterPath, (d) => setProjectDone(d, refOf(project), false, ''));
	}

	/** Moves a project just before or after another in the sidebar, by moving its link line. */
	moveProject(project: ProjectInfo, target: ProjectInfo, place: Place): Promise<RunResult> {
		return this.run(this.masterPath, (d) => moveProjectLink(d, refOf(project), refOf(target), place));
	}

	/** Moves a project to the end of an area, or out of all areas when `area` is null. */
	moveProjectToArea(project: ProjectInfo, area: Area | null): Promise<RunResult> {
		return this.run(this.masterPath, (d) => moveProjectToArea(d, refOf(project), area && refOf(area)));
	}

	/** Areas in the task file, in order. */
	get areas(): Area[] {
		return this.master.doc.areas;
	}

	addArea(name: string): Promise<RunResult> {
		return this.run(this.masterPath, (d) => addArea(d, name));
	}

	renameArea(area: Area, name: string): Promise<RunResult> {
		return this.run(this.masterPath, (d) => renameArea(d, refOf(area), name));
	}

	removeArea(area: Area): Promise<RunResult> {
		return this.run(this.masterPath, (d) => removeArea(d, refOf(area)));
	}

	/** Removes the project from Plainlist. The note itself is left alone. */
	removeProject(project: ProjectInfo): Promise<RunResult> {
		return this.run(this.masterPath, (d) => removeProjectLink(d, refOf(project)));
	}

	/** Renames the project's note. Obsidian updates links if the user allows it; otherwise we fix ours. */
	async renameProject(project: ProjectInfo, name: string): Promise<boolean> {
		const error = projectNameError(name);
		const file = this.app.vault.getAbstractFileByPath(project.path);
		if (error || !(file instanceof TFile)) {
			new Notice(error ?? 'The project note was not found.');
			return false;
		}
		const path = notePath(file.parent?.path ?? '/', name);
		if (path === file.path) return true;
		if (this.app.vault.getAbstractFileByPath(path)) {
			new Notice(`${path} already exists.`);
			return false;
		}
		await this.app.fileManager.renameFile(file, path);
		const text = await this.app.vault.read(this.master.file);
		if (locateLine(parse(text), refOf(project)) !== null) {
			const link = this.app.fileManager.generateMarkdownLink(file, this.masterPath);
			await this.run(this.masterPath, (d) => replaceProjectLink(d, refOf(project), link));
		}
		await this.resolve();
		return true;
	}

	// --- Internals ----------------------------------------------------------

	/**
	 * Remembers an action's changes so `undoLast` can put the notes back. Nothing is kept
	 * when it failed or changed nothing.
	 */
	remember(label: string, res: RunResult): void {
		const changes = res.ok ? res.changes : undefined;
		if (changes?.length) this.undo.push(label, () => this.revert(changes));
	}

	/** Undoes the newest action. Returns its label, or null when there was nothing (or it couldn't). */
	async undoLast(): Promise<string | null> {
		const entry = this.undo.pop();
		if (!entry) {
			new Notice('Plainlist: nothing to undo.');
			return null;
		}
		return (await entry.undo()) ? entry.label : null;
	}

	/**
	 * Puts notes back as they were before some changes, all or none: only while every note
	 * still reads exactly as the changes left it, so nothing written since is lost.
	 */
	revert(changes: Change[]): Promise<boolean> {
		const job = this.queue.then(async () => {
			const stale = changes.find((c) => this.state(c.path)?.text !== c.after);
			if (stale) {
				new Notice(`Plainlist: can't undo, “${stale.path.split('/').pop()?.replace(/\.md$/i, '')}” has changed since.`);
				return false;
			}
			for (const c of [...changes].reverse()) {
				const state = this.state(c.path);
				if (!state) return false;
				try {
					const out = await this.app.vault.process(state.file, (text) => {
						if (text !== c.after) throw new PatchConflict('Changed since');
						return c.before;
					});
					state.text = out;
					state.doc = parse(out);
				} catch (e) {
					this.report(c.path, e);
					return false;
				}
			}
			if (changes.some((c) => c.path === this.masterPath)) await this.resolve();
			else this.notify();
			return true;
		});
		this.queue = job;
		return job;
	}

	private state(path: string): FileState | null {
		return path === this.masterPath ? this.master : (this.notes.get(path) ?? null);
	}

	private async apply(path: string, makeEdits: (doc: Doc) => LineEdit[], box?: TrackBox): Promise<RunResult> {
		const state = this.state(path);
		if (!state) {
			new Notice('Plainlist: that note is no longer available.');
			return { ok: false };
		}
		const track = box?.current.path === path ? box.current.ref : undefined;
		let tracked: LineRef | null = null;
		let before = '';
		try {
			const out = await this.app.vault.process(state.file, (text) => {
				before = text;
				const doc = parse(text);
				const edits = makeEdits(doc);
				if (!edits.length) return text;
				const next = applyEdits(doc, edits);
				if (track) {
					const at = locateLine(doc, track);
					const line = at === null ? null : mapLine(doc, edits, at);
					const lines = parse(next).lines;
					if (line !== null && lines[line] !== undefined) tracked = { line, text: lines[line] };
				}
				return next;
			});
			const doc = parse(out);
			if (track && !tracked) {
				const line = locateLine(doc, track);
				tracked = line === null ? null : { line, text: track.text };
			}
			if (box && tracked) box.current = { path, ref: tracked };
			state.text = out;
			state.doc = doc;
			if (state === this.master) await this.resolve();
			else this.notify();
			return { ok: true, changes: out === before ? [] : [{ path, before, after: out }] };
		} catch (e) {
			this.report(path, e);
			return { ok: false };
		}
	}

	private report(path: string, e: unknown): void {
		if (e instanceof PatchConflict) {
			new Notice(`${path.split('/').pop() ?? path} changed — please try again`);
		} else {
			console.error('Plainlist', e);
			new Notice(`Plainlist could not save: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private async onModify(f: TAbstractFile): Promise<void> {
		if (!(f instanceof TFile)) return;
		const state = this.state(f.path);
		if (!state) return;
		const text = await this.app.vault.read(f);
		// Our own writes are already applied; only re-render for changes made elsewhere.
		if (text === state.text) return;
		state.text = text;
		state.doc = parse(text);
		if (state === this.master) await this.resolve();
		else this.notify();
		// A repeating to-do ticked by hand gets its next one straight away.
		this.tidyNote(f.path, state.doc, false);
	}

	private scheduleResolve(): void {
		window.setTimeout(() => void this.resolve(), 0);
	}

	/** Re-reads which notes are projects, loading any newly linked ones. Calls made meanwhile re-run it. */
	private resolve(): Promise<void> {
		if (this.resolving) {
			this.resolveAgain = true;
			return this.resolving;
		}
		this.resolving = (async () => {
			try {
				do {
					this.resolveAgain = false;
					await this.resolveOnce();
				} while (this.resolveAgain);
			} finally {
				this.resolving = null;
			}
		})();
		return this.resolving;
	}

	private async resolveOnce(): Promise<void> {
		const resolved = resolveProjects(this.app, this.master.file, this.master.doc);
		const next = new Map<string, FileState>();
		for (const p of resolved) {
			if (!p.file) continue;
			const existing = this.notes.get(p.path);
			if (existing && existing.file === p.file) {
				next.set(p.path, existing);
			} else {
				const text = await this.app.vault.read(p.file);
				next.set(p.path, { file: p.file, text, doc: parse(text) });
			}
		}
		this.notes = next;
		this.projects = resolved.map(({ file: _file, ...info }) => info);
		this.notify();
	}

	private notify(): void {
		for (const fn of this.listeners) fn();
	}
}
