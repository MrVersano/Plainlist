import { Keymap, Menu, Notice } from 'obsidian';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { headerDate, metaDate, overdueLabel } from '../../dates/format';
import {
	allItems,
	computeCounts,
	computeList,
	homeList,
	isOverdue,
	moveInOrder,
	placeLabel,
	sameList,
	todayKey,
	type Item,
	type ListId,
	type ListView,
	type ProjectInfo,
	type Source,
} from '../../model/lists';
import { pastedTasks } from '../../model/paste';
import {
	addSubtask,
	canReorder,
	completeTasks,
	deleteTask,
	deleteTasks,
	indentTask,
	moveTaskNextTo,
	outdentTask,
	refOf,
	restoreAll,
	restoreLines,
	setTaskDate,
	setTaskDone,
	setTasksDate,
	undoComplete,
	type BulkDone,
	type Place,
	type Relocation,
	type Removed,
} from '../../model/patch';
import { setDate } from '../../model/taskLine';
import type { Area, Doc, Task, TaskDate } from '../../model/types';
import { locateLine, type RunResult, type TaskRef, type TrackBox } from '../../store';
import { quoted, type UndoEntry } from '../../undo';
import { useEnv, useToday, useWorkspace, type SelectionCommand, type ViewCommand } from '../env';
import { themeCheckboxRadius } from '../obsidian';
import { AreaSuggestModal } from '../AreaSuggestModal';
import { scheduleMenu } from '../scheduleMenu';
import { ProjectSuggestModal } from '../ProjectSuggestModal';
import { useReorder } from '../reorder';
import { Checkbox } from './bits';
import { DatePopover, ProjectPicker } from './popovers';
import { areaMenu, LISTS, listLabel, projectMenu, Sidebar, SidebarHandle, type ProjectActions } from './Sidebar';
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

function meta(list: ListId, item: Item, today: string, byProject: boolean): { text: string; cls?: string } {
	const { task } = item;
	switch (list.kind) {
		case 'today':
			return isOverdue(task, today)
				? { text: overdueLabel(task.date ?? today, today), cls: 'is-overdue' }
				: { text: placeLabel(item, byProject) };
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

/** Lists that show to-dos in file order, with sub-tasks indented under their parents. */
const isNested = (list: ListId): boolean => ['inbox', 'project', 'nodate', 'someday'].includes(list.kind);

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
	undo?: () => void;
}

const todos = (n: number): string => `${n} to-do${n === 1 ? '' : 's'}`;

/** Items grouped by the note they are in, in the order they come. */
function byNote(items: Item[]): Map<string, Item[]> {
	const out = new Map<string, Item[]>();
	for (const i of items) out.set(i.path, [...(out.get(i.path) ?? []), i]);
	return out;
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
	/** To-dos selected for a bulk action, by itemKey. A Shift range starts at `anchor`. */
	const [marks, setMarks] = useState<ReadonlySet<string>>(new Set());
	const anchor = useRef<string | null>(null);
	/** The bulk bar's open picker. */
	const [picker, setPicker] = useState<SelectionCommand | null>(null);
	/** Just-completed to-dos still shown in this list, by lingerKey; true once fading out. */
	const [lingering, setLingering] = useState<Map<string, boolean>>(new Map());
	const lingerTimers = useRef(new Map<string, number[]>());
	/** A to-do found with "Search to-dos", until it is selected and scrolled to. */
	const [revealed, setRevealed] = useState<TaskRef | null>(null);
	/** A to-do that was just indented or outdented, until it is selected again. */
	const [follow, setFollow] = useState<TaskRef | null>(null);
	/** A just-added sub-task, open in the editor; it is removed if closed while still empty. */
	const fresh = useRef<TrackBox | null>(null);
	const [narrow, setNarrow] = useState(false);
	const [sidebar, setSidebar] = useState(() => env.sidebar.load());
	/** Re-renders after the saved Today order changes, here or in a list in a note. */
	const [orderVersion, setOrderVersion] = useState(0);
	useEffect(() => env.todayOrder.subscribe(() => setOrderVersion((v) => v + 1)), []);
	const todayOrder = env.todayOrder.get();
	const todayByProject = env.todayOrder.byProject();
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
		clearMarks();
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

	useLayoutEffect(() => {
		root.current?.setCssProps({ '--pl-sidebar-width': `${sidebar.width}px` });
	}, [sidebar.width]);

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

	/** Shows a toast whose Undo undoes `entry`, which Mod+Z can also undo until then. */
	const undoToast = (message: string, entry: UndoEntry | null): void =>
		setToast({ message, undo: entry ? () => void (workspace.undo.take(entry) && entry.undo()) : undefined });

	/** Keeps an undo of its own, as an action with a toast has, for Mod+Z. */
	const keepUndo = (label: string, undo: () => void): UndoEntry =>
		workspace.undo.push(label, () => {
			undo();
			return Promise.resolve(true);
		});

	/** Lets Mod+Z put back what an action wrote. */
	const remember = (label: string, res: Promise<RunResult>): Promise<RunResult> =>
		res.then((r) => {
			workspace.remember(label, r);
			return r;
		});

	const undoLast = (): void => {
		void workspace.undoLast().then((label) => label && setToast({ message: `Undone: ${label}` }));
	};

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
		() => withLingering(sources, lingering, (s) => computeList(s, projects, list, today, todayOrder, todayByProject)),
		[sources, lingering, list, today, todayOrder, todayByProject, orderVersion],
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

	const marked = rows.filter((i) => marks.has(itemKey(i)));
	// Selected to-dos that changed elsewhere drop out; once none are left, so does the selection.
	useEffect(() => {
		if (marks.size && !marked.length && !picker) clearMarks();
	}, [marks, marked.length]);
	/** On touch screens, where there is no Cmd-click, a tap adds to (or takes from) a selection once one is started. */
	const tapSelects = marked.length > 0 && env.hint() === null;

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
			const v = computeList(all, workspace.projects, id, today, todayOrder);
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

	useLayoutEffect(() => {
		if (!follow) return;
		const at = rows.findIndex((i) => isAt(follow, i));
		if (at !== -1) setSelected(at);
		setFollow(null);
	}, [follow]);

	/** The row a to-do would be indented under: the closest one above it at the same depth, with the same parent. */
	const indentTarget = (item: Item): Item | null => {
		const open = view.groups.flatMap((g) => g.items);
		const depth = item.depth ?? 0;
		for (let j = open.indexOf(item) - 1; j >= 0; j--) {
			const r = open[j];
			if (!r || r.path !== item.path || (r.depth ?? 0) < depth) return null;
			if ((r.depth ?? 0) > depth) continue;
			const sameHeading = (r.task.heading?.line ?? null) === (item.task.heading?.line ?? null);
			return r.task.parent === item.task.parent && sameHeading ? r : null;
		}
		return null;
	};

	/** Re-nests a to-do and keeps it selected. */
	const relocate = (item: Item, makeEdits: (d: Doc) => Relocation): void => {
		const landed: { at: TaskRef | null } = { at: null };
		void remember(
			`Moved ${quoted(item.task.title)}`,
			workspace.run(item.path, (d) => {
				const r = makeEdits(d);
				landed.at = { path: item.path, ref: r.landed };
				return r.edits;
			}),
		).then((res) => res.ok && landed.at && setFollow(landed.at));
	};

	const indent = (item: Item): void => {
		const under = indentTarget(item);
		if (under) relocate(item, (d) => indentTask(d, refOf(item.task), refOf(under.task)));
	};

	const outdent = (item: Item): void => {
		if (item.task.parent !== null) relocate(item, (d) => outdentTask(d, refOf(item.task)));
	};

	const addSub = (item: Item): void => {
		const landed: { at: TaskRef | null } = { at: null };
		void workspace
			.run(item.path, (d) => {
				const r = addSubtask(d, refOf(item.task));
				landed.at = { path: item.path, ref: r.landed };
				return r.edits;
			})
			.then((res) => {
				if (!res.ok || !landed.at) return;
				const box = { current: landed.at };
				fresh.current = box;
				setExpanded(box);
			});
	};

	const toggle = (item: Item): void => {
		// Completed shows done to-dos anyway; elsewhere a completed one lingers, crossed off.
		// A repeating one's next to-do goes above it, so it lingers that many lines further down.
		const { task } = item;
		const repeats = !task.done && task.repeat !== null;
		const key = lingerKey(item.path, repeats ? Math.max(task.end, task.subtreeEnd) : task.line);
		if (task.done) unlinger(key);
		else if (list.kind !== 'completed') linger(key);
		const box = isBoxed(expanded, item) ? (expanded ?? undefined) : undefined;
		if (repeats) {
			void workspace
				.completeRepeating(item.path, refOf(task), today, env.weekStart(), box)
				.then((r) => r && undoToast(`Next one: ${metaDate(r.date, today)}`, keepUndo(`Completed ${quoted(task.title)}`, r.undo)));
			return;
		}
		void remember(
			`${task.done ? 'Reopened' : 'Completed'} ${quoted(task.title)}`,
			workspace.run(item.path, (d) => setTaskDone(d, box ? box.current.ref : refOf(item.task), !item.task.done, today), box),
		);
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
			undoToast('Deleted', keepUndo(`Deleted ${quoted(item.task.title)}`, () => void workspace.run(item.path, (d) => restoreLines(d, removed))));
		}
	};

	function clearMarks(): void {
		setMarks(new Set());
		anchor.current = null;
		setPicker(null);
	}

	/** Selects the rows from the anchor (or `from`) to `to`, keeping the anchor. */
	const markRange = (from: number, to: number): void => {
		const at = rows.findIndex((i) => itemKey(i) === anchor.current);
		const start = at === -1 ? from : at;
		if (at === -1) anchor.current = rows[start] ? itemKey(rows[start]) : null;
		setMarks(new Set(rows.slice(Math.min(start, to), Math.max(start, to) + 1).map(itemKey)));
	};

	/** Cmd/Ctrl-click (or a tap while selecting) adds or removes one to-do; Shift-click selects a range. */
	const mark = (item: Item, how: 'toggle' | 'range'): void => {
		const at = rows.indexOf(item);
		if (expanded) setExpanded(null);
		if (how === 'range') {
			markRange(marks.size ? at : selected >= 0 ? selected : at, at);
		} else {
			const key = itemKey(item);
			const next = new Set(marks);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			setMarks(next);
			anchor.current = key;
		}
		setSelected(at);
	};

	/** Selects one to-do (when none are) and opens the bulk bar's picker. */
	const openPicker = (command: SelectionCommand, item?: Item): void => {
		if (!item || !marks.has(itemKey(item))) {
			const one = item ?? marked[0] ?? (expanded ? rows.find((i) => isBoxed(expanded, i)) : rows[selected]);
			if (!one) {
				new Notice('Select a to-do first.');
				return;
			}
			if (item || !marked.length) {
				setMarks(new Set([itemKey(one)]));
				anchor.current = itemKey(one);
			}
		}
		setExpanded(null);
		setPicker(command);
	};
	const viewCommand = useRef<(command: ViewCommand) => void>(() => {});
	viewCommand.current = (command) => (command === 'undo' ? undoLast() : openPicker(command));
	useLayoutEffect(() => env.onCommand((command) => viewCommand.current(command)), []);

	const refocus = (): void => {
		window.requestAnimationFrame(() => root.current?.focus({ preventScroll: true }));
	};

	/** Completes the to-dos, or reopens them when they all are done already. */
	const toggleAll = async (items: Item[]): Promise<void> => {
		if (items.length === 1 && items[0]) return toggle(items[0]);
		const done = !items.every((i) => i.task.done);
		clearMarks();
		setExpanded(null);
		const ran: { path: string; done: BulkDone }[] = [];
		const results = await Promise.all(
			[...byNote(items)].map(([path, group]) => {
				const refs = group.map((i) => refOf(i.task));
				const doc = workspace.doc(path);
				// Completed to-dos linger where they land, as one ticked on its own does.
				if (doc && done && list.kind !== 'completed') {
					try {
						for (const line of completeTasks(doc, refs, true, today, env.weekStart()).lines) linger(lingerKey(path, line));
					} catch {
						// The run below reports it.
					}
				}
				if (!done) for (const i of group) unlinger(lingerKey(path, i.task.line));
				return workspace.run(path, (d) => {
					const r = completeTasks(d, refs, done, today, env.weekStart());
					ran.push({ path, done: r });
					return r.edits;
				});
			}),
		);
		if (!results.some((r) => r.ok)) return;
		const count = ran.reduce((n, r) => n + r.done.changed.length + r.done.repeated.length, 0);
		const message = `${done ? 'Completed' : 'Reopened'} ${todos(count)}`;
		undoToast(
			message,
			keepUndo(message, () => {
				for (const r of ran) void workspace.run(r.path, (d) => undoComplete(d, r.done));
			}),
		);
	};

	const removeAll = async (items: Item[]): Promise<void> => {
		if (items.length === 1 && items[0]) return remove(items[0]);
		clearMarks();
		setExpanded(null);
		const ran: { path: string; removed: Removed[] }[] = [];
		const results = await Promise.all(
			[...byNote(items)].map(([path, group]) =>
				workspace.run(path, (d) => {
					const r = deleteTasks(
						d,
						group.map((i) => refOf(i.task)),
					);
					ran.push({ path, removed: r.removed });
					return r.edits;
				}),
			),
		);
		if (!results.some((r) => r.ok)) return;
		const message = `Deleted ${todos(items.length)}`;
		undoToast(
			message,
			keepUndo(message, () => {
				for (const r of ran) void workspace.run(r.path, (d) => restoreAll(d, r.removed));
			}),
		);
	};

	const scheduleAll = async (items: Item[], date: TaskDate | null): Promise<void> => {
		clearMarks();
		refocus();
		// For undo: each to-do's line as it will be, and the date it had.
		const before = items.map((i) => ({ path: i.path, ref: { line: i.task.line, text: setDate(i.task.text, date) }, date: i.task.date }));
		const results = await Promise.all(
			[...byNote(items)].map(([path, group]) =>
				workspace.run(path, (d) =>
					setTasksDate(
						d,
						group.map((i) => refOf(i.task)),
						date,
					),
				),
			),
		);
		if (!results.some((r) => r.ok)) return;
		const n = todos(items.length);
		undoToast(
			date === null ? `Removed the date from ${n}` : `${items.length === 1 ? 'Scheduled' : n}: ${metaDate(date, today)}`,
			keepUndo(`Scheduled ${items.length === 1 && items[0] ? quoted(items[0].task.title) : n}`, () => {
				for (const b of before) void workspace.run(b.path, (d) => setTaskDate(d, b.ref, b.date));
			}),
		);
	};

	const moveAll = async (items: Item[], projectPath: string | null, heading: { line: number; text: string } | null): Promise<void> => {
		clearMarks();
		refocus();
		const res = await workspace.moveTasks(
			items.map((i) => ({ path: i.path, ref: refOf(i.task) })),
			projectPath,
			heading,
		);
		const name = projectPath === null ? 'the Inbox' : (projects.find((p) => p.path === projectPath)?.name ?? 'the project');
		const message = `Moved ${todos(items.length)} to ${name}`;
		workspace.remember(message, res);
		if (res.ok) undoToast(message, res.changes?.length ? workspace.undo.peek() : null);
	};

	const rowActions: RowActions = {
		onToggle: toggle,
		onExpand: (item) => {
			clearMarks();
			setSelected(rows.indexOf(item));
			setExpanded({ current: { path: item.path, ref: refOf(item.task) } });
		},
		onMark: mark,
	};

	/** The menu for a right-click on one of several selected to-dos. */
	const selectionMenu = (pos: { x: number; y: number }): void => {
		const items = marked;
		const allDone = items.every((i) => i.task.done);
		new Menu()
			.addItem((i) =>
				i
					.setTitle(`${allDone ? 'Mark as open' : 'Complete'}: ${todos(items.length)}`)
					.setIcon('check')
					.onClick(() => void toggleAll(items)),
			)
			.addItem((i) => i.setTitle('Schedule…').setIcon('calendar').onClick(() => openPicker('schedule')))
			.addItem((i) => i.setTitle('Move to…').setIcon('folder-input').onClick(() => openPicker('move')))
			.addItem((i) => i.setTitle('Clear selection').setIcon('x').onClick(clearMarks))
			.addSeparator()
			.addItem((i) =>
				i
					.setTitle(`Delete ${todos(items.length)}`)
					.setIcon('trash')
					.setWarning(true)
					.onClick(() => void removeAll(items)),
			)
			.showAtPosition(pos);
	};

	const rowMenu = (item: Item, pos: { x: number; y: number }): void => {
		if (marked.length > 1 && marks.has(itemKey(item))) return selectionMenu(pos);
		const menu = new Menu().addItem((i) =>
			i
				.setTitle(item.task.done ? 'Mark as open' : 'Complete')
				.setIcon('check')
				.onClick(() => toggle(item)),
		);
		if (isNested(list) && !item.task.done) {
			if (list.kind === 'inbox' || list.kind === 'project') {
				menu.addItem((i) => i.setTitle('Add sub-task').setIcon('list-plus').onClick(() => addSub(item)));
			}
			if (indentTarget(item)) menu.addItem((i) => i.setTitle('Indent').setIcon('indent-increase').onClick(() => indent(item)));
			if (item.task.parent !== null) {
				menu.addItem((i) => i.setTitle('Outdent').setIcon('indent-decrease').onClick(() => outdent(item)));
			}
		}
		menu
			.addSeparator()
			.addItem((i) => i.setTitle('Schedule…').setIcon('calendar').onClick(() => openPicker('schedule', item)))
			.addItem((i) => i.setTitle('Move to…').setIcon('folder-input').onClick(() => openPicker('move', item)))
			.addItem((i) =>
				i
					.setTitle('Select')
					.setIcon('check-square')
					.onClick(() => {
						clearMarks();
						mark(item, 'toggle');
					}),
			)
			.addSeparator()
			.addItem((i) =>
				i
					.setTitle('Delete')
					.setIcon('trash')
					.setWarning(true)
					.onClick(() => void remove(item)),
			)
			.showAtPosition(pos);
	};

	/**
	 * Today's order is free and saved by Plainlist, within each project when grouped. Elsewhere a to-do moves among its siblings
	 * in its note, within its group (anywhere in a project).
	 */
	const groupOf = new Map(view.groups.flatMap((g) => g.items.map((i) => [i, g.key] as const)));
	const canDrop = (a: Item, b: Item): boolean => {
		if (!groupOf.has(a) || !groupOf.has(b) || a.task.done || b.task.done || a === b) return false;
		if (list.kind === 'today') return !todayByProject || groupOf.get(a) === groupOf.get(b);
		return (
			list.kind !== 'completed' &&
			a.path === b.path &&
			canReorder(a.task, b.task) &&
			(list.kind === 'project' || groupOf.get(a) === groupOf.get(b))
		);
	};

	/** Puts a to-do just before or after another, and keeps it selected. */
	const reorderTo = (item: Item, target: Item, place: Place): void => {
		if (list.kind === 'today') {
			const shown = view.groups.flatMap((g) => g.items.map(todayKey));
			env.todayOrder.set(moveInOrder(shown, todayKey(item), todayKey(target), place));
			setFollow({ path: item.path, ref: refOf(item.task) });
			return;
		}
		relocate(item, (d) => moveTaskNextTo(d, refOf(item.task), refOf(target.task), place));
	};

	const reorder = useReorder<Item>({
		entries: rows.map((item) => ({ key: itemKey(item), item })),
		canDrag: (item) => !item.task.done && list.kind !== 'completed',
		canDrop,
		onDrop: reorderTo,
		onMenu: rowMenu,
		// Not while picking several to-dos, nor on the one being edited.
		canSwipe: (item) => !marks.size && !isBoxed(expanded, item),
		onSwipe: (item, dir, pos) => {
			if (dir === 'right') return toggle(item);
			scheduleMenu(app, { current: item.task.date, today, weekStart: env.weekStart(), onPick: (date) => void scheduleAll([item], date) }).showAtPosition(pos);
		},
	});

	/** The dragged row's sub-tasks move with it, so they look lifted too. */
	const dragged = rows.find((i) => itemKey(i) === reorder.dragging);
	const dragClass = (item: Item): string =>
		dragged && item.path === dragged.path && item.task.line > dragged.task.line && item.task.line < dragged.task.subtreeEnd
			? ' is-dragging'
			: reorder.rowClass(itemKey(item));

	/** Alt+↑/↓: swaps the selected to-do with the closest sibling above or below it. */
	const moveSelected = (item: Item, step: 1 | -1): void => {
		const open = view.groups.flatMap((g) => g.items);
		for (let j = open.indexOf(item) + step; j >= 0 && j < open.length; j += step) {
			const r = open[j];
			if (r && canDrop(item, r)) return reorderTo(item, r, step < 0 ? 'before' : 'after');
		}
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
				void workspace.completeProject(p, today).then((undo) => undo && undoToast('Completed', keepUndo(`Completed ${quoted(p.name)}`, undo)));
			};
			if (!open) return go();
			void env
				.confirm(`Complete “${p.name}”?`, `Its ${open} open to-do${open === 1 ? '' : 's'} will be marked as done too.`, 'Complete', false)
				.then((ok) => ok && go());
		},
		reopen: (p) => void workspace.reopenProject(p),
		move: (p, target, place) => void remember(`Moved ${quoted(p.name)}`, workspace.moveProject(p, target, place)),
		moveToArea: (p, area) => void remember(`Moved ${quoted(p.name)}`, workspace.moveProjectToArea(p, area)),
		chooseArea: (p) => new AreaSuggestModal(app, workspace.areas, (area) => projectActions.moveToArea(p, area)).open(),
		addArea: (name) => void remember(`Added the area ${quoted(name)}`, workspace.addArea(name)),
		renameArea: (area, name) => void remember(`Renamed the area ${quoted(area.name)}`, workspace.renameArea(area, name)),
		moveArea: (area, target, place) => void remember(`Moved the area ${quoted(area.name)}`, workspace.moveArea(area, target, place)),
		removeArea: (area) => {
			void env
				.confirm(`Remove the area “${area.name}”?`, 'Its projects stay in Plainlist, and join the list above it.', 'Remove')
				.then((ok) => ok && void remember(`Removed the area ${quoted(area.name)}`, workspace.removeArea(area)));
		},
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
		/** The selected to-dos, or the highlighted one. */
		const targets = marked.length ? marked : current ? [current] : [];
		if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey && !mod) {
			e.preventDefault();
			if (!expanded && !marked.length && current) moveSelected(current, e.key === 'ArrowDown' ? 1 : -1);
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (expanded || !rows.length) return;
			const step = e.key === 'ArrowDown' ? 1 : -1;
			const next = Math.max(0, Math.min(rows.length - 1, (selected < 0 && step < 0 ? rows.length : selected) + step));
			// Shift extends the selection from where it started; a plain arrow ends it.
			if (e.shiftKey && !mod) markRange(selected < 0 ? next : selected, next);
			else if (marks.size) clearMarks();
			setSelected(next);
		} else if ((e.key === 'z' || e.key === 'Z') && mod && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			if (!expanded) undoLast();
		} else if ((e.key === 'a' || e.key === 'A') && mod && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			if (expanded || !rows.length) return;
			setMarks(new Set(rows.map(itemKey)));
			anchor.current = null;
		} else if (e.key === 'Tab' && !mod && !e.altKey) {
			e.preventDefault();
			if (expanded || marked.length || !current || current.task.done || !isNested(list)) return;
			if (e.shiftKey) outdent(current);
			else indent(current);
		} else if ((e.key === 'Enter' && mod) || (e.key === ' ' && !mod)) {
			e.preventDefault();
			if (targets.length) void toggleAll(targets);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			clearMarks();
			if (expanded) setExpanded(null);
			else if (current) setExpanded({ current: { path: current.path, ref: refOf(current.task) } });
		} else if (e.key === 'Escape') {
			if (expanded) {
				e.preventDefault();
				setExpanded(null);
			} else if (marks.size) {
				e.preventDefault();
				clearMarks();
			}
		} else if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			if (targets.length) void removeAll(targets);
		} else if ((e.key === 'n' || e.key === 'N') && !mod && !e.altKey) {
			e.preventDefault();
			env.openCapture(list);
		}
	};

	// Pasting a list (`- [ ] …`, `- …`, `[ ] …`) adds each item as a to-do in this list.
	const onPaste = (e: ClipboardEvent): void => {
		const target = e.target as HTMLElement | null;
		if (target?.closest('input, textarea, [contenteditable="true"], .pl-popover')) return;
		const tasks = pastedTasks(e.clipboardData?.getData('text/plain') ?? '');
		if (!tasks) return;
		e.preventDefault();
		const date = list.kind === 'today' ? today : list.kind === 'someday' ? 'someday' : null;
		const dated = tasks.map((t) => ({ ...t, date: t.date ?? date }));
		void remember(`Pasted ${todos(dated.length)}`, workspace.addTasks(list.kind === 'project' ? list.path : null, dated)).then((res) => {
			if (res.ok) new Notice(`Added ${dated.length} to-do${dated.length === 1 ? '' : 's'}`);
		});
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
					onDiscard={
						fresh.current === expanded
							? () => {
									const box = expanded;
									fresh.current = null;
									void workspace.run(box.current.path, (d) => deleteTask(d, box.current.ref).edits);
								}
							: undefined
					}
				/>
			);
		}
		const m = meta(list, item, today, todayByProject);
		return (
			<TaskRow
				key={itemKey(item)}
				item={item}
				meta={m.text}
				metaClass={m.cls}
				selected={rows[selected] === item}
				marked={marks.has(itemKey(item))}
				tapSelects={tapSelects}
				reveal={isAt(revealed, item)}
				leaving={item.task.done && lingering.get(lingerKey(item.path, item.task.line)) === true}
				drag={{ props: reorder.rowProps(itemKey(item)), cls: dragClass(item) }}
				actions={rowActions}
			/>
		);
	};

	const pickList = (evt: MouseEvent): void => {
		const menu = new Menu();
		for (const { id, label } of LISTS) menu.addItem((i) => i.setTitle(label).setChecked(sameList(id, list)).onClick(() => setList(id)));
		const addProjectItem = (p: ProjectInfo): void => {
			const id: ListId = { kind: 'project', path: p.path };
			menu.addItem((i) =>
				i
					.setTitle(p.done ? `${p.name} (completed)` : p.name)
					.setChecked(sameList(id, list))
					.onClick(() => setList(id)),
			);
		};
		// Same order as the sidebar: projects outside any area, then each area's under its name, then completed ones.
		const open = projects.filter((x) => !x.done);
		const inArea = (a: Area | null) => open.filter((p) => (p.area?.line ?? null) === (a?.line ?? null));
		if (inArea(null).length) {
			menu.addSeparator();
			inArea(null).forEach(addProjectItem);
		}
		for (const a of workspace.areas) {
			menu.addSeparator();
			// Tapping an area's name offers what right-clicking it does in the sidebar.
			menu.addItem((i) =>
				i
					.setTitle(a.name)
					.setIcon('folder')
					.onClick((e) =>
						areaMenu(a, workspace.areas, projectActions, () => {
							void env.prompt('Rename area', 'Area name', a.name, 'Rename').then((name) => {
								const next = name?.trim();
								if (next && next !== a.name) projectActions.renameArea(a, next);
							});
						}).showAtMouseEvent(e instanceof MouseEvent ? e : evt),
					),
			);
			inArea(a).forEach(addProjectItem);
		}
		if (projects.some((x) => x.done)) {
			menu.addSeparator();
			projects.filter((x) => x.done).forEach(addProjectItem);
		}
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('New project').setIcon('plus').onClick(addProject));
		menu.addItem((i) =>
			i
				.setTitle('New area')
				.setIcon('folder-plus')
				.onClick(() => void env.prompt('New area', 'Area name', '', 'Add').then((name) => name?.trim() && projectActions.addArea(name.trim()))),
		);
		menu.showAtMouseEvent(evt);
	};

	const hint = env.hint();

	return (
		<div ref={root} class={`pl-root${narrow ? ' is-narrow' : ''}${marked.length ? ' has-selection' : ''}`} tabIndex={-1} onKeyDown={onKeyDown} onPaste={onPaste}>
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
								projectMenu(
									p,
									projectActions,
									() => {
										void env.prompt('Rename project', 'Project name', p.name, 'Rename').then((name) => name && projectActions.rename(p, name));
									},
									workspace.areas.length > 0,
								).showAtMouseEvent(e);
							}}
						>
							•••
						</button>
					)}
				</div>
			) : (
				<>
					{!sidebar.hidden && (
						<Sidebar
							list={list}
							counts={counts}
							projects={projects}
							areas={workspace.areas}
							masterPath={workspace.masterPath}
							onSelect={setList}
							actions={projectActions}
						/>
					)}
					<SidebarHandle
						layout={sidebar}
						onChange={(layout, done) => {
							setSidebar(layout);
							if (done) env.sidebar.save(layout);
						}}
					/>
				</>
			)}
			<main
				class="pl-main"
				onMouseDown={(e) => {
					if (e.target === e.currentTarget) root.current?.focus({ preventScroll: true });
				}}
			>
				<div class="pl-content" {...reorder.scopeProps}>
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

					{marked.length > 0 && (
						<BulkBar
							items={marked}
							picker={picker}
							projects={projects}
							today={today}
							onPicker={(p) => {
								setPicker(p);
								if (!p) refocus();
							}}
							onToggle={() => void toggleAll(marked)}
							onSchedule={(date) => void scheduleAll(marked, date)}
							onMove={(path, heading) => void moveAll(marked, path, heading)}
							onDelete={() => void removeAll(marked)}
							onClear={() => {
								clearMarks();
								refocus();
							}}
						/>
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
					{toast.undo && (
						<>
							<span class="pl-toast-sep" aria-hidden="true">·</span>
							<button
								type="button"
								onClick={() => {
									toast.undo?.();
									setToast(null);
								}}
							>
								Undo
							</button>
						</>
					)}
				</div>
			)}
		</div>
	);
}

/** The actions for the selected to-dos, at the bottom of the list. */
function BulkBar({
	items,
	picker,
	projects,
	today,
	onPicker,
	onToggle,
	onSchedule,
	onMove,
	onDelete,
	onClear,
}: {
	items: Item[];
	picker: SelectionCommand | null;
	projects: ProjectInfo[];
	today: string;
	onPicker: (picker: SelectionCommand | null) => void;
	onToggle: () => void;
	onSchedule: (date: TaskDate | null) => void;
	onMove: (projectPath: string | null, heading: { line: number; text: string } | null) => void;
	onDelete: () => void;
	onClear: () => void;
}) {
	const { workspace, weekStart } = useEnv();
	const allDone = items.every((i) => i.task.done);
	const first = items[0];
	const oneProject = first && items.every((i) => i.project?.path === first.project?.path) ? (first.project?.path ?? null) : undefined;
	const headingLine = first?.task.heading?.line ?? null;
	const sharedHeading = oneProject !== undefined && items.every((i) => (i.task.heading?.line ?? null) === headingLine) ? headingLine : undefined;
	const choices = projects
		.filter((p) => p.exists && !p.done)
		.map((p) => ({ name: p.name, path: p.path, headings: workspace.doc(p.path)?.headings }));

	return (
		<div class="pl-bulk" role="toolbar" aria-label="Selected to-dos">
			<span class="pl-bulk-count">{items.length} selected</span>
			<button type="button" onClick={onToggle}>
				{allDone ? 'Mark as open' : 'Complete'}
			</button>
			<span class="pl-bulk-anchor">
				<button type="button" aria-haspopup="dialog" aria-expanded={picker === 'schedule'} onClick={() => onPicker(picker === 'schedule' ? null : 'schedule')}>
					Schedule
				</button>
				{picker === 'schedule' && <DatePopover today={today} weekStart={weekStart()} onClose={() => onPicker(null)} onPick={onSchedule} />}
			</span>
			<span class="pl-bulk-anchor">
				<button type="button" aria-haspopup="listbox" aria-expanded={picker === 'move'} onClick={() => onPicker(picker === 'move' ? null : 'move')}>
					Move
				</button>
				{picker === 'move' && (
					<ProjectPicker
						projects={choices}
						current={oneProject ?? null}
						// Marks where they all are, if that's one place; -1 matches no heading.
						currentHeading={sharedHeading === undefined ? -1 : sharedHeading}
						onClose={() => onPicker(null)}
						onPick={onMove}
					/>
				)}
			</span>
			<button type="button" class="mod-warning" onClick={onDelete}>
				Delete
			</button>
			<button type="button" class="pl-bulk-clear clickable-icon" aria-label="Clear selection" onClick={onClear}>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M4 4l8 8M12 4l-8 8" />
				</svg>
			</button>
		</div>
	);
}
