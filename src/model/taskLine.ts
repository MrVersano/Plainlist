// Reading and rewriting a single to-do line, e.g.
// `  - [x] Order cable trays #errands [date:: 2026-10-04] [repeat:: every week] [done:: 2026-10-02] [col:: Done]`.
// Any indent and list marker (`-`, `*`, `+`, `1.`, `1)`) is accepted and kept.

import { parseRepeat } from '../dates/repeat';
import type { TaskDate } from './types';

const TASK_RE = /^([ \t]*)([-*+]|\d+[.)])[ \t]+\[([ xX])\](?:[ \t]+(.*))?$/;
const FIELD_RE = /\[(date|repeat|done|col)::[ \t]*([^\]]*?)[ \t]*\]/gi;
const ISO_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface FieldMatch {
	/** Span within the line, including the whitespace before the field. */
	start: number;
	end: number;
	value: string;
}

export interface TaskLine {
	done: boolean;
	indent: string;
	/** Everything before the checkbox: indent, list marker and space, e.g. `  - `. */
	prefix: string;
	title: string;
	date: FieldMatch | null;
	/** A `[repeat:: …]` field with a rule `parseRepeat` reads. */
	repeat: FieldMatch | null;
	doneField: FieldMatch | null;
	/** The board column, `[col:: Doing]`; always written last on the line. */
	col: FieldMatch | null;
}

export function isTaskLine(line: string): boolean {
	return TASK_RE.test(line);
}

export function isIsoDate(value: string): boolean {
	return ISO_RE.test(value);
}

function normaliseDate(value: string): TaskDate | null {
	if (value.toLowerCase() === 'someday') return 'someday';
	return ISO_RE.test(value) ? value : null;
}

export function parseTaskLine(line: string): TaskLine | null {
	const m = TASK_RE.exec(line);
	if (!m) return null;
	const rest = m[4] ?? '';
	const restStart = line.length - rest.length;
	const prefix = line.slice(0, line.indexOf('['));
	let date: FieldMatch | null = null;
	let repeat: FieldMatch | null = null;
	let doneField: FieldMatch | null = null;
	let col: FieldMatch | null = null;

	for (const f of rest.matchAll(FIELD_RE)) {
		const name = (f[1] ?? '').toLowerCase();
		const raw = f[2] ?? '';
		let start = restStart + (f.index ?? 0);
		while (start > restStart && /[ \t]/.test(line[start - 1] ?? '')) start--;
		const end = restStart + (f.index ?? 0) + f[0].length;
		if (name === 'date' && !date) {
			const value = normaliseDate(raw);
			if (value) date = { start, end, value };
		} else if (name === 'repeat' && !repeat) {
			if (parseRepeat(raw)) repeat = { start, end, value: raw.trim().replace(/\s+/g, ' ') };
		} else if (name === 'done' && !doneField && ISO_RE.test(raw)) {
			doneField = { start, end, value: raw };
		} else if (name === 'col' && !col && raw.trim()) {
			col = { start, end, value: raw.trim() };
		}
	}

	let title = line;
	for (const f of [date, repeat, doneField, col].filter((x): x is FieldMatch => !!x).sort((a, b) => b.start - a.start)) {
		title = title.slice(0, f.start) + title.slice(f.end);
	}
	title = title.slice(restStart).trim();

	return { done: m[3] !== ' ', indent: m[1] ?? '', prefix, title, date, repeat, doneField, col };
}

export function formatTaskLine(
	title: string,
	done: boolean,
	date: TaskDate | null,
	doneDate: string | null,
	prefix = '- ',
	repeat: string | null = null,
	col: string | null = null,
): string {
	let line = `${prefix}[${done ? 'x' : ' '}] ${title.trim()}`;
	if (date) line += ` [date:: ${date}]`;
	if (repeat) line += ` [repeat:: ${repeat}]`;
	if (done && doneDate) line += ` [done:: ${doneDate}]`;
	if (col) line += ` [col:: ${col}]`;
	return line.trimEnd();
}

/** Marks the line done or open, adding or removing the `done` field. Leaves the rest of the line as is. */
export function setDone(line: string, done: boolean, today: string): string {
	const t = parseTaskLine(line);
	if (!t || t.done === done) return line;
	const box = t.prefix.length;
	let out = line.slice(0, box + 1) + (done ? 'x' : ' ') + line.slice(box + 2);
	if (done) {
		const at = t.col ? t.col.start : out.trimEnd().length;
		if (!t.doneField) out = `${out.slice(0, at)} [done:: ${today}]${out.slice(at)}`;
	} else if (t.doneField) {
		out = out.slice(0, t.doneField.start) + out.slice(t.doneField.end);
	}
	return out;
}

/** Sets, replaces or removes the `date` field. A new field goes at the end, before any `repeat`, `done` or `col` field. */
export function setDate(line: string, date: TaskDate | null): string {
	const t = parseTaskLine(line);
	if (!t) return line;
	if (t.date) {
		const field = date ? ` [date:: ${date}]` : '';
		return line.slice(0, t.date.start) + field + line.slice(t.date.end);
	}
	if (!date) return line;
	const at = t.repeat?.start ?? t.doneField?.start ?? t.col?.start ?? line.trimEnd().length;
	return `${line.slice(0, at)} [date:: ${date}]${line.slice(at)}`;
}

/** Sets, replaces or removes the `repeat` field. A new field goes at the end, before any `done` or `col` field. */
export function setRepeat(line: string, repeat: string | null): string {
	const t = parseTaskLine(line);
	if (!t) return line;
	if (t.repeat) {
		const field = repeat ? ` [repeat:: ${repeat}]` : '';
		return line.slice(0, t.repeat.start) + field + line.slice(t.repeat.end);
	}
	if (!repeat) return line;
	const at = t.doneField?.start ?? t.col?.start ?? line.trimEnd().length;
	return `${line.slice(0, at)} [repeat:: ${repeat}]${line.slice(at)}`;
}

/** Replaces the title, keeping the line's indent, marker and fields. */
export function setTitle(line: string, title: string): string {
	const t = parseTaskLine(line);
	if (!t || t.title === title.trim()) return line;
	return formatTaskLine(title, t.done, t.date?.value ?? null, t.doneField?.value ?? null, t.prefix, t.repeat?.value ?? null, t.col?.value ?? null);
}

/** Sets, replaces or removes the `col` field (the board column). A new field goes at the very end. */
export function setCol(line: string, col: string | null): string {
	const t = parseTaskLine(line);
	if (!t) return line;
	const field = col ? ` [col:: ${col}]` : '';
	if (t.col) return t.col.value === col ? line : line.slice(0, t.col.start) + field + line.slice(t.col.end);
	return col ? `${line.trimEnd()}${field}` : line;
}
