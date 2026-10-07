// Finds `[[wikilinks]]` in to-do text, and the `[[query` being typed.

export interface Link {
	/** The link target as written, e.g. `Note#Heading`. */
	target: string;
	/** What the link shows: its alias, or else the target. */
	label: string;
	index: number;
	end: number;
}

const LINK_RE = /\[\[([^[\]|\n]+)(?:\|([^[\]\n]*))?\]\]/g;

/** Every `[[target]]` and `[[target|alias]]` in `text`. */
export function findLinks(text: string): Link[] {
	return [...text.matchAll(LINK_RE)].map((m) => {
		const target = (m[1] ?? '').trim();
		const index = m.index ?? 0;
		return { target, label: m[2]?.trim() || target, index, end: index + m[0].length };
	});
}

/** `text` as it reads with each link shown by its label, the way Obsidian renders it. */
export function linkLabels(text: string): string {
	let out = '';
	let last = 0;
	for (const l of findLinks(text)) {
		out += text.slice(last, l.index) + l.label;
		last = l.end;
	}
	return out + text.slice(last);
}

/**
 * The `[[query` being typed just before the caret, if any. Once a heading, block or
 * alias part starts (`#`, `^`, `|`) the note is chosen, so there is nothing to suggest.
 */
export function linkQuery(text: string, caret: number): { index: number; query: string } | null {
	const before = text.slice(0, caret);
	const at = before.lastIndexOf('[[');
	if (at < 0) return null;
	const query = before.slice(at + 2);
	return /[[\]|#^\n]/.test(query) ? null : { index: at, query };
}
