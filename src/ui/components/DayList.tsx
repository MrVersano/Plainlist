import { Keymap, Menu, Scope } from 'obsidian';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { headerDate, overdueLabel } from '../../dates/format';
import { computeDay, isOverdue, moveInOrder, placeLabel, todayKey, type Item } from '../../model/lists';
import { deleteTask, refOf, restoreLines, setTaskDone, type Place, type Removed } from '../../model/patch';
import { locateLine, type TaskRef, type TrackBox } from '../../store';
import { useEnv, useToday, useWorkspace } from '../env';
import { themeCheckboxRadius } from '../obsidian';
import { useReorder } from '../reorder';
import { TaskEditor, TaskRow, type RowActions } from './TaskRow';

const isAt = (at: TaskRef | null, item: Item): boolean =>
	!!at && at.path === item.path && at.ref.line === item.task.line && at.ref.text === item.task.text;

const itemKey = (item: Item): string => `${item.path}:${item.task.line}:${item.task.text}`;

/** One key per expansion, so opening another to-do mounts a fresh editor. */
let nextExpansionId = 0;

interface Toast {
	message: string;
	undo: () => void;
}

/**
 * One day's to-dos inside a note: Today when `date` is null, otherwise that day. Completed
 * to-dos stay, crossed off. Clicking a row selects it and hands the keyboard to the list, with
 * the view's keys; Escape gives it back to the note.
 */
export function DayList({ date, onAdd, onExit }: { date: string | null; onAdd: (day: string) => void; onExit: () => void }) {
	const env = useEnv();
	const { workspace, clock, app } = env;
	const version = useWorkspace(workspace);
	const today = useToday(clock);
	const day = date ?? today;
	const [expanded, setExpanded] = useState<{ box: TrackBox; id: number } | null>(null);
	const [toast, setToast] = useState<Toast | null>(null);
	/** Re-renders after the saved Today order changes, here, in the view or in another note. */
	const [orderVersion, setOrderVersion] = useState(0);
	useEffect(() => env.todayOrder.subscribe(() => setOrderVersion((v) => v + 1)), []);
	/** The selected row, only while the list has the keyboard. */
	const [selected, setSelected] = useState(-1);
	/** A to-do that was just reordered, until it is selected again. */
	const [follow, setFollow] = useState<TaskRef | null>(null);
	const root = useRef<HTMLDivElement>(null);

	const sources = useMemo(() => workspace.sources(), [version]);
	const projects = workspace.projects;
	const rows = useMemo(
		() => computeDay(sources, projects, day, today, env.todayOrder.get()),
		[sources, day, today, orderVersion],
	);

	useLayoutEffect(() => {
		const el = root.current;
		if (el) el.setCssProps({ '--pl-check-radius': themeCheckboxRadius(el.ownerDocument) });
	}, []);

	/** Mod+Enter while the list has the keyboard; set below, where the rows are known. */
	const modEnter = useRef<(e: KeyboardEvent) => boolean>(() => true);

	useEffect(() => {
		const el = root.current;
		if (!el) return;
		// In a note, Mod+Enter is the editor's "Open link in new tab" hotkey, which runs before
		// the list sees the key. A scope of our own takes it first while the list has focus.
		const scope = new Scope(app.scope);
		scope.register(['Mod'], 'Enter', (e) => modEnter.current(e));
		let pushed = false;
		const onFocusIn = (): void => {
			if (pushed) return;
			app.keymap.pushScope(scope);
			pushed = true;
		};
		const onFocusOut = (e: FocusEvent): void => {
			const to = e.relatedTarget as HTMLElement | null;
			if (pushed && !(to && el.contains(to))) {
				app.keymap.popScope(scope);
				pushed = false;
			}
			// Clicking back into the note (or anywhere else) ends keyboard use of the list. Menus
			// and dialogs it opens don't, nor does losing focus to nothing: a row re-rendering, or
			// the window going to the background.
			if (!to || el.contains(to) || to.closest('.menu, .modal-container, .pl-popover')) return;
			setSelected(-1);
		};
		el.addEventListener('focusin', onFocusIn);
		el.addEventListener('focusout', onFocusOut);
		return () => {
			el.removeEventListener('focusin', onFocusIn);
			el.removeEventListener('focusout', onFocusOut);
			if (pushed) app.keymap.popScope(scope);
		};
	}, []);

	useLayoutEffect(() => {
		if (!follow) return;
		const at = rows.findIndex((i) => isAt(follow, i));
		if (at !== -1) setSelected(at);
		setFollow(null);
	}, [follow]);

	useEffect(() => {
		if (!toast) return;
		const timer = window.setTimeout(() => setToast(null), 5000);
		return () => window.clearTimeout(timer);
	}, [toast]);

	// Keep the open row attached to its to-do when its note changes elsewhere.
	const box = expanded?.box ?? null;
	if (box) {
		const doc = workspace.doc(box.current.path);
		const { ref } = box.current;
		if (doc && doc.lines[ref.line] !== ref.text) {
			const line = locateLine(doc, ref);
			if (line !== null) box.current = { path: box.current.path, ref: { line, text: ref.text } };
		}
	}
	const expandedVisible = rows.some((i) => isAt(box?.current ?? null, i));
	useEffect(() => {
		if (expanded && !expandedVisible) setExpanded(null);
	}, [expanded, expandedVisible]);

	const toggle = (item: Item): void => {
		const tracked = isAt(box?.current ?? null, item) ? (box ?? undefined) : undefined;
		void workspace.run(item.path, (d) => setTaskDone(d, tracked ? tracked.current.ref : refOf(item.task), !item.task.done, today), tracked);
	};

	const remove = async (item: Item): Promise<void> => {
		const holder: { removed: Removed | null } = { removed: null };
		if (isAt(box?.current ?? null, item)) setExpanded(null);
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

	const focusList = (): void => root.current?.focus({ preventScroll: true });

	const expand = (item: Item): void => {
		setSelected(rows.indexOf(item));
		setExpanded({ box: { current: { path: item.path, ref: refOf(item.task) } }, id: nextExpansionId++ });
	};

	// Give the list the keyboard back after a row collapses.
	const collapse = (): void => {
		setExpanded(null);
		window.requestAnimationFrame(() => {
			const doc = root.current?.ownerDocument;
			if (doc && (!root.current?.contains(doc.activeElement) || doc.activeElement === doc.body)) focusList();
		});
	};

	const rowActions: RowActions = {
		onToggle: toggle,
		onExpand: expand,
		onSelect: (item) => {
			setSelected(rows.indexOf(item));
			focusList();
		},
	};

	const rowMenu = (item: Item, pos: { x: number; y: number }): void => {
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
	};

	// Dragging sets Today's order, shared with the Today list, so only today's list can.
	const reorderable = day === today;
	const canDrop = (a: Item, b: Item): boolean => reorderable && a !== b && !a.task.done && !b.task.done;
	const reorderTo = (item: Item, target: Item, place: Place): void => {
		env.todayOrder.set(moveInOrder(rows.map(todayKey), todayKey(item), todayKey(target), place));
		setFollow({ path: item.path, ref: refOf(item.task) });
	};
	const reorder = useReorder<Item>({
		entries: rows.map((item) => ({ key: itemKey(item), item })),
		canDrag: (item) => reorderable && !item.task.done,
		canDrop,
		onDrop: reorderTo,
		onMenu: rowMenu,
	});

	/** Alt+↑/↓: swaps the selected to-do with the closest one above or below it that it can pass. */
	const moveSelected = (item: Item, step: 1 | -1): void => {
		for (let j = rows.indexOf(item) + step; j >= 0 && j < rows.length; j += step) {
			const r = rows[j];
			if (r && canDrop(item, r)) return reorderTo(item, r, step < 0 ? 'before' : 'after');
		}
	};

	modEnter.current = (e) => {
		// In the editor's fields it is left to the editor, as in the view.
		if ((e.target as HTMLElement | null)?.closest('input, textarea, .pl-editor-desc, .pl-popover')) return true;
		const current = rows[selected];
		if (current && !expanded) toggle(current);
		return false;
	};

	// The view's keys, while the list has the keyboard. Handled keys stop here, so the note's
	// editor doesn't act on them too.
	const onKeyDown = (e: KeyboardEvent): void => {
		const target = e.target as HTMLElement | null;
		if (e.isComposing || target?.closest('input, textarea, .pl-editor-desc, .pl-popover')) return;
		const mod = Keymap.isModEvent(e) === true || e.metaKey || e.ctrlKey;
		const current = rows[selected];
		const handled = (): void => {
			e.preventDefault();
			e.stopPropagation();
		};
		if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey && !mod) {
			handled();
			if (!expanded && current) moveSelected(current, e.key === 'ArrowDown' ? 1 : -1);
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			handled();
			if (expanded) return;
			const step = e.key === 'ArrowDown' ? 1 : -1;
			setSelected(Math.max(0, Math.min(rows.length - 1, (selected < 0 && step < 0 ? rows.length : selected) + step)));
		} else if (e.key === 'Enter' && mod) {
			handled();
			if (current) toggle(current);
		} else if (e.key === 'Enter') {
			handled();
			if (expanded) collapse();
			else if (current) expand(current);
		} else if (e.key === 'Escape') {
			handled();
			if (expanded) return collapse();
			setSelected(-1);
			onExit();
		} else if (e.key === ' ' && !mod) {
			handled();
			if (current) toggle(current);
		} else if (e.key === 'Backspace' || e.key === 'Delete') {
			handled();
			if (current) void remove(current);
		} else if ((e.key === 'n' || e.key === 'N') && !mod && !e.altKey) {
			handled();
			if (day >= today) onAdd(day);
		}
	};

	const meta = (item: Item): { text: string; cls?: string } =>
		isOverdue(item.task, today) ? { text: overdueLabel(item.task.date ?? today, today), cls: 'is-overdue' } : { text: placeLabel(item) };

	const renderRow = (item: Item) => {
		if (expanded && isAt(expanded.box.current, item)) {
			return (
				<TaskEditor
					key={`expanded-${expanded.id}`}
					item={item}
					box={expanded.box}
					projects={projects.filter((p) => !p.done)}
					today={today}
					onCollapse={collapse}
					onToggle={() => toggle(item)}
				/>
			);
		}
		const m = meta(item);
		return (
			<TaskRow
				key={itemKey(item)}
				item={item}
				meta={m.text}
				metaClass={m.cls}
				selected={rows[selected] === item}
				drag={{ props: reorder.rowProps(itemKey(item)), cls: reorder.rowClass(itemKey(item)) }}
				actions={rowActions}
			/>
		);
	};

	const past = day < today;
	const empty = day === today ? 'Nothing for today.' : past ? 'Nothing completed this day.' : 'Nothing planned for this day.';

	return (
		<div ref={root} class="pl-root pl-embed" tabIndex={-1} onKeyDown={onKeyDown}>
			<div class="pl-content" {...reorder.scopeProps}>
				<header class="pl-header">
					<span class="pl-title">{day === today ? 'Today' : headerDate(day)}</span>
					<span class="pl-header-date">{day === today ? headerDate(today) : past ? 'Completed' : 'Planned'}</span>
				</header>
				{rows.length ? <div class="pl-rows">{rows.map(renderRow)}</div> : <p class="pl-empty">{empty}</p>}
				{!past && (
					<button type="button" class="pl-add-mobile" onClick={() => onAdd(day)}>
						New to-do
					</button>
				)}
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
		</div>
	);
}
