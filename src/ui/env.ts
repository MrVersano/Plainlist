import { createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { App, Component, TFile } from 'obsidian';
import type { Clock } from '../clock';
import type { ListId } from '../model/lists';
import type { Doc } from '../model/types';
import type { Store } from '../store';

export interface Env {
	app: App;
	file: TFile;
	store: Store;
	clock: Clock;
	/** Owner for rendered Markdown children. */
	component: Component;
	weekStart: () => 0 | 1;
	openCapture: (list: ListId) => void;
	confirm: (title: string, message: string, cta: string) => Promise<boolean>;
	prompt: (title: string, placeholder: string) => Promise<string | null>;
	/** Desktop: "Press N…" hint; null on mobile. */
	hint: () => { hotkey: string | null } | null;
}

export const EnvContext = createContext<Env | null>(null);

export function useEnv(): Env {
	const env = useContext(EnvContext);
	if (!env) throw new Error('Plainlist UI rendered outside its view');
	return env;
}

/** Re-renders when the store's document changes. */
export function useDoc(store: Store): Doc {
	const [doc, setDoc] = useState(store.doc);
	useEffect(() => {
		setDoc(store.doc);
		return store.subscribe(() => setDoc(store.doc));
	}, [store]);
	return doc;
}

export function useToday(clock: Clock): string {
	const [today, setToday] = useState(clock.today);
	useEffect(() => clock.subscribe(() => setToday(clock.today)), [clock]);
	return today;
}

/** Calls `fn` after `ms` of quiet; `flush` runs it immediately if pending. */
export function useDebounced(fn: () => void, ms: number): { schedule: () => void; flush: () => void } {
	const timer = useRef<number | null>(null);
	const latest = useRef(fn);
	latest.current = fn;
	const flush = (): void => {
		if (timer.current === null) return;
		window.clearTimeout(timer.current);
		timer.current = null;
		latest.current();
	};
	const schedule = (): void => {
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			timer.current = null;
			latest.current();
		}, ms);
	};
	return { schedule, flush };
}

/** Calls `onClose` on a pointer-down outside `ref`. */
export function useOutsideClick(ref: { current: HTMLElement | null }, onClose: () => void, active = true): void {
	const latest = useRef(onClose);
	latest.current = onClose;
	useEffect(() => {
		if (!active) return;
		const doc = ref.current?.ownerDocument ?? document;
		const handler = (evt: PointerEvent): void => {
			const target = evt.target as Node | null;
			if (!ref.current || !target || ref.current.contains(target)) return;
			// Obsidian menus and modals live outside the view; clicks there don't count.
			if (target.instanceOf(Element) && target.closest('.menu, .modal-container, .pl-popover')) return;
			latest.current();
		};
		doc.addEventListener('pointerdown', handler, true);
		return () => doc.removeEventListener('pointerdown', handler, true);
	}, [active]);
}

/** Long-press (touch) handlers that call `fn` with the touch position. */
export function useLongPress(fn: (pos: { x: number; y: number }) => void, ms = 500) {
	const timer = useRef<number | null>(null);
	const cancel = (): void => {
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = null;
	};
	return {
		onTouchStart: (evt: TouchEvent) => {
			const t = evt.touches[0];
			if (!t) return;
			const pos = { x: t.clientX, y: t.clientY };
			cancel();
			timer.current = window.setTimeout(() => {
				timer.current = null;
				fn(pos);
			}, ms);
		},
		onTouchMove: cancel,
		onTouchEnd: cancel,
		onTouchCancel: cancel,
	};
}
