// Drag-to-reorder for a list of rows, with pointer events so it works with a mouse and on
// touch screens. A mouse drag starts after a few pixels of movement. On touch, holding a
// row lifts it; moving then drags it, and letting go without moving opens its menu.
// On touch, a row can also be swiped sideways before the hold completes.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Place } from '../model/patch';

/** Mouse movement before a press becomes a drag. */
const DRAG_SLOP = 5;
/** Touch movement that means the finger is scrolling, not holding. */
const TOUCH_SLOP = 8;
/** How long a touch must hold still before the row lifts. */
const HOLD_MS = 450;
/** Distance from the scroller's top or bottom edge where dragging scrolls it. */
const EDGE = 40;
/** Share of the row's width a swipe must travel to act. */
const SWIPE_AT = 0.35;
/** A quicker flick acts too: pixels per millisecond. */
const FLING = 0.6;

export type SwipeDir = 'right' | 'left';

export interface ReorderOptions<T> {
	/** Rows in display order, keyed as in `rowProps`. */
	entries: { key: string; item: T }[];
	canDrag: (item: T) => boolean;
	canDrop: (dragged: T, target: T) => boolean;
	onDrop: (dragged: T, target: T, place: Place) => void;
	/** Right-click, or a touch held without moving. */
	onMenu: (item: T, pos: { x: number; y: number }) => void;
	/** Whether a row can be swiped on a touch screen; no swiping without it. */
	canSwipe?: (item: T) => boolean;
	/** A finished swipe, with where the finger lifted. */
	onSwipe?: (item: T, dir: SwipeDir, pos: { x: number; y: number }) => void;
}

export interface DropAt {
	key: string;
	place: Place;
}

interface Gesture {
	key: string;
	pointerId: number;
	touch: boolean;
	x: number;
	y: number;
	/** Where the touch started, and when. */
	start: { x: number; y: number; t: number };
	row: HTMLElement;
	/** The row can be dragged (and so held); otherwise the gesture is only a possible swipe. */
	draggable: boolean;
	swipeable: boolean;
	/** The row is following the finger sideways: how far, and how fast lately. */
	swipe: { dx: number; v: number; t: number } | null;
	/** Touch held long enough to lift the row. */
	armed: boolean;
	dragging: boolean;
	scope: HTMLElement;
	scroller: HTMLElement | null;
	timer: number | null;
	frame: number | null;
	drop: DropAt | null;
	cleanup: () => void;
}

let nextScope = 0;

/** Moves a swiped row with the finger, and shows which way it acts and whether it would. */
function followSwipe(g: Gesture, dx: number, at: number): void {
	const swipe = g.swipe;
	if (!swipe) return;
	const dt = at - swipe.t;
	if (dt > 0) swipe.v = (dx - swipe.dx) / dt;
	swipe.dx = dx;
	swipe.t = at;
	const row = g.row;
	const ready = Math.abs(dx) >= row.clientWidth * SWIPE_AT;
	// A small tap on the phone when the swipe would now act.
	if (ready && !row.hasClass('is-swipe-ready')) navigator.vibrate?.(10);
	row.style.setProperty('--pl-swipe-x', `${dx}px`);
	row.toggleClass('is-swipe-right', dx > 0);
	row.toggleClass('is-swipe-left', dx < 0);
	row.toggleClass('is-swipe-ready', ready);
}

function clearSwipe(row: HTMLElement): void {
	row.removeClasses(['is-swiping', 'is-swipe-right', 'is-swipe-left', 'is-swipe-ready']);
	row.style.removeProperty('--pl-swipe-x');
}

export function useReorder<T>(opts: ReorderOptions<T>) {
	const latest = useRef(opts);
	latest.current = opts;
	const [scopeId] = useState(() => `pl-drag-${nextScope++}`);
	const [dragging, setDragging] = useState<string | null>(null);
	const [drop, setDrop] = useState<DropAt | null>(null);
	const gesture = useRef<Gesture | null>(null);

	const itemOf = (key: string): T | undefined => latest.current.entries.find((e) => e.key === key)?.item;

	const end = (): void => {
		const g = gesture.current;
		if (!g) return;
		gesture.current = null;
		if (g.timer !== null) window.clearTimeout(g.timer);
		if (g.frame !== null) window.cancelAnimationFrame(g.frame);
		g.scope.removeClass('is-reordering');
		if (g.swipe) clearSwipe(g.row);
		g.cleanup();
		setDragging(null);
		setDrop(null);
	};
	useEffect(() => end, []);

	/** The droppable row under the pointer, and which half of it. Keeps the last one over gaps and headers. */
	const findDrop = (g: Gesture, y: number): DropAt | null => {
		const dragged = itemOf(g.key);
		if (dragged === undefined) return null;
		for (const el of Array.from(g.scope.querySelectorAll<HTMLElement>(`[data-${scopeId}]`))) {
			const rect = el.getBoundingClientRect();
			if (y < rect.top || y >= rect.bottom) continue;
			const key = el.getAttribute(`data-${scopeId}`) ?? '';
			const target = itemOf(key);
			if (key === g.key || target === undefined || !latest.current.canDrop(dragged, target)) return null;
			return { key, place: y < rect.top + rect.height / 2 ? 'before' : 'after' };
		}
		return g.drop;
	};

	const update = (g: Gesture): void => {
		const next = findDrop(g, g.y);
		if (next?.key !== g.drop?.key || next?.place !== g.drop?.place) {
			g.drop = next;
			setDrop(next);
		}
	};

	/** Scrolls while the pointer is near the scroller's edge, re-finding the drop target as rows pass under it. */
	const autoScroll = (g: Gesture): void => {
		g.frame = null;
		const s = g.scroller;
		if (!s || !g.dragging || gesture.current !== g) return;
		const rect = s.getBoundingClientRect();
		const speed = g.y < rect.top + EDGE ? -(rect.top + EDGE - g.y) : g.y > rect.bottom - EDGE ? g.y - (rect.bottom - EDGE) : 0;
		if (!speed) return;
		s.scrollTop += Math.max(-EDGE, Math.min(EDGE, speed)) / 3;
		update(g);
		g.frame = window.requestAnimationFrame(() => autoScroll(g));
	};

	const startDrag = (g: Gesture): void => {
		g.dragging = true;
		g.scope.addClass('is-reordering');
		setDragging(g.key);
	};

	const onPointerDown = (key: string, e: PointerEvent): void => {
		const item = itemOf(key);
		if (gesture.current || e.button !== 0 || item === undefined) return;
		const draggable = latest.current.canDrag(item);
		const swipeable = e.pointerType === 'touch' && !!latest.current.onSwipe && (latest.current.canSwipe?.(item) ?? false);
		if (!draggable && !swipeable) return;
		const row = e.currentTarget as HTMLElement;
		// Only fields in the row count: a list embedded in a note sits inside the editor's contenteditable.
		const field = (e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]');
		if (field && row.contains(field)) return;
		const scope = row.closest<HTMLElement>(`[data-scope="${scopeId}"]`);
		if (!scope) return;
		const doc = row.ownerDocument;
		const win = doc.defaultView ?? window;

		const move = (evt: PointerEvent): void => {
			const g = gesture.current;
			if (!g || evt.pointerId !== g.pointerId) return;
			const dist = Math.hypot(evt.clientX - g.x, evt.clientY - g.y);
			g.y = evt.clientY;
			if (g.swipe) {
				evt.preventDefault();
				followSwipe(g, evt.clientX - g.start.x, evt.timeStamp);
				return;
			}
			if (!g.dragging) {
				if (g.touch && !g.armed) {
					const dx = evt.clientX - g.start.x;
					const dy = evt.clientY - g.start.y;
					// Mostly sideways: a swipe. Otherwise, moving before the hold completes is a scroll.
					if (g.swipeable && Math.abs(dx) > TOUCH_SLOP && Math.abs(dx) > 1.5 * Math.abs(dy)) {
						if (g.timer !== null) win.clearTimeout(g.timer);
						g.timer = null;
						g.swipe = { dx: 0, v: 0, t: evt.timeStamp };
						g.row.addClass('is-swiping');
						followSwipe(g, dx, evt.timeStamp);
					} else if (dist > TOUCH_SLOP) end();
					return;
				}
				if (!g.draggable) return;
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
			const dragged = itemOf(g.key);
			// A drag, swipe or held touch already did its job; don't let it also click the row.
			if (g.dragging || g.armed || g.swipe) {
				// On the window, so it runs before anything listening on the document (such as an open menu).
				const swallow = (c: MouseEvent): void => {
					c.stopImmediatePropagation();
					c.preventDefault();
				};
				win.addEventListener('click', swallow, true);
				win.setTimeout(() => win.removeEventListener('click', swallow, true), 0);
			}
			if (g.swipe) {
				const { dx, v } = g.swipe;
				const acts = Math.abs(dx) >= g.row.clientWidth * SWIPE_AT || (Math.abs(v) >= FLING && Math.sign(v) === Math.sign(dx));
				end();
				if (acts && dragged !== undefined) latest.current.onSwipe?.(dragged, dx > 0 ? 'right' : 'left', { x: evt.clientX, y: evt.clientY });
				return;
			}
			if (g.dragging) {
				const at = g.drop;
				const target = at ? itemOf(at.key) : undefined;
				end();
				if (dragged !== undefined && at && target !== undefined) latest.current.onDrop(dragged, target, at.place);
				return;
			}
			const armed = g.armed;
			end();
			if (armed && dragged !== undefined) {
				evt.preventDefault();
				latest.current.onMenu(dragged, { x: evt.clientX, y: evt.clientY });
			}
		};

		// Once a held row is lifted, the finger drags it instead of scrolling the list.
		const touchMove = (evt: TouchEvent): void => {
			const g = gesture.current;
			if (g?.armed) evt.preventDefault();
			// A swipe is ours: not a scroll, nor Obsidian's swipe to open a side panel.
			if (g?.swipe) {
				evt.preventDefault();
				evt.stopPropagation();
			}
		};
		const cancel = (): void => end();
		// A drag that starts on a link would otherwise become the browser's own drag.
		const dragStart = (evt: DragEvent): void => evt.preventDefault();

		doc.addEventListener('pointermove', move, true);
		doc.addEventListener('pointerup', up, true);
		doc.addEventListener('pointercancel', cancel, true);
		doc.addEventListener('touchmove', touchMove, { capture: true, passive: false });
		doc.addEventListener('dragstart', dragStart, true);

		const touch = e.pointerType === 'touch';
		const g: Gesture = {
			key,
			pointerId: e.pointerId,
			touch,
			x: e.clientX,
			y: e.clientY,
			start: { x: e.clientX, y: e.clientY, t: e.timeStamp },
			row,
			draggable,
			swipeable,
			swipe: null,
			armed: false,
			dragging: false,
			scope,
			scroller: row.closest<HTMLElement>('.pl-main, .pl-sidebar, .cm-scroller, .markdown-preview-view'),
			timer: null,
			frame: null,
			drop: null,
			cleanup: () => {
				doc.removeEventListener('pointermove', move, true);
				doc.removeEventListener('pointerup', up, true);
				doc.removeEventListener('pointercancel', cancel, true);
				doc.removeEventListener('touchmove', touchMove, true);
				doc.removeEventListener('dragstart', dragStart, true);
			},
		};
		if (touch && draggable) {
			g.timer = win.setTimeout(() => {
				g.timer = null;
				if (gesture.current !== g) return;
				g.armed = true;
				setDragging(g.key);
			}, HOLD_MS);
		}
		gesture.current = g;
	};

	return {
		/** Key of the row being dragged (or, on touch, held). */
		dragging,
		/** Where the dragged row would land. */
		drop,
		/** Props for the element that contains the rows. */
		scopeProps: { 'data-scope': scopeId },
		/** Props for each row. */
		rowProps: (key: string) => ({
			[`data-${scopeId}`]: key,
			onPointerDown: (e: PointerEvent) => onPointerDown(key, e),
			onContextMenu: (e: MouseEvent) => {
				e.preventDefault();
				// A long touch on a draggable row is handled when it lifts, as a menu or a drop.
				if (gesture.current?.touch && gesture.current.draggable) return;
				const item = itemOf(key);
				if (item !== undefined) latest.current.onMenu(item, { x: e.clientX, y: e.clientY });
			},
		}),
		/** Class for a row: lifted, or showing where the dragged row would land. */
		rowClass: (key: string): string =>
			dragging === key ? ' is-dragging' : drop?.key === key ? ` is-drop-${drop.place}` : '',
	};
}
