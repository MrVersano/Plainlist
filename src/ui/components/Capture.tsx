import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { longDate } from '../../dates/format';
import { findDate } from '../../dates/parse';
import { findMention, type Mention, mentionQuery, stripRanges } from '../../mentions';
import { ProjectPicker } from './popovers';

export interface CaptureResult {
	title: string;
	date: string | null;
	/** Project note path, or null for the Inbox. */
	project: string | null;
}

const TAG_RE = /(^|[\s(])(#[^\s#.,;:!?()[\]{}"'`]+)/gu;

interface Mark {
	start: number;
	end: number;
	cls: string;
}

/** The typed text with the date phrase, @project and #tags marked, drawn behind the transparent input. */
function highlighted(text: string, found: Mark[]): JSX.Element[] {
	const marks = [...found];
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

/** The date and @project found in `text`. The mention is blanked out before looking for a date. */
function recognise(text: string, names: string[], today: string, weekStart: 0 | 1) {
	const mention = findMention(text, names);
	const masked = mention ? text.slice(0, mention.index) + ' '.repeat(mention.end - mention.index) + text.slice(mention.end) : text;
	const match = findDate(masked, today, weekStart);
	return { mention, match: match && { ...match, text: text.slice(match.index, match.end) } };
}

/** Projects for an `@query`: names starting with it first, then names containing it. */
function suggestions(projects: { name: string; path: string }[], query: string) {
	const q = query.toLowerCase();
	const starts = projects.filter((p) => p.name.toLowerCase().startsWith(q));
	const contains = projects.filter((p) => !p.name.toLowerCase().startsWith(q) && p.name.toLowerCase().includes(q));
	const all = [...starts, ...contains];
	// A name typed out in full needs no list; Enter should save.
	return all.length === 1 && all[0]?.name.toLowerCase() === q ? [] : all;
}

export function Capture({
	today,
	weekStart,
	projects,
	initialProject,
	defaultDate,
	closeList,
	onSave,
	onClose,
}: {
	today: string;
	weekStart: 0 | 1;
	projects: { name: string; path: string }[];
	initialProject: string | null;
	defaultDate: string | null;
	/** Filled in here so the modal's Escape handler can close an open list first. */
	closeList: { current: (() => boolean) | null };
	onSave: (result: CaptureResult) => Promise<boolean>;
	onClose: () => void;
}) {
	const [text, setText] = useState('');
	const [caret, setCaret] = useState(0);
	const [project, setProject] = useState(initialProject);
	const [picking, setPicking] = useState(false);
	/** Where the `@` of a dismissed suggestion list sits, so Esc keeps it closed. */
	const [dismissed, setDismissed] = useState<number | null>(null);
	const [active, setActive] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	const backdrop = useRef<HTMLDivElement>(null);
	const pendingCaret = useRef<number | null>(null);
	const busy = useRef(false);
	const names = projects.map((p) => p.name);

	useEffect(() => input.current?.focus(), []);
	const syncScroll = (): void => {
		if (backdrop.current && input.current) backdrop.current.scrollLeft = input.current.scrollLeft;
	};
	const syncCaret = (): void => {
		if (input.current) setCaret(input.current.selectionStart ?? input.current.value.length);
	};
	useEffect(() => {
		if (pendingCaret.current !== null && input.current) {
			input.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
			setCaret(pendingCaret.current);
			pendingCaret.current = null;
		}
		syncScroll();
	}, [text]);

	const { mention, match } = recognise(text, names, today, weekStart);
	const date = match?.date ?? defaultDate;
	const chosen = mention ? (projects[mention.project]?.path ?? null) : project;

	const typing = mentionQuery(text, caret);
	const options = !picking && typing && typing.index !== dismissed ? suggestions(projects, typing.query) : [];
	const index = Math.min(active, Math.max(options.length - 1, 0));

	closeList.current = () => {
		if (picking) {
			setPicking(false);
			input.current?.focus();
		} else if (options.length) {
			setDismissed(typing?.index ?? null);
		} else {
			return false;
		}
		return true;
	};

	const replace = (next: string, at: number): void => {
		pendingCaret.current = at;
		setText(next);
	};

	const accept = (name: string): void => {
		if (!typing) return;
		const value = input.current?.value ?? text;
		const before = `${value.slice(0, typing.index)}@${name} `;
		replace(before + value.slice(caret).replace(/^ +/, ''), before.length);
		setActive(0);
	};

	/** Removes a typed @project so the picker's choice is the one that counts. */
	const dropMention = (m: Mention | null): void => {
		if (!m) return;
		const value = input.current?.value ?? text;
		const rest = stripRanges(value, [m]);
		replace(rest && `${rest} `, rest.length + 1);
	};

	const save = async (keepOpen: boolean): Promise<void> => {
		// Read the input itself: a fast Enter can arrive before the last keystroke re-renders.
		const typed = input.current?.value ?? text;
		const found = recognise(typed, names, today, weekStart);
		const title = stripRanges(typed, [found.match, found.mention].filter((r) => r !== null));
		const date = found.match?.date ?? defaultDate;
		const target = found.mention ? (projects[found.mention.project]?.path ?? null) : project;
		if (!title || busy.current) return;
		busy.current = true;
		const ok = await onSave({ title, date, project: target });
		busy.current = false;
		if (!ok) return;
		if (keepOpen) {
			setText('');
			setCaret(0);
			setDismissed(null);
			input.current?.focus();
		} else {
			onClose();
		}
	};

	const marks: Mark[] = [];
	if (match) marks.push({ start: match.index, end: match.end, cls: 'pl-capture-date' });
	if (mention) marks.push({ start: mention.index, end: mention.end, cls: 'pl-capture-mention' });

	return (
		<div class="pl-capture">
			<div class="pl-capture-field">
				<div ref={backdrop} class="pl-capture-backdrop" aria-hidden="true">
					{highlighted(text, marks)}
					{'​'}
				</div>
				<input
					ref={input}
					class="pl-capture-input"
					type="text"
					// No aria-label: Obsidian would show it as a tooltip. The placeholder names the field.
					placeholder="New to-do"
					spellcheck={false}
					role="combobox"
					aria-expanded={options.length > 0}
					aria-autocomplete="list"
					value={text}
					onInput={(e) => {
						setText(e.currentTarget.value);
						setActive(0);
						syncCaret();
					}}
					onScroll={syncScroll}
					onKeyUp={() => {
						syncScroll();
						syncCaret();
					}}
					onClick={syncCaret}
					onBlur={() => setDismissed(typing?.index ?? null)}
					onKeyDown={(e) => {
						if (e.isComposing) return;
						if (options.length) {
							if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
								e.preventDefault();
								const step = e.key === 'ArrowDown' ? 1 : -1;
								setActive((index + step + options.length) % options.length);
								return;
							}
							if (e.key === 'Enter' || e.key === 'Tab') {
								e.preventDefault();
								const p = options[index];
								if (p) accept(p.name);
								return;
							}
						}
						if (e.key === 'Enter') {
							e.preventDefault();
							void save(e.shiftKey);
						} else if (e.key === 'Tab' && !e.shiftKey) {
							e.preventDefault();
							setPicking(true);
						}
					}}
				/>
				{options.length > 0 && (
					<div class="pl-popover pl-mention-popover">
						<div class="pl-project-options" role="listbox" aria-label="Projects">
							{options.map((p, i) => (
								<button
									type="button"
									role="option"
									aria-selected={i === index}
									key={p.path}
									class={`pl-project-option${i === index ? ' is-active' : ''}`}
									// Keep focus (and the caret) in the input.
									onMouseDown={(e) => e.preventDefault()}
									onMouseEnter={() => setActive(i)}
									onClick={() => accept(p.name)}
								>
									{p.name}
								</button>
							))}
						</div>
					</div>
				)}
			</div>
			<div class="pl-capture-rows">
				<div class="pl-capture-row">
					<span class="pl-capture-label">Date</span>
					{date ? (
						<>
							<span class="pl-capture-value">{longDate(date, today)}</span>
							{match && <span class="pl-capture-note">from “{match.text}”</span>}
						</>
					) : (
						<span class="pl-capture-value is-muted">No date</span>
					)}
				</div>
				<div class="pl-capture-row pl-capture-project">
					<span class="pl-capture-label">Project</span>
					<button
						type="button"
						class={`pl-capture-value pl-capture-project-button${!mention && chosen === initialProject ? ' is-muted' : ''}`}
						onClick={() => setPicking(true)}
					>
						{projects.find((p) => p.path === chosen)?.name ?? 'Inbox'}
					</button>
					<span class="pl-capture-note">{mention ? `from “${mention.text}”` : 'Tab or @ to choose'}</span>
					{picking && (
						<ProjectPicker
							projects={projects}
							current={chosen}
							onPick={(p) => {
								dropMention(mention);
								setProject(p);
								setPicking(false);
								input.current?.focus();
							}}
							onClose={() => {
								setPicking(false);
								input.current?.focus();
							}}
						/>
					)}
				</div>
			</div>
			<div class="pl-capture-footer">
				<span class="pl-capture-try">Try: today, tonight, fri, in 3 days, oct 20, someday, @project</span>
				<span class="pl-capture-keys">
					<kbd>↵</kbd> save
					<kbd>esc</kbd> cancel
				</span>
			</div>
		</div>
	);
}
