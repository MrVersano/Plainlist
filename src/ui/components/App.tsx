import { Keymap, Menu } from 'obsidian';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { headerDate, metaDate, overdueLabel } from '../../dates/format';
import { computeCounts, computeList, isOverdue, sameList, type ListId } from '../../model/lists';
import {
	addProject,
	deleteProject,
	deleteTask,
	refOf,
	renameProject,
	restoreLines,
	setProjectDescription,
	setTaskDone,
	type Removed,
} from '../../model/patch';
import type { Project, Task } from '../../model/types';
import { locateLine, type TrackBox } from '../../store';
import { useDebounced, useDoc, useEnv, useToday } from '../env';
import { MarkdownField } from './bits';
import { LISTS, listLabel, Sidebar, type ProjectActions } from './Sidebar';
import { TaskEditor, TaskRow, type RowActions } from './TaskRow';

const NARROW = 600;

const EMPTY: Record<ListId['kind'], string> = {
	inbox: 'Inbox is empty.',
	today: 'Nothing for today.',
	upcoming: 'Nothing coming up.',
	nodate: 'Every project to-do has a date.',
	someday: 'Nothing for someday.',
	completed: 'Nothing completed yet.',
	project: 'No to-dos in this project.',
};

function meta(list: ListId, task: Task, today: string): { text: string; cls?: string } {
	switch (list.kind) {
		case 'today':
			return isOverdue(task, today) ? { text: overdueLabel(task.date ?? today, today), cls: 'is-overdue' } : { text: task.project ?? '' };
		case 'upcoming':
		case 'someday':
		case 'completed':
			return { text: task.project ?? '' };
		default:
			return { text: task.date ? metaDate(task.date, today) : '' };
	}
}

const sameRef = (box: TrackBox | null, t: Task): boolean => !!box && box.current.line === t.line && box.current.text === t.text;

function ProjectHeader({ project, onRename }: { project: Project; onRename: (name: string) => void }) {
	const { store } = useEnv();
	const [name, setName] = useState(project.name);
	const [description, setDescription] = useState(project.description);
	const box = useRef<TrackBox>({ current: refOf(project) });
	const focused = useRef(false);

	// Follow changes made elsewhere unless the user is typing here.
	useEffect(() => {
		box.current.current = refOf(project);
		if (!focused.current) setName(project.name);
	}, [project.line, project.text]);
	useEffect(() => {
		if (!save.pending()) setDescription(project.description);
	}, [project.description]);

	const save = useDebouncedWithPending(() => {
		void store.run((doc) => setProjectDescription(doc, box.current.current, latest.current), box.current);
	}, 400);
	const latest = useRef(description);
	latest.current = description;
	useEffect(() => () => save.flush(), []);

	const commitName = (): void => {
		const clean = name.trim();
		if (clean && clean !== project.name) onRename(clean);
		else setName(project.name);
	};

	return (
		<>
			<input
				class="pl-title pl-title-input"
				type="text"
				aria-label="Project name"
				value={name}
				onFocus={() => (focused.current = true)}
				onInput={(e) => setName(e.currentTarget.value)}
				onBlur={() => {
					focused.current = false;
					commitName();
				}}
				onKeyDown={(e) => {
					if (e.isComposing) return;
					if (e.key === 'Enter') e.currentTarget.blur();
					if (e.key === 'Escape') {
						setName(project.name);
						e.currentTarget.blur();
					}
				}}
			/>
			<MarkdownField
				class="pl-project-desc"
				value={description}
				placeholder="Notes"
				onInput={(value) => {
					setDescription(value);
					save.schedule();
				}}
				onBlur={() => save.flush()}
			/>
		</>
	);
}

function useDebouncedWithPending(fn: () => void, ms: number) {
	const pending = useRef(false);
	const d = useDebounced(() => {
		pending.current = false;
		fn();
	}, ms);
	return {
		schedule: () => {
			pending.current = true;
			d.schedule();
		},
		flush: d.flush,
		pending: () => pending.current,
	};
}

interface Toast {
	message: string;
	undo: () => void;
}

export function App({ initialList, onListChange }: { initialList: ListId; onListChange: (list: ListId) => void }) {
	const env = useEnv();
	const { store, clock } = env;
	const doc = useDoc(store);
	const today = useToday(clock);
	const [list, setListState] = useState<ListId>(initialList);
	const [expanded, setExpanded] = useState<TrackBox | null>(null);
	const [selected, setSelected] = useState(-1);
	const [showCompleted, setShowCompleted] = useState(false);
	const [toast, setToast] = useState<Toast | null>(null);
	const [narrow, setNarrow] = useState(false);
	const root = useRef<HTMLDivElement>(null);

	const setList = (next: ListId): void => {
		if (sameList(next, list)) return;
		setListState(next);
		setExpanded(null);
		setSelected(-1);
		setShowCompleted(false);
		onListChange(next);
	};

	// Follow a project renamed here or in the file (same heading line); if it is gone, go to the Inbox.
	const projectLine = useRef<number | null>(null);
	useEffect(() => {
		if (list.kind !== 'project') return;
		const current = doc.projects.find((p) => p.name === list.name);
		if (current) {
			projectLine.current = current.line;
			return;
		}
		const renamed = doc.projects.find((p) => p.line === projectLine.current);
		if (renamed) {
			setListState({ kind: 'project', name: renamed.name });
			onListChange({ kind: 'project', name: renamed.name });
		} else {
			setList({ kind: 'inbox' });
		}
	}, [doc, list]);

	useLayoutEffect(() => {
		const el = root.current;
		if (!el) return;
		const observer = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW));
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!toast) return;
		const timer = window.setTimeout(() => setToast(null), 5000);
		return () => window.clearTimeout(timer);
	}, [toast]);

	const view = useMemo(() => computeList(doc, list, today), [doc, list, today]);
	const counts = useMemo(() => computeCounts(doc, today), [doc, today]);
	const projectNames = doc.projects.map((p) => p.name);
	const project = list.kind === 'project' ? doc.projects.find((p) => p.name === list.name) : undefined;

	// Keep the open row attached to its to-do when the file changes elsewhere.
	if (expanded && doc.lines[expanded.current.line] !== expanded.current.text) {
		const line = locateLine(doc, expanded.current);
		if (line !== null) expanded.current = { line, text: expanded.current.text };
	}
	const rows = [...view.groups.flatMap((g) => g.tasks), ...(showCompleted ? view.completed : [])];
	const expandedVisible = !!expanded && rows.some((t) => sameRef(expanded, t));
	useEffect(() => {
		if (expanded && !expandedVisible) setExpanded(null);
	}, [expanded, expandedVisible]);

	const toggle = (task: Task): void => {
		void store.run((d) => setTaskDone(d, refOf(task), !task.done, today), sameRef(expanded, task) ? (expanded ?? undefined) : undefined);
	};

	const remove = async (task: Task): Promise<void> => {
		let removed: Removed | null = null;
		if (sameRef(expanded, task)) setExpanded(null);
		const res = await store.run((d) => {
			const r = deleteTask(d, refOf(task));
			removed = r.removed;
			return r.edits;
		});
		const undo = removed as Removed | null;
		if (res.ok && undo) {
			setToast({ message: 'Deleted', undo: () => void store.run((d) => restoreLines(d, undo)) });
		}
	};

	const rowActions: RowActions = {
		onToggle: toggle,
		onExpand: (task) => {
			setSelected(rows.indexOf(task));
			setExpanded({ current: refOf(task) });
		},
		onMenu: (task, pos) => {
			new Menu()
				.addItem((i) =>
					i
						.setTitle(task.done ? 'Mark as open' : 'Complete')
						.setIcon('check')
						.onClick(() => toggle(task)),
				)
				.addItem((i) =>
					i
						.setTitle('Delete')
						.setIcon('trash')
						.setWarning(true)
						.onClick(() => void remove(task)),
				)
				.showAtPosition(pos);
		},
	};

	const projectActions: ProjectActions = {
		add: (name) => {
			void store.run((d) => addProject(d, name)).then((res) => {
				if (res.ok) setList({ kind: 'project', name: name.trim() });
			});
		},
		rename: (p, name) => {
			void store.run((d) => renameProject(d, refOf(p), name));
		},
		remove: (p) => {
			const open = p.tasks.filter((t) => !t.done).length;
			const detail = p.tasks.length
				? `Its ${p.tasks.length} to-do${p.tasks.length === 1 ? '' : 's'}${open < p.tasks.length ? ` (${open} open)` : ''} will move to the Inbox.`
				: 'It has no to-dos.';
			void env.confirm(`Delete “${p.name}”?`, detail, 'Delete').then((ok) => {
				if (!ok) return;
				void store.run((d) => deleteProject(d, refOf(p))).then((res) => {
					if (res.ok && list.kind === 'project' && list.name === p.name) setList({ kind: 'inbox' });
				});
			});
		},
	};

	const onKeyDown = (e: KeyboardEvent): void => {
		const target = e.target as HTMLElement | null;
		if (e.isComposing || target?.closest('input, textarea, [contenteditable="true"], .pl-popover')) return;
		const mod = Keymap.isModEvent(e) === true || e.metaKey || e.ctrlKey;
		const current = rows[selected];
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (expanded) return;
			const step = e.key === 'ArrowDown' ? 1 : -1;
			setSelected(Math.max(0, Math.min(rows.length - 1, (selected < 0 && step < 0 ? rows.length : selected) + step)));
		} else if (e.key === 'Enter' && mod) {
			e.preventDefault();
			if (current) toggle(current);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (expanded) setExpanded(null);
			else if (current) setExpanded({ current: refOf(current) });
		} else if (e.key === 'Escape') {
			if (expanded) {
				e.preventDefault();
				setExpanded(null);
			}
		} else if (e.key === ' ' && !mod) {
			e.preventDefault();
			if (current) toggle(current);
		} else if ((e.key === 'Backspace' || e.key === 'Delete') && mod) {
			e.preventDefault();
			if (current) void remove(current);
		} else if ((e.key === 'n' || e.key === 'N') && !mod && !e.altKey) {
			e.preventDefault();
			env.openCapture(list);
		}
	};

	// Give the view keyboard focus back after a row collapses.
	const collapse = (): void => {
		setExpanded(null);
		window.requestAnimationFrame(() => {
			if (!root.current?.contains(root.current.ownerDocument.activeElement) || root.current.ownerDocument.activeElement === root.current.ownerDocument.body) {
				root.current?.focus({ preventScroll: true });
			}
		});
	};

	const renderRow = (task: Task) => {
		if (sameRef(expanded, task) && expanded) {
			return (
				<TaskEditor
					key="expanded"
					task={task}
					box={expanded}
					projects={projectNames}
					today={today}
					onCollapse={collapse}
					onToggle={() => toggle(task)}
				/>
			);
		}
		const m = meta(list, task, today);
		return (
			<TaskRow
				key={`${task.line}:${task.text}`}
				task={task}
				meta={m.text}
				metaClass={m.cls}
				selected={rows[selected] === task}
				actions={rowActions}
			/>
		);
	};

	const pickList = (evt: MouseEvent): void => {
		const menu = new Menu();
		for (const { id, label } of LISTS) menu.addItem((i) => i.setTitle(label).setChecked(sameList(id, list)).onClick(() => setList(id)));
		if (doc.projects.length) menu.addSeparator();
		for (const p of doc.projects) {
			const id: ListId = { kind: 'project', name: p.name };
			menu.addItem((i) => i.setTitle(p.name).setChecked(sameList(id, list)).onClick(() => setList(id)));
		}
		menu.addSeparator();
		menu.addItem((i) =>
			i.setTitle('New project').setIcon('plus').onClick(() => {
				void env.prompt('New project', 'Project name').then((name) => name && projectActions.add(name));
			}),
		);
		if (project) {
			const p = project;
			menu.addItem((i) => i.setTitle('Delete project').setIcon('trash').setWarning(true).onClick(() => projectActions.remove(p)));
		}
		menu.showAtMouseEvent(evt);
	};

	const hint = env.hint();

	return (
		<div
			ref={root}
			class={`pl-root${narrow ? ' is-narrow' : ''}`}
			tabIndex={-1}
			onKeyDown={onKeyDown}
		>
			{narrow ? (
				<div class="pl-picker-bar">
					<button type="button" class="pl-picker" aria-haspopup="menu" onClick={pickList}>
						{listLabel(list)}
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M4 6l4 4 4-4" />
						</svg>
					</button>
				</div>
			) : (
				<Sidebar list={list} counts={counts} projects={doc.projects} onSelect={setList} actions={projectActions} />
			)}
			<main
				class="pl-main"
				onMouseDown={(e) => {
					if (e.target === e.currentTarget) root.current?.focus({ preventScroll: true });
				}}
			>
				<div class="pl-content">
					<header class="pl-header">
						{project ? (
							<ProjectHeader
								key={project.name}
								project={project}
								onRename={(name) => projectActions.rename(project, name)}
							/>
						) : (
							<>
								<h1 class="pl-title">{listLabel(list)}</h1>
								{list.kind === 'today' && <span class="pl-header-date">{headerDate(today)}</span>}
							</>
						)}
					</header>

					{view.groups.length === 0 && !view.completed.length && <p class="pl-empty">{EMPTY[list.kind]}</p>}

					{view.groups.map((g) => (
						<section class="pl-group" key={g.key}>
							{g.label && (
								<h2 class="pl-group-header">
									<span class="pl-group-label">{g.label}</span>
									{g.sublabel && <span class="pl-group-sublabel">{g.sublabel}</span>}
								</h2>
							)}
							<div class="pl-rows">{g.tasks.map(renderRow)}</div>
						</section>
					))}

					{view.completed.length > 0 && (
						<div class="pl-completed">
							<button
								type="button"
								class="pl-completed-toggle"
								aria-expanded={showCompleted}
								onClick={() => setShowCompleted(!showCompleted)}
							>
								{showCompleted ? 'Hide completed' : `${view.completed.length} completed`}
							</button>
							{showCompleted && <div class="pl-rows">{view.completed.map(renderRow)}</div>}
						</div>
					)}

					{hint ? (
						<p class="pl-hint">
							Press <kbd>N</kbd> to add a to-do
							{hint.hotkey && (
								<>
									, or <kbd>{hint.hotkey}</kbd> from anywhere
								</>
							)}
						</p>
					) : (
						<button type="button" class="pl-add-mobile" onClick={() => env.openCapture(list)}>
							New to-do
						</button>
					)}
				</div>
			</main>

			{toast && (
				<div class="pl-toast" role="status">
					<span>{toast.message}</span>
					<span class="pl-toast-sep" aria-hidden="true">·</span>
					<button
						type="button"
						onClick={() => {
							toast.undo();
							setToast(null);
						}}
					>
						Undo
					</button>
				</div>
			)}
		</div>
	);
}
