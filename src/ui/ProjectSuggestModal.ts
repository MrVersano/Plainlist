import { App, SuggestModal } from 'obsidian';
import { projectChoices, type ProjectChoice as Choice } from './components/Sidebar';

/** Narrow-layout version of "+ New project": type a name to create a note, or pick a note to import. */
export class ProjectSuggestModal extends SuggestModal<Choice> {
	constructor(
		app: App,
		private exclude: Set<string>,
		private onChoose: (choice: Choice) => void,
	) {
		super(app);
		this.setPlaceholder('Project name, or find a note');
		this.emptyStateText = 'Type a name to create a project';
	}

	getSuggestions(query: string): Choice[] {
		return projectChoices(this.app.vault.getMarkdownFiles(), query, this.exclude, 20);
	}

	renderSuggestion(choice: Choice, el: HTMLElement): void {
		if (choice.kind === 'create') {
			el.createDiv({ text: `Create “${choice.name}”` });
		} else {
			el.createDiv({ text: choice.file.basename });
			if (choice.file.parent && choice.file.parent.path !== '/') el.createEl('small', { text: choice.file.parent.path, cls: 'pl-add-path' });
		}
	}

	onChooseSuggestion(choice: Choice): void {
		this.onChoose(choice);
	}
}
