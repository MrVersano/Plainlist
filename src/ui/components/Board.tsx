import { Notice } from 'obsidian';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { metaDate } from '../../dates/format';
import {
	cleanColumnName,
	columnNameError,
	columnOf,
	enterColumn,
	headingBoard,
	moveCard,
	moveColumn,
	renameColumn,
	setColumnFlag,
	statusBoard,
	type BoardColumn,
	type CardPlace,
	type ColumnDef,
	type GroupBy,
} from '../../model/board';
import type { Item, ProjectInfo } from '../../model/lists';
import { refOf, sectionSiblings } from '../../model/patch';
import type { Heading } from '../../model/types';
import type { RunResult, TaskRef, TrackBox } from '../../store';
import { quoted } from '../../undo';
import type { Boards } from '../../boards';
import { useBoardDrag, type CardDrop } from '../boardDrag';
import { useEnv, useOutsideClick, type Env } from '../env';
import { Checkbox, Title } from './bits';
import { NameInput } from './Sidebar';

/** What the view's keyboard and commands reach in the board. */
export interface BoardHandle {
	/** Handles a key pressed in the view; false when it isn't the board's. */
	keyDown: (e: KeyboardEvent) => boolean;
	/** Moves a card (the selected one by default) one column left or right. */
	shift: (step: 1 | -1, item?: Item) => void;
}

const cardKey = (item: Item): string => `${item.path}:${item.task.line}:${item.task.text}`;

const isAt = (at: TaskRef | null, item: Item): boolean =>
	!!at && at.path === item.path && at.ref.line === item.task.line && at.ref.text === item.task.text;

/** The same to-do, though perhaps from another list's computation. */
const same = (a: Item, b: Item): boolean => cardKey(a) === cardKey(b);

/** The column a card is in, or -1. */
const columnIndexOf = (columns: BoardColumn[], item: Item): number =>
	columns.findIndex((c) => c.cards.some((i) => same(i, item)) || c.older.some((i) => same(i, item)));

/** A board's columns, by status (from the project's column settings) or by heading. */
export function boardColumns(boards: Boards, path: string, groupBy: GroupBy, items: Item[], env: Env, today: string): BoardColumn[] {
	const doc = env.workspace.doc(path);
	const days = boards.settings.doneDays;
	if (groupBy === 'heading') return doc ? headingBoard(items, doc, today, days) : [];
	return statusBoard(items, boards.columns(path), today, days);
}

/**
 * Moves a card one column left or right, keeping its place in the note when grouped by status,
 * or to the end of the next section when grouped by heading. Resolves to the column's name and
 * where the to-do ended up, or null when it was already in the first or last column.
 */
export async function shiftCard(
	env: Env,
	boards: Boards,
	groupBy: GroupBy,
	columns: BoardColumn[],
	item: Item,
	step: 1 | -1,
	today: string,
): Promise<{ name: string; at: TaskRef | null } | null> {
	const from = columnIndexOf(columns, item);
	const to = columns[from + step];
	if (from === -1 || !to) return null;
	const at = await moveTo(env, boards, groupBy, item, from, to, null, today, `Moved ${quoted(item.task.title)} to ${to.name}`);
	return { name: to.name, at };
}

/** Moves a card to a column, next to `place` in the note when given. Resolves to where it ended up. */
async function moveTo(
	env: Env,
	boards: Boards,
	groupBy: GroupBy,
	item: Item,
	from: number,
	to: BoardColumn,
	place: CardPlace,
	today: string,
	label: string,
): Promise<TaskRef | null> {
	const { workspace } = env;
	const landed: { at: TaskRef | null } = { at: null };
	let res: RunResult;
	if (groupBy === 'status') {
		const columns = boards.columns(item.path);
		const change = from === to.index ? {} : enterColumn(columns, from, to.index, item.task.done);
		res = await workspace.run(item.path, (d) => {
			const r = moveCard(d, refOf(item.task), { ...change, to: place, today, weekStart: env.weekStart() });
			landed.at = { path: item.path, ref: r.landed };
			return r.edits;
		});
	} else {
		const heading = to.heading ? refOf(to.heading) : null;
		res = await workspace.run(item.path, (d) => {
			const r = moveCard(d, refOf(item.task), { to: place ?? { heading }, today, weekStart: env.weekStart() });
			landed.at = { path: item.path, ref: r.landed };
			return r.edits;
		});
	}
	workspace.remember(label, res);
	return res.ok ? landed.at : null;
}

export function Board({
	project,
	groupBy,
	items,
	today,
	expanded,
	renderEditor,
	onExpand,
	onToggle,
	onDelete,
	onMenu,
	onUndo,
	toast,
	handle,
}: {
	project: ProjectInfo;
	groupBy: GroupBy;
	/** The project's to-dos. */
	items: Item[];
	today: string;
	expanded: TrackBox | null;
	renderEditor: (item: Item) => JSX.Element;
	onExpand: (item: Item) => void;
	onToggle: (item: Item) => void;
	onDelete: (item: Item) => void;
	onMenu: (item: Item, pos: { x: number; y: number }) => void;
	onUndo: () => void;
	toast: (message: string) => void;
	handle: { current: BoardHandle | null };
}) {
	const env = useEnv();
	const { workspace } = env;
	const boards = env.boards!;
	const path = project.path;
	const columns = boardColumns(boards, path, groupBy, items, env, today);
	const defs = boards.columns(path);
	const doc = workspace.doc(path);
	/** Columns showing their older completed cards. */
	const [older, setOlder] = useState<ReadonlySet<string>>(new Set());
	const [sel, setSel] = useState<{ col: number; row: number } | null>(null);
	const [follow, setFollow] = useState<TaskRef | null>(null);
	const [popover, setPopover] = useState<number | null>(null);
	const [adding, setAdding] = useState(false);
	const editable = project.exists && !project.done;

	const shown = (c: BoardColumn): Item[] => (older.has(c.key) ? [...c.cards, ...c.older] : c.cards);
	const selected = sel ? shown(columns[sel.col] ?? columns[0]!)?.[sel.row] : undefined;
	const isExpanded = (item: Item): boolean => isAt(expanded?.current ?? null, item);

	// Keep the selection on the same card after a move, or in range after the board changes.
	useLayoutEffect(() => {
		if (!follow) return;
		for (const [c, col] of columns.entries()) {
			const row = shown(col).findIndex((i) => isAt(follow, i));
			if (row !== -1) {
				setSel({ col: c, row });
				break;
			}
		}
		setFollow(null);
	}, [follow]);
	useEffect(() => {
		if (!sel) return;
		const col = columns[sel.col];
		if (!col) setSel(columns.length ? { col: columns.length - 1, row: 0 } : null);
		else if (sel.row >= shown(col).length && sel.row > 0) setSel({ col: sel.col, row: Math.max(0, shown(col).length - 1) });
	});

	// --- Cards -------------------------------------------------------------------

	/** Where a card dropped before `before` (or at the end of `col`) goes in the note, or null to keep its line. */
	const placeFor = (item: Item, col: BoardColumn, before: Item | null): CardPlace => {
		const rest = shown(col).filter((i) => i !== item);
		const target = before ?? rest[rest.length - 1] ?? null;
		const place = before ? 'before' : 'after';
		if (groupBy === 'heading') return target ? { target: refOf(target.task), place } : { heading: col.heading ? refOf(col.heading) : null };
		// By status, a card keeps its section: it goes next to a card under the same heading, or stays.
		if (!target || (target.task.heading?.line ?? null) !== (item.task.heading?.line ?? null)) return null;
		return { target: refOf(target.task), place };
	};

	const dropCard = (key: string, drop: CardDrop): void => {
		const all = columns.flatMap((c) => shown(c));
		const item = all.find((i) => cardKey(i) === key);
		const col = columns[drop.col];
		if (!item || !col) return;
		const from = columnIndexOf(columns, item);
		const before = drop.before ? (all.find((i) => cardKey(i) === drop.before) ?? null) : null;
		const place = placeFor(item, col, before);
		if (from === drop.col && !place) return;
		void moveTo(env, boards, groupBy, item, from, col, place, today, `Moved ${quoted(item.task.title)}`).then((at) => at && setFollow(at));
	};

	const shift = (step: 1 | -1, item = selected): void => {
		if (!item || isExpanded(item)) return;
		void shiftCard(env, boards, groupBy, columns, item, step, today).then((r) => {
			if (!r) return;
			toast(`Moved to ${r.name}`);
			if (r.at) setFollow(r.at);
		});
	};

	// --- Columns -----------------------------------------------------------------

	const headingOf = (c: BoardColumn): Heading | null => {
		const h = c.heading;
		return h ? (doc?.headings.find((x) => x.line === h.line && x.text === h.text) ?? null) : null;
	};
	/** By heading, a section can only trade places with sections at its level in the same section. */
	const canSwap = (a: BoardColumn, b: BoardColumn | undefined): boolean => {
		const ha = headingOf(a);
		const hb = b && headingOf(b);
		return !!doc && !!ha && !!hb && sectionSiblings(doc, ha).includes(hb);
	};

	const saveColumns = (next: ColumnDef[]): void => boards.setColumns(path, next);

	const renameCol = (c: BoardColumn, name: string): void => {
		const clean = cleanColumnName(name);
		if (!clean || clean === c.name) return;
		if (groupBy === 'heading') {
			const h = headingOf(c);
			if (h) void workspace.renameSection(path, h, clean).then((r) => workspace.remember(`Renamed the section ${quoted(h.name)}`, r));
			return;
		}
		const error = columnNameError(defs, clean, c.index);
		if (error) {
			new Notice(error);
			return;
		}
		const old = c.name;
		void boards.hold(
			path,
			workspace.run(path, (d) => renameColumn(d, old, clean)).then((r) => workspace.remember(`Renamed the column ${quoted(old)}`, r)),
		);
		saveColumns(defs.map((d, i) => (i === c.index ? { ...d, name: clean } : d)));
	};

	const deleteCol = (c: BoardColumn): void => {
		setPopover(null);
		if (groupBy === 'heading') {
			const h = headingOf(c);
			if (!h) return;
			void env
				.confirm(`Delete the column “${c.name}”?`, `This removes the heading “${h.name}” from the note. Its to-dos stay, under the section above.`, 'Delete')
				.then((ok) => ok && void workspace.removeSection(path, h).then((r) => workspace.remember(`Removed the section ${quoted(h.name)}`, r)));
			return;
		}
		if (defs.length <= 1) {
			new Notice('A board needs at least one column.');
			return;
		}
		const count = c.cards.length + c.older.length;
		const first = defs[c.index === 0 ? 1 : 0]?.name ?? '';
		void env
			.confirm(
				`Delete the column “${c.name}”?`,
				count ? `Its ${count} to-do${count === 1 ? '' : 's'} will move to “${first}”.` : 'It has no to-dos.',
				'Delete',
			)
			.then((ok) => {
				if (!ok) return;
				void boards.hold(
					path,
					workspace.run(path, (d) => renameColumn(d, c.name, null)).then((r) => workspace.remember(`Deleted the column ${quoted(c.name)}`, r)),
				);
				saveColumns(defs.filter((_, i) => i !== c.index));
			});
	};

	/** Moves column `from` to just before column `before` (the column count: to the end). */
	const moveCol = (from: number, before: number): void => {
		const a = columns[from];
		if (!a) return;
		if (groupBy === 'heading') {
			const ha = headingOf(a);
			const target = before > from ? columns[before - 1] : columns[before];
			const hb = target && headingOf(target);
			if (!ha || !hb || !canSwap(a, target)) return;
			void workspace.moveSection(path, ha, hb, before > from ? 'after' : 'before').then((r) => workspace.remember(`Moved the section ${quoted(ha.name)}`, r));
			return;
		}
		saveColumns(moveColumn(defs, from, before > from ? before - 1 : before));
	};

	const addColumn = (name: string | null): void => {
		setAdding(false);
		const clean = name ? cleanColumnName(name) : '';
		if (!clean) return;
		if (groupBy === 'heading') {
			void workspace.addSection(path, clean).then((r) => workspace.remember(`Added the section ${quoted(clean)}`, r));
			return;
		}
		const error = columnNameError(defs, clean);
		if (error) new Notice(error);
		else saveColumns([...defs, { name: clean }]);
	};

	const addTo = (c: BoardColumn): void => {
		const list = { kind: 'project' as const, path };
		if (groupBy === 'heading') env.openCapture(list, c.heading ? refOf(c.heading) : null);
		else env.openCapture(list, null, c.def && !c.def.checkOnEnter ? (c.index === 0 ? null : c.def.name) : null);
	};
	const canAdd = (c: BoardColumn): boolean => editable && !c.def?.checkOnEnter;

	const drag = useBoardDrag({
		canDragCard: (key) => {
			const item = columns.flatMap((c) => shown(c)).find((i) => cardKey(i) === key);
			return editable && !!item && !isExpanded(item);
		},
		canDragColumn: (index) => {
			const c = columns[index];
			if (!editable || !c) return false;
			return groupBy === 'status' ? columns.length > 1 : canSwap(c, columns[index - 1]) || canSwap(c, columns[index + 1]);
		},
		canDropColumn: (from, before) => {
			const a = columns[from];
			if (!a) return false;
			if (groupBy === 'status') return true;
			return canSwap(a, before > from ? columns[before - 1] : columns[before]);
		},
		onDropCard: dropCard,
		onDropColumn: moveCol,
		onCardMenu: (key, pos) => {
			const item = columns.flatMap((c) => shown(c)).find((i) => cardKey(i) === key);
			if (item) onMenu(item, pos);
		},
	});

	// --- Keyboard ------------------------------------------------------------------

	const keyDown = (e: KeyboardEvent): boolean => {
		const mod = e.metaKey || e.ctrlKey;
		const at = sel ?? (columns.length ? { col: 0, row: -1 } : null);
		const col = at ? columns[at.col] : undefined;
		if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && mod && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			shift(e.key === 'ArrowRight' ? 1 : -1);
		} else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !mod && !e.altKey) {
			e.preventDefault();
			if (expanded || !at || !col) return true;
			const n = shown(col).length;
			if (!n) return true;
			const row = e.key === 'ArrowDown' ? Math.min(n - 1, at.row + 1) : at.row < 0 ? n - 1 : Math.max(0, at.row - 1);
			setSel({ col: at.col, row });
		} else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !mod && !e.altKey) {
			e.preventDefault();
			if (expanded || !at) return true;
			const c = Math.max(0, Math.min(columns.length - 1, at.col + (e.key === 'ArrowRight' ? 1 : -1)));
			const n = shown(columns[c]!).length;
			setSel({ col: c, row: n ? Math.min(Math.max(at.row, 0), n - 1) : 0 });
		} else if ((e.key === 'Enter' && mod) || (e.key === ' ' && !mod)) {
			e.preventDefault();
			if (selected) onToggle(selected);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (selected && !expanded) onExpand(selected);
		} else if (e.key === 'Escape') {
			if (popover !== null) setPopover(null);
			else if (sel) setSel(null);
			else return false;
			e.preventDefault();
		} else if ((e.key === 'z' || e.key === 'Z') && mod && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			if (!expanded) onUndo();
		} else if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			if (selected) onDelete(selected);
		} else if ((e.key === 'n' || e.key === 'N') && !mod && !e.altKey) {
			e.preventDefault();
			const c = (col && canAdd(col) ? col : columns.find(canAdd)) ?? null;
			if (c) addTo(c);
		} else {
			return false;
		}
		return true;
	};
	handle.current = { keyDown, shift };

	// --- Rendering -----------------------------------------------------------------

	const renderCard = (item: Item, c: BoardColumn, row: number) => {
		if (isExpanded(item)) return <div class="pl-card-editor">{renderEditor(item)}</div>;
		const key = cardKey(item);
		const { task } = item;
		const unknown = groupBy === 'status' ? columnOf(defs, task).unknown : null;
		const isSel = sel?.col === c.index && sel.row === row;
		const dragging = drag.dragging?.kind === 'card' && drag.dragging.key === key;
		const dropBefore = drag.dragging?.kind === 'card' && drag.cardDrop?.col === c.index && drag.cardDrop.before === key;
		const date = task.date ? metaDate(task.date, today) : null;
		const heading = groupBy === 'status' ? task.heading?.name : null;
		return (
			<Card
				key={key}
				selected={isSel}
				cls={`pl-card${task.done ? ' is-done' : ''}${isSel ? ' is-selected' : ''}${dragging ? ' is-lifted' : ''}${dropBefore ? ' is-drop-before' : ''}`}
				props={drag.cardProps(key)}
				onClick={(e) => {
					if (!(e.target as HTMLElement).closest('button, a, .pl-tag, .pl-link')) {
						setSel({ col: c.index, row });
					}
				}}
			>
				<Checkbox done={task.done} title={task.title} onToggle={() => onToggle(item)} />
				<div class="pl-card-body">
					<button
						type="button"
						class="pl-card-title"
						onClick={() => {
							setSel({ col: c.index, row });
							onExpand(item);
						}}
					>
						{task.title ? <Title text={task.title} sourcePath={item.path} /> : <span class="pl-untitled">New to-do</span>}
					</button>
					{(date || heading || (task.repeat && !task.done) || unknown) && (
						<div class="pl-card-meta">
							{date && <span class={task.date === today && !task.done ? 'is-today' : ''}>{date}</span>}
							{heading && <span>{heading}</span>}
							{task.repeat && !task.done && <span>Repeats</span>}
							{unknown && <span class="pl-card-unknown">unknown column: {unknown}</span>}
						</div>
					)}
				</div>
			</Card>
		);
	};

	const columnDrop = drag.dragging?.kind === 'column' ? drag.columnDrop : null;

	return (
		<div class={`pl-board${drag.dragging ? ' is-dragging' : ''}`} data-board="">
			{columns.map((c) => {
				const cards = shown(c);
				const lifted = drag.dragging?.kind === 'column' && drag.dragging.index === c.index;
				const dropEnd = drag.dragging?.kind === 'card' && drag.cardDrop?.col === c.index && drag.cardDrop.before === null;
				const settings = groupBy === 'status' || !!c.heading;
				return (
					<section
						key={c.key}
						class={`pl-col${lifted ? ' is-lifted' : ''}${columnDrop === c.index ? ' is-drop-before' : ''}${columnDrop === columns.length && c.index === columns.length - 1 ? ' is-drop-after' : ''}${popover === c.index ? ' has-popover' : ''}`}
						data-board-col={c.index}
						aria-label={c.name}
					>
						<header class="pl-col-header">
							{editable && settings && (
								<span class="pl-col-handle" aria-hidden="true" {...drag.handleProps(c.index)}>
									<svg viewBox="0 0 10 16">
										<circle cx="3" cy="3" r="1.3" />
										<circle cx="7" cy="3" r="1.3" />
										<circle cx="3" cy="8" r="1.3" />
										<circle cx="7" cy="8" r="1.3" />
										<circle cx="3" cy="13" r="1.3" />
										<circle cx="7" cy="13" r="1.3" />
									</svg>
								</span>
							)}
							<span class="pl-col-name" {...(editable && settings ? drag.handleProps(c.index) : {})}>
								{c.name}
							</span>
							<span class="pl-col-count">{c.open}</span>
							{c.def?.checkOnEnter && (
								<span class="pl-col-badge" title="Moving a to-do here checks it">
									<svg viewBox="0 0 16 16" aria-hidden="true">
										<path d="M4 8.2l2.6 2.6L12 5.4" />
									</svg>
									Auto-check
								</span>
							)}
							<span class="pl-col-actions">
								{canAdd(c) && (
									<button type="button" class="pl-col-button" aria-label={`Add a to-do to ${c.name}`} onClick={() => addTo(c)}>
										<svg viewBox="0 0 16 16" aria-hidden="true">
											<path d="M8 3v10M3 8h10" />
										</svg>
									</button>
								)}
								{editable && settings && (
									<button
										type="button"
										class="pl-col-button pl-col-more"
										aria-label={`Column settings: ${c.name}`}
										aria-haspopup="dialog"
										aria-expanded={popover === c.index}
										onClick={() => setPopover(popover === c.index ? null : c.index)}
									>
										<svg viewBox="0 0 16 16" aria-hidden="true">
											<circle cx="3.5" cy="8" r="1.2" />
											<circle cx="8" cy="8" r="1.2" />
											<circle cx="12.5" cy="8" r="1.2" />
										</svg>
									</button>
								)}
							</span>
							{popover === c.index && (
								<ColumnPopover
									column={c}
									groupBy={groupBy}
									def={c.def}
									canLeft={groupBy === 'status' ? c.index > 0 : canSwap(c, columns[c.index - 1])}
									canRight={groupBy === 'status' ? c.index < columns.length - 1 : canSwap(c, columns[c.index + 1])}
									canDelete={groupBy === 'status' ? defs.length > 1 : !!c.heading}
									onClose={() => setPopover(null)}
									onRename={(name) => renameCol(c, name)}
									onFlag={(flag, on) => saveColumns(setColumnFlag(defs, c.index, flag, on))}
									onMove={(step) => {
										setPopover(c.index + step);
										moveCol(c.index, step > 0 ? c.index + 2 : c.index - 1);
									}}
									onDelete={() => deleteCol(c)}
								/>
							)}
						</header>
						<div class={`pl-col-cards${dropEnd ? ' is-drop-end' : ''}`}>
							{cards.map((item, row) => renderCard(item, c, row))}
							{!cards.length && <div class="pl-col-empty" />}
						</div>
						{c.older.length > 0 && (
							<button
								type="button"
								class="pl-col-older"
								onClick={() => {
									const next = new Set(older);
									if (next.has(c.key)) next.delete(c.key);
									else next.add(c.key);
									setOlder(next);
								}}
							>
								{older.has(c.key) ? 'Hide older' : `Show ${c.older.length} older`}
							</button>
						)}
					</section>
				);
			})}
			{editable &&
				(adding ? (
					<div class="pl-col pl-col-new">
						<NameInput cls="pl-col-name-input" label={groupBy === 'heading' ? 'Section name' : 'Column name'} initial="" onDone={addColumn} />
					</div>
				) : (
					<button type="button" class="pl-col-add" onClick={() => setAdding(true)}>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M8 3v10M3 8h10" />
						</svg>
						Add column
					</button>
				))}
		</div>
	);
}

/** A card, which scrolls itself into view when selected. */
function Card({
	selected,
	cls,
	props,
	onClick,
	children,
}: {
	selected: boolean;
	cls: string;
	props: Record<string, unknown>;
	onClick: (e: MouseEvent) => void;
	children: ComponentChildren;
}) {
	const el = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (selected) el.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}, [selected]);
	return (
		<div ref={el} class={cls} {...props} onClick={onClick}>
			{children}
		</div>
	);
}

function ColumnPopover({
	column,
	groupBy,
	def,
	canLeft,
	canRight,
	canDelete,
	onClose,
	onRename,
	onFlag,
	onMove,
	onDelete,
}: {
	column: BoardColumn;
	groupBy: GroupBy;
	def?: ColumnDef;
	canLeft: boolean;
	canRight: boolean;
	canDelete: boolean;
	onClose: () => void;
	onRename: (name: string) => void;
	onFlag: (flag: 'checkOnEnter' | 'uncheckOnLeave' | 'receivesChecked', on: boolean) => void;
	onMove: (step: 1 | -1) => void;
	onDelete: () => void;
}) {
	const wrap = useRef<HTMLDivElement>(null);
	const [name, setName] = useState(column.name);
	/** The name last sent, so blurring and closing don't rename twice. */
	const sent = useRef(column.name);
	useEffect(() => {
		setName(column.name);
		sent.current = column.name;
	}, [column.name]);
	useOutsideClick(wrap, () => {
		commit();
		onClose();
	});
	const commit = (): void => {
		const clean = name.trim();
		if (!clean || clean === sent.current) return;
		sent.current = clean;
		onRename(clean);
	};
	const toggle = (flag: 'checkOnEnter' | 'uncheckOnLeave' | 'receivesChecked', label: string, disabled = false) => (
		<label class={`pl-col-option${disabled ? ' is-disabled' : ''}`}>
			<input type="checkbox" checked={!!def?.[flag]} disabled={disabled} onChange={(e) => onFlag(flag, e.currentTarget.checked)} />
			<span>{label}</span>
		</label>
	);
	return (
		<div
			ref={wrap}
			class="pl-popover pl-col-popover"
			role="dialog"
			aria-label={`Column settings: ${column.name}`}
			onKeyDown={(e) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					onClose();
				}
			}}
		>
			<label class="pl-col-field">
				<span>{groupBy === 'heading' ? 'Section name' : 'Column name'}</span>
				<input
					class="pl-popover-input"
					type="text"
					value={name}
					onInput={(e) => setName(e.currentTarget.value)}
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.isComposing) {
							e.preventDefault();
							commit();
							onClose();
						}
					}}
				/>
			</label>
			{groupBy === 'status' && (
				<div class="pl-col-options">
					{toggle('checkOnEnter', 'Check tasks when moved here')}
					{toggle('uncheckOnLeave', 'Uncheck tasks when moved out', !def?.checkOnEnter)}
					{toggle('receivesChecked', 'Checking a task elsewhere moves it here')}
				</div>
			)}
			<div class="pl-col-footer">
				{canDelete && (
					<button type="button" class="pl-col-delete" onClick={onDelete}>
						Delete column
					</button>
				)}
				<span class="pl-col-moves">
					{canLeft && (
						<button type="button" onClick={() => onMove(-1)}>
							Move left
						</button>
					)}
					{canRight && (
						<button type="button" onClick={() => onMove(1)}>
							Move right
						</button>
					)}
				</span>
			</div>
		</div>
	);
}
