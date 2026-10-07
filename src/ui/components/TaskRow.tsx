import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { addDays, longDate } from '../../dates/format';
import { placeLabel, type Item, type ProjectInfo } from '../../model/lists';
import { mentionTargets, stripRanges, targetName } from '../../mentions';
import { findTask, setTaskDate, setTaskDescription, setTaskRepeat, setTaskTitle } from '../../model/patch';
import { phraseBefore, recogniseEdit, stillKept } from '../../recognise';
import type { TrackBox } from '../../store';
import { useDebounced, useEnv, useOutsideClick } from '../env';
import { noteLinks } from '../obsidian';
import { AutoTextarea, Checkbox, MarkdownField, RepeatIcon, Title } from './bits';
import { DatePopover, ProjectPicker, RepeatPopover } from './popovers';
import { highlighted, type Mark, useSuggest } from './suggest';

export interface RowActions {
	onToggle: (item: Item) => void;
	onExpand: (item: Item) => void;
	/** A click on the row outside its checkbox, title and links. */
	onSelect?: (item: Item) => void;
	/** Cmd/Ctrl-click (`toggle`) or Shift-click (`range`) anywhere on the row, to select several to-dos. */
	onMark?: (item: Item, how: 'toggle' | 'range') => void;
}

export function TaskRow({
	item,
	meta,
	metaClass,
	selected,
	marked = false,
	tapSelects = false,
	reveal = false,
	leaving = false,
	drag,
	actions,
}: {
	item: Item;
	meta: string;
	metaClass?: string;
	selected: boolean;
	/** One of the to-dos selected for a bulk action. */
	marked?: boolean;
	/** A selection is under way on a touch screen: a tap outside the checkbox selects or deselects. */
	tapSelects?: boolean;
	/** Found with "Search to-dos": scroll it to the middle of the view. */
	reveal?: boolean;
	/** Just completed and fading out of a list that hides completed to-dos. */
	leaving?: boolean;
	/** Drag-to-reorder handlers (they also open the menu), and the row's drag state class. */
	drag: { props: Record<string, unknown>; cls: string };
	actions: RowActions;
}) {
	const { task } = item;
	const el = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (selected) el.current?.scrollIntoView({ block: 'nearest' });
	}, [selected]);
	useEffect(() => {
		if (reveal) el.current?.scrollIntoView({ block: 'center' });
	}, [reveal]);
	// A wrapped title makes the row taller: fade out from its real height.
	useLayoutEffect(() => {
		const row = el.current;
		if (leaving && row) row.setCssProps({ '--pl-leave-height': `${row.offsetHeight + 1}px` });
	}, [leaving]);
	useDepth(el, item.depth);

	return (
		<div
			ref={el}
			class={`pl-row${task.done ? ' is-done' : ''}${selected ? ' is-selected' : ''}${marked ? ' is-marked' : ''}${leaving ? ' is-leaving' : ''}${drag.cls}`}
			aria-selected={marked}
			{...drag.props}
			onMouseDown={(e) => {
				// Shift-click selects to-dos, not text.
				if (e.shiftKey && actions.onMark) e.preventDefault();
			}}
			onClickCapture={(e) => {
				if (!actions.onMark) return;
				const onCheckbox = !!(e.target as HTMLElement).closest('.pl-check');
				const how = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey || (tapSelects && !onCheckbox) ? 'toggle' : null;
				if (!how) return;
				// Before the title, its links and the checkbox see it.
				e.preventDefault();
				e.stopPropagation();
				actions.onMark(item, how);
			}}
			onClick={(e) => {
				if (actions.onSelect && !(e.target as HTMLElement).closest('button, a')) actions.onSelect(item);
			}}
		>
			<Checkbox done={task.done} title={task.title} onToggle={() => actions.onToggle(item)} />
			<button type="button" class="pl-row-title" onClick={() => actions.onExpand(item)}>
				{task.title ? <Title text={task.title} sourcePath={item.path} /> : <span class="pl-untitled">New to-do</span>}
			</button>
			{task.repeat && !task.done && (
				<span class="pl-row-repeat" aria-label={`Repeats ${task.repeat}`}>
					<RepeatIcon />
				</span>
			)}
			{meta && <span class={`pl-row-meta ${metaClass ?? ''}`}>{meta}</span>}
		</div>
	);
}

/** Indents a sub-task's row under its parent's. */
function useDepth(el: { current: HTMLElement | null }, depth = 0): void {
	useLayoutEffect(() => {
		el.current?.setCssProps({ '--pl-depth': String(depth) });
	}, [depth]);
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
	onDiscard,
}: {
	item: Item;
	box: TrackBox;
	projects: ProjectInfo[];
	today: string;
	onCollapse: () => void;
	onToggle: () => void;
	/** For a just-added sub-task: called when the editor closes with no title or description. */
	onDiscard?: () => void;
}) {
	const { app, workspace, weekStart } = useEnv();
	const { task } = item;
	const [title, setTitle] = useState(task.title);
	const [description, setDescription] = useState(task.description);
	const [popover, setPopover] = useState<'date' | 'repeat' | 'project' | null>(null);
	const wrap = useRef<HTMLDivElement>(null);
	const titleInput = useRef<HTMLTextAreaElement>(null);
	/** The title as the editor opened: dates and @projects already in it are plain text. */
	const original = useRef(task.title);
	/** Recognised phrases the user backspaced into, to keep as plain words. */
	const [kept, setKept] = useState<string[]>([]);
	const latest = useRef({ title, description });
	latest.current = { title, description };
	const open = projects.filter((p) => p.exists);
	const choices = open.map((p) => ({ name: p.name, path: p.path, headings: workspace.doc(p.path)?.headings }));
	const targets = mentionTargets(choices);
	const names = targets.map((t) => t.label);
	const links = noteLinks(app, item.path);

	const onTitle = (value: string): void => {
		setKept((k) => stillKept(k, value));
		setTitle(value);
		save.schedule();
	};
	const suggest = useSuggest({ input: titleInput, value: title, onChange: onTitle, projects: targets, links });
	const recognised = (text: string) => recogniseEdit(text, original.current, names, today, weekStart(), kept);
	const { match, mention, repeat } = recognised(title);

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
		if (onDiscard && !latest.current.title.trim() && !latest.current.description.trim()) return onDiscard();
		const typed = latest.current.title;
		const found = recognised(typed);
		const rest = stripRanges(typed, [found.match, found.mention, found.repeat].filter((r) => r !== null));
		if (!rest || rest === typed.trim()) return;
		void workspace.run(box.current.path, (doc) => setTaskTitle(doc, box.current.ref, rest), box);
		const date = found.match?.date;
		if (date) void workspace.run(box.current.path, (doc) => setTaskDate(doc, box.current.ref, date), box);
		const rule = found.repeat?.rule;
		if (rule) void workspace.run(box.current.path, (doc) => setTaskRepeat(doc, box.current.ref, rule, today, weekStart()), box);
		const target = found.mention && targets[found.mention.project];
		if (target) void workspace.moveTask(box, target.path, target.heading && { line: target.heading.line, text: target.heading.text });
	};

	// Collapsing unmounts the editor: save whatever is still pending.
	useEffect(() => () => finish.current(), []);
	useEffect(() => titleInput.current?.focus(), []);
	useOutsideClick(wrap, onCollapse, popover === null);
	useDepth(wrap, item.depth);

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
	if (repeat) marks.push({ start: repeat.index, end: repeat.end, cls: 'pl-capture-date' });
	if (mention) marks.push({ start: mention.index, end: mention.end, cls: 'pl-capture-mention' });
	const dateText = match ? dateLabel(match.date, today) : dateLabel(task.date, today);
	const repeatText = repeat ? repeat.rule : task.repeat;
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
					<div class="pl-editor-title-backdrop" aria-hidden="true">
						{highlighted(title, marks)}
						{'\u200b'}
					</div>
					{/* A textarea so a long title wraps; it stays one line, as Enter closes the editor. */}
					<AutoTextarea
						inputRef={titleInput}
						class="pl-editor-title"
						aria-label="Title"
						placeholder="New to-do"
						spellcheck={false}
						aria-autocomplete="list"
						value={title}
						onInput={(e) => {
							// Pasted line breaks would split the to-do line in the note.
							onTitle(e.currentTarget.value.replace(/[\r\n]+/g, ' '));
							suggest.onInput();
						}}
						onKeyUp={suggest.sync}
						onClick={suggest.sync}
						onBlur={suggest.onBlur}
						onKeyDown={(e) => {
							if (suggest.onKeyDown(e)) return;
							const el = e.currentTarget;
							if (e.key === 'Backspace' && !e.isComposing && el.selectionStart === el.selectionEnd) {
								// Backspace at the end of a recognised phrase keeps it as words instead.
								const phrase = phraseBefore(recognised(el.value), el.selectionStart);
								if (phrase) {
									e.preventDefault();
									setKept([...kept, phrase]);
								}
							} else if (e.key === 'Enter' && !e.isComposing) {
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
					<div class="pl-field">
						<span class="pl-field-label">Repeat{repeat && <span class="pl-field-note"> · from “{repeat.text}”</span>}</span>
						<button
							type="button"
							class={`pl-field-button${repeatText ? '' : ' is-empty'}`}
							aria-haspopup="dialog"
							aria-expanded={popover === 'repeat'}
							onClick={() => setPopover(popover === 'repeat' ? null : 'repeat')}
						>
							{repeatText ?? 'Never'}
						</button>
						{popover === 'repeat' && (
							<RepeatPopover
								current={task.repeat}
								onClose={() => setPopover(null)}
								onPick={(rule, close) => {
									const apply = (): void => {
										drop(repeat);
										void workspace.run(box.current.path, (doc) => setTaskRepeat(doc, box.current.ref, rule, today, weekStart()), box);
									};
									if (close) pick(apply);
									else apply();
								}}
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
