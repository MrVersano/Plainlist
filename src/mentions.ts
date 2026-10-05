// Finds "@Project name" mentions in capture text.

export interface Mention {
	/** Index into the project list. */
	project: number;
	/** The mention as typed, including the `@`. */
	text: string;
	index: number;
	end: number;
}

/** An `@` starts a mention at the start of the text or after whitespace or `(`. */
const startsMention = (text: string, i: number): boolean => text[i] === '@' && (i === 0 || /[\s(]/.test(text[i - 1] ?? ''));

/** A mention ends at the end of the text, whitespace or punctuation, never mid-word. */
const endsMention = (text: string, i: number): boolean => i >= text.length || /[\s.,;:!?)]/.test(text[i] ?? '');

/** The last `@name` in `text` naming one of `names` (case-insensitive, longest name wins). */
export function findMention(text: string, names: string[]): Mention | null {
	const lower = text.toLowerCase();
	const order = names.map((n, i) => ({ n: n.toLowerCase(), i })).sort((a, b) => b.n.length - a.n.length);
	for (let at = lower.lastIndexOf('@'); at >= 0; at = at > 0 ? lower.lastIndexOf('@', at - 1) : -1) {
		if (!startsMention(lower, at)) continue;
		for (const { n, i } of order) {
			const end = at + 1 + n.length;
			if (n && lower.startsWith(n, at + 1) && endsMention(lower, end)) {
				return { project: i, text: text.slice(at, end), index: at, end };
			}
		}
	}
	return null;
}

/** The `@query` being typed just before the caret, if any. The query may contain spaces. */
export function mentionQuery(text: string, caret: number): { index: number; query: string } | null {
	const before = text.slice(0, caret);
	const at = before.lastIndexOf('@');
	if (at < 0 || !startsMention(before, at)) return null;
	const query = before.slice(at + 1);
	return query.includes('\n') ? null : { index: at, query };
}

/** Removes the given ranges from `text`, collapsing the space they leave. */
export function stripRanges(text: string, ranges: { index: number; end: number }[]): string {
	let out = '';
	let at = 0;
	for (const r of [...ranges].sort((a, b) => a.index - b.index)) {
		if (r.index < at) continue;
		out += text.slice(at, r.index);
		at = r.end;
	}
	return (out + text.slice(at)).replace(/[ \t]{2,}/g, ' ').trim();
}
