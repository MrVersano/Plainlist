// Drag-to-reorder for a list of rows, with pointer events so it works with a mouse and on
// touch screens. A mouse drag starts after a few pixels of movement. On touch, holding a
// row lifts it; moving then drags it, and letting go without moving opens its menu.

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

export interface ReorderOptions<T> {
	/** Rows in display order, keyed as in `rowProps`. */
	entries: { key: string; item: T }[];
	canDrag: (item: T) => boolean;
	canDrop: (dragged: T, target: T) => boolean;
	onDrop: (dragged: T, target: T, place: Place) => void;
	/** Right-click, or a touch held without moving. */
	onMenu: (item: T, pos: { x: number; y: number }) => void;
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
		if (gesture.current || e.button !== 0 || item === undefined || !latest.current.canDrag(item)) return;
		const target = e.target as HTMLElement | null;
		if (target?.closest('input, textarea, [contenteditable="true"]')) return;
		const row = e.currentTarget as HTMLElement;
		const scope = row.closest<HTMLElement>(`[data-scope="${scopeId}"]`);
		if (!scope) return;
		const doc = row.ownerDocument;
		const win = doc.defaultView ?? window;

		const move = (evt: PointerEvent): void => {
			const g = gesture.current;
			if (!g || evt.pointerId !== g.pointerId) return;
			const dist = Math.hypot(evt.clientX - g.x, evt.clientY - g.y);
			g.y = evt.clientY;
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
			const dragged = itemOf(g.key);
			// A drag or a held touch already did its job; don't let it also click the row.
			if (g.dragging || g.armed) {
				// On the window, so it runs before anything listening on the document (such as an open menu).
				const swallow = (c: MouseEvent): void => {
					c.stopImmediatePropagation();
					c.preventDefault();
				};
				win.addEventListener('click', swallow, true);
				win.setTimeout(() => win.removeEventListener('click', swallow, true), 0);
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
			if (gesture.current?.armed) evt.preventDefault();
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
			armed: false,
			dragging: false,
			scope,
			scroller: row.closest<HTMLElement>('.pl-main, .pl-sidebar'),
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
		if (touch) {
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
				// A long touch is handled when it lifts, as a menu or a drop.
				if (gesture.current?.touch) return;
				const item = itemOf(key);
				if (item !== undefined) latest.current.onMenu(item, { x: e.clientX, y: e.clientY });
			},
		}),
		/** Class for a row: lifted, or showing where the dragged row would land. */
		rowClass: (key: string): string =>
			dragging === key ? ' is-dragging' : drop?.key === key ? ` is-drop-${drop.place}` : '',
	};
}
