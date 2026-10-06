import { Keymap, Menu } from 'obsidian';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { headerDate, metaDate, overdueLabel } from '../../dates/format';
import {
	allItems,
	computeCounts,
	computeList,
	homeList,
	isOverdue,
	placeLabel,
	sameList,
	type Item,
	type ListId,
	type ListView,
	type ProjectInfo,
	type Source,
} from '../../model/lists';
import { deleteTask, refOf, restoreLines, setTaskDone, type Removed } from '../../model/patch';
import type { Task } from '../../model/types';
import { locateLine, type TaskRef, type TrackBox } from '../../store';
import { useEnv, useToday, useWorkspace } from '../env';
import { themeCheckboxRadius } from '../obsidian';
import { ProjectSuggestModal } from '../ProjectSuggestModal';
import { Checkbox } from './bits';
import { LISTS, listLabel, projectMenu, Sidebar, type ProjectActions } from './Sidebar';
import { TaskEditor, TaskRow, type RowActions } from './TaskRow';

const NARROW = 600;
/** How long a just-completed to-do stays in its list, crossed off, before it fades out. */
const LINGER_MS = 3000;
/** Matches the `pl-leave` animation in styles.css. */
const LEAVE_MS = 250;

/**
 * One key per expansion. The editor keeps its key while its to-do is edited (and its line
 * changes), but opening another to-do mounts a fresh editor instead of reusing the old state.
 */
const expansionIds = new WeakMap<TrackBox, number>();
let nextExpansionId = 0;
function expansionKey(box: TrackBox): string {
	let id = expansionIds.get(box);
	if (id === undefined) {
		id = nextExpansionId++;
		expansionIds.set(box, id);
	}
	return `expanded-${id}`;
}

const EMPTY: Record<ListId['kind'], string> = {
	inbox: 'Inbox is empty.',
	today: 'Nothing for today.',
	upcoming: 'Nothing coming up.',
	nodate: 'Every project to-do has a date.',
	someday: 'Nothing for someday.',
	completed: 'Nothing completed yet.',
	project: 'No to-dos in this note yet.',
};

function meta(list: ListId, item: Item, today: string): { text: string; cls?: string } {
	const { task } = item;
	switch (list.kind) {
		case 'today':
			return isOverdue(task, today) ? { text: overdueLabel(task.date ?? today, today), cls: 'is-overdue' } : { text: placeLabel(item) };
		case 'upcoming':
		case 'someday':
		case 'completed':
			return { text: placeLabel(item) };
		default:
			return { text: task.date ? metaDate(task.date, today) : '' };
	}
}

const isAt = (at: TaskRef | null, item: Item): boolean =>
	!!at && at.path === item.path && at.ref.line === item.task.line && at.ref.text === item.task.text;

const isBoxed = (box: TrackBox | null, item: Item): boolean => isAt(box?.current ?? null, item);

const itemKey = (item: Item): string => `${item.path}:${item.task.line}:${item.task.text}`;

/** Identifies a to-do across its completion, which rewrites its line's text but not its number. */
const lingerKey = (path: string, line: number): string => `${path}:${line}`;

/**
 * The list as if the lingering to-dos were still open, so each keeps its place; their rows
 * still show the real, completed to-do.
 */
function withLingering(sources: Source[], lingering: Map<string, boolean>, compute: (s: Source[]) => ListView): ListView {
	if (!lingering.size) return compute(sources);
	const real = new Map<Task, Task>();
	const shown = sources.map((s) => {
		if (!s.doc.tasks.some((t) => t.done && lingering.has(lingerKey(s.path, t.line)))) return s;
		const tasks = s.doc.tasks.map((t) => {
			if (!t.done || !lingering.has(lingerKey(s.path, t.line))) return t;
			const open = { ...t, done: false, doneDate: null };
			real.set(open, t);
			return open;
		});
		return { ...s, doc: { ...s.doc, tasks } };
	});
	const restore = (i: Item): Item => {
		const task = real.get(i.task);
		return task ? { ...i, task } : i;
	};
	const view = compute(shown);
	return { groups: view.groups.map((g) => ({ ...g, items: g.items.map(restore) })), completed: view.completed };
}

function ProjectHeader({ project, actions }: { project: ProjectInfo; actions: ProjectActions }) {
	const [name, setName] = useState(project.name);
	const focused = useRef(false);
	useEffect(() => {
		if (!focused.current) setName(project.name);
	}, [project.name]);

	const commit = (): void => {
		const clean = name.trim();
		if (clean && clean !== project.name) actions.rename(project, clean);
		else setName(project.name);
	};

	return (
		<>
			<div class="pl-title-row">
				<Checkbox
					done={project.done}
					title={project.name}
					onToggle={() => (project.done ? actions.reopen(project) : actions.complete(project))}
				/>
				<input
					class="pl-title pl-title-input"
					type="text"
					aria-label="Project name"
					value={name}
					disabled={!project.exists}
					onFocus={() => (focused.current = true)}
					onInput={(e) => setName(e.currentTarget.value)}
					onBlur={() => {
						focused.current = false;
						commit();
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
			</div>
			{project.exists ? (
				<button type="button" class="pl-open-note" onClick={() => actions.open(project)}>
					Open note ↗
				</button>
			) : (
				<span class="pl-open-note is-missing">
					Note not found.{' '}
					<button type="button" class="pl-inline-action" onClick={() => actions.remove(project)}>
						Remove from Plainlist
					</button>
				</span>
			)}
		</>
	);
}

interface Toast {
	message: string;
	undo: () => void;
}

export function App({ initialList, onListChange }: { initialList: ListId; onListChange: (list: ListId) => void }) {
	const env = useEnv();
	const { workspace, clock, app } = env;
	const version = useWorkspace(workspace);
	const today = useToday(clock);
	const [list, setListState] = useState<ListId>(initialList);
	const [expanded, setExpanded] = useState<TrackBox | null>(null);
	const [selected, setSelected] = useState(-1);
	const [showCompleted, setShowCompleted] = useState(false);
	const [toast, setToast] = useState<Toast | null>(null);
	/** Just-completed to-dos still shown in this list, by lingerKey; true once fading out. */
	const [lingering, setLingering] = useState<Map<string, boolean>>(new Map());
	const lingerTimers = useRef(new Map<string, number[]>());
	/** A to-do found with "Search to-dos", until it is selected and scrolled to. */
	const [revealed, setRevealed] = useState<TaskRef | null>(null);
	const [narrow, setNarrow] = useState(false);
	const root = useRef<HTMLDivElement>(null);

	const sources = useMemo(() => workspace.sources(), [version]);
	const projects = workspace.projects;
	const project = list.kind === 'project' ? projects.find((p) => p.path === list.path) : undefined;

	const setList = (next: ListId): void => {
		if (sameList(next, list)) return;
		setListState(next);
		setExpanded(null);
		setSelected(-1);
		setShowCompleted(false);
		clearLingering();
		onListChange(next);
	};

	// Follow a project whose note was renamed: same link line, but a path we haven't seen
	// before. If it was removed instead, go to the Inbox.
	const projectLine = useRef<number | null>(null);
	const knownPaths = useRef(new Set<string>());
	useEffect(() => {
		const known = knownPaths.current;
		knownPaths.current = new Set(projects.map((p) => p.path));
		if (list.kind !== 'project') return;
		if (project) {
			projectLine.current = project.line;
			return;
		}
		const moved = projects.find((p) => p.line === projectLine.current && !known.has(p.path));
		if (moved) {
			setListState({ kind: 'project', path: moved.path });
			onListChange({ kind: 'project', path: moved.path });
		} else {
			setList({ kind: 'inbox' });
		}
	}, [version, list]);

	useLayoutEffect(() => {
		const el = root.current;
		if (!el) return;
		const observer = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW));
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	// Match the theme's checkbox shape (round, or square with its corner radius).
	useEffect(() => {
		const apply = (): void => {
			const el = root.current;
			if (el) el.setCssProps({ '--pl-check-radius': themeCheckboxRadius(el.ownerDocument) });
		};
		apply();
		const ref = app.workspace.on('css-change', apply);
		return () => app.workspace.offref(ref);
	}, []);

	useEffect(() => {
		if (!toast) return;
		const timer = window.setTimeout(() => setToast(null), 5000);
		return () => window.clearTimeout(timer);
	}, [toast]);

	const stopLinger = (key: string): void => {
		for (const t of lingerTimers.current.get(key) ?? []) window.clearTimeout(t);
		lingerTimers.current.delete(key);
	};
	const unlinger = (key: string): void => {
		stopLinger(key);
		setLingering((m) => {
			if (!m.has(key)) return m;
			const next = new Map(m);
			next.delete(key);
			return next;
		});
	};
	const linger = (key: string): void => {
		stopLinger(key);
		setLingering((m) => new Map(m).set(key, false));
		lingerTimers.current.set(key, [
			window.setTimeout(() => setLingering((m) => (m.has(key) ? new Map(m).set(key, true) : m)), LINGER_MS),
			window.setTimeout(() => unlinger(key), LINGER_MS + LEAVE_MS),
		]);
	};
	function clearLingering(): void {
		for (const key of [...lingerTimers.current.keys()]) stopLinger(key);
		setLingering(new Map());
	}
	useEffect(() => clearLingering, []);

	const view = useMemo(
		() => withLingering(sources, lingering, (s) => computeList(s, projects, list, today)),
		[sources, lingering, list, today],
	);
	const counts = useMemo(() => computeCounts(sources, projects, today), [sources, today]);

	// Keep the open row attached to its to-do when its note changes elsewhere.
	if (expanded) {
		const doc = workspace.doc(expanded.current.path);
		const { ref } = expanded.current;
		if (doc && doc.lines[ref.line] !== ref.text) {
			const line = locateLine(doc, ref);
			if (line !== null) expanded.current = { path: expanded.current.path, ref: { line, text: ref.text } };
		}
	}
	const rows = [...view.groups.flatMap((g) => g.items), ...(showCompleted ? view.completed : [])];
	const expandedVisible = rows.some((i) => isBoxed(expanded, i));
	useEffect(() => {
		if (expanded && !expandedVisible) setExpanded(null);
	}, [expanded, expandedVisible]);

	// "Search to-dos": stay on this list if it shows the to-do, otherwise go to the list that
	// always does, then select it.
	const reveal = useRef<(target: TaskRef) => void>(() => {});
	reveal.current = (target) => {
		const doc = workspace.doc(target.path);
		const line = doc ? locateLine(doc, target.ref) : null;
		const all = workspace.sources();
		const item = allItems(all).find((i) => i.path === target.path && i.task.line === line);
		if (!item) return;
		const same = (i: Item): boolean => i.path === item.path && i.task.line === item.task.line;
		const placeIn = (id: ListId): 'open' | 'completed' | null => {
			const v = computeList(all, workspace.projects, id, today);
			if (v.groups.some((g) => g.items.some(same))) return 'open';
			return v.completed.some(same) ? 'completed' : null;
		};
		let next = list;
		let where = placeIn(next);
		if (!where) {
			next = homeList(item);
			where = placeIn(next);
		}
		setList(next);
		if (where === 'completed') setShowCompleted(true);
		if (expanded && !isBoxed(expanded, item)) setExpanded(null);
		setRevealed({ path: item.path, ref: refOf(item.task) });
		window.requestAnimationFrame(() => root.current?.focus({ preventScroll: true }));
	};
	// A layout effect, so this list takes reveals as soon as it mounts.
	useLayoutEffect(() => env.onReveal((target) => reveal.current(target)), []);

	useLayoutEffect(() => {
		if (!revealed) return;
		const at = rows.findIndex((i) => isAt(revealed, i));
		if (at !== -1) setSelected(at);
		setRevealed(null);
	}, [revealed]);

	const toggle = (item: Item): void => {
		// Completed shows done to-dos anyway; elsewhere a completed one lingers, crossed off.
		const key = lingerKey(item.path, item.task.line);
		if (item.task.done) unlinger(key);
		else if (list.kind !== 'completed') linger(key);
		const box = isBoxed(expanded, item) ? (expanded ?? undefined) : undefined;
		void workspace.run(item.path, (d) => setTaskDone(d, box ? box.current.ref : refOf(item.task), !item.task.done, today), box);
	};

	const remove = async (item: Item): Promise<void> => {
		const holder: { removed: Removed | null } = { removed: null };
		if (isBoxed(expanded, item)) setExpanded(null);
		const res = await workspace.run(item.path, (d) => {
			const r = deleteTask(d, refOf(item.task));
			holder.removed = r.removed;
			return r.edits;
		});
		const removed = holder.removed;
		if (res.ok && removed) {
			setToast({ message: 'Deleted', undo: () => void workspace.run(item.path, (d) => restoreLines(d, removed)) });
		}
	};

	const rowActions: RowActions = {
		onToggle: toggle,
		onExpand: (item) => {
			setSelected(rows.indexOf(item));
			setExpanded({ current: { path: item.path, ref: refOf(item.task) } });
		},
		onMenu: (item, pos) => {
			new Menu()
				.addItem((i) =>
					i
						.setTitle(item.task.done ? 'Mark as open' : 'Complete')
						.setIcon('check')
						.onClick(() => toggle(item)),
				)
				.addItem((i) =>
					i
						.setTitle('Delete')
						.setIcon('trash')
						.setWarning(true)
						.onClick(() => void remove(item)),
				)
				.showAtPosition(pos);
		},
	};

	const projectActions: ProjectActions = {
		create: (name) => {
			void workspace.createProject(name).then((p) => p && setList({ kind: 'project', path: p.path }));
		},
		import: (file) => {
			void workspace.importProject(file).then((p) => p && setList({ kind: 'project', path: p.path }));
		},
		rename: (p, name) => {
			projectLine.current = p.line;
			void workspace.renameProject(p, name);
		},
		remove: (p) => {
			void env
				.confirm(`Remove “${p.name}” from Plainlist?`, 'The note and its checkboxes stay as they are; its to-dos just stop showing here.', 'Remove')
				.then((ok) => {
					if (!ok) return;
					void workspace.removeProject(p).then((res) => {
						if (res.ok && list.kind === 'project' && list.path === p.path) setList({ kind: 'inbox' });
					});
				});
		},
		open: (p) => void app.workspace.openLinkText(p.path, workspace.masterPath, 'tab'),
		complete: (p) => {
			const open = workspace.openTaskCount(p);
			const go = (): void => {
				void workspace.completeProject(p, today).then((undo) => undo && setToast({ message: 'Completed', undo }));
			};
			if (!open) return go();
			void env
				.confirm(`Complete “${p.name}”?`, `Its ${open} open to-do${open === 1 ? '' : 's'} will be marked as done too.`, 'Complete', false)
				.then((ok) => ok && go());
		},
		reopen: (p) => void workspace.reopenProject(p),
	};

	const addProject = (): void => {
		new ProjectSuggestModal(app, new Set([workspace.masterPath, ...projects.map((p) => p.path)]), (c) => {
			if (c.kind === 'create') projectActions.create(c.name);
			else projectActions.import(c.file);
		}).open();
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
			else if (current) setExpanded({ current: { path: current.path, ref: refOf(current.task) } });
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
			const doc = root.current?.ownerDocument;
			if (doc && (!root.current?.contains(doc.activeElement) || doc.activeElement === doc.body)) {
				root.current?.focus({ preventScroll: true });
			}
		});
	};

	const renderRow = (item: Item) => {
		if (expanded && isBoxed(expanded, item)) {
			return (
				<TaskEditor
					key={expansionKey(expanded)}
					item={item}
					box={expanded}
					projects={projects.filter((p) => !p.done)}
					today={today}
					onCollapse={collapse}
					onToggle={() => toggle(item)}
				/>
			);
		}
		const m = meta(list, item, today);
		return (
			<TaskRow
				key={itemKey(item)}
				item={item}
				meta={m.text}
				metaClass={m.cls}
				selected={rows[selected] === item}
				reveal={isAt(revealed, item)}
				leaving={item.task.done && lingering.get(lingerKey(item.path, item.task.line)) === true}
				actions={rowActions}
			/>
		);
	};

	const pickList = (evt: MouseEvent): void => {
		const menu = new Menu();
		for (const { id, label } of LISTS) menu.addItem((i) => i.setTitle(label).setChecked(sameList(id, list)).onClick(() => setList(id)));
		if (projects.length) menu.addSeparator();
		for (const p of [...projects.filter((x) => !x.done), ...projects.filter((x) => x.done)]) {
			const id: ListId = { kind: 'project', path: p.path };
			menu.addItem((i) =>
				i
					.setTitle(p.done ? `${p.name} (completed)` : p.name)
					.setChecked(sameList(id, list))
					.onClick(() => setList(id)),
			);
		}
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('New project').setIcon('plus').onClick(addProject));
		menu.showAtMouseEvent(evt);
	};

	const hint = env.hint();

	return (
		<div ref={root} class={`pl-root${narrow ? ' is-narrow' : ''}`} tabIndex={-1} onKeyDown={onKeyDown}>
			{narrow ? (
				<div class="pl-picker-bar">
					<button type="button" class="pl-picker" aria-haspopup="menu" onClick={pickList}>
						{listLabel(list, projects)}
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M4 6l4 4 4-4" />
						</svg>
					</button>
					{project && (
						<button
							type="button"
							class="pl-picker-more"
							aria-label="Project actions"
							onClick={(e) => {
								const p = project;
								projectMenu(p, projectActions, () => {
									void env.prompt('Rename project', 'Project name', p.name, 'Rename').then((name) => name && projectActions.rename(p, name));
								}).showAtMouseEvent(e);
							}}
						>
							•••
						</button>
					)}
				</div>
			) : (
				<Sidebar
					list={list}
					counts={counts}
					projects={projects}
					masterPath={workspace.masterPath}
					onSelect={setList}
					actions={projectActions}
				/>
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
							<ProjectHeader key={project.path} project={project} actions={projectActions} />
						) : (
							<>
								<h1 class="pl-title">{listLabel(list, projects)}</h1>
								{list.kind === 'today' && <span class="pl-header-date">{headerDate(today)}</span>}
							</>
						)}
					</header>

					{view.groups.length === 0 && !view.completed.length && (!project || project.exists) && (
						<p class="pl-empty">{EMPTY[list.kind]}</p>
					)}

					{view.groups.map((g) => (
						<section class="pl-group" key={g.key}>
							{g.label && (
								<h2 class="pl-group-header">
									<span class="pl-group-label">{g.label}</span>
									{g.sublabel && <span class="pl-group-sublabel">{g.sublabel}</span>}
								</h2>
							)}
							<div class="pl-rows">
								{g.projects?.map((p) => (
									<div class="pl-row is-done pl-project-row" key={`project:${p.path}`}>
										<Checkbox done title={p.name} onToggle={() => projectActions.reopen(p)} />
										<button type="button" class="pl-row-title" onClick={() => setList({ kind: 'project', path: p.path })}>
											{p.name}
										</button>
										<span class="pl-row-meta">Project</span>
									</div>
								))}
								{g.items.map(renderRow)}
							</div>
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
