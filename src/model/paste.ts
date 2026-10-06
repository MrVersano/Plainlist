// Reads a pasted list, e.g. `- [ ] Call Sam` lines, `- []` lines, plain `- ` bullets or
// bare `[ ]` checkboxes, as new to-dos.

import { indentWidth } from './parse';
import { parseTaskLine } from './taskLine';
import type { NewTask } from './patch';

/** An optional list marker, then an optional checkbox (`[ ]`, `[]`, `[x]`), then the title. */
const ITEM_RE = /^[ \t]*(?:(?:[-*+•]|\d+[.)])[ \t]+)?(\[[ xX]?\][ \t]*)?(.*)$/;
const MARKER_RE = /^[ \t]*(?:[-*+•]|\d+[.)])[ \t]/;

/**
 * The to-dos in pasted text, or null unless every non-blank line is a list item or a
 * checkbox. Indented items become sub-tasks of the item above; `[date:: …]` fields are kept.
 */
export function pastedTasks(text: string): NewTask[] | null {
	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	if (!lines.length) return null;
	const out: NewTask[] = [];
	/** Indent widths of the items the next one may be nested under, outermost first. */
	const widths: number[] = [];
	for (const line of lines) {
		const m = ITEM_RE.exec(line);
		if (!m || (!m[1] && !MARKER_RE.test(line))) return null;
		const rest = (m[2] ?? '').trim();
		if (!rest) continue;
		const parsed = parseTaskLine(`- [ ] ${rest}`);
		const title = parsed?.title ?? rest;
		if (!title) continue;
		const width = indentWidth(line);
		while (widths.length && (widths[widths.length - 1] ?? 0) >= width) widths.pop();
		// No deeper than one step below the item before it.
		const depth = Math.min(widths.length, (out[out.length - 1]?.depth ?? -1) + 1);
		widths.length = depth;
		widths.push(width);
		out.push({ title, date: parsed?.date?.value ?? null, depth });
	}
	return out.length ? out : null;
}
