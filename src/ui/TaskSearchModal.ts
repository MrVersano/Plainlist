import { App, prepareFuzzySearch, renderMatches, SuggestModal, type SearchMatches } from 'obsidian';
import { metaDate } from '../dates/format';
import { INBOX_GROUP, placeLabel, type Item } from '../model/lists';

interface Result {
	item: Item;
	matches: SearchMatches;
	score: number;
}

const LIMIT = 50;

/** Where a to-do lives, as the results show it. */
const place = (item: Item): string => placeLabel(item) || INBOX_GROUP;

/** "Search to-dos": fuzzy-finds a to-do by its title or where it lives. */
export class TaskSearchModal extends SuggestModal<Result> {
	constructor(
		app: App,
		private items: Item[],
		private today: string,
		private onPick: (item: Item) => void,
		private onDismiss: () => void,
	) {
		super(app);
		this.limit = LIMIT;
		this.setPlaceholder('Find a to-do');
		this.emptyStateText = 'No matching to-dos';
		this.setInstructions([
			{ command: '↑↓', purpose: 'to navigate' },
			{ command: '↵', purpose: 'to go to the to-do' },
			{ command: 'esc', purpose: 'to dismiss' },
		]);
		this.modalEl.addClass('pl-search-modal');
	}

	getSuggestions(query: string): Result[] {
		const q = query.trim();
		// Open to-dos rank ahead of completed ones with the same score.
		const byDone = (a: Result, b: Result): number => Number(a.item.task.done) - Number(b.item.task.done);
		if (!q) {
			return this.items
				.map((item) => ({ item, matches: [], score: 0 }))
				.filter((r) => !r.item.task.done)
				.slice(0, LIMIT);
		}
		const search = prepareFuzzySearch(q);
		const out: Result[] = [];
		for (const item of this.items) {
			const found = search(`${item.task.title}\n${place(item)}`);
			if (found) out.push({ item, matches: found.matches, score: found.score });
		}
		return out.sort((a, b) => b.score - a.score || byDone(a, b));
	}

	renderSuggestion({ item, matches }: Result, el: HTMLElement): void {
		const { task } = item;
		el.addClass('pl-search-result');
		if (task.done) el.addClass('is-done');
		const title = el.createDiv({ cls: 'pl-search-title' });
		const titleEnd = task.title.length;
		if (task.title) renderMatches(title, task.title, matches.filter(([, end]) => end <= titleEnd));
		else title.createSpan({ text: 'New to-do', cls: 'pl-untitled' });

		const meta = el.createDiv({ cls: 'pl-search-meta' });
		const where = place(item);
		const start = titleEnd + 1;
		renderMatches(
			meta.createSpan(),
			where,
			matches.filter(([s]) => s >= start),
			-start,
		);
		const when = task.done ? 'Completed' : task.date ? metaDate(task.date, this.today) : '';
		if (when) meta.createSpan({ text: ` · ${when}` });
	}

	onChooseSuggestion({ item }: Result): void {
		this.onPick(item);
	}

	onClose(): void {
		super.onClose();
		this.onDismiss();
	}
}
