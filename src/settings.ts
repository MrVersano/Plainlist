import { App, moment, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import type PlainlistPlugin from './main';

export type WeekStart = 'locale' | 'sunday' | 'monday';

export interface PlainlistSettings {
	tasksFile: string;
	openByDefault: boolean;
	weekStart: WeekStart;
}

export const DEFAULT_SETTINGS: PlainlistSettings = {
	tasksFile: 'Tasks.md',
	openByDefault: true,
	weekStart: 'locale',
};

/** 0 = Sunday, 1 = Monday. Locales that start on another day fall back to Monday. */
export function firstDayOfWeek(weekStart: WeekStart): 0 | 1 {
	if (weekStart === 'sunday') return 0;
	if (weekStart === 'monday') return 1;
	return moment.localeData().firstDayOfWeek() === 0 ? 0 : 1;
}

export class PlainlistSettingTab extends PluginSettingTab {
	constructor(app: App, plugin: PlainlistPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const localeDay = moment.localeData().firstDayOfWeek() === 0 ? 'Sunday' : 'Monday';
		return [
			{
				name: 'Tasks file',
				desc: 'The note Plainlist reads and writes. The open command creates it if it is missing.',
				control: {
					type: 'file',
					key: 'tasksFile',
					placeholder: DEFAULT_SETTINGS.tasksFile,
					defaultValue: DEFAULT_SETTINGS.tasksFile,
					filter: (file) => file.extension === 'md',
					validate: (value) => (value.trim() ? undefined : 'Enter a file path.'),
				},
			},
			{
				name: 'Open this file in Plainlist view by default',
				desc: 'Notes with "plainlist: true" in their properties open as a task list instead of as Markdown.',
				control: { type: 'toggle', key: 'openByDefault', defaultValue: DEFAULT_SETTINGS.openByDefault },
			},
			{
				name: 'Week starts on',
				desc: 'Used for "next week" and the upcoming list.',
				control: {
					type: 'dropdown',
					key: 'weekStart',
					defaultValue: DEFAULT_SETTINGS.weekStart,
					options: { locale: `Locale default (${localeDay})`, sunday: 'Sunday', monday: 'Monday' },
				},
			},
		];
	}
}
