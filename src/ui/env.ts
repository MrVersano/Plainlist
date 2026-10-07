import { createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { App, Component } from 'obsidian';
import type { Clock } from '../clock';
import type { ListId } from '../model/lists';
import type { TaskRef, Workspace } from '../store';

/** The sidebar's width, and whether it is pulled closed. Kept per device. */
export interface SidebarLayout {
	width: number;
	hidden: boolean;
}

export interface Env {
	app: App;
	workspace: Workspace;
	clock: Clock;
	/** Owner for rendered Markdown children. */
	component: Component;
	weekStart: () => 0 | 1;
	openCapture: (list: ListId) => void;
	confirm: (title: string, message: string, cta: string, destructive?: boolean) => Promise<boolean>;
	prompt: (title: string, placeholder: string, initial?: string, cta?: string) => Promise<string | null>;
	/** Desktop: "Press N…" hint; null on mobile. */
	hint: () => { hotkey: string | null } | null;
	sidebar: { load: () => SidebarLayout; save: (layout: SidebarLayout) => void };
	/**
	 * The saved Today order, as `todayKey`s, and whether Today is grouped by project.
	 * `subscribe` hears changes to either, made anywhere.
	 */
	todayOrder: {
		get: () => string[];
		set: (keys: string[]) => void;
		byProject: () => boolean;
		subscribe: (fn: () => void) => () => void;
	};
	/** Calls `fn` for each "go to this to-do" request, starting with one made before it subscribed. */
	onReveal: (fn: (target: TaskRef) => void) => () => void;
	/** Calls `fn` for each "Move selected to-dos" or "Schedule selected to-dos" command. */
	onSelectionCommand: (fn: (command: SelectionCommand) => void) => () => void;
}

/** A command that acts on the selected to-dos, or on the highlighted one when none is selected. */
export type SelectionCommand = 'move' | 'schedule';

export const EnvContext = createContext<Env | null>(null);

export function useEnv(): Env {
	const env = useContext(EnvContext);
	if (!env) throw new Error('Plainlist UI rendered outside its view');
	return env;
}

/** Re-renders whenever the task file or a project note changes. */
export function useWorkspace(workspace: Workspace): number {
	const [version, setVersion] = useState(0);
	useEffect(() => workspace.subscribe(() => setVersion((v) => v + 1)), [workspace]);
	return version;
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
			// nodeType, not instanceOf: the Quick Entry window's nodes come from another realm.
			if (target.nodeType === Node.ELEMENT_NODE && (target as Element).closest('.menu, .modal-container, .pl-popover')) return;
			latest.current();
		};
		doc.addEventListener('pointerdown', handler, true);
		return () => doc.removeEventListener('pointerdown', handler, true);
	}, [active]);
}
