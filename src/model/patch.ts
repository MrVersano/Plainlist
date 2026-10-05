// Pure functions: Doc + action -> minimal line edits. They never touch lines the
// action does not own, and throw PatchConflict rather than guess at a target.

import { headingOf, isBlank, projectLinkTarget } from './parse';
import { formatTaskLine, setDate, setDone, setTitle } from './taskLine';
import type { Doc, LineEdit, ProjectLink, Task, TaskDate } from './types';

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

/** Where a to-do goes: the task file's Inbox, or the to-do list of a project note. */
export type Destination = 'inbox' | 'note';

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

export function findProjectLink(doc: Doc, ref: LineRef): ProjectLink {
	return locate(doc.projectLinks, ref, 'Project');
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

/** Pads `content` with blank lines so it sits as its own block at `at`. Returns the padded lines and the content's offset. */
function block(doc: Doc, at: number, content: string[]): { lines: string[]; offset: number } {
	const before = at > 0 && !isBlank(doc.lines[at - 1] ?? '') ? [''] : [];
	const after = at < doc.lines.length && !isBlank(doc.lines[at] ?? '') ? [''] : [];
	return { lines: [...before, ...content, ...after], offset: before.length };
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

/** One indentation step for lines under a to-do with this indent. */
function indentUnit(indent: string): string {
	return indent && !indent.includes('\t') ? '    ' : '\t';
}

/** Description text -> lines indented one step under a to-do. Blank lines inside keep the indent. */
export function descriptionLines(description: string, taskIndent = ''): string[] {
	const pad = taskIndent + indentUnit(taskIndent);
	return trimBlankEnds(description).map((l) => (isBlank(l) ? pad : pad + l));
}

function reindent(lines: string[], from: string, to: string): string[] {
	return lines.map((l) => (isBlank(l) ? l : to + (l.startsWith(from) ? l.slice(from.length) : l.trimStart())));
}

/** An insertion, plus where the to-do's title line lands within the inserted lines. */
export interface Insertion {
	edit: LineEdit;
	/** Index of the title line within `edit.insert`. */
	offset: number;
}

/** Appends lines for a to-do (given at indent 0) to the end of the Inbox, creating `# Inbox` if needed. */
function appendToInbox(doc: Doc, lines: string[]): Insertion {
	const inbox = doc.inbox;
	if (!inbox) {
		let at = doc.frontmatterEnd;
		while (at < doc.lines.length && isBlank(doc.lines[at] ?? '')) at++;
		const b = block(doc, at, ['# Inbox', ...lines]);
		return { edit: { at, delete: 0, insert: b.lines }, offset: b.offset + 1 };
	}
	const own = doc.tasks.filter((t) => t.section === 'inbox' && t.line > inbox.line && t.line < inbox.end);
	const last = own[own.length - 1];
	if (last) return { edit: { at: Math.max(last.end, last.subtreeEnd), delete: 0, insert: lines }, offset: 0 };
	const at = inbox.line + 1;
	const next = doc.lines[at];
	const gap = next !== undefined && !isBlank(next) ? [''] : [];
	return { edit: { at, delete: 0, insert: [...lines, ...gap] }, offset: 0 };
}

/** Appends lines for a to-do after the note's last top-level to-do, or at the end of the note. */
function appendToNote(doc: Doc, lines: string[]): Insertion {
	if (!doc.tasks.length) {
		const at = beforeBlanks(doc, doc.lines.length, doc.frontmatterEnd);
		const b = block(doc, at, lines);
		return { edit: { at, delete: 0, insert: b.lines }, offset: b.offset };
	}
	const top = Math.min(...doc.tasks.map((t) => t.indent.length));
	const anchor = [...doc.tasks].reverse().find((t) => t.indent.length === top) ?? doc.tasks[doc.tasks.length - 1]!;
	return { edit: { at: anchor.subtreeEnd, delete: 0, insert: reindent(lines, '', anchor.indent) }, offset: 0 };
}

export function insertTaskLines(doc: Doc, lines: string[], dest: Destination): Insertion {
	return dest === 'inbox' ? appendToInbox(doc, lines) : appendToNote(doc, lines);
}

// --- To-dos ---------------------------------------------------------------

export interface NewTask {
	title: string;
	date: TaskDate | null;
	description?: string;
}

export function addTask(doc: Doc, task: NewTask, dest: Destination): LineEdit[] {
	const lines = [formatTaskLine(task.title, false, task.date, null), ...descriptionLines(task.description ?? '')];
	return [insertTaskLines(doc, lines, dest).edit];
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
	const oldText = oldRaw.length ? t.description.split('\n') : [];
	const newText = trimBlankEnds(description);
	// Keep the original raw line wherever its text is unchanged, so its indentation survives.
	const newRaw = descriptionLines(description, t.indent).map((raw, i) =>
		i < oldRaw.length && oldText[i] === newText[i] ? (oldRaw[i] ?? raw) : raw,
	);
	return replaceRange(t.line + 1, oldRaw, newRaw);
}

/**
 * Takes a to-do out of its note for a move: its lines (and everything nested under it),
 * re-indented to the left margin, and the edit that removes them.
 */
export function extractTask(doc: Doc, ref: LineRef): { lines: string[]; edits: LineEdit[] } {
	const t = findTask(doc, ref);
	const end = Math.max(t.end, t.subtreeEnd);
	return {
		lines: reindent(doc.lines.slice(t.line, end), t.indent, ''),
		edits: [{ at: t.line, delete: end - t.line, insert: [] }],
	};
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

// --- Project links in the task file ---------------------------------------

/** Adds `- <link>` to the end of the project list, creating `# Projects` if needed. */
export function addProjectLink(doc: Doc, link: string): LineEdit[] {
	const target = projectLinkTarget(`- ${link}`);
	if (!target) throw new PatchConflict(`Not a link: ${link}`);
	if (doc.projectLinks.some((p) => p.target === target)) throw new PatchConflict(`Already a project: ${target}`);
	const item = `- ${link}`;
	const section = doc.projectsSection;
	if (section) {
		const last = doc.projectLinks.filter((p) => p.line > section.line && p.line < section.end).pop();
		if (last) return [{ at: last.line + 1, delete: 0, insert: [item] }];
		const at = section.line + 1;
		const next = doc.lines[at];
		const gap = next !== undefined && !isBlank(next) ? [''] : [];
		return [{ at, delete: 0, insert: [item, ...gap] }];
	}
	// No `# Projects` yet: add it after the Inbox (before the next level-1 heading), or at the end.
	let at = doc.lines.length;
	if (doc.inbox) {
		const inboxLine = doc.inbox.line;
		const next = doc.lines.findIndex(
			(l, i) => i > inboxLine && doc.nodes[i]?.kind === 'opaque' && headingOf(l)?.level === 1,
		);
		if (next !== -1) at = next;
		at = beforeBlanks(doc, at, inboxLine + 1);
	}
	return [{ at, delete: 0, insert: block(doc, at, ['# Projects', item]).lines }];
}

export function removeProjectLink(doc: Doc, ref: LineRef): LineEdit[] {
	const p = findProjectLink(doc, ref);
	return [{ at: p.line, delete: 1, insert: [] }];
}

/** Rewrites a project link (after its note was renamed), keeping the line's indent and marker. */
export function replaceProjectLink(doc: Doc, ref: LineRef, link: string): LineEdit[] {
	const p = findProjectLink(doc, ref);
	const marker = /^[ \t]*[-*+][ \t]+/.exec(p.text)?.[0] ?? '- ';
	return replaceLine(p.line, p.text, `${marker}${link}`);
}

/** Marks a project complete (`- [x] [[Note]] [done:: today]`) or open again (`- [[Note]]`). */
export function setProjectDone(doc: Doc, ref: LineRef, done: boolean, today: string): LineEdit[] {
	const p = findProjectLink(doc, ref);
	if (p.done === done) return [];
	const marker = /^[ \t]*[-*+][ \t]+/.exec(p.text)?.[0] ?? '- ';
	return replaceLine(p.line, p.text, done ? `${marker}[x] ${p.link} [done:: ${today}]` : `${marker}${p.link}`);
}

/** Completes every open to-do in a note. Returns the edits and the completed lines, for undo. */
export function completeOpenTasks(doc: Doc, today: string): { edits: LineEdit[]; completed: LineRef[] } {
	const edits: LineEdit[] = [];
	const completed: LineRef[] = [];
	for (const t of doc.tasks) {
		if (t.done) continue;
		const text = setDone(t.text, true, today);
		edits.push({ at: t.line, delete: 1, insert: [text] });
		completed.push({ line: t.line, text });
	}
	return { edits, completed };
}

/** Moves every open to-do dated before today to today. */
export function rollOverdueTasks(doc: Doc, today: string): LineEdit[] {
	const edits: LineEdit[] = [];
	for (const t of doc.tasks) {
		if (t.done || !t.date || t.date === 'someday' || t.date >= today) continue;
		edits.push({ at: t.line, delete: 1, insert: [setDate(t.text, today)] });
	}
	return edits;
}

/** Reopens the given to-dos, skipping any that changed or disappeared since. */
export function reopenTasks(doc: Doc, refs: LineRef[]): LineEdit[] {
	const edits: LineEdit[] = [];
	for (const ref of refs) {
		let t: Task;
		try {
			t = findTask(doc, ref);
		} catch {
			continue;
		}
		if (!edits.some((e) => e.at === t.line)) edits.push(...replaceLine(t.line, t.text, setDone(t.text, false, '')));
	}
	return edits;
}
