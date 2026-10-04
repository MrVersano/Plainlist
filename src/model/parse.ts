// Text -> Doc. Line-based and tolerant: every line becomes a node, and anything
// not understood is an `opaque` node that patches never touch.

import { parseTaskLine } from './taskLine';
import type { Doc, LineKind, Project, Section, Task } from './types';

const HEADING_RE = /^(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED_RE = /^(\t| {2,})/;
const BLANK_RE = /^\s*$/;
const PLAINLIST_RE = /^plainlist:[ \t]*true[ \t]*$/i;

export function splitLines(text: string): { lines: string[]; eols: string[] } {
	const lines: string[] = [];
	const eols: string[] = [];
	const re = /\r?\n/g;
	let start = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		lines.push(text.slice(start, m.index));
		eols.push(m[0]);
		start = m.index + m[0].length;
	}
	if (start < text.length) {
		lines.push(text.slice(start));
		eols.push('');
	}
	return { lines, eols };
}

export function headingOf(line: string): { level: number; name: string } | null {
	const m = HEADING_RE.exec(line);
	if (!m) return null;
	const name = (m[2] ?? '').replace(/[ \t]+#+$/, '').trim();
	return { level: (m[1] ?? '').length, name };
}

export function isBlank(line: string): boolean {
	return BLANK_RE.test(line);
}

function isDescLine(line: string): boolean {
	return INDENTED_RE.test(line) && !BLANK_RE.test(line);
}

/** Strips one level of indentation (a tab, or the block's common space indent). */
export function descriptionText(raw: string[]): string {
	const spaceIndents = raw
		.filter((l) => !BLANK_RE.test(l) && l.startsWith(' '))
		.map((l) => (/^ */.exec(l)?.[0].length ?? 0));
	const spaces = spaceIndents.length ? Math.min(...spaceIndents) : 0;
	return raw
		.map((l) => {
			if (BLANK_RE.test(l)) return '';
			if (l.startsWith('\t')) return l.slice(1);
			return l.slice(Math.min(spaces, /^ */.exec(l)?.[0].length ?? 0));
		})
		.join('\n');
}

/** End (exclusive) of the description lines under the task title at `line`. */
function descriptionEnd(lines: string[], line: number): number {
	let end = line + 1;
	let j = line + 1;
	while (j < lines.length) {
		const l = lines[j] ?? '';
		if (isDescLine(l)) {
			end = ++j;
		} else if (BLANK_RE.test(l)) {
			// Blank lines belong to the description only when more description follows.
			let k = j;
			while (k < lines.length && BLANK_RE.test(lines[k] ?? '')) k++;
			if (k < lines.length && isDescLine(lines[k] ?? '')) j = k;
			else break;
		} else {
			break;
		}
	}
	return end;
}

function frontmatterEnd(lines: string[]): number {
	if ((lines[0] ?? '').trimEnd() !== '---') return 0;
	for (let i = 1; i < lines.length; i++) {
		const l = (lines[i] ?? '').trimEnd();
		if (l === '---' || l === '...') return i + 1;
	}
	return 0;
}

export function parse(text: string): Doc {
	const { lines, eols } = splitLines(text);
	const crlf = eols.filter((e) => e === '\r\n').length;
	const lf = eols.filter((e) => e === '\n').length;
	const n = lines.length;

	const fmEnd = frontmatterEnd(lines);
	const kinds: LineKind[] = lines.map((_, i) => (i < fmEnd ? 'frontmatter' : 'opaque'));
	const isPlainlist = lines.slice(1, Math.max(fmEnd - 1, 1)).some((l) => PLAINLIST_RE.test(l));

	const headings: { line: number; level: number }[] = [];
	const tasks: Task[] = [];
	const projects: Project[] = [];
	let inbox: Section | null = null;
	let projectsSection: Section | null = null;
	let ctx: 'none' | 'inbox' | 'projects' | 'project' | 'other' = 'none';
	let project: Project | null = null;
	let fence: { ch: string; len: number } | null = null;

	for (let i = fmEnd; i < n; i++) {
		const line = lines[i] ?? '';

		if (fence) {
			const close = FENCE_RE.exec(line);
			const marker = close?.[1] ?? '';
			if (marker[0] === fence.ch && marker.length >= fence.len && BLANK_RE.test(line.slice(line.indexOf(marker) + marker.length))) {
				fence = null;
			}
			continue;
		}
		const open = FENCE_RE.exec(line);
		if (open?.[1]) {
			fence = { ch: open[1][0] ?? '`', len: open[1].length };
			continue;
		}

		const h = headingOf(line);
		if (h) {
			headings.push({ line: i, level: h.level });
			const name = h.name.toLowerCase();
			if (h.level === 1) {
				project = null;
				if (name === 'inbox') {
					kinds[i] = 'section';
					inbox ??= { line: i, end: n };
					ctx = 'inbox';
				} else if (name === 'projects') {
					kinds[i] = 'section';
					projectsSection ??= { line: i, end: n };
					ctx = 'projects';
				} else {
					ctx = 'other';
				}
			} else if (h.level === 2 && (ctx === 'projects' || ctx === 'project')) {
				kinds[i] = 'project';
				project = { name: h.name, line: i, text: line, description: '', descStart: i + 1, descEnd: i + 1, end: n, tasks: [] };
				projects.push(project);
				ctx = 'project';
			} else if (ctx === 'inbox') {
				// Any other heading ends the Inbox's own region.
				ctx = 'other';
			}
			continue;
		}

		const t = parseTaskLine(line);
		if (t) {
			const end = descriptionEnd(lines, i);
			const section = ctx === 'inbox' ? 'inbox' : ctx === 'project' ? 'project' : 'other';
			const task: Task = {
				line: i,
				text: line,
				done: t.done,
				title: t.title,
				date: t.date?.value ?? null,
				doneDate: t.doneField?.value ?? null,
				description: descriptionText(lines.slice(i + 1, end)),
				end,
				section,
				project: section === 'project' && project ? project.name : null,
			};
			kinds[i] = 'task';
			for (let j = i + 1; j < end; j++) kinds[j] = 'taskDesc';
			tasks.push(task);
			if (section === 'project') project?.tasks.push(task);
			i = end - 1;
		}
	}

	const nextHeading = (after: number, maxLevel: number): number =>
		headings.find((h) => h.line > after && h.level <= maxLevel)?.line ?? n;

	if (inbox) inbox.end = nextHeading(inbox.line, 6);
	if (projectsSection) projectsSection.end = nextHeading(projectsSection.line, 1);

	for (const p of projects) {
		p.end = nextHeading(p.line, 2);
		// Description: lines before the first to-do or sub-heading, blank lines trimmed.
		let stop = Math.min(p.tasks[0]?.line ?? p.end, nextHeading(p.line, 6));
		let start = p.line + 1;
		while (start < stop && BLANK_RE.test(lines[start] ?? '')) start++;
		while (stop > start && BLANK_RE.test(lines[stop - 1] ?? '')) stop--;
		if (start === stop) start = stop = p.line + 1;
		p.descStart = start;
		p.descEnd = stop;
		p.description = lines.slice(start, stop).join('\n');
		for (let j = start; j < stop; j++) kinds[j] = 'projectDesc';
	}

	return {
		lines,
		eols,
		eol: crlf > lf ? '\r\n' : '\n',
		trailingNewline: text === '' || eols[n - 1] !== '',
		nodes: lines.map((text, i) => ({ kind: kinds[i] ?? 'opaque', text })),
		frontmatterEnd: fmEnd,
		isPlainlist,
		inbox,
		projectsSection,
		projects,
		tasks,
	};
}
