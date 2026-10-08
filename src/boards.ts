// Board settings per project, kept in plugin data, and who to tell when they change.

import { DEFAULT_COLUMNS, type BoardProject, type BoardSettings, type ColumnDef } from './model/board';

export class Boards {
	private listeners = new Set<() => void>();
	private holds = new Map<string, number>();

	constructor(
		private read: () => BoardSettings,
		private save: () => void,
	) {}

	get settings(): BoardSettings {
		return this.read();
	}

	/** A project's board, or null until it has been switched to Board. */
	entry(path: string): BoardProject | null {
		return this.read().projects[path] ?? null;
	}

	/** A project's columns, or the default ones. */
	columns(path: string): ColumnDef[] {
		const board = this.read();
		const own = board.projects[path]?.columns;
		if (own?.length) return own;
		return board.defaultColumns.length ? board.defaultColumns : DEFAULT_COLUMNS;
	}

	/** The columns whose auto-check rules apply to a note: a board project's, when grouped by status. */
	rules(path: string): ColumnDef[] | null {
		const e = this.entry(path);
		return e && e.groupBy === 'status' ? this.columns(path) : null;
	}

	/** Changes a project's board, creating it first. */
	update(path: string, change: (entry: BoardProject) => BoardProject): void {
		const board = this.read();
		board.projects[path] = change(board.projects[path] ?? { view: 'list', groupBy: 'status' });
		this.changed();
	}

	setColumns(path: string, columns: ColumnDef[]): void {
		this.update(path, (e) => ({ ...e, columns: columns.map((c) => ({ ...c })) }));
	}

	/** Keeps a project's board when its note is renamed or moved. */
	rename(oldPath: string, newPath: string): void {
		const board = this.read();
		const entry = board.projects[oldPath];
		if (!entry || oldPath === newPath) return;
		delete board.projects[oldPath];
		board.projects[newPath] = entry;
		this.changed();
	}

	/**
	 * Waits for a change to a project's note made along with a change to its columns (a rename
	 * or a delete). Meanwhile its fields may name no column, and must not create one.
	 */
	async hold<T>(path: string, work: Promise<T>): Promise<T> {
		this.holds.set(path, (this.holds.get(path) ?? 0) + 1);
		try {
			return await work;
		} finally {
			const n = (this.holds.get(path) ?? 1) - 1;
			if (n > 0) this.holds.set(path, n);
			else this.holds.delete(path);
			for (const fn of this.listeners) fn();
		}
	}

	held(path: string): boolean {
		return this.holds.has(path);
	}

	/** Saves and tells every board. */
	changed(): void {
		this.save();
		for (const fn of this.listeners) fn();
	}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}
}
