import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, PlainlistSettings, PlainlistSettingTab } from './settings';
import { ensureTasksFile } from './tasksFile';

export default class PlainlistPlugin extends Plugin {
	settings!: PlainlistSettings;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new PlainlistSettingTab(this.app, this));

		this.addCommand({
			id: 'open',
			name: 'Open',
			callback: () => void this.openTasksFile(),
		});
	}

	async openTasksFile(): Promise<void> {
		try {
			const file = await ensureTasksFile(this.app, this.settings.tasksFile);
			// Opens as Markdown for now; the Plainlist view takes over in a later step.
			await this.app.workspace.getLeaf(false).openFile(file);
		} catch (e) {
			new Notice(`Plainlist: could not open the tasks file. ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<PlainlistSettings>);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
