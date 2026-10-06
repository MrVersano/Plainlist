// Reads a pasted list, e.g. `- [ ] Call Sam` lines, `- []` lines, plain `- ` bullets or
// bare `[ ]` checkboxes, as new to-dos.

import { parseTaskLine } from './taskLine';
import type { NewTask } from './patch';

/** An optional list marker, then an optional checkbox (`[ ]`, `[]`, `[x]`), then the title. */
const ITEM_RE = /^[ \t]*(?:(?:[-*+•]|\d+[.)])[ \t]+)?(\[[ xX]?\][ \t]*)?(.*)$/;
const MARKER_RE = /^[ \t]*(?:[-*+•]|\d+[.)])[ \t]/;

/**
 * The to-dos in pasted text, or null unless every non-blank line is a list item or a
 * checkbox. Indented items become to-dos of their own; `[date:: …]` fields are kept.
 */
export function pastedTasks(text: string): NewTask[] | null {
	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	if (!lines.length) return null;
	const out: NewTask[] = [];
	for (const line of lines) {
		const m = ITEM_RE.exec(line);
		if (!m || (!m[1] && !MARKER_RE.test(line))) return null;
		const rest = (m[2] ?? '').trim();
		if (!rest) continue;
		const parsed = parseTaskLine(`- [ ] ${rest}`);
		const title = parsed?.title ?? rest;
		if (title) out.push({ title, date: parsed?.date?.value ?? null });
	}
	return out.length ? out : null;
}
