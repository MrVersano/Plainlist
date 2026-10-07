import { App, FuzzySuggestModal } from 'obsidian';
import type { Area } from '../model/types';

/** "Move to area…": picks an area for a project, or none. */
export class AreaSuggestModal extends FuzzySuggestModal<Area | null> {
	constructor(
		app: App,
		private areas: Area[],
		private onChoose: (area: Area | null) => void,
	) {
		super(app);
		this.setPlaceholder('Move to area');
	}

	getItems(): (Area | null)[] {
		return [null, ...this.areas];
	}

	getItemText(area: Area | null): string {
		return area?.name ?? 'No area';
	}

	onChooseItem(area: Area | null): void {
		this.onChoose(area);
	}
}
