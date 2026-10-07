import { AbstractInputSuggest, App, getAllTags } from 'obsidian';
import { completeTag, parseTagList, suggestTags, tagQuery } from '../model/tags';

/** Completes the tag being typed in a comma-separated list of tags, from the vault's tags. */
export class TagSuggest extends AbstractInputSuggest<string> {
	/** Tag (without `#`) → notes using it; read once, on the first keystroke. */
	private counts: Map<string, number> | null = null;

	constructor(
		app: App,
		private inputEl: HTMLInputElement,
		private onPick: (value: string) => void,
	) {
		super(app, inputEl);
		this.limit = 20;
	}

	protected getSuggestions(text: string): string[] {
		const query = tagQuery(text);
		const listed = parseTagList(text.slice(0, text.length - query.length).replace(/#+$/, ''));
		return suggestTags(this.tagCounts(), query, listed);
	}

	renderSuggestion(tag: string, el: HTMLElement): void {
		el.addClass('mod-complex');
		el.createDiv({ cls: 'suggestion-content' }).createDiv({ cls: 'suggestion-title', text: `#${tag}` });
		const count = this.tagCounts().get(tag) ?? 0;
		el.createDiv({ cls: 'suggestion-aux' }).createSpan({ cls: 'suggestion-flair', text: String(count) });
	}

	selectSuggestion(tag: string): void {
		const value = completeTag(this.inputEl.value, tag);
		this.setValue(value);
		this.onPick(value);
		this.close();
	}

	private tagCounts(): Map<string, number> {
		if (this.counts) return this.counts;
		const counts = new Map<string, number>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			// A note counts once per tag, however often it uses it.
			const tags = new Set((cache ? getAllTags(cache) ?? [] : []).map((t) => t.replace(/^#/, '')));
			for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
		this.counts = counts;
		return counts;
	}
}
