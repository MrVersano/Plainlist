import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { longDate } from '../../dates/format';
import { findDate, stripDate } from '../../dates/parse';
import { ProjectPicker } from './popovers';

export interface CaptureResult {
	title: string;
	date: string | null;
	/** Project note path, or null for the Inbox. */
	project: string | null;
}

const TAG_RE = /(^|[\s(])(#[^\s#.,;:!?()[\]{}"'`]+)/gu;

/** The typed text with the date phrase and #tags marked, drawn behind the transparent input. */
function highlighted(text: string, date: { index: number; end: number } | null): JSX.Element[] {
	const marks: { start: number; end: number; cls: string }[] = [];
	if (date) marks.push({ start: date.index, end: date.end, cls: 'pl-capture-date' });
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

export function Capture({
	today,
	weekStart,
	projects,
	initialProject,
	defaultDate,
	onSave,
	onClose,
}: {
	today: string;
	weekStart: 0 | 1;
	projects: { name: string; path: string }[];
	initialProject: string | null;
	defaultDate: string | null;
	onSave: (result: CaptureResult) => Promise<boolean>;
	onClose: () => void;
}) {
	const [text, setText] = useState('');
	const [project, setProject] = useState(initialProject);
	const [picking, setPicking] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const backdrop = useRef<HTMLDivElement>(null);
	const busy = useRef(false);

	useEffect(() => input.current?.focus(), []);
	const syncScroll = (): void => {
		if (backdrop.current && input.current) backdrop.current.scrollLeft = input.current.scrollLeft;
	};
	useEffect(syncScroll, [text]);

	const match = findDate(text, today, weekStart);
	const date = match?.date ?? defaultDate;

	const save = async (keepOpen: boolean): Promise<void> => {
		// Read the input itself: a fast Enter can arrive before the last keystroke re-renders.
		const typed = input.current?.value ?? text;
		const found = findDate(typed, today, weekStart);
		const title = found ? stripDate(typed, found) : typed.trim().replace(/[ \t]{2,}/g, ' ');
		const date = found?.date ?? defaultDate;
		if (!title || busy.current) return;
		busy.current = true;
		const ok = await onSave({ title, date, project });
		busy.current = false;
		if (!ok) return;
		if (keepOpen) {
			setText('');
			input.current?.focus();
		} else {
			onClose();
		}
	};

	return (
		<div class="pl-capture">
			<div class="pl-capture-field">
				<div ref={backdrop} class="pl-capture-backdrop" aria-hidden="true">
					{highlighted(text, match)}
					{'​'}
				</div>
				<input
					ref={input}
					class="pl-capture-input"
					type="text"
					aria-label="New to-do"
					placeholder="New to-do"
					spellcheck={false}
					value={text}
					onInput={(e) => setText(e.currentTarget.value)}
					onScroll={syncScroll}
					onKeyUp={syncScroll}
					onKeyDown={(e) => {
						if (e.isComposing) return;
						if (e.key === 'Enter') {
							e.preventDefault();
							void save(e.shiftKey);
						} else if (e.key === 'Tab' && !e.shiftKey) {
							e.preventDefault();
							setPicking(true);
						}
					}}
				/>
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
						class={`pl-capture-value pl-capture-project-button${project === initialProject ? ' is-muted' : ''}`}
						onClick={() => setPicking(true)}
					>
						{projects.find((p) => p.path === project)?.name ?? 'Inbox'}
					</button>
					<span class="pl-capture-note">Tab to choose</span>
					{picking && (
						<ProjectPicker
							projects={projects}
							current={project}
							onPick={(p) => {
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
				<span class="pl-capture-try">Try: today, tonight, fri, in 3 days, oct 20, someday</span>
				<span class="pl-capture-keys">
					<kbd>↵</kbd> save
					<kbd>esc</kbd> cancel
				</span>
			</div>
		</div>
	);
}
