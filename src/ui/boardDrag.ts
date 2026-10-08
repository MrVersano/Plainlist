// Drag and drop on the board: cards between and within columns, and columns by their header.
// Pointer events, so it works with a mouse and on touch screens. A mouse drag starts after a few
// pixels; on touch, holding a card lifts it, and letting go without moving opens its menu.
// The lifted card follows the pointer, tilted; an accent line shows where it will land.

import { useEffect, useRef, useState } from 'preact/hooks';

const DRAG_SLOP = 5;
const TOUCH_SLOP = 8;
const HOLD_MS = 450;
/** Distance from an edge of the board or the page where dragging scrolls it. */
const EDGE = 48;

/** Where a dragged card lands: in column `col`, before card `before` (null: at the end). */
export interface CardDrop {
	col: number;
	before: string | null;
}

export interface BoardDragOptions {
	canDragCard: (key: string) => boolean;
	canDragColumn: (index: number) => boolean;
	/** Whether a column can go just before column `before` (the column count: at the end). */
	canDropColumn: (from: number, before: number) => boolean;
	onDropCard: (key: string, drop: CardDrop) => void;
	onDropColumn: (from: number, before: number) => void;
	/** Right-click, or a touch held without moving. */
	onCardMenu: (key: string, pos: { x: number; y: number }) => void;
}

type Dragged = { kind: 'card'; key: string } | { kind: 'column'; index: number };

interface Gesture {
	what: Dragged;
	pointerId: number;
	touch: boolean;
	start: { x: number; y: number };
	x: number;
	y: number;
	el: HTMLElement;
	armed: boolean;
	dragging: boolean;
	board: HTMLElement;
	page: HTMLElement | null;
	timer: number | null;
	frame: number | null;
	cardDrop: CardDrop | null;
	columnDrop: number | null;
	cleanup: () => void;
}

export function useBoardDrag(opts: BoardDragOptions) {
	const latest = useRef(opts);
	latest.current = opts;
	const [dragging, setDragging] = useState<Dragged | null>(null);
	const [cardDrop, setCardDrop] = useState<CardDrop | null>(null);
	const [columnDrop, setColumnDrop] = useState<number | null>(null);
	const gesture = useRef<Gesture | null>(null);

	const end = (): void => {
		const g = gesture.current;
		if (!g) return;
		gesture.current = null;
		if (g.timer !== null) window.clearTimeout(g.timer);
		if (g.frame !== null) window.cancelAnimationFrame(g.frame);
		g.board.removeClass('is-reordering');
		g.el.style.removeProperty('--pl-lift-x');
		g.el.style.removeProperty('--pl-lift-y');
		g.cleanup();
		setDragging(null);
		setCardDrop(null);
		setColumnDrop(null);
	};
	useEffect(() => end, []);

	const columns = (g: Gesture): HTMLElement[] => Array.from(g.board.querySelectorAll<HTMLElement>('[data-board-col]'));

	const findCardDrop = (g: Gesture): CardDrop | null => {
		if (g.what.kind !== 'card') return null;
		const cols = columns(g);
		if (!cols.length) return null;
		// The column under the pointer, or the nearest one.
		let col = cols[0]!;
		let best = Infinity;
		for (const c of cols) {
			const r = c.getBoundingClientRect();
			const d = g.x < r.left ? r.left - g.x : g.x > r.right ? g.x - r.right : 0;
			if (d < best) {
				best = d;
				col = c;
			}
		}
		const index = Number(col.getAttribute('data-board-col'));
		const key = g.what.key;
		const cards = Array.from(col.querySelectorAll<HTMLElement>('[data-board-card]')).filter((c) => c.getAttribute('data-board-card') !== key);
		for (const c of cards) {
			const r = c.getBoundingClientRect();
			if (g.y < r.top + r.height / 2) return { col: index, before: c.getAttribute('data-board-card') };
		}
		return { col: index, before: null };
	};

	const findColumnDrop = (g: Gesture): number | null => {
		if (g.what.kind !== 'column') return null;
		const from = g.what.index;
		const cols = columns(g);
		let before = cols.length;
		for (const c of cols) {
			const i = Number(c.getAttribute('data-board-col'));
			if (i === from) continue;
			const r = c.getBoundingClientRect();
			if (g.x < r.left + r.width / 2) {
				before = i;
				break;
			}
		}
		// Dropping it right where it is changes nothing.
		if (before === from || before === from + 1) return null;
		return latest.current.canDropColumn(from, before) ? before : null;
	};

	const update = (g: Gesture): void => {
		g.el.style.setProperty('--pl-lift-x', `${g.x - g.start.x}px`);
		g.el.style.setProperty('--pl-lift-y', `${g.y - g.start.y}px`);
		if (g.what.kind === 'card') {
			const next = findCardDrop(g);
			if (next?.col !== g.cardDrop?.col || next?.before !== g.cardDrop?.before) {
				g.cardDrop = next;
				setCardDrop(next);
			}
		} else {
			const next = findColumnDrop(g);
			if (next !== g.columnDrop) {
				g.columnDrop = next;
				setColumnDrop(next);
			}
		}
	};

	/** Scrolls the board sideways, or the page up and down, while the pointer is near an edge. */
	const autoScroll = (g: Gesture): void => {
		g.frame = null;
		if (!g.dragging || gesture.current !== g) return;
		const speed = (pos: number, lo: number, hi: number): number =>
			pos < lo + EDGE ? -(lo + EDGE - pos) : pos > hi - EDGE ? pos - (hi - EDGE) : 0;
		const b = g.board.getBoundingClientRect();
		const dx = speed(g.x, b.left, b.right);
		const p = g.page?.getBoundingClientRect();
		const dy = p && g.page ? speed(g.y, p.top, p.bottom) : 0;
		if (!dx && !dy) return;
		const before = { x: g.board.scrollLeft, y: g.page?.scrollTop ?? 0 };
		g.board.scrollLeft += Math.max(-EDGE, Math.min(EDGE, dx)) / 3;
		if (g.page) g.page.scrollTop += Math.max(-EDGE, Math.min(EDGE, dy)) / 3;
		// The lifted element scrolls with the content; keep it under the pointer.
		g.start.x -= g.board.scrollLeft - before.x;
		g.start.y -= (g.page?.scrollTop ?? 0) - before.y;
		update(g);
		g.frame = window.requestAnimationFrame(() => autoScroll(g));
	};

	const begin = (what: Dragged, e: PointerEvent): void => {
		if (gesture.current || e.button !== 0) return;
		if (what.kind === 'card' ? !latest.current.canDragCard(what.key) : !latest.current.canDragColumn(what.index)) return;
		const target = e.target as HTMLElement | null;
		if (target?.closest('input, textarea, [contenteditable="true"]')) return;
		const handle = e.currentTarget as HTMLElement;
		const el = what.kind === 'card' ? handle : (handle.closest<HTMLElement>('[data-board-col]') ?? handle);
		const board = handle.closest<HTMLElement>('[data-board]');
		if (!board) return;
		const doc = handle.ownerDocument;
		const win = doc.defaultView ?? window;

		const startDrag = (g: Gesture): void => {
			g.dragging = true;
			g.board.addClass('is-reordering');
			setDragging(g.what);
		};

		const move = (evt: PointerEvent): void => {
			const g = gesture.current;
			if (!g || evt.pointerId !== g.pointerId) return;
			g.x = evt.clientX;
			g.y = evt.clientY;
			const dist = Math.hypot(g.x - g.start.x, g.y - g.start.y);
			if (!g.dragging) {
				if (g.touch && !g.armed) {
					// Moving before the hold completes is a scroll.
					if (dist > TOUCH_SLOP) end();
					return;
				}
				if (dist <= (g.touch ? TOUCH_SLOP : DRAG_SLOP)) return;
				startDrag(g);
			}
			evt.preventDefault();
			update(g);
			if (g.frame === null) g.frame = win.requestAnimationFrame(() => autoScroll(g));
		};

		const up = (evt: PointerEvent): void => {
			const g = gesture.current;
			if (!g || evt.pointerId !== g.pointerId) return;
			if (g.dragging || g.armed) {
				// A drag or a held touch already did its job; don't let it also click.
				const swallow = (c: MouseEvent): void => {
					c.stopImmediatePropagation();
					c.preventDefault();
				};
				win.addEventListener('click', swallow, true);
				win.setTimeout(() => win.removeEventListener('click', swallow, true), 0);
			}
			const { what: dragged, cardDrop: cd, columnDrop: kd, dragging: was, armed } = g;
			end();
			if (was) {
				if (dragged.kind === 'card' && cd) latest.current.onDropCard(dragged.key, cd);
				if (dragged.kind === 'column' && kd !== null) latest.current.onDropColumn(dragged.index, kd);
			} else if (armed && dragged.kind === 'card') {
				evt.preventDefault();
				latest.current.onCardMenu(dragged.key, { x: evt.clientX, y: evt.clientY });
			}
		};

		// Once a held card is lifted, the finger drags it instead of scrolling.
		const touchMove = (evt: TouchEvent): void => {
			if (gesture.current?.armed) evt.preventDefault();
		};
		const cancel = (): void => end();
		const dragStart = (evt: DragEvent): void => evt.preventDefault();

		doc.addEventListener('pointermove', move, true);
		doc.addEventListener('pointerup', up, true);
		doc.addEventListener('pointercancel', cancel, true);
		doc.addEventListener('touchmove', touchMove, { capture: true, passive: false });
		doc.addEventListener('dragstart', dragStart, true);

		const touch = e.pointerType === 'touch';
		const g: Gesture = {
			what,
			pointerId: e.pointerId,
			touch,
			start: { x: e.clientX, y: e.clientY },
			x: e.clientX,
			y: e.clientY,
			el,
			armed: false,
			dragging: false,
			board,
			page: board.closest<HTMLElement>('.pl-main'),
			timer: null,
			frame: null,
			cardDrop: null,
			columnDrop: null,
			cleanup: () => {
				doc.removeEventListener('pointermove', move, true);
				doc.removeEventListener('pointerup', up, true);
				doc.removeEventListener('pointercancel', cancel, true);
				doc.removeEventListener('touchmove', touchMove, true);
				doc.removeEventListener('dragstart', dragStart, true);
			},
		};
		if (touch) {
			g.timer = win.setTimeout(() => {
				g.timer = null;
				if (gesture.current !== g) return;
				g.armed = true;
				navigator.vibrate?.(10);
				startDrag(g);
			}, HOLD_MS);
		}
		gesture.current = g;
	};

	return {
		dragging,
		cardDrop,
		columnDrop,
		cardProps: (key: string) => ({
			'data-board-card': key,
			onPointerDown: (e: PointerEvent) => begin({ kind: 'card', key }, e),
			onContextMenu: (e: MouseEvent) => {
				e.preventDefault();
				if (gesture.current?.touch) return;
				latest.current.onCardMenu(key, { x: e.clientX, y: e.clientY });
			},
		}),
		handleProps: (index: number) => ({
			onPointerDown: (e: PointerEvent) => begin({ kind: 'column', index }, e),
		}),
	};
}
