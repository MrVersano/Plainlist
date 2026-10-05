// Inline suggestions while typing: `@` lists projects and their headings, `[[` lists notes. Shared by the
// capture palette, the to-do title and the description. Also draws the highlighted text
// behind a transparent input.

import type { JSX, RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { findLinks, linkQuery } from '../../links';
import { type MentionTarget, mentionQuery, targetName } from '../../mentions';

/** Notes for a `[[query`, best first. `link` is the text that goes between the brackets. */
export type LinkSource = (query: string) => { key: string; label: string; detail?: string; link: string }[];

interface Suggestion {
	key: string;
	label: string;
	detail?: string;
	insert: string;
	cls?: string;
}

/**
 * Projects and headings for an `@query`, each project followed by its matching headings.
 * Projects with a match starting with the query come first, then those containing it.
 */
function targetSuggestions(targets: MentionTarget[], query: string): Suggestion[] {
	const q = query.toLowerCase();
	const slash = q.indexOf('/');
	const rank = (t: MentionTarget): number => {
		const label = t.label.toLowerCase();
		if (label.startsWith(q)) return 0;
		if (label.includes(q)) return 1;
		// `@reno/furn`: part of the project name, then part of the heading.
		if (slash < 0 || !t.heading) return 2;
		const project = t.projectName.toLowerCase();
		const p = q.slice(0, slash);
		return project.includes(p) && t.heading.name.toLowerCase().includes(q.slice(slash + 1)) ? (project.startsWith(p) ? 0 : 1) : 2;
	};
	const groups = new Map<string, MentionTarget[]>();
	for (const t of targets) if (rank(t) < 2) groups.set(t.path, [...(groups.get(t.path) ?? []), t]);
	const ordered = [...groups.values()].sort((a, b) => Math.min(...a.map(rank)) - Math.min(...b.map(rank))).flat();
	// A name typed out in full needs no list; Enter should save.
	if (ordered.length === 1 && ordered[0]?.label.toLowerCase() === q) return [];
	return ordered.map((t) => {
		// Under its project's row a heading shows on its own; without it, it says which project.
		const underProject = !!t.heading && ordered.some((x) => x.path === t.path && !x.heading);
		return {
			key: t.heading ? `${t.path}#${t.heading.line}` : t.path,
			label: underProject ? (t.heading?.name ?? '') : targetName(t),
			insert: `@${t.label} `,
			cls: underProject ? 'is-heading' : undefined,
		};
	});
}

/**
 * Suggestions for the controlled `input`. Call `onInput` from the field's input handler and
 * `sync` when the caret may have moved; `onKeyDown` returns true when it handled the key.
 */
export function useSuggest({
	input,
	value,
	onChange,
	projects,
	links,
	enabled = true,
}: {
	input: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
	value: string;
	onChange: (value: string) => void;
	/** Offer `@project` and `@project/heading` suggestions from these. */
	projects?: MentionTarget[];
	/** Offer `[[note` suggestions from this. */
	links?: LinkSource;
	enabled?: boolean;
}) {
	const [caret, setCaret] = useState(0);
	/** Where the trigger of a dismissed list sits, so Esc keeps it closed. */
	const [dismissed, setDismissed] = useState<number | null>(null);
	const [active, setActive] = useState(0);
	const pendingCaret = useRef<number | null>(null);
	const listEl = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = input.current;
		if (pendingCaret.current !== null && el) {
			el.setSelectionRange(pendingCaret.current, pendingCaret.current);
			setCaret(pendingCaret.current);
			pendingCaret.current = null;
		}
	}, [value]);

	const link = links ? linkQuery(value, caret) : null;
	const mention = link || !projects ? null : mentionQuery(value, caret);
	const trigger = link ?? mention;
	let options: Suggestion[] = [];
	if (enabled && trigger && trigger.index !== dismissed) {
		options =
			link && links
				? links(link.query).map((n) => ({ key: n.key, label: n.label, detail: n.detail, insert: `[[${n.link}]]` }))
				: targetSuggestions(projects ?? [], mention?.query ?? '');
	}
	const index = Math.min(active, Math.max(options.length - 1, 0));

	useEffect(() => {
		listEl.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
	}, [index, options.length]);

	/** Sets the value and puts the caret at `at` once it renders. */
	const replace = (next: string, at: number): void => {
		pendingCaret.current = at;
		onChange(next);
	};

	const sync = (): void => {
		const el = input.current;
		if (el) setCaret(el.selectionStart ?? el.value.length);
	};

	const accept = (s: Suggestion): void => {
		if (!trigger) return;
		const current = input.current?.value ?? value;
		const before = current.slice(0, trigger.index) + s.insert;
		const rest = current.slice(caret);
		// Drop a closing `]]` already typed, or the space after a mention.
		replace(before + (link ? rest.replace(/^\]\]/, '') : rest.replace(/^ +/, '')), before.length);
		setActive(0);
	};

	/** Closes an open list. Returns false when none was open. */
	const close = (): boolean => {
		if (!options.length || !trigger) return false;
		setDismissed(trigger.index);
		return true;
	};

	const onKeyDown = (e: KeyboardEvent): boolean => {
		if (e.isComposing || !options.length) return false;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const step = e.key === 'ArrowDown' ? 1 : -1;
			setActive((index + step + options.length) % options.length);
			return true;
		}
		if (e.key === 'Enter' || e.key === 'Tab') {
			e.preventDefault();
			e.stopPropagation();
			const s = options[index];
			if (s) accept(s);
			return true;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
			return true;
		}
		return false;
	};

	const list =
		options.length > 0 ? (
			<div class="pl-popover pl-suggest-popover">
				<div ref={listEl} class="pl-project-options" role="listbox" aria-label={link ? 'Notes' : 'Projects'}>
					{options.map((s, i) => (
						<button
							type="button"
							role="option"
							aria-selected={i === index}
							key={s.key}
							class={`pl-project-option${s.cls ? ` ${s.cls}` : ''}${i === index ? ' is-active' : ''}`}
							// Keep focus (and the caret) in the field.
							onMouseDown={(e) => e.preventDefault()}
							onMouseEnter={() => setActive(i)}
							onClick={() => accept(s)}
						>
							<span class="pl-suggest-label">{s.label}</span>
							{s.detail && <span class="pl-suggest-detail">{s.detail}</span>}
						</button>
					))}
				</div>
			</div>
		) : null;

	return {
		open: options.length > 0,
		list,
		replace,
		close,
		sync,
		onKeyDown,
		onInput: (): void => {
			setActive(0);
			sync();
		},
		onBlur: (): void => setDismissed(trigger?.index ?? null),
		/** Clears a dismissal, e.g. after the field is emptied for the next to-do. */
		reset: (): void => setDismissed(null),
	};
}

const TAG_RE = /(^|[\s(])(#[^\s#.,;:!?()[\]{}"'`]+)/gu;

export interface Mark {
	start: number;
	end: number;
	cls: string;
}

/** The typed text with `found` ranges, `[[links]]` and `#tags` marked, drawn behind a transparent input. */
export function highlighted(text: string, found: Mark[]): JSX.Element[] {
	const marks = [...found];
	for (const l of findLinks(text)) marks.push({ start: l.index, end: l.end, cls: 'pl-link' });
	for (const m of text.matchAll(TAG_RE)) {
		const start = (m.index ?? 0) + (m[1] ?? '').length;
		const tag = m[2] ?? '';
		if (!/^#\d+$/.test(tag)) marks.push({ start, end: start + tag.length, cls: 'pl-tag' });
	}
	marks.sort((a, b) => a.start - b.start);
	const out: JSX.Element[] = [];
	let at = 0;
	for (const m of marks) {
		if (m.start < at) continue;
		out.push(<span key={`t${at}`}>{text.slice(at, m.start)}</span>);
		out.push(
			<span key={`m${m.start}`} class={m.cls}>
				{text.slice(m.start, m.end)}
			</span>,
		);
		at = m.end;
	}
	out.push(<span key={`t${at}`}>{text.slice(at)}</span>);
	return out;
}
