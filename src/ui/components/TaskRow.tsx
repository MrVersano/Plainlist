import { useEffect, useRef, useState } from 'preact/hooks';
import { addDays, longDate } from '../../dates/format';
import { placeLabel, type Item, type ProjectInfo } from '../../model/lists';
import { mentionTargets, stripRanges, targetName } from '../../mentions';
import { findTask, setTaskDate, setTaskDescription, setTaskTitle } from '../../model/patch';
import { recogniseEdit } from '../../recognise';
import type { TrackBox } from '../../store';
import { useDebounced, useEnv, useLongPress, useOutsideClick } from '../env';
import { noteLinks } from '../obsidian';
import { Checkbox, MarkdownField, Title } from './bits';
import { DatePopover, ProjectPicker } from './popovers';
import { highlighted, type Mark, useSuggest } from './suggest';

export interface RowActions {
	onToggle: (item: Item) => void;
	onExpand: (item: Item) => void;
	onMenu: (item: Item, pos: { x: number; y: number }) => void;
}

export function TaskRow({
	item,
	meta,
	metaClass,
	selected,
	actions,
}: {
	item: Item;
	meta: string;
	metaClass?: string;
	selected: boolean;
	actions: RowActions;
}) {
	const { task } = item;
	const el = useRef<HTMLDivElement>(null);
	const longPress = useLongPress((pos) => actions.onMenu(item, pos));
	useEffect(() => {
		if (selected) el.current?.scrollIntoView({ block: 'nearest' });
	}, [selected]);

	return (
		<div
			ref={el}
			class={`pl-row${task.done ? ' is-done' : ''}${selected ? ' is-selected' : ''}`}
			onContextMenu={(evt) => {
				evt.preventDefault();
				actions.onMenu(item, { x: evt.clientX, y: evt.clientY });
			}}
			{...longPress}
		>
			<Checkbox done={task.done} title={task.title} onToggle={() => actions.onToggle(item)} />
			<button type="button" class="pl-row-title" onClick={() => actions.onExpand(item)}>
				{task.title ? <Title text={task.title} sourcePath={item.path} /> : <span class="pl-untitled">New to-do</span>}
			</button>
			{meta && <span class={`pl-row-meta ${metaClass ?? ''}`}>{meta}</span>}
		</div>
	);
}

function dateLabel(date: string | null, today: string): string {
	if (!date) return '';
	if (date === today) return 'Today';
	if (date === addDays(today, 1)) return 'Tomorrow';
	return longDate(date, today);
}

export function TaskEditor({
	item,
	box,
	projects,
	today,
	onCollapse,
	onToggle,
}: {
	item: Item;
	box: TrackBox;
	projects: ProjectInfo[];
	today: string;
	onCollapse: () => void;
	onToggle: () => void;
}) {
	const { app, workspace, weekStart } = useEnv();
	const { task } = item;
	const [title, setTitle] = useState(task.title);
	const [description, setDescription] = useState(task.description);
	const [popover, setPopover] = useState<'date' | 'project' | null>(null);
	const wrap = useRef<HTMLDivElement>(null);
	const titleInput = useRef<HTMLInputElement>(null);
	const backdrop = useRef<HTMLDivElement>(null);
	/** The title as the editor opened: dates and @projects already in it are plain text. */
	const original = useRef(task.title);
	const latest = useRef({ title, description });
	latest.current = { title, description };
	const open = projects.filter((p) => p.exists);
	const choices = open.map((p) => ({ name: p.name, path: p.path, headings: workspace.doc(p.path)?.headings }));
	const targets = mentionTargets(choices);
	const names = targets.map((t) => t.label);
	const links = noteLinks(app, item.path);

	const onTitle = (value: string): void => {
		setTitle(value);
		save.schedule();
	};
	const suggest = useSuggest({ input: titleInput, value: title, onChange: onTitle, projects: targets, links });
	const recognised = (text: string) => recogniseEdit(text, original.current, names, today, weekStart());
	const { match, mention } = recognised(title);

	const save = useDebounced(() => {
		const { title: newTitle, description: newDesc } = latest.current;
		void workspace.run(
			box.current.path,
			(doc) => {
				const t = findTask(doc, box.current.ref);
				return [
					...(newTitle.trim() !== t.title ? setTaskTitle(doc, box.current.ref, newTitle) : []),
					...(newDesc !== t.description ? setTaskDescription(doc, box.current.ref, newDesc) : []),
				];
			},
			box,
		);
	}, 400);

	/** Saves what's pending, then applies a date or @project typed into the title, as capture does. */
	const finish = useRef(() => {});
	finish.current = () => {
		save.flush();
		const typed = latest.current.title;
		const found = recognised(typed);
		const rest = stripRanges(typed, [found.match, found.mention].filter((r) => r !== null));
		if (!rest || rest === typed.trim()) return;
		void workspace.run(box.current.path, (doc) => setTaskTitle(doc, box.current.ref, rest), box);
		const date = found.match?.date;
		if (date) void workspace.run(box.current.path, (doc) => setTaskDate(doc, box.current.ref, date), box);
		const target = found.mention && targets[found.mention.project];
		if (target) void workspace.moveTask(box, target.path, target.heading && { line: target.heading.line, text: target.heading.text });
	};

	// Collapsing unmounts the editor: save whatever is still pending.
	useEffect(() => () => finish.current(), []);
	useEffect(() => titleInput.current?.focus(), []);
	useOutsideClick(wrap, onCollapse, popover === null);
	const syncScroll = (): void => {
		if (backdrop.current && titleInput.current) backdrop.current.scrollLeft = titleInput.current.scrollLeft;
	};
	useEffect(syncScroll, [title]);

	/** Removes a typed date or @project from the title, so a choice made in a popover wins. */
	const drop = (r: { index: number; end: number } | null): void => {
		if (r) onTitle(stripRanges(title, [r]));
	};

	const pick = (fn: () => void): void => {
		save.flush();
		setPopover(null);
		fn();
		// The popover took focus with it; keep Esc and Enter working in the editor.
		titleInput.current?.focus();
	};

	const marks: Mark[] = [];
	if (match) marks.push({ start: match.index, end: match.end, cls: 'pl-capture-date' });
	if (mention) marks.push({ start: mention.index, end: mention.end, cls: 'pl-capture-mention' });
	const dateText = match ? dateLabel(match.date, today) : dateLabel(task.date, today);
	const mentioned = mention ? targets[mention.project] : undefined;
	const projectName = mentioned ? targetName(mentioned) : placeLabel(item) || undefined;

	return (
		<div
			ref={wrap}
			class="pl-row is-expanded"
			onKeyDown={(e) => {
				if (e.key === 'Escape' && !popover) {
					e.preventDefault();
					e.stopPropagation();
					onCollapse();
				}
			}}
		>
			<div class="pl-row-line">
				<Checkbox
					done={task.done}
					title={task.title}
					onToggle={() => {
						save.flush();
						onToggle();
					}}
				/>
				<div class="pl-editor-title-field">
					<div ref={backdrop} class="pl-editor-title-backdrop" aria-hidden="true">
						{highlighted(title, marks)}
						{'\u200b'}
					</div>
					<input
						ref={titleInput}
						class="pl-editor-title"
						type="text"
						aria-label="Title"
						placeholder="New to-do"
						spellcheck={false}
						role="combobox"
						aria-expanded={suggest.open}
						aria-autocomplete="list"
						value={title}
						onInput={(e) => {
							onTitle(e.currentTarget.value);
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
							if (suggest.onKeyDown(e)) return;
							if (e.key === 'Enter' && !e.isComposing) {
								e.preventDefault();
								onCollapse();
							}
						}}
					/>
					{suggest.list}
				</div>
			</div>
			<div class="pl-editor-body">
				<MarkdownField
					class="pl-editor-desc"
					value={description}
					sourcePath={item.path}
					links={links}
					placeholder="Description — #tags and [[links]] work here too"
					onInput={(value) => {
						setDescription(value);
						save.schedule();
					}}
					onBlur={() => save.flush()}
				/>
				<div class="pl-editor-fields">
					<div class="pl-field">
						<span class="pl-field-label">Date{match && <span class="pl-field-note"> · from “{match.text}”</span>}</span>
						<button
							type="button"
							class={`pl-field-button${dateText ? '' : ' is-empty'}`}
							aria-haspopup="dialog"
							aria-expanded={popover === 'date'}
							onClick={() => setPopover(popover === 'date' ? null : 'date')}
						>
							{dateText || 'No date'}
						</button>
						{popover === 'date' && (
							<DatePopover
								today={today}
								weekStart={weekStart()}
								onClose={() => setPopover(null)}
								onPick={(date) =>
									pick(() => {
										drop(match);
										void workspace.run(box.current.path, (doc) => setTaskDate(doc, box.current.ref, date), box);
									})
								}
							/>
						)}
					</div>
					<div class="pl-field pl-field-wide">
						<span class="pl-field-label">
							Project{mention && <span class="pl-field-note"> · from “{mention.text}”</span>}
						</span>
						<button
							type="button"
							class="pl-field-button"
							aria-haspopup="listbox"
							aria-expanded={popover === 'project'}
							onClick={() => setPopover(popover === 'project' ? null : 'project')}
						>
							{projectName ?? 'Inbox'}
						</button>
						{popover === 'project' && (
							<ProjectPicker
								projects={choices}
								current={item.project?.path ?? null}
								currentHeading={item.task.heading?.line ?? null}
								onClose={() => setPopover(null)}
								onPick={(path, heading) =>
									pick(() => {
										drop(mention);
										void workspace.moveTask(box, path, heading);
									})
								}
							/>
						)}
					</div>
					<button type="button" class="pl-done-button" onClick={onCollapse}>
						Done
					</button>
				</div>
			</div>
		</div>
	);
}
