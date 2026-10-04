// Pure functions: Doc + action -> minimal line edits. They never touch lines the
// action does not own, and throw PatchConflict rather than guess at a target.

import { descriptionText, headingOf, isBlank } from './parse';
import { formatTaskLine, setDate, setDone, setTitle } from './taskLine';
import type { Doc, LineEdit, Project, Task, TaskDate } from './types';

export class PatchConflict extends Error {}

/** Identifies a line by its index and exact text at the time the UI rendered it. */
export interface LineRef {
	line: number;
	text: string;
}

/** Lines removed by a delete, with their neighbours so undo can find the spot again. */
export interface Removed {
	at: number;
	lines: string[];
	before: string | null;
	after: string | null;
}

export function refOf(item: { line: number; text: string }): LineRef {
	return { line: item.line, text: item.text };
}

function locate<T extends { line: number; text: string }>(items: T[], ref: LineRef, what: string): T {
	const exact = items.find((x) => x.line === ref.line && x.text === ref.text);
	if (exact) return exact;
	const moved = items.filter((x) => x.text === ref.text);
	if (moved.length === 1 && moved[0]) return moved[0];
	throw new PatchConflict(`${what} not found: ${ref.text}`);
}

export function findTask(doc: Doc, ref: LineRef): Task {
	return locate(doc.tasks, ref, 'To-do');
}

export function findProject(doc: Doc, ref: LineRef): Project {
	return locate(doc.projects, ref, 'Project');
}

function projectByName(doc: Doc, name: string): Project {
	const p = doc.projects.find((x) => x.name === name);
	if (!p) throw new PatchConflict(`Project not found: ${name}`);
	return p;
}

function replaceLine(at: number, oldText: string, newText: string): LineEdit[] {
	return oldText === newText ? [] : [{ at, delete: 1, insert: [newText] }];
}

/** Replaces `[start, start + oldLines.length)` with `newLines`, skipping unchanged lines at both ends. */
function replaceRange(start: number, oldLines: string[], newLines: string[]): LineEdit[] {
	let head = 0;
	while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++;
	let tail = 0;
	while (
		tail < oldLines.length - head &&
		tail < newLines.length - head &&
		oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
	) {
		tail++;
	}
	const del = oldLines.length - head - tail;
	const ins = newLines.slice(head, newLines.length - tail);
	return del || ins.length ? [{ at: start + head, delete: del, insert: ins }] : [];
}

/** Pads `content` with blank lines so it sits as its own block at `at`. */
function block(doc: Doc, at: number, content: string[]): string[] {
	const before = at > 0 && !isBlank(doc.lines[at - 1] ?? '') ? [''] : [];
	const after = at < doc.lines.length && !isBlank(doc.lines[at] ?? '') ? [''] : [];
	return [...before, ...content, ...after];
}

function trimBlankEnds(text: string): string[] {
	const lines = text.split(/\r?\n/);
	while (lines.length && isBlank(lines[0] ?? '')) lines.shift();
	while (lines.length && isBlank(lines[lines.length - 1] ?? '')) lines.pop();
	return lines;
}

/** Back up from `at` over blank lines, but not past `floor`. */
function beforeBlanks(doc: Doc, at: number, floor: number): number {
	while (at > floor && isBlank(doc.lines[at - 1] ?? '')) at--;
	return at;
}

/** Edit that appends `lines` (a to-do and its description) to the end of the Inbox, creating `# Inbox` if needed. */
function appendToInbox(doc: Doc, lines: string[]): LineEdit {
	const inbox = doc.inbox;
	if (!inbox) {
		let at = doc.frontmatterEnd;
		while (at < doc.lines.length && isBlank(doc.lines[at] ?? '')) at++;
		return { at, delete: 0, insert: block(doc, at, ['# Inbox', ...lines]) };
	}
	const own = doc.tasks.filter((t) => t.section === 'inbox' && t.line > inbox.line && t.line < inbox.end);
	const last = own[own.length - 1];
	if (last) return { at: last.end, delete: 0, insert: lines };
	const at = inbox.line + 1;
	const next = doc.lines[at];
	const gap = next !== undefined && !isBlank(next) ? [''] : [];
	return { at, delete: 0, insert: [...lines, ...gap] };
}

/** Edit that appends `lines` to the end of project `p`. */
function appendToProject(doc: Doc, p: Project, lines: string[]): LineEdit {
	const last = p.tasks[p.tasks.length - 1];
	if (last) return { at: last.end, delete: 0, insert: lines };
	if (p.descEnd > p.descStart) return { at: p.descEnd, delete: 0, insert: ['', ...lines] };
	return { at: p.line + 1, delete: 0, insert: lines };
}

function appendTo(doc: Doc, project: string | null, lines: string[]): LineEdit {
	return project === null ? appendToInbox(doc, lines) : appendToProject(doc, projectByName(doc, project), lines);
}

/** Description text -> indented lines. Blank lines inside become a lone tab. */
export function descriptionLines(description: string): string[] {
	return trimBlankEnds(description).map((l) => (isBlank(l) ? '\t' : `\t${l}`));
}

// --- To-dos ---------------------------------------------------------------

export interface NewTask {
	title: string;
	date: TaskDate | null;
	/** Project name, or null for the Inbox. */
	project: string | null;
	description?: string;
}

export function addTask(doc: Doc, task: NewTask): LineEdit[] {
	const lines = [formatTaskLine(task.title, false, task.date, null), ...descriptionLines(task.description ?? '')];
	return [appendTo(doc, task.project, lines)];
}

export function setTaskDone(doc: Doc, ref: LineRef, done: boolean, today: string): LineEdit[] {
	const t = findTask(doc, ref);
	return replaceLine(t.line, t.text, setDone(t.text, done, today));
}

export function setTaskTitle(doc: Doc, ref: LineRef, title: string): LineEdit[] {
	const t = findTask(doc, ref);
	return replaceLine(t.line, t.text, setTitle(t.text, title.replace(/[\r\n]+/g, ' ')));
}

export function setTaskDate(doc: Doc, ref: LineRef, date: TaskDate | null): LineEdit[] {
	const t = findTask(doc, ref);
	return replaceLine(t.line, t.text, setDate(t.text, date));
}

export function setTaskDescription(doc: Doc, ref: LineRef, description: string): LineEdit[] {
	const t = findTask(doc, ref);
	const oldRaw = doc.lines.slice(t.line + 1, t.end);
	const oldText = oldRaw.length ? descriptionText(oldRaw).split('\n') : [];
	const newText = trimBlankEnds(description);
	// Keep the original raw line wherever its text is unchanged, so its indentation survives.
	const newRaw = descriptionLines(description).map((raw, i) =>
		i < oldRaw.length && oldText[i] === newText[i] ? (oldRaw[i] ?? raw) : raw,
	);
	return replaceRange(t.line + 1, oldRaw, newRaw);
}

/** Moves a to-do (with its description) to the end of a project, or the Inbox when `project` is null. */
export function moveTask(doc: Doc, ref: LineRef, project: string | null): LineEdit[] {
	const t = findTask(doc, ref);
	// `other` to-dos already show as Inbox items; they stay where they are.
	if (project === null ? t.section !== 'project' : t.project === project) return [];
	const lines = doc.lines.slice(t.line, t.end);
	return [{ at: t.line, delete: t.end - t.line, insert: [] }, appendTo(doc, project, lines)];
}

export function deleteTask(doc: Doc, ref: LineRef): { edits: LineEdit[]; removed: Removed } {
	const t = findTask(doc, ref);
	return {
		edits: [{ at: t.line, delete: t.end - t.line, insert: [] }],
		removed: {
			at: t.line,
			lines: doc.lines.slice(t.line, t.end),
			before: doc.lines[t.line - 1] ?? null,
			after: doc.lines[t.end] ?? null,
		},
	};
}

/** Puts deleted lines back between the same neighbours. */
export function restoreLines(doc: Doc, removed: Removed): LineEdit[] {
	const fits = (at: number): boolean =>
		(doc.lines[at - 1] ?? null) === removed.before && (doc.lines[at] ?? null) === removed.after;
	if (fits(removed.at)) return [{ at: removed.at, delete: 0, insert: removed.lines }];
	const spots: number[] = [];
	for (let at = 0; at <= doc.lines.length; at++) if (fits(at)) spots.push(at);
	if (spots.length === 1 && spots[0] !== undefined) return [{ at: spots[0], delete: 0, insert: removed.lines }];
	throw new PatchConflict('Could not find where the deleted lines were');
}

// --- Projects -------------------------------------------------------------

function cleanName(name: string): string {
	const clean = name.replace(/[\r\n]+/g, ' ').trim();
	if (!clean) throw new PatchConflict('Project name is empty');
	return clean;
}

export function addProject(doc: Doc, name: string): LineEdit[] {
	const clean = cleanName(name);
	if (doc.projects.some((p) => p.name === clean)) throw new PatchConflict(`Project already exists: ${clean}`);
	const section = doc.projectsSection;
	if (section) {
		const at = beforeBlanks(doc, section.end, section.line + 1);
		return [{ at, delete: 0, insert: block(doc, at, [`## ${clean}`]) }];
	}
	// No `# Projects` yet: add it after the Inbox (before the next level-1 heading), or at the end.
	let at = doc.lines.length;
	if (doc.inbox) {
		const inboxLine = doc.inbox.line;
		const next = doc.lines.findIndex(
			(l, i) => i > inboxLine && doc.nodes[i]?.kind !== 'taskDesc' && headingOf(l)?.level === 1,
		);
		if (next !== -1) at = next;
		at = beforeBlanks(doc, at, inboxLine + 1);
	}
	return [{ at, delete: 0, insert: block(doc, at, ['# Projects', '', `## ${clean}`]) }];
}

export function renameProject(doc: Doc, ref: LineRef, name: string): LineEdit[] {
	const p = findProject(doc, ref);
	const clean = cleanName(name);
	if (clean !== p.name && doc.projects.some((x) => x.name === clean)) {
		throw new PatchConflict(`Project already exists: ${clean}`);
	}
	return replaceLine(p.line, p.text, `## ${clean}`);
}

export function setProjectDescription(doc: Doc, ref: LineRef, description: string): LineEdit[] {
	const p = findProject(doc, ref);
	const newLines = trimBlankEnds(description);
	if (p.descEnd > p.descStart) {
		if (!newLines.length) {
			// Also drop the blank line that separated the description from what follows.
			const gap = p.descStart === p.line + 1 && isBlank(doc.lines[p.descEnd] ?? 'x') ? 1 : 0;
			return [{ at: p.descStart, delete: p.descEnd - p.descStart + gap, insert: [] }];
		}
		return replaceRange(p.descStart, doc.lines.slice(p.descStart, p.descEnd), newLines);
	}
	if (!newLines.length) return [];
	const next = doc.lines[p.line + 1];
	const gap = next !== undefined && !isBlank(next) ? [''] : [];
	return [{ at: p.line + 1, delete: 0, insert: [...newLines, ...gap] }];
}

/** Moves the project's to-dos to the end of the Inbox, then removes its heading and description. */
export function deleteProject(doc: Doc, ref: LineRef): LineEdit[] {
	const p = findProject(doc, ref);
	const remove = new Set<number>([p.line]);
	for (let i = p.descStart; i < p.descEnd; i++) remove.add(i);
	const moved: string[] = [];
	for (const t of p.tasks) {
		for (let i = t.line; i < t.end; i++) {
			remove.add(i);
			moved.push(doc.lines[i] ?? '');
		}
	}
	// If nothing but blank lines would be left of the project, remove those too.
	let onlyBlank = true;
	for (let i = p.line; i < p.end; i++) if (!remove.has(i) && !isBlank(doc.lines[i] ?? '')) onlyBlank = false;
	if (onlyBlank) for (let i = p.line; i < p.end; i++) remove.add(i);

	const edits: LineEdit[] = [];
	const sorted = [...remove].sort((a, b) => a - b);
	for (const i of sorted) {
		const prev = edits[edits.length - 1];
		if (prev && prev.at + prev.delete === i) prev.delete++;
		else edits.push({ at: i, delete: 1, insert: [] });
	}
	if (moved.length) edits.push(appendToInbox(doc, moved));
	return edits;
}
