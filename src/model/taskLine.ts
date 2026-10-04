// Reading and rewriting a single to-do title line, e.g.
// `- [x] Order cable trays #errands [date:: 2026-10-04] [done:: 2026-10-02]`.

import type { TaskDate } from './types';

const TASK_RE = /^([-*])[ \t]+\[([ xX])\](?:[ \t]+(.*))?$/;
const FIELD_RE = /\[(date|done)::[ \t]*([^\]]*?)[ \t]*\]/gi;
const ISO_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface FieldMatch {
	/** Span within the line, including the whitespace before the field. */
	start: number;
	end: number;
	value: string;
}

export interface TaskLine {
	done: boolean;
	/** Offset of the text after `- [ ] `. */
	restStart: number;
	title: string;
	date: FieldMatch | null;
	doneField: FieldMatch | null;
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
	const rest = m[3] ?? '';
	const restStart = line.length - rest.length;
	let date: FieldMatch | null = null;
	let doneField: FieldMatch | null = null;

	for (const f of rest.matchAll(FIELD_RE)) {
		const name = (f[1] ?? '').toLowerCase();
		const raw = f[2] ?? '';
		let start = restStart + (f.index ?? 0);
		while (start > restStart && /[ \t]/.test(line[start - 1] ?? '')) start--;
		const end = restStart + (f.index ?? 0) + f[0].length;
		if (name === 'date' && !date) {
			const value = normaliseDate(raw);
			if (value) date = { start, end, value };
		} else if (name === 'done' && !doneField && ISO_RE.test(raw)) {
			doneField = { start, end, value: raw };
		}
	}

	let title = line;
	for (const f of [date, doneField].filter((x): x is FieldMatch => !!x).sort((a, b) => b.start - a.start)) {
		title = title.slice(0, f.start) + title.slice(f.end);
	}
	title = title.slice(restStart).trim();

	return { done: m[2] !== ' ', restStart, title, date, doneField };
}

export function formatTaskLine(title: string, done: boolean, date: TaskDate | null, doneDate: string | null): string {
	let line = `- [${done ? 'x' : ' '}] ${title.trim()}`;
	if (date) line += ` [date:: ${date}]`;
	if (done && doneDate) line += ` [done:: ${doneDate}]`;
	return line.trimEnd();
}

/** Marks the line done or open, adding or removing the `done` field. Leaves the rest of the line as is. */
export function setDone(line: string, done: boolean, today: string): string {
	const t = parseTaskLine(line);
	if (!t || t.done === done) return line;
	const box = line.indexOf('[', 0);
	let out = line.slice(0, box + 1) + (done ? 'x' : ' ') + line.slice(box + 2);
	if (done) {
		if (!t.doneField) out = `${out.trimEnd()} [done:: ${today}]`;
	} else if (t.doneField) {
		out = out.slice(0, t.doneField.start) + out.slice(t.doneField.end);
	}
	return out;
}

/** Sets, replaces or removes the `date` field. A new field goes at the end, before any `done` field. */
export function setDate(line: string, date: TaskDate | null): string {
	const t = parseTaskLine(line);
	if (!t) return line;
	if (t.date) {
		const field = date ? ` [date:: ${date}]` : '';
		return line.slice(0, t.date.start) + field + line.slice(t.date.end);
	}
	if (!date) return line;
	const at = t.doneField ? t.doneField.start : line.trimEnd().length;
	return `${line.slice(0, at)} [date:: ${date}]${line.slice(at)}`;
}

/** Replaces the title, rewriting the line in the canonical format. */
export function setTitle(line: string, title: string): string {
	const t = parseTaskLine(line);
	if (!t || t.title === title.trim()) return line;
	return formatTaskLine(title, t.done, t.date?.value ?? null, t.doneField?.value ?? null);
}
