// Applies line edits to a parsed Doc. Untouched lines keep their exact text and
// line ending; inserted lines use the file's dominant line ending.

import { parse } from './parse';
import type { Doc, LineEdit } from './types';

export function applyEdits(doc: Doc, edits: LineEdit[]): string {
	const n = doc.lines.length;
	const inserts = new Map<number, string[]>();
	const deleted = new Array<boolean>(n).fill(false);

	for (const e of edits) {
		if (e.at < 0 || e.delete < 0 || e.at + e.delete > n) {
			throw new RangeError(`Edit out of range: ${e.at}+${e.delete} in ${n} lines`);
		}
		for (let i = e.at; i < e.at + e.delete; i++) {
			if (deleted[i]) throw new RangeError(`Overlapping edits at line ${i}`);
			deleted[i] = true;
		}
		if (e.insert.length) inserts.set(e.at, [...(inserts.get(e.at) ?? []), ...e.insert]);
	}

	const out: { text: string; eol: string }[] = [];
	for (let i = 0; i <= n; i++) {
		for (const text of inserts.get(i) ?? []) out.push({ text, eol: doc.eol });
		if (i < n && !deleted[i]) out.push({ text: doc.lines[i] ?? '', eol: doc.eols[i] ?? '' });
	}

	const last = out.length - 1;
	return out
		.map((l, i) => {
			if (i < last) return l.text + (l.eol || doc.eol);
			return l.text + (doc.trailingNewline ? l.eol || doc.eol : '');
		})
		.join('');
}

/** Parses `text`, computes edits against it, and returns the patched text. For use inside `vault.process`. */
export function patchText(text: string, makeEdits: (doc: Doc) => LineEdit[]): string {
	const doc = parse(text);
	return applyEdits(doc, makeEdits(doc));
}
