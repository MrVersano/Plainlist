// Pure functions: Doc + action -> minimal line edits. They never touch lines the
// action does not own, and throw PatchConflict rather than guess at a target.

import { mapLine } from './apply';
import { headingOf, isBlank, projectLinkTarget } from './parse';
import { firstOccurrence, nextOccurrence, parseRepeat } from '../dates/repeat';
import { formatTaskLine, parseTaskLine, setDate, setDone, setRepeat, setTitle } from './taskLine';
import type { Area, Doc, Heading, LineEdit, ProjectLink, Section, Task, TaskDate } from './types';

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

/** Where a to-do goes: the task file's Inbox, the to-do list of a project note, or under a heading in one. */
export type Destination = 'inbox' | 'note' | { heading: LineRef };

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

export function findHeading(doc: Doc, ref: LineRef): Heading {
	return locate(doc.headings, ref, 'Heading');
}

export function findProjectLink(doc: Doc, ref: LineRef): ProjectLink {
	return locate(doc.projectLinks, ref, 'Project');
}

export function findArea(doc: Doc, ref: LineRef): Area {
	return locate(doc.areas, ref, 'Area');
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

/**
 * Appends lines for a to-do to the note itself, not under a heading: after the last top-level
 * to-do above the first heading, or just above that heading. Without headings: after the
 * note's last top-level to-do, or at the end of the note.
 */
function appendToNote(doc: Doc, lines: string[]): Insertion {
	const first = doc.headings[0];
	if (first) {
		const own = doc.tasks.filter((t) => t.line < first.line);
		if (!own.length) {
			const at = beforeBlanks(doc, first.line, doc.frontmatterEnd);
			const b = block(doc, at, lines);
			return { edit: { at, delete: 0, insert: b.lines }, offset: b.offset };
		}
		const top = Math.min(...own.map((t) => t.indent.length));
		const anchor = [...own].reverse().find((t) => t.indent.length === top) ?? own[own.length - 1]!;
		return { edit: { at: anchor.subtreeEnd, delete: 0, insert: reindent(lines, '', anchor.indent) }, offset: 0 };
	}
	if (!doc.tasks.length) {
		const at = beforeBlanks(doc, doc.lines.length, doc.frontmatterEnd);
		const b = block(doc, at, lines);
		return { edit: { at, delete: 0, insert: b.lines }, offset: b.offset };
	}
	const top = Math.min(...doc.tasks.map((t) => t.indent.length));
	const anchor = [...doc.tasks].reverse().find((t) => t.indent.length === top) ?? doc.tasks[doc.tasks.length - 1]!;
	return { edit: { at: anchor.subtreeEnd, delete: 0, insert: reindent(lines, '', anchor.indent) }, offset: 0 };
}

/** Appends lines for a to-do after the last top-level to-do under a heading, or at the end of its section. */
function appendToHeading(doc: Doc, ref: LineRef, lines: string[]): Insertion {
	const h = findHeading(doc, ref);
	const own = doc.tasks.filter((t) => t.heading?.line === h.line);
	if (!own.length) {
		const at = beforeBlanks(doc, h.end, h.line + 1);
		const b = block(doc, at, lines);
		return { edit: { at, delete: 0, insert: b.lines }, offset: b.offset };
	}
	const top = Math.min(...own.map((t) => t.indent.length));
	const anchor = [...own].reverse().find((t) => t.indent.length === top) ?? own[own.length - 1]!;
	return { edit: { at: anchor.subtreeEnd, delete: 0, insert: reindent(lines, '', anchor.indent) }, offset: 0 };
}

export function insertTaskLines(doc: Doc, lines: string[], dest: Destination): Insertion {
	if (dest === 'inbox') return appendToInbox(doc, lines);
	return dest === 'note' ? appendToNote(doc, lines) : appendToHeading(doc, dest.heading, lines);
}

// --- To-dos ---------------------------------------------------------------

export interface NewTask {
	title: string;
	date: TaskDate | null;
	/** A `[repeat:: …]` rule. */
	repeat?: string | null;
	description?: string;
	/** How deeply it is nested under the to-dos before it: 1 is a sub-task of the closest one at 0. */
	depth?: number;
}

function newTaskLines(t: NewTask): string[] {
	const indent = '\t'.repeat(t.depth ?? 0);
	return [formatTaskLine(t.title, false, t.date, null, `${indent}- `, t.repeat ?? null), ...descriptionLines(t.description ?? '', indent)];
}

export function addTask(doc: Doc, task: NewTask, dest: Destination): LineEdit[] {
	return [insertTaskLines(doc, newTaskLines(task), dest).edit];
}

/** Adds several to-dos at once, in order, as a single edit. A to-do's `depth` nests it under the ones before. */
export function addTasks(doc: Doc, tasks: NewTask[], dest: Destination): LineEdit[] {
	if (!tasks.length) return [];
	return [insertTaskLines(doc, tasks.flatMap(newTaskLines), dest).edit];
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

/**
 * Sets or removes a to-do's repeat rule. A to-do given a rule without a date (or with
 * "someday") gets the rule's first date, from today.
 */
export function setTaskRepeat(doc: Doc, ref: LineRef, repeat: string | null, today: string, weekStart: 0 | 1): LineEdit[] {
	const t = findTask(doc, ref);
	const rule = repeat ? parseRepeat(repeat) : null;
	if (repeat && !rule) throw new PatchConflict(`Not a repeat rule: ${repeat}`);
	let line = setRepeat(t.text, repeat);
	if (rule && (!t.date || t.date === 'someday')) line = setDate(line, firstOccurrence(rule, today, weekStart));
	return replaceLine(t.line, t.text, line);
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

/**
 * Moves a to-do (and everything nested under it) under another heading in the same note, or
 * above all headings when `heading` is null. Returns no edits when it is already there.
 * `landed` is where its title line ends up.
 */
export function moveTaskToHeading(doc: Doc, ref: LineRef, heading: LineRef | null): { edits: LineEdit[]; landed: LineRef } {
	const t = findTask(doc, ref);
	const h = heading && findHeading(doc, heading);
	if ((t.heading?.line ?? null) === (h?.line ?? null)) return { edits: [], landed: refOf(t) };
	const out = extractTask(doc, ref);
	const removed = out.edits[0]!;
	const ins = insertTaskLines(doc, out.lines, heading ? { heading } : 'note');
	const shift = ins.edit.at >= removed.at + removed.delete ? removed.delete : 0;
	return {
		edits: [...out.edits, ins.edit],
		landed: { line: ins.edit.at - shift + ins.offset, text: ins.edit.insert[ins.offset] ?? '' },
	};
}

/** Deletes a to-do with its description and its sub-tasks. */
export function deleteTask(doc: Doc, ref: LineRef): { edits: LineEdit[]; removed: Removed } {
	const t = findTask(doc, ref);
	const end = Math.max(t.end, t.subtreeEnd);
	return {
		edits: [{ at: t.line, delete: end - t.line, insert: [] }],
		removed: {
			at: t.line,
			lines: doc.lines.slice(t.line, end),
			before: doc.lines[t.line - 1] ?? null,
			after: doc.lines[end] ?? null,
		},
	};
}

// --- Sub-tasks --------------------------------------------------------------

/** The edits that result, and where the to-do's title line ends up. */
export interface Relocation {
	edits: LineEdit[];
	landed: LineRef;
}

/** The indent for a new sub-task of `t`: that of its existing sub-tasks, or one step deeper than it. */
function childIndent(doc: Doc, t: Task): string {
	const last = [...doc.tasks].reverse().find((c) => c.parent === t.line);
	return last ? last.indent : t.indent + indentUnit(t.indent);
}

/**
 * Re-indents a to-do's block to `indent` and puts it at line `at`. When only blank lines
 * separate `at` from the block, the lines are rewritten in place, one edit per line.
 */
function relocate(doc: Doc, t: Task, at: number, indent: string): Relocation {
	const end = Math.max(t.end, t.subtreeEnd);
	const lines = reindent(doc.lines.slice(t.line, end), t.indent, indent);
	const between = at <= t.line ? doc.lines.slice(at, t.line) : doc.lines.slice(end, at);
	if (between.every(isBlank)) {
		const edits = lines.flatMap((l, i) => replaceLine(t.line + i, doc.lines[t.line + i] ?? '', l));
		return { edits, landed: { line: t.line, text: lines[0] ?? '' } };
	}
	const line = at < t.line ? at : at - (end - t.line);
	return {
		edits: [
			{ at: t.line, delete: end - t.line, insert: [] },
			{ at, delete: 0, insert: lines },
		],
		landed: { line, text: lines[0] ?? '' },
	};
}

/**
 * Makes a to-do (with everything nested under it) a sub-task of `under`, its last one.
 * `under` must come before it and be nested under the same to-do (or both at the top level).
 */
export function indentTask(doc: Doc, ref: LineRef, under: LineRef): Relocation {
	const t = findTask(doc, ref);
	const p = findTask(doc, under);
	if (p.line >= t.line || p.parent !== t.parent) throw new PatchConflict(`Cannot nest ${t.text} under ${p.text}`);
	return relocate(doc, t, Math.max(p.end, p.subtreeEnd), childIndent(doc, p));
}

/** Moves a sub-task out of its parent, to just after the parent's block, at the parent's indent. */
export function outdentTask(doc: Doc, ref: LineRef): Relocation {
	const t = findTask(doc, ref);
	const p = doc.tasks.find((x) => x.line === t.parent);
	if (!p) return { edits: [], landed: refOf(t) };
	return relocate(doc, t, Math.max(p.end, p.subtreeEnd), p.indent);
}

/** Where a dragged item lands relative to the one it was dropped on. */
export type Place = 'before' | 'after';

/**
 * Whether a to-do can be put next to `target` by reordering lines: both in the same note
 * (checked by the caller), siblings under the same parent and in the same section.
 */
export function canReorder(t: Task, target: Task): boolean {
	return t.line !== target.line && !t.done && !target.done && t.parent === target.parent && t.section === target.section;
}

/**
 * Reorders a to-do (with everything nested under it) to just before or after a sibling's
 * block, at the sibling's indent. In a note with headings this can also move it under the
 * sibling's heading.
 */
export function moveTaskNextTo(doc: Doc, ref: LineRef, target: LineRef, place: Place): Relocation {
	const t = findTask(doc, ref);
	const p = findTask(doc, target);
	if (!canReorder(t, p)) throw new PatchConflict(`Cannot move ${t.text} next to ${p.text}`);
	return relocate(doc, t, place === 'before' ? p.line : Math.max(p.end, p.subtreeEnd), p.indent);
}

/** Adds an untitled sub-task after a to-do's last one. */
export function addSubtask(doc: Doc, ref: LineRef): Relocation {
	const p = findTask(doc, ref);
	const at = Math.max(p.end, p.subtreeEnd);
	const text = formatTaskLine('', false, null, null, `${childIndent(doc, p)}- `);
	return { edits: [{ at, delete: 0, insert: [text] }], landed: { line: at, text } };
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

// --- Several to-dos at once --------------------------------------------------
//
// One note's share of a bulk action, as a single set of edits against the same Doc, so no
// edit has to find a line that an earlier one moved. A to-do nested under another one in
// the selection goes along with it rather than being handled twice.

/** The to-dos `refs` name, in file order and without duplicates. */
function findTasks(doc: Doc, refs: LineRef[]): Task[] {
	const found = new Map<number, Task>();
	for (const ref of refs) {
		const t = findTask(doc, ref);
		found.set(t.line, t);
	}
	return [...found.values()].sort((a, b) => a.line - b.line);
}

const blockEnd = (t: Task): number => Math.max(t.end, t.subtreeEnd);

/** Drops to-dos that sit inside the block of an earlier one in the list. */
function outermost(tasks: Task[]): Task[] {
	const out: Task[] = [];
	for (const t of tasks) {
		const last = out[out.length - 1];
		if (!last || t.line >= blockEnd(last)) out.push(t);
	}
	return out;
}

/**
 * Deletes several to-dos with their descriptions and sub-tasks. Each `Removed` is one run of
 * deleted lines, with `at` counted in the note after the delete, so `restoreAll` can put them
 * all back in one go.
 */
export function deleteTasks(doc: Doc, refs: LineRef[]): { edits: LineEdit[]; removed: Removed[] } {
	const ranges: { start: number; end: number }[] = [];
	for (const t of outermost(findTasks(doc, refs))) {
		const last = ranges[ranges.length - 1];
		if (last && t.line <= last.end) last.end = Math.max(last.end, blockEnd(t));
		else ranges.push({ start: t.line, end: blockEnd(t) });
	}
	let gone = 0;
	const removed = ranges.map(({ start, end }) => {
		const r: Removed = {
			at: start - gone,
			lines: doc.lines.slice(start, end),
			before: doc.lines[start - 1] ?? null,
			after: doc.lines[end] ?? null,
		};
		gone += end - start;
		return r;
	});
	return { edits: ranges.map(({ start, end }) => ({ at: start, delete: end - start, insert: [] })), removed };
}

/** Puts back everything `deleteTasks` removed. */
export function restoreAll(doc: Doc, removed: Removed[]): LineEdit[] {
	return removed.flatMap((r) => restoreLines(doc, r));
}

/** What `completeTasks` did, for undo and to know where each completed to-do ends up. */
export interface BulkDone {
	edits: LineEdit[];
	/** Non-repeating to-dos it ticked (or reopened). */
	changed: Reopen[];
	/** Repeating to-dos it completed, each with its next one added above it. */
	repeated: Repeated[];
	/** Where each to-do's title line is after the edits. */
	lines: number[];
}

/**
 * Completes (or, with `done` false, reopens) several to-dos. A repeating one gets its next
 * one, as when ticked on its own, and takes its open sub-tasks with it.
 */
export function completeTasks(doc: Doc, refs: LineRef[], done: boolean, today: string, weekStart: 0 | 1): BulkDone {
	const edits: LineEdit[] = [];
	const changed: { line: number; text: string; before: string }[] = [];
	const repeated: { line: number; r: Repeated }[] = [];
	let taken = -1;
	for (const t of findTasks(doc, refs)) {
		if (t.line < taken || t.done === done) continue;
		const r = done && t.repeat ? completeRepeating(doc, refOf(t), today, weekStart) : null;
		if (r) {
			edits.push(...r.edits);
			repeated.push({ line: t.line, r: r.repeated });
			taken = blockEnd(t);
			continue;
		}
		const text = setDone(t.text, done, today);
		edits.push(...replaceLine(t.line, t.text, text));
		changed.push({ line: t.line, text, before: t.text });
	}
	const at = (line: number): number => mapLine(doc, edits, line) ?? line;
	return {
		edits,
		changed: changed.map((c) => ({ ref: { line: at(c.line), text: c.text }, before: c.before })),
		// The next one goes just above the completed one, which is replaced line for line.
		repeated: repeated.map(({ line, r }) => ({ ...r, next: { line: at(line) - (r.lines.length - r.before.length), text: r.next.text } })),
		lines: [...changed.map((c) => at(c.line)), ...repeated.map(({ line }) => at(line))].sort((a, b) => a - b),
	};
}

/** Undoes `completeTasks`, skipping any to-do that changed since. */
export function undoComplete(doc: Doc, done: BulkDone): LineEdit[] {
	const edits = reopenTasks(doc, done.changed);
	for (const r of done.repeated) {
		try {
			edits.push(...undoRepeat(doc, r));
		} catch {
			// Changed since; leave it.
		}
	}
	return edits;
}

/** Gives several to-dos the same date (or none). */
export function setTasksDate(doc: Doc, refs: LineRef[], date: TaskDate | null): LineEdit[] {
	return findTasks(doc, refs).flatMap((t) => replaceLine(t.line, t.text, setDate(t.text, date)));
}

/**
 * Takes several to-dos out of a note for a move, as `extractTask` does: their blocks, one
 * after another in file order and re-indented to the left margin, and the edits that remove them.
 */
export function extractTasks(doc: Doc, refs: LineRef[]): { lines: string[]; edits: LineEdit[] } {
	const parts = outermost(findTasks(doc, refs)).map((t) => extractTask(doc, refOf(t)));
	return { lines: parts.flatMap((p) => p.lines), edits: parts.flatMap((p) => p.edits) };
}

/** Moves several to-dos under one heading in the same note (or above all headings), as `moveTaskToHeading` does. */
export function moveTasksToHeading(doc: Doc, refs: LineRef[], heading: LineRef | null): LineEdit[] {
	const h = heading && findHeading(doc, heading);
	const moving = outermost(findTasks(doc, refs)).filter((t) => (t.heading?.line ?? null) !== (h?.line ?? null));
	if (!moving.length) return [];
	const out = extractTasks(doc, moving.map(refOf));
	return [...out.edits, insertTaskLines(doc, out.lines, heading ? { heading } : 'note').edit];
}

// --- Project links in the task file ---------------------------------------

/**
 * Where a link goes to come last in an area, or last among the projects before any area (`area` null),
 * and whether it needs a blank line after it to keep a heading below at arm's length.
 */
function areaEnd(doc: Doc, section: Section, area: Area | null): { at: number; gap: boolean } {
	const last = doc.projectLinks.filter((p) => p.line > section.line && p.line < section.end && (p.area?.line ?? null) === (area?.line ?? null)).pop();
	const at = last ? last.line + 1 : (area ?? section).line + 1;
	const next = doc.lines[at];
	return { at, gap: !last && next !== undefined && !isBlank(next) };
}

/** Adds `- <link>` to the end of the project list, before any area, creating `# Projects` if needed. */
export function addProjectLink(doc: Doc, link: string): LineEdit[] {
	const target = projectLinkTarget(`- ${link}`);
	if (!target) throw new PatchConflict(`Not a link: ${link}`);
	if (doc.projectLinks.some((p) => p.target === target)) throw new PatchConflict(`Already a project: ${target}`);
	const item = `- ${link}`;
	const section = doc.projectsSection;
	if (section) {
		const { at, gap } = areaEnd(doc, section, null);
		return [{ at, delete: 0, insert: gap ? [item, ''] : [item] }];
	}
	return addProjectsSection(doc, [item]);
}

/** Adds a `# Projects` section holding `content`: after the Inbox (before the next level-1 heading), or at the end. */
function addProjectsSection(doc: Doc, content: string[]): LineEdit[] {
	let at = doc.lines.length;
	if (doc.inbox) {
		const inboxLine = doc.inbox.line;
		const next = doc.lines.findIndex(
			(l, i) => i > inboxLine && doc.nodes[i]?.kind === 'opaque' && headingOf(l)?.level === 1,
		);
		if (next !== -1) at = next;
		at = beforeBlanks(doc, at, inboxLine + 1);
	}
	return [{ at, delete: 0, insert: block(doc, at, ['# Projects', ...content]).lines }];
}

export function removeProjectLink(doc: Doc, ref: LineRef): LineEdit[] {
	const p = findProjectLink(doc, ref);
	return [{ at: p.line, delete: 1, insert: [] }];
}

/** Moves a project's link line to just before or after another's, which sets the sidebar order. */
export function moveProjectLink(doc: Doc, ref: LineRef, target: LineRef, place: Place): LineEdit[] {
	const p = findProjectLink(doc, ref);
	const q = findProjectLink(doc, target);
	const at = place === 'before' ? q.line : q.line + 1;
	if (p.line === q.line || at === p.line || at === p.line + 1) return [];
	return [
		{ at: p.line, delete: 1, insert: [] },
		{ at, delete: 0, insert: [p.text] },
	];
}

/** Rewrites a project link (after its note was renamed), keeping the line's indent and marker. */
export function replaceProjectLink(doc: Doc, ref: LineRef, link: string): LineEdit[] {
	const p = findProjectLink(doc, ref);
	const marker = /^[ \t]*[-*+][ \t]+/.exec(p.text)?.[0] ?? '- ';
	return replaceLine(p.line, p.text, `${marker}${link}`);
}

/** Moves a project's link to the end of an area, or of the projects before any area when `area` is null. */
export function moveProjectToArea(doc: Doc, ref: LineRef, area: LineRef | null): LineEdit[] {
	const p = findProjectLink(doc, ref);
	const a = area ? findArea(doc, area) : null;
	const section = doc.projectsSection;
	if (!section || (p.area?.line ?? null) === (a?.line ?? null)) return [];
	const { at, gap } = areaEnd(doc, section, a);
	return [
		{ at: p.line, delete: 1, insert: [] },
		{ at, delete: 0, insert: gap ? [p.text, ''] : [p.text] },
	];
}

/** Adds `## name` at the end of `# Projects`, creating the section if needed. */
export function addArea(doc: Doc, name: string): LineEdit[] {
	const title = name.trim();
	if (!title) throw new PatchConflict('An area needs a name');
	if (doc.areas.some((a) => a.name.toLowerCase() === title.toLowerCase())) throw new PatchConflict(`Already an area: ${title}`);
	const section = doc.projectsSection;
	if (!section) return addProjectsSection(doc, ['', `## ${title}`]);
	const at = beforeBlanks(doc, section.end, section.line + 1);
	return [{ at, delete: 0, insert: block(doc, at, [`## ${title}`]).lines }];
}

/** Renames an area, keeping its heading level. */
export function renameArea(doc: Doc, ref: LineRef, name: string): LineEdit[] {
	const a = findArea(doc, ref);
	const title = name.trim();
	if (!title) throw new PatchConflict('An area needs a name');
	const prefix = /^[ \t]*#+[ \t]+/.exec(a.text)?.[0] ?? '## ';
	return replaceLine(a.line, a.text, `${prefix}${title}`);
}

/** Removes an area's heading. Its projects stay, and join the area above (or none). */
export function removeArea(doc: Doc, ref: LineRef): LineEdit[] {
	const a = findArea(doc, ref);
	// Don't leave two blank lines where the heading was.
	const blankAround = isBlank(doc.lines[a.line - 1] ?? 'x') && isBlank(doc.lines[a.line + 1] ?? 'x');
	return [{ at: a.line, delete: blankAround ? 2 : 1, insert: [] }];
}

/**
 * Moves an area, with its heading and projects, to just before or after another area.
 * Blank lines between areas stay where they were, so the file keeps its spacing.
 */
export function moveArea(doc: Doc, ref: LineRef, target: LineRef, place: Place): LineEdit[] {
	const a = findArea(doc, ref);
	const b = findArea(doc, target);
	const order = doc.areas.filter((x) => x !== a);
	const at = order.indexOf(b);
	if (at === -1) return [];
	order.splice(place === 'before' ? at : at + 1, 0, a);
	const first = doc.areas[0];
	const last = doc.areas[doc.areas.length - 1];
	if (!first || !last) return [];
	// Each area's lines without its trailing blanks, and those blanks, which keep their slot.
	const parts = doc.areas.map((x) => {
		let end = x.end;
		while (end > x.line + 1 && isBlank(doc.lines[end - 1] ?? '')) end--;
		return { area: x, content: doc.lines.slice(x.line, end), gap: doc.lines.slice(end, x.end) };
	});
	const content = (x: Area): string[] => parts.find((p) => p.area === x)?.content ?? [];
	const next = parts.flatMap((p, i) => [...content(order[i] ?? p.area), ...p.gap]);
	return replaceRange(first.line, doc.lines.slice(first.line, last.end), next);
}

/** Marks a project complete (`- [x] [[Note]] [done:: today]`) or open again (`- [[Note]]`). */
export function setProjectDone(doc: Doc, ref: LineRef, done: boolean, today: string): LineEdit[] {
	const p = findProjectLink(doc, ref);
	if (p.done === done) return [];
	const marker = /^[ \t]*[-*+][ \t]+/.exec(p.text)?.[0] ?? '- ';
	return replaceLine(p.line, p.text, done ? `${marker}[x] ${p.link} [done:: ${today}]` : `${marker}${p.link}`);
}

/** Completes every open to-do in a note. Returns the edits and, for undo, each completed line and its text before. */
export function completeOpenTasks(doc: Doc, today: string): { edits: LineEdit[]; completed: Reopen[] } {
	const edits: LineEdit[] = [];
	const completed: Reopen[] = [];
	for (const t of doc.tasks) {
		if (t.done) continue;
		// Without its rule, so completing the project doesn't schedule the next one.
		const text = setRepeat(setDone(t.text, true, today), null);
		edits.push({ at: t.line, delete: 1, insert: [text] });
		completed.push({ ref: { line: t.line, text }, before: t.text });
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

/** A line `completeOpenTasks` completed, and its text before, to put back on undo. */
export interface Reopen {
	ref: LineRef;
	before: string;
}

/** Reopens the given to-dos as they were, skipping any that changed or disappeared since. */
export function reopenTasks(doc: Doc, items: Reopen[]): LineEdit[] {
	const edits: LineEdit[] = [];
	for (const { ref, before } of items) {
		let t: Task;
		try {
			t = findTask(doc, ref);
		} catch {
			continue;
		}
		if (!edits.some((e) => e.at === t.line)) edits.push(...replaceLine(t.line, t.text, before));
	}
	return edits;
}

// --- Repeating to-dos -------------------------------------------------------

/** What completing a repeating to-do wrote, so undo can put the lines back. */
export interface Repeated {
	/** The new open to-do's title line. */
	next: LineRef;
	/** Its date. */
	date: string;
	/** The lines now in the note, from the new to-do to the end of the completed one's block. */
	lines: string[];
	/** The completed to-do's block as it was. */
	before: string[];
}

/**
 * Completes a to-do with a `[repeat:: …]` rule on `done`: it is ticked and loses its rule, any
 * sub-tasks still open are ticked with it, and a fresh copy, sub-tasks open again, goes just
 * above it with the rule and the next date. A to-do already ticked (by hand, in the note) keeps
 * its own completion date. Returns null when the to-do has no rule.
 */
export function completeRepeating(doc: Doc, ref: LineRef, done: string, weekStart: 0 | 1): { edits: LineEdit[]; repeated: Repeated } | null {
	const t = findTask(doc, ref);
	const rule = t.repeat ? parseRepeat(t.repeat) : null;
	if (!rule) return null;
	const doneOn = t.done ? (t.doneDate ?? done) : done;
	const date = nextOccurrence(rule, t.date, doneOn, weekStart);
	const end = Math.max(t.end, t.subtreeEnd);
	const before = doc.lines.slice(t.line, end);
	const copy = before.map((l, i) => {
		const open = parseTaskLine(l) ? setDone(l, false, '') : l;
		return i === 0 ? setDate(open, date) : open;
	});
	const completed = before.map((l, i) => {
		if (i > 0) return parseTaskLine(l) ? setDone(l, true, doneOn) : l;
		// Ticked by hand without a completion date: give it one, so it shows in Completed.
		const open = t.done && !t.doneDate ? setDone(l, false, '') : l;
		return setRepeat(setDone(open, true, doneOn), null);
	});
	const edits: LineEdit[] = [{ at: t.line, delete: 0, insert: copy }];
	completed.forEach((l, i) => edits.push(...replaceLine(t.line + i, before[i] ?? '', l)));
	return {
		edits,
		repeated: { next: { line: t.line, text: copy[0] ?? '' }, date, lines: [...copy, ...completed], before },
	};
}

/**
 * Schedules the next one for each ticked to-do that still has its rule, which is how a to-do
 * ticked by hand in the note looks. A to-do nested in another one handled here waits for the
 * next pass.
 */
export function spawnRepeats(doc: Doc, today: string, weekStart: 0 | 1): LineEdit[] {
	const edits: LineEdit[] = [];
	let taken = -1;
	for (const t of doc.tasks) {
		if (!t.done || !t.repeat || t.line < taken) continue;
		const r = completeRepeating(doc, refOf(t), today, weekStart);
		if (!r) continue;
		edits.push(...r.edits);
		taken = Math.max(t.end, t.subtreeEnd);
	}
	return edits;
}

/** Undoes `completeRepeating`: removes the new to-do and puts the completed one back as it was. */
export function undoRepeat(doc: Doc, repeated: Repeated): LineEdit[] {
	const at = findTask(doc, repeated.next).line;
	const now = doc.lines.slice(at, at + repeated.lines.length);
	if (now.length !== repeated.lines.length || now.some((l, i) => l !== repeated.lines[i])) {
		throw new PatchConflict('The repeating to-do changed since it was completed');
	}
	return [{ at, delete: repeated.lines.length, insert: repeated.before }];
}
