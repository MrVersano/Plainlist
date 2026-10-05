import { useEffect, useRef, useState } from 'preact/hooks';
import { longDate } from '../../dates/format';
import { type Mention, stripRanges } from '../../mentions';
import { recognise } from '../../recognise';
import { ProjectPicker } from './popovers';
import { highlighted, type LinkSource, type Mark, useSuggest } from './suggest';

export interface CaptureResult {
	title: string;
	date: string | null;
	/** Project note path, or null for the Inbox. */
	project: string | null;
}

export function Capture({
	today,
	weekStart,
	projects,
	initialProject,
	defaultDate,
	links,
	closeList,
	onSave,
	onClose,
}: {
	today: string;
	weekStart: 0 | 1;
	projects: { name: string; path: string }[];
	initialProject: string | null;
	defaultDate: string | null;
	/** Notes to suggest after `[[`. */
	links?: LinkSource;
	/** Filled in here so the modal's Escape handler can close an open list first. */
	closeList: { current: (() => boolean) | null };
	onSave: (result: CaptureResult) => Promise<boolean>;
	onClose: () => void;
}) {
	const [text, setText] = useState('');
	const [project, setProject] = useState(initialProject);
	const [picking, setPicking] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const backdrop = useRef<HTMLDivElement>(null);
	const busy = useRef(false);
	const names = projects.map((p) => p.name);
	const suggest = useSuggest({ input, value: text, onChange: setText, projects, links, enabled: !picking });

	useEffect(() => input.current?.focus(), []);
	const syncScroll = (): void => {
		if (backdrop.current && input.current) backdrop.current.scrollLeft = input.current.scrollLeft;
	};
	useEffect(syncScroll, [text]);

	const { mention, match } = recognise(text, names, today, weekStart);
	const date = match?.date ?? defaultDate;
	const chosen = mention ? (projects[mention.project]?.path ?? null) : project;

	closeList.current = () => {
		if (picking) {
			setPicking(false);
			input.current?.focus();
			return true;
		}
		return suggest.close();
	};

	/** Removes a typed @project so the picker's choice is the one that counts. */
	const dropMention = (m: Mention | null): void => {
		if (!m) return;
		const value = input.current?.value ?? text;
		const rest = stripRanges(value, [m]);
		suggest.replace(rest && `${rest} `, rest.length + 1);
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
			suggest.replace('', 0);
			suggest.reset();
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
					aria-expanded={suggest.open}
					aria-autocomplete="list"
					value={text}
					onInput={(e) => {
						setText(e.currentTarget.value);
						suggest.onInput();
					}}
					onScroll={syncScroll}
					onKeyUp={() => {
						syncScroll();
						suggest.sync();
					}}
					onClick={suggest.sync}
					onBlur={suggest.onBlur}
					onKeyDown={(e) => {
						// Escape goes through the modal's handler (closeList).
						if (e.key !== 'Escape' && suggest.onKeyDown(e)) return;
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
				{suggest.list}
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
