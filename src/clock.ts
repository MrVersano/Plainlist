import type { Plugin } from 'obsidian';
import { toISO } from './dates/format';

/** Today's local date, re-checked at midnight and whenever the window regains focus. */
export class Clock {
	today = toISO(new Date());
	private listeners = new Set<() => void>();
	private timer: number | null = null;

	start(plugin: Plugin): void {
		plugin.registerDomEvent(window, 'focus', () => this.check());
		this.schedule();
		plugin.register(() => {
			if (this.timer !== null) window.clearTimeout(this.timer);
		});
	}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private schedule(): void {
		const now = new Date();
		const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
		this.timer = window.setTimeout(() => {
			this.check();
			this.schedule();
		}, next.getTime() - now.getTime());
	}

	private check(): void {
		const today = toISO(new Date());
		if (today === this.today) return;
		this.today = today;
		for (const fn of this.listeners) fn();
	}
}
