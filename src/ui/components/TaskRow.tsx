import { useEffect, useRef, useState } from 'preact/hooks';
import { addDays, longDate } from '../../dates/format';
import type { Item, ProjectInfo } from '../../model/lists';
import { findTask, setTaskDate, setTaskDescription, setTaskTitle } from '../../model/patch';
import type { TrackBox } from '../../store';
import { useDebounced, useEnv, useLongPress, useOutsideClick } from '../env';
import { Checkbox, MarkdownField, Title } from './bits';
import { DatePopover, ProjectPicker } from './popovers';

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
				{task.title ? <Title text={task.title} /> : <span class="pl-untitled">New to-do</span>}
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
	const { workspace, weekStart } = useEnv();
	const { task } = item;
	const [title, setTitle] = useState(task.title);
	const [description, setDescription] = useState(task.description);
	const [popover, setPopover] = useState<'date' | 'project' | null>(null);
	const wrap = useRef<HTMLDivElement>(null);
	const titleInput = useRef<HTMLInputElement>(null);
	const latest = useRef({ title, description });
	latest.current = { title, description };

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

	// Collapsing unmounts the editor: save whatever is still pending.
	useEffect(() => () => save.flush(), []);
	useEffect(() => titleInput.current?.focus(), []);
	useOutsideClick(wrap, onCollapse, popover === null);

	const pick = (fn: () => void): void => {
		save.flush();
		setPopover(null);
		fn();
	};

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
				<input
					ref={titleInput}
					class="pl-editor-title"
					type="text"
					aria-label="Title"
					placeholder="New to-do"
					value={title}
					onInput={(e) => {
						setTitle(e.currentTarget.value);
						save.schedule();
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.isComposing) {
							e.preventDefault();
							onCollapse();
						}
					}}
				/>
			</div>
			<div class="pl-editor-body">
				<MarkdownField
					class="pl-editor-desc"
					value={description}
					sourcePath={item.path}
					placeholder="Description — #tags and [[links]] work here too"
					onInput={(value) => {
						setDescription(value);
						save.schedule();
					}}
					onBlur={() => save.flush()}
				/>
				<div class="pl-editor-fields">
					<div class="pl-field">
						<span class="pl-field-label">Date</span>
						<button
							type="button"
							class={`pl-field-button${task.date ? '' : ' is-empty'}`}
							aria-haspopup="dialog"
							aria-expanded={popover === 'date'}
							onClick={() => setPopover(popover === 'date' ? null : 'date')}
						>
							{dateLabel(task.date, today) || 'No date'}
						</button>
						{popover === 'date' && (
							<DatePopover
								today={today}
								weekStart={weekStart()}
								onClose={() => setPopover(null)}
								onPick={(date) =>
									pick(() => void workspace.run(box.current.path, (doc) => setTaskDate(doc, box.current.ref, date), box))
								}
							/>
						)}
					</div>
					<div class="pl-field pl-field-wide">
						<span class="pl-field-label">Project</span>
						<button
							type="button"
							class="pl-field-button"
							aria-haspopup="listbox"
							aria-expanded={popover === 'project'}
							onClick={() => setPopover(popover === 'project' ? null : 'project')}
						>
							{item.project?.name ?? 'Inbox'}
						</button>
						{popover === 'project' && (
							<ProjectPicker
								projects={projects.filter((p) => p.exists)}
								current={item.project?.path ?? null}
								onClose={() => setPopover(null)}
								onPick={(path) => pick(() => void workspace.moveTask(box, path))}
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
