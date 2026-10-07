// Tag lists for the "Project tags" setting.

/** Splits "#project, work area" into ["project", "work", "area"]: no `#`, lower case, no repeats. */
export function parseTagList(text: string): string[] {
	const tags = text
		.split(/[\s,]+/)
		.map((t) => t.replace(/^#+/, '').toLowerCase())
		.filter((t) => t.length > 0);
	return [...new Set(tags)];
}

/**
 * Whether any of a note's tags (as Obsidian reports them, with or without `#`) is one of `wanted`
 * or nested under one: `#project/client` counts for `project`. Case is ignored, as Obsidian does.
 */
export function hasAnyTag(noteTags: readonly string[], wanted: readonly string[]): boolean {
	if (!wanted.length) return false;
	return noteTags.some((raw) => {
		const tag = raw.replace(/^#+/, '').toLowerCase();
		return wanted.some((w) => tag === w || tag.startsWith(`${w}/`));
	});
}

/** The tag being typed at the end of the setting: the text after the last comma or space, without `#`. */
export function tagQuery(text: string): string {
	return (/[^\s,]*$/.exec(text)?.[0] ?? '').replace(/^#+/, '');
}

/** Replaces the tag being typed with `#tag`, ready for the next one. */
export function completeTag(text: string, tag: string): string {
	return `${text.replace(/[^\s,]*$/, '')}#${tag.replace(/^#+/, '')}, `;
}

/**
 * Tags from `counts` (tag → number of notes) matching `query`, minus the ones already listed:
 * tags starting with the query first, then ones containing it, each by most used.
 */
export function suggestTags(counts: ReadonlyMap<string, number>, query: string, listed: readonly string[]): string[] {
	const q = query.toLowerCase();
	const rank = (tag: string): number => (tag.toLowerCase().startsWith(q) ? 0 : 1);
	return [...counts.keys()]
		.filter((t) => !listed.includes(t.toLowerCase()) && t.toLowerCase().includes(q))
		.sort((a, b) => rank(a) - rank(b) || (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
}
