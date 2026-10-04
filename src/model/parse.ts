// Text -> Doc. Line-based and tolerant: every line becomes a node, and anything
// not understood is an `opaque` node that patches never touch. The same rules read
// the task file and project notes; only the task file uses `# Inbox` / `# Projects`.

import { isTaskLine, parseTaskLine } from './taskLine';
import type { Doc, LineKind, ProjectLink, Section, Task } from './types';

const HEADING_RE = /^(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;
const BLANK_RE = /^\s*$/;
const PLAINLIST_RE = /^plainlist:[ \t]*true[ \t]*$/i;
const LINK_ITEM_RE =
	/^[ \t]*[-*+][ \t]+(?:\[([ xX])\][ \t]+)?(\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]|\[[^\]]*\]\(<?([^)>]+)>?\))(?:[ \t]+\[done::[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*\])?[ \t]*$/;

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

/** Width of the leading whitespace, counting a tab as four columns. */
export function indentWidth(line: string): number {
	let w = 0;
	for (const ch of line) {
		if (ch === ' ') w += 1;
		else if (ch === '\t') w += 4;
		else break;
	}
	return w;
}

export interface ParsedProjectLink {
	target: string;
	link: string;
	done: boolean;
	doneDate: string | null;
}

/** Reads a `- [[Note]]` / `- [Note](Note.md)` line, optionally `- [x] [[Note]] [done:: …]`; null if it is not one. */
export function parseProjectLink(line: string): ParsedProjectLink | null {
	const m = LINK_ITEM_RE.exec(line);
	if (!m) return null;
	let target = (m[3] ?? '').trim();
	if (!target) {
		try {
			target = decodeURI((m[4] ?? '').trim());
		} catch {
			target = (m[4] ?? '').trim();
		}
	}
	const done = !!m[1] && m[1] !== ' ';
	return { target, link: m[2] ?? '', done, doneDate: done ? (m[5] ?? null) : null };
}

/** The link target of a project link line, or null. */
export function projectLinkTarget(line: string): string | null {
	return parseProjectLink(line)?.target ?? null;
}

/** Strips the indentation the description lines share. Blank lines become empty. */
export function descriptionText(raw: string[]): string {
	const nonBlank = raw.filter((l) => !BLANK_RE.test(l));
	let common = /^[ \t]*/.exec(nonBlank[0] ?? '')?.[0] ?? '';
	for (const l of nonBlank) {
		while (common && !l.startsWith(common)) common = common.slice(0, -1);
	}
	return raw.map((l) => (BLANK_RE.test(l) ? '' : l.slice(common.length))).join('\n');
}

/**
 * End (exclusive) of the lines under `line` that satisfy `belongs`. Blank lines count
 * only when more such lines follow. Fenced code inside the block is taken whole.
 */
function blockEnd(lines: string[], line: number, belongs: (l: string) => boolean): number {
	let end = line + 1;
	let j = line + 1;
	let fence: string | null = null;
	while (j < lines.length) {
		const l = lines[j] ?? '';
		if (fence) {
			end = ++j;
			const close = FENCE_RE.exec(l)?.[1];
			if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
		} else if (BLANK_RE.test(l)) {
			let k = j;
			while (k < lines.length && BLANK_RE.test(lines[k] ?? '')) k++;
			if (k < lines.length && belongs(lines[k] ?? '')) j = k;
			else break;
		} else if (belongs(l)) {
			fence = FENCE_RE.exec(l)?.[1] ?? null;
			end = ++j;
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
	const projectLinks: ProjectLink[] = [];
	let inbox: Section | null = null;
	let projectsSection: Section | null = null;
	let ctx: 'none' | 'inbox' | 'projects' | 'other' = 'none';
	let fence: { ch: string; len: number } | null = null;

	for (let i = fmEnd; i < n; i++) {
		const line = lines[i] ?? '';

		if (fence) {
			const marker = FENCE_RE.exec(line)?.[1] ?? '';
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
			if (h.level === 1 && name === 'inbox') {
				kinds[i] = 'section';
				inbox ??= { line: i, end: n };
				ctx = 'inbox';
			} else if (h.level === 1 && name === 'projects') {
				kinds[i] = 'section';
				projectsSection ??= { line: i, end: n };
				ctx = 'projects';
			} else if (h.level === 1 || ctx === 'inbox') {
				// Any other heading ends the Inbox's own region.
				ctx = 'other';
			}
			continue;
		}

		if (ctx === 'projects') {
			const link = parseProjectLink(line);
			if (link) {
				kinds[i] = 'projectLink';
				projectLinks.push({ line: i, text: line, ...link });
				continue;
			}
		}

		const t = parseTaskLine(line);
		if (t) {
			const width = indentWidth(line);
			const end = blockEnd(lines, i, (l) => !isTaskLine(l) && indentWidth(l) >= width + 2);
			const subtreeEnd = blockEnd(lines, i, (l) => indentWidth(l) > width);
			tasks.push({
				line: i,
				text: line,
				indent: t.indent,
				done: t.done,
				title: t.title,
				date: t.date?.value ?? null,
				doneDate: t.doneField?.value ?? null,
				description: descriptionText(lines.slice(i + 1, end)),
				end,
				subtreeEnd,
				section: ctx === 'inbox' ? 'inbox' : 'other',
			});
			kinds[i] = 'task';
			for (let j = i + 1; j < end; j++) kinds[j] = 'taskDesc';
			i = end - 1;
		}
	}

	const nextHeading = (after: number, maxLevel: number): number =>
		headings.find((h) => h.line > after && h.level <= maxLevel)?.line ?? n;
	if (inbox) inbox.end = nextHeading(inbox.line, 6);
	if (projectsSection) projectsSection.end = nextHeading(projectsSection.line, 1);

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
		projectLinks,
		tasks,
	};
}
