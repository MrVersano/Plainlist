// The Board view's model: column definitions (kept in plugin data), which column each to-do
// is in (its `[col:: …]` field), and the edits that move cards. Pure, no Obsidian imports.
//
// Only top-level to-dos are cards. A sub-task travels with its parent, so its own field is ignored.

import { addDays } from '../dates/format';
import type { Item } from './lists';
import { blockEnd, findTask, insertTaskLines, reindent, repeatBlock, type LineRef, type Place, type Relocation } from './patch';
import { setCol, setDone } from './taskLine';
import type { Doc, Heading, LineEdit, Task } from './types';

export interface ColumnDef {
	name: string;
	/** Moving a to-do here checks it. */
	checkOnEnter?: boolean;
	/** With `checkOnEnter`: moving a to-do out, to a column without it, unchecks it. */
	uncheckOnLeave?: boolean;
	/** Checking a to-do anywhere moves it here. One column per project at most. */
	receivesChecked?: boolean;
}

export type BoardMode = 'list' | 'board';
export type GroupBy = 'status' | 'heading';

/** A project's board, once it has been switched to Board. */
export interface BoardProject {
	view: BoardMode;
	groupBy: GroupBy;
	/** Its own columns; the default columns until it has some. */
	columns?: ColumnDef[];
}

export interface BoardSettings {
	autoCreateColumns: boolean;
	/** How many days completed to-dos stay in their column before "Show older". */
	doneDays: number;
	defaultColumns: ColumnDef[];
	/** By project note path. */
	projects: Record<string, BoardProject>;
}

export const DEFAULT_COLUMNS: ColumnDef[] = [
	{ name: 'To do' },
	{ name: 'Doing' },
	{ name: 'Done', checkOnEnter: true, uncheckOnLeave: true, receivesChecked: true },
];

export function defaultBoard(): BoardSettings {
	return { autoCreateColumns: true, doneDays: 7, defaultColumns: DEFAULT_COLUMNS.map((c) => ({ ...c })), projects: {} };
}

function cleanColumns(raw: unknown): ColumnDef[] | null {
	if (!Array.isArray(raw)) return null;
	const out: ColumnDef[] = [];
	for (const c of raw as unknown[]) {
		const v = c as Partial<ColumnDef> | null;
		const name = typeof v?.name === 'string' ? cleanColumnName(v.name) : '';
		if (!name || out.some((x) => sameName(x.name, name))) continue;
		const def: ColumnDef = { name };
		if (v?.checkOnEnter === true) def.checkOnEnter = true;
		if (v?.checkOnEnter === true && v.uncheckOnLeave === true) def.uncheckOnLeave = true;
		if (v?.receivesChecked === true && !out.some((x) => x.receivesChecked)) def.receivesChecked = true;
		out.push(def);
	}
	return out.length ? out : null;
}

/** Board settings from saved data, with defaults for anything missing or malformed. */
export function normaliseBoard(raw: unknown): BoardSettings {
	const board = defaultBoard();
	if (!raw || typeof raw !== 'object') return board;
	const v = raw as Partial<Record<keyof BoardSettings, unknown>>;
	if (typeof v.autoCreateColumns === 'boolean') board.autoCreateColumns = v.autoCreateColumns;
	if (typeof v.doneDays === 'number' && Number.isFinite(v.doneDays) && v.doneDays >= 0) board.doneDays = Math.floor(v.doneDays);
	board.defaultColumns = cleanColumns(v.defaultColumns) ?? board.defaultColumns;
	if (v.projects && typeof v.projects === 'object') {
		for (const [path, p] of Object.entries(v.projects as Record<string, unknown>)) {
			const e = p as Partial<Record<keyof BoardProject, unknown>> | null;
			if (!e || typeof e !== 'object') continue;
			const entry: BoardProject = {
				view: e.view === 'board' ? 'board' : 'list',
				groupBy: e.groupBy === 'heading' ? 'heading' : 'status',
			};
			const columns = cleanColumns(e.columns);
			if (columns) entry.columns = columns;
			board.projects[path] = entry;
		}
	}
	return board;
}

/** Column names match without regard to case or surrounding spaces. */
export function sameName(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A name that fits in `[col:: …]`: one line, no square brackets. */
export function cleanColumnName(name: string): string {
	return name.replace(/[[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Why `name` can't name a column (other than `except`), or null. */
export function columnNameError(columns: ColumnDef[], name: string, except = -1): string | null {
	const clean = cleanColumnName(name);
	if (!clean) return 'Enter a column name.';
	if (columns.some((c, i) => i !== except && sameName(c.name, clean))) return `There is already a column called “${clean}”.`;
	return null;
}

export function columnIndex(columns: ColumnDef[], name: string): number {
	return columns.findIndex((c) => sameName(c.name, name));
}

/** Where a to-do without a field goes: the first column, or for a checked one, the column that receives checked to-dos. */
function homeColumn(columns: ColumnDef[], done: boolean): number {
	if (!done) return 0;
	const at = columns.findIndex((c) => c.receivesChecked);
	return at === -1 ? 0 : at;
}

/** The column a to-do shows in, and the name in its field when no column has it. */
export function columnOf(columns: ColumnDef[], t: { col: string | null; done: boolean }): { index: number; unknown: string | null } {
	if (t.col) {
		const at = columnIndex(columns, t.col);
		return at === -1 ? { index: 0, unknown: t.col } : { index: at, unknown: null };
	}
	return { index: homeColumn(columns, t.done), unknown: null };
}

/**
 * The field that puts a to-do in column `index`: none for the first column (unless a checked
 * one would then go to the checked column), the column's name otherwise.
 */
export function fieldFor(columns: ColumnDef[], index: number, done: boolean): string | null {
	if (index === 0 && homeColumn(columns, done) === 0) return null;
	return columns[index]?.name ?? null;
}

/** A card's column and checkbox after moving from column `from` to `to`, by the auto-check rules. */
export function enterColumn(columns: ColumnDef[], from: number, to: number, done: boolean): { field: string | null; done: boolean } {
	const src = columns[from];
	const dst = columns[to];
	let next = done;
	if (dst?.checkOnEnter) next = true;
	else if (src?.checkOnEnter && src.uncheckOnLeave) next = false;
	return { field: fieldFor(columns, to, next), done: next };
}

/** Field values on cards that name no column, in the order they first appear. */
export function unknownColumns(doc: Doc, columns: ColumnDef[]): string[] {
	const out: string[] = [];
	for (const t of doc.tasks) {
		if (t.parent !== null || !t.col || columnIndex(columns, t.col) !== -1) continue;
		const name = cleanColumnName(t.col);
		if (name && !out.some((n) => sameName(n, name))) out.push(name);
	}
	return out;
}

/** Adds columns just before the first one that checks to-dos, or at the end. */
export function withNewColumns(columns: ColumnDef[], names: string[]): ColumnDef[] {
	const fresh = names.filter((n) => columnIndex(columns, n) === -1).map((name) => ({ name }));
	if (!fresh.length) return columns;
	const at = columns.findIndex((c) => c.checkOnEnter);
	const out = [...columns];
	out.splice(at === -1 ? out.length : at, 0, ...fresh);
	return out;
}

/** Turns `on` a flag that only one column may have, turning it off on the others. */
export function setColumnFlag(columns: ColumnDef[], index: number, flag: keyof Omit<ColumnDef, 'name'>, on: boolean): ColumnDef[] {
	return columns.map((c, i) => {
		const next = { ...c };
		if (i === index) {
			if (on) next[flag] = true;
			else delete next[flag];
			if (flag === 'checkOnEnter' && !on) delete next.uncheckOnLeave;
		} else if (flag === 'receivesChecked' && on) {
			delete next.receivesChecked;
		}
		return next;
	});
}

export function moveColumn<T>(columns: T[], from: number, to: number): T[] {
	if (from === to || !columns[from] || to < 0 || to >= columns.length) return columns;
	const out = [...columns];
	const [c] = out.splice(from, 1);
	if (c !== undefined) out.splice(to, 0, c);
	return out;
}

// --- Edits --------------------------------------------------------------------

/** Sets or removes one to-do's field. */
export function setTaskColumn(doc: Doc, ref: LineRef, field: string | null): LineEdit[] {
	const t = findTask(doc, ref);
	const text = setCol(t.text, field);
	return text === t.text ? [] : [{ at: t.line, delete: 1, insert: [text] }];
}

/** Rewrites every field naming column `from` to `to`, or removes them when `to` is null. */
export function renameColumn(doc: Doc, from: string, to: string | null): LineEdit[] {
	const edits: LineEdit[] = [];
	for (const t of doc.tasks) {
		if (!t.col || !sameName(t.col, from)) continue;
		const text = setCol(t.text, to);
		if (text !== t.text) edits.push({ at: t.line, delete: 1, insert: [text] });
	}
	return edits;
}

/** Where a moved card goes: next to another card, to the end of a heading's to-dos (null: above all headings), or nowhere. */
export type CardPlace = { target: LineRef; place: Place } | { heading: LineRef | null } | null;

export interface CardMove {
	/** The new `col` field; leave it out to keep the field as it is. */
	field?: string | null;
	/** Checks or unchecks it; a repeating to-do checked here gets its next one, which stays where it was. */
	done?: boolean;
	to: CardPlace;
	today: string;
	weekStart: 0 | 1;
}

/**
 * Moves a card (its to-do and everything nested under it) in one set of edits: changes its field
 * and checkbox, and puts its lines next to another card or under a heading.
 */
export function moveCard(doc: Doc, ref: LineRef, move: CardMove): Relocation {
	const t = findTask(doc, ref);
	const end = blockEnd(t);
	const n = end - t.line;
	const before = doc.lines.slice(t.line, end);
	let lines = [...before];
	let left: string[] = [];
	if (move.done !== undefined && move.done !== t.done) {
		const r = move.done ? repeatBlock(t, before, move.today, move.weekStart) : null;
		if (r) {
			left = r.copy;
			lines = r.completed;
		} else {
			lines[0] = setDone(lines[0] ?? '', move.done, move.today);
		}
	}
	if (move.field !== undefined) lines[0] = setCol(lines[0] ?? '', move.field);

	// Where the lines go: `at` in the original note, re-indented to `indent`.
	let at: number | null = null;
	let indent = t.indent;
	const to = move.to;
	if (to && 'target' in to) {
		const p = findTask(doc, to.target);
		const spot = to.place === 'before' ? p.line : blockEnd(p);
		if (p.line !== t.line && p.parent === t.parent && (spot < t.line || spot > end)) {
			at = spot;
			indent = p.indent;
		}
	} else if (to && (to.heading?.line ?? null) !== (t.heading?.line ?? null)) {
		const ins = insertTaskLines(doc, reindent(lines, t.indent, ''), to.heading ? { heading: to.heading } : 'note');
		const moved = ins.edit.insert;
		const landedAt = ins.edit.at <= t.line ? ins.edit.at + ins.offset : ins.edit.at - n + left.length + ins.offset;
		return {
			edits: [{ at: t.line, delete: n, insert: left }, ins.edit],
			landed: { line: landedAt, text: moved[ins.offset] ?? '' },
		};
	}

	if (at === null) {
		const next = [...left, ...lines];
		const edits = next.length === n && left.length === 0 ? lines.flatMap((l, i) => (l === before[i] ? [] : [{ at: t.line + i, delete: 1, insert: [l] }])) : [{ at: t.line, delete: n, insert: next }];
		return { edits, landed: { line: t.line + left.length, text: lines[0] ?? '' } };
	}
	const moved = reindent(lines, t.indent, indent);
	if (at < t.line) {
		return {
			edits: [
				{ at, delete: 0, insert: moved },
				{ at: t.line, delete: n, insert: left },
			],
			landed: { line: at, text: moved[0] ?? '' },
		};
	}
	return {
		edits: [
			{ at: t.line, delete: n, insert: left },
			{ at, delete: 0, insert: moved },
		],
		landed: { line: at - n + left.length, text: moved[0] ?? '' },
	};
}

/** Identifies a to-do across checking it: its indent and title. */
const titleKey = (t: Task): string => `${t.indent}\u0000${t.title}`;

function tally(tasks: Task[]): Map<string, { open: number; done: number }> {
	const out = new Map<string, { open: number; done: number }>();
	for (const t of tasks) {
		const c = out.get(titleKey(t)) ?? { open: 0, done: 0 };
		if (t.done) c.done++;
		else c.open++;
		out.set(titleKey(t), c);
	}
	return out;
}

/**
 * The auto-check rules that follow from checking or unchecking to-dos, anywhere: comparing the
 * note `before` with `after`, a card checked outside a column that checks moves to the column
 * that receives checked to-dos, and a card unchecked in a column that checks moves to the first
 * column. A card checked by hand gets today's completion date, so it shows among the recent ones.
 * Edits are against `after`, one line each.
 */
export function reconcileColumns(before: Doc, after: Doc, columns: ColumnDef[], today = ''): LineEdit[] {
	const top = (d: Doc): Task[] => d.tasks.filter((t) => t.parent === null);
	const was = tally(top(before));
	const now = tally(top(after));
	// Lines that were there already, exactly as they are, didn't just change.
	const unchanged = new Map<string, number>();
	for (const t of top(before)) unchanged.set(t.text, (unchanged.get(t.text) ?? 0) + 1);
	const fresh = (t: Task): boolean => {
		const left = unchanged.get(t.text) ?? 0;
		if (left > 0) unchanged.set(t.text, left - 1);
		return left === 0;
	};
	const receives = columns.findIndex((c) => c.receivesChecked);
	const edits: LineEdit[] = [];
	const checkedLeft = new Map<string, number>();
	const uncheckedLeft = new Map<string, number>();
	for (const [key, c] of now) {
		const b = was.get(key) ?? { open: 0, done: 0 };
		checkedLeft.set(key, Math.min(c.done - b.done, b.open));
		uncheckedLeft.set(key, Math.min(c.open - b.open, b.done));
	}
	for (const t of top(after)) {
		if (!fresh(t)) continue;
		const key = titleKey(t);
		const { index } = columnOf(columns, t);
		const checks = !!columns[index]?.checkOnEnter;
		if (t.done && receives !== -1 && !checks && (checkedLeft.get(key) ?? 0) > 0) {
			checkedLeft.set(key, (checkedLeft.get(key) ?? 0) - 1);
			const dated = !t.doneDate && today ? setDone(setDone(t.text, false, today), true, today) : t.text;
			const text = setCol(dated, fieldFor(columns, receives, true));
			if (text !== t.text) edits.push({ at: t.line, delete: 1, insert: [text] });
		} else if (!t.done && checks && (uncheckedLeft.get(key) ?? 0) > 0) {
			uncheckedLeft.set(key, (uncheckedLeft.get(key) ?? 0) - 1);
			const text = setCol(t.text, fieldFor(columns, 0, false));
			if (text !== t.text) edits.push({ at: t.line, delete: 1, insert: [text] });
		} else if (t.done && !t.doneDate && today && (checkedLeft.get(key) ?? 0) > 0) {
			checkedLeft.set(key, (checkedLeft.get(key) ?? 0) - 1);
			const text = setDone(setDone(t.text, false, today), true, today);
			if (text !== t.text) edits.push({ at: t.line, delete: 1, insert: [text] });
		}
	}
	return edits;
}

// --- The board, as shown ---------------------------------------------------------

export interface BoardColumn {
	key: string;
	name: string;
	/** Status board: the column's definition and its place in the project's columns. */
	def?: ColumnDef;
	index: number;
	/** Heading board: the heading, or null for to-dos above the first one. */
	heading?: Heading | null;
	/** Cards shown, in note order. */
	cards: Item[];
	/** Completed cards older than the window, behind "Show N older". */
	older: Item[];
	/** Open cards. */
	open: number;
}

/** Whether a completed to-do was completed in the last `days` days, today included. */
function isRecent(t: Task, today: string, days: number): boolean {
	return !!t.doneDate && t.doneDate >= addDays(today, 1 - days);
}

function fill(column: BoardColumn, items: Item[], today: string, days: number): BoardColumn {
	for (const i of items) {
		if (i.task.done && !isRecent(i.task, today, days)) column.older.push(i);
		else column.cards.push(i);
		if (!i.task.done) column.open++;
	}
	return column;
}

/** Cards are a note's top-level to-dos, in note order. */
const cardsOf = (items: Item[]): Item[] => items.filter((i) => i.task.parent === null).sort((a, b) => a.task.line - b.task.line);

/** A board with a column per status, from the `col` fields. `unknown` collects fields naming no column. */
export function statusBoard(items: Item[], columns: ColumnDef[], today: string, days: number): BoardColumn[] {
	const cards = cardsOf(items);
	return columns.map((def, index) =>
		fill(
			{ key: `col:${def.name.toLowerCase()}`, name: def.name, def, index, cards: [], older: [], open: 0 },
			cards.filter((i) => columnOf(columns, i.task).index === index),
			today,
			days,
		),
	);
}

/** A board with a column per heading in the note, after one for to-dos above the first heading when there are any. */
export function headingBoard(items: Item[], doc: Doc, today: string, days: number): BoardColumn[] {
	const cards = cardsOf(items);
	const out: BoardColumn[] = [];
	const loose = cards.filter((i) => !i.task.heading);
	if (loose.length || !doc.headings.length) {
		out.push(fill({ key: 'heading:none', name: 'No section', heading: null, index: 0, cards: [], older: [], open: 0 }, loose, today, days));
	}
	for (const h of doc.headings) {
		const own = cards.filter((i) => i.task.heading?.line === h.line);
		out.push(fill({ key: `heading:${h.line}:${h.text}`, name: h.name, heading: h, index: out.length, cards: [], older: [], open: 0 }, own, today, days));
	}
	return out;
}
