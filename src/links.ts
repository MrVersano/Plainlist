// Finds `[[wikilinks]]` and `[label](url)` links in to-do text, and the `[[query` being typed.
// Also turns a bare URL into a Markdown link once its page title is known.

export interface Link {
	/** The link target as written, e.g. `Note#Heading` or `https://example.com`. */
	target: string;
	/** What the link shows: its alias or label, or else the target. */
	label: string;
	index: number;
	end: number;
	/** A web link, `[label](https://…)`, as opposed to a link to a note. */
	external: boolean;
}

const LINK_RE = /\[\[([^[\]|\n]+)(?:\|([^[\]\n]*))?\]\]/g;
// `[label](url)` or `[label](<url with spaces>)`; the label may hold escaped brackets, the url one level of parentheses.
const MD_LINK_RE = /\[((?:\\.|[^[\]\\\n])+)\]\((?:<([^<>\n]+)>|([^\s()<>]+(?:\([^\s()]*\)[^\s()<>]*)*))\)/g;
const SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;

function decoded(target: string): string {
	try {
		return decodeURI(target);
	} catch {
		return target;
	}
}

/** Every `[[target]]`, `[[target|alias]]` and `[label](url)` in `text`, in order. */
export function findLinks(text: string): Link[] {
	const wiki: Link[] = [...text.matchAll(LINK_RE)].map((m) => {
		const target = (m[1] ?? '').trim();
		const index = m.index ?? 0;
		return { target, label: m[2]?.trim() || target, index, end: index + m[0].length, external: false };
	});
	const markdown: Link[] = [...text.matchAll(MD_LINK_RE)].flatMap((m) => {
		const index = m.index ?? 0;
		const end = index + m[0].length;
		if (wiki.some((w) => index < w.end && w.index < end)) return [];
		const url = (m[2] ?? m[3] ?? '').trim();
		const external = SCHEME_RE.test(url);
		const label = (m[1] ?? '').replace(/\\(.)/g, '$1').trim();
		// A Markdown link without a scheme points at a note, e.g. `[Plan](Plan.md)` or `[Plan](My%20Plan.md)`.
		return [{ target: external ? url : decoded(url), label: label || url, index, end, external }];
	});
	return [...wiki, ...markdown].sort((a, b) => a.index - b.index);
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

/** The URL, when a to-do's title is a web address and nothing else. */
export function bareUrl(title: string): string | null {
	const t = title.trim();
	return /^https?:\/\/[^\s<>]+$/i.test(t) ? t : null;
}

/** `[label](url)`, escaping what would end the label early and wrapping a url with parentheses in `<…>`. */
export function markdownLink(label: string, url: string): string {
	const text = label.replace(/\s+/g, ' ').trim().replace(/[\\[\]]/g, '\\$&');
	return `[${text}](${/[()\s]/.test(url) ? `<${url}>` : url})`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', bull: '•' };

function decodeEntities(text: string): string {
	return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
		if (name[0] === '#') {
			const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[name.toLowerCase()] ?? whole;
	});
}

function attributes(tag: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
		out.set((m[1] ?? '').toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
	}
	return out;
}

/** A page's title from its HTML: its `og:title`, else its `<title>`. Null when it has neither. */
export function pageTitle(html: string): string | null {
	const head = html.slice(0, 200_000);
	let og: string | null = null;
	for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
		const attrs = attributes(m[0]);
		const name = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
		if (name === 'og:title' && attrs.get('content')?.trim()) {
			og = attrs.get('content') ?? null;
			break;
		}
	}
	const raw = og ?? /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '';
	const title = decodeEntities(raw).replace(/\s+/g, ' ').trim();
	return title || null;
}
