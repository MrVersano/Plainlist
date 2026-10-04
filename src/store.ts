import { App, Notice, TFile } from 'obsidian';
import { applyEdits, mapLine } from './model/apply';
import { parse } from './model/parse';
import { PatchConflict, type LineRef } from './model/patch';
import type { Doc, LineEdit } from './model/types';

export interface RunResult {
	ok: boolean;
	/** The tracked line after the change, or null if it is gone. */
	tracked: LineRef | null;
}

/** A line reference that `run` reads when the action executes and updates once it is applied. */
export interface TrackBox {
	current: LineRef;
}

/** Finds a line by index and exact text, or by exact text alone when it is unique. */
export function locateLine(doc: Doc, ref: LineRef): number | null {
	if (doc.lines[ref.line] === ref.text) return ref.line;
	const first = doc.lines.indexOf(ref.text);
	if (first === -1 || doc.lines.indexOf(ref.text, first + 1) !== -1) return null;
	return first;
}

/**
 * Holds the parsed file. The file text is the single source of truth: every action goes
 * through `vault.process`, and changes made elsewhere arrive through the vault's `modify` event.
 */
export class Store {
	doc: Doc;
	private text = '';
	private listeners = new Set<() => void>();
	private queue: Promise<unknown> = Promise.resolve();
	private disposers: (() => void)[] = [];

	constructor(
		private app: App,
		public file: TFile,
	) {
		this.doc = parse('');
		const ref = app.vault.on('modify', (f) => {
			if (f === this.file) void this.reload();
		});
		this.disposers.push(() => app.vault.offref(ref));
	}

	async load(): Promise<void> {
		this.setText(await this.app.vault.read(this.file));
	}

	dispose(): void {
		for (const d of this.disposers) d();
		this.listeners.clear();
	}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	/**
	 * Applies an action atomically against the latest file content. Actions run one at a time.
	 * `box` follows a line (the to-do being edited, say) to where it ends up, and is updated
	 * before listeners hear about the change, so the UI keeps its place.
	 */
	run(makeEdits: (doc: Doc) => LineEdit[], box?: TrackBox): Promise<RunResult> {
		const job = this.queue.then(async () => {
			const track = box?.current;
			let tracked: LineRef | null = null;
			try {
				const out = await this.app.vault.process(this.file, (text) => {
					const doc = parse(text);
					const edits = makeEdits(doc);
					if (!edits.length) return text;
					const next = applyEdits(doc, edits);
					if (track) {
						const at = locateLine(doc, track);
						const line = at === null ? null : mapLine(doc, edits, at);
						const lines = parse(next).lines;
						if (line !== null && lines[line] !== undefined) tracked = { line, text: lines[line] };
					}
					return next;
				});
				const doc = parse(out);
				if (track && !tracked) {
					// Moved rather than edited in place: find it again by its text.
					const line = locateLine(doc, track);
					tracked = line === null ? null : { line, text: track.text };
				}
				if (box && tracked) box.current = tracked;
				this.setText(out, doc);
				return { ok: true, tracked };
			} catch (e) {
				if (e instanceof PatchConflict) {
					new Notice(`${this.file.name} changed — please try again`);
				} else {
					console.error('Plainlist', e);
					new Notice(`Plainlist could not save: ${e instanceof Error ? e.message : String(e)}`);
				}
				return { ok: false, tracked: null };
			}
		});
		this.queue = job;
		return job;
	}

	private async reload(): Promise<void> {
		const text = await this.app.vault.read(this.file);
		// Our own writes are already applied; only re-render for changes made elsewhere.
		if (text !== this.text) this.setText(text);
	}

	private setText(text: string, doc = parse(text)): void {
		this.text = text;
		this.doc = doc;
		for (const fn of this.listeners) fn();
	}
}
