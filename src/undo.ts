// The undo history: what each action changed, newest last. Pure, no Obsidian imports.

/** A note's whole text before and after an action wrote to it. */
export interface Change {
	path: string;
	before: string;
	after: string;
}

export interface UndoEntry {
	/** What the action did, e.g. `Completed “Call Sam”`. */
	label: string;
	/** Undoes it; resolves to false when it couldn't. */
	undo: () => Promise<boolean>;
}

/** How many actions can be undone. */
const LIMIT = 30;

export class UndoStack {
	private entries: UndoEntry[] = [];

	push(label: string, undo: () => Promise<boolean>): UndoEntry {
		const entry = { label, undo };
		this.entries.push(entry);
		if (this.entries.length > LIMIT) this.entries.shift();
		return entry;
	}

	/** The newest entry, left on the stack. */
	peek(): UndoEntry | null {
		return this.entries[this.entries.length - 1] ?? null;
	}

	/** Takes the newest entry off the stack. */
	pop(): UndoEntry | null {
		return this.entries.pop() ?? null;
	}

	/** Takes a given entry off the stack (when its toast's Undo is used); false when it's gone already. */
	take(entry: UndoEntry): boolean {
		const at = this.entries.lastIndexOf(entry);
		if (at === -1) return false;
		this.entries.splice(at, 1);
		return true;
	}

	get size(): number {
		return this.entries.length;
	}
}

/**
 * Folds a run of changes into one per note: from the first text to the last. Null when a note's
 * changes don't follow on from each other, because something else wrote to it in between.
 */
export function mergeChanges(changes: Change[]): Change[] | null {
	const byPath = new Map<string, Change>();
	for (const c of changes) {
		const prev = byPath.get(c.path);
		if (prev && prev.after !== c.before) return null;
		byPath.set(c.path, prev ? { ...prev, after: c.after } : { ...c });
	}
	return [...byPath.values()].filter((c) => c.before !== c.after);
}

/** A to-do's title for a label, shortened. */
export function quoted(title: string, max = 40): string {
	const t = title.trim();
	return `“${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}”`;
}
