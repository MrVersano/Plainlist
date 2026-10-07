import { App, moment, Platform, PluginSettingTab, Scope, Setting, SettingDefinitionItem } from 'obsidian';
import { acceleratorFromEvent, DEFAULT_SHORTCUT, formatAccelerator } from './accelerator';
import type PlainlistPlugin from './main';
import { TagSuggest } from './ui/TagSuggest';

export type WeekStart = 'locale' | 'sunday' | 'monday';

export interface PlainlistSettings {
	tasksFile: string;
	openByDefault: boolean;
	weekStart: WeekStart;
	/** Desktop only: open the palette from any app with a global shortcut. */
	quickEntryEnabled: boolean;
	/** Electron accelerator, e.g. "CmdOrCtrl+Shift+Space". */
	quickEntryShortcut: string;
	/** "Search to-dos" also finds completed to-dos. */
	searchCompleted: boolean;
	/** Today, in the view and in notes, shows a group per project instead of one list. */
	groupTodayByProject: boolean;
	/** Notes with any of these tags (comma- or space-separated) become projects. Empty turns it off. */
	projectTags: string;
	/** The order the user dragged Today's to-dos into, as `todayKey`s. Not shown in the settings tab. */
	todayOrder: string[];
}

export const DEFAULT_SETTINGS: PlainlistSettings = {
	tasksFile: 'Tasks.md',
	openByDefault: true,
	weekStart: 'locale',
	// Off by default: a global shortcut reaches into every other app, so it should be opt-in.
	quickEntryEnabled: false,
	quickEntryShortcut: DEFAULT_SHORTCUT,
	searchCompleted: false,
	groupTodayByProject: false,
	projectTags: '',
	todayOrder: [],
};

/** 0 = Sunday, 1 = Monday. Locales that start on another day fall back to Monday. */
export function firstDayOfWeek(weekStart: WeekStart): 0 | 1 {
	if (weekStart === 'sunday') return 0;
	if (weekStart === 'monday') return 1;
	return moment.localeData().firstDayOfWeek() === 0 ? 0 : 1;
}

export class PlainlistSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: PlainlistPlugin,
	) {
		super(app, plugin);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		if (key === 'quickEntryEnabled') {
			this.plugin.quickEntry?.apply();
			this.update();
		}
		if (key === 'groupTodayByProject') this.plugin.todayChanged();
	}

	hide(): void {
		super.hide();
		// Applied here rather than per keystroke, so a half-typed tag never matches.
		this.plugin.autoProjects.settingChanged();
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
			{
				name: 'Project tags',
				desc: 'Notes with any of these tags become projects, including notes that already have them. Separate tags with commas; changes apply when you close settings. Removing a tag never removes projects without asking.',
				render: (setting) => this.renderProjectTags(setting),
			},
			{
				name: 'Group Today by project',
				desc: 'Show Today\'s to-dos under a heading for each project, with Inbox to-dos first. Lists in notes too.',
				control: { type: 'toggle', key: 'groupTodayByProject', defaultValue: DEFAULT_SETTINGS.groupTodayByProject },
			},
			{
				name: 'Search completed to-dos',
				desc: 'Include completed to-dos in "Search to-dos" results.',
				control: { type: 'toggle', key: 'searchCompleted', defaultValue: DEFAULT_SETTINGS.searchCompleted },
			},
			// System-wide Quick Entry needs Electron, so these are hidden on mobile.
			{
				name: 'System-wide quick entry',
				desc: 'Add a to-do from any app with a global shortcut while Obsidian is running. Desktop only.',
				visible: Platform.isDesktopApp,
				control: { type: 'toggle', key: 'quickEntryEnabled', defaultValue: DEFAULT_SETTINGS.quickEntryEnabled },
			},
			{
				name: 'Global shortcut',
				visible: () => Platform.isDesktopApp && this.plugin.settings.quickEntryEnabled,
				render: (setting) => this.renderShortcut(setting),
			},
		];
	}

	/** A text box that completes tags from the vault as you type. */
	private renderProjectTags(setting: Setting): () => void {
		const plugin = this.plugin;
		const save = async (value: string): Promise<void> => {
			plugin.settings.projectTags = value;
			await plugin.saveSettings();
		};
		let suggest: TagSuggest | null = null;
		setting.addText((text) => {
			text
				.setPlaceholder('For example #project, #client')
				.setValue(plugin.settings.projectTags)
				.onChange((value) => void save(value));
			suggest = new TagSuggest(this.app, text.inputEl, (value) => void save(value));
		});
		return () => suggest?.close();
	}

	/** A button that records the next key combination, plus a reset button. */
	private renderShortcut(setting: Setting): () => void {
		const plugin = this.plugin;
		let stopRecording: (() => void) | null = null;

		const describe = (): void => {
			const error = plugin.quickEntry ? plugin.quickEntry.error : 'Quick entry could not start on this device.';
			setting.setDesc(error ?? 'Click to record a new shortcut. Use at least one of Ctrl, Alt or ⌘.');
			setting.descEl.toggleClass('mod-warning', error !== null);
		};

		const use = async (accelerator: string): Promise<void> => {
			plugin.settings.quickEntryShortcut = accelerator;
			await plugin.saveSettings();
		};

		setting.addButton((button) => {
			const label = (): void => {
				button.setButtonText(formatAccelerator(plugin.settings.quickEntryShortcut, Platform.isMacOS));
			};
			label();
			button.onClick(() => {
				if (stopRecording) {
					stopRecording();
					return;
				}
				button.setButtonText('Press a shortcut…').setCta();
				// The current shortcut would open Quick Entry instead of reaching this page.
				plugin.quickEntry?.suspend();
				// A catch-all scope keeps Obsidian's own hotkeys (and Escape closing settings) out of the way.
				const scope = new Scope(this.app.scope);
				scope.register(null, null, (evt) => {
					if (evt.key === 'Escape') {
						stopRecording?.();
						return false;
					}
					const accelerator = acceleratorFromEvent(evt, Platform.isMacOS);
					if (accelerator) void use(accelerator).then(() => stopRecording?.());
					return false;
				});
				this.app.keymap.pushScope(scope);
				stopRecording = () => {
					stopRecording = null;
					this.app.keymap.popScope(scope);
					button.removeCta();
					label();
					plugin.quickEntry?.apply();
					describe();
				};
			});
		});

		setting.addExtraButton((button) =>
			button
				.setIcon('rotate-ccw')
				.setTooltip('Restore default')
				.onClick(async () => {
					stopRecording?.();
					await use(DEFAULT_SHORTCUT);
					plugin.quickEntry?.apply();
					this.update();
				}),
		);

		describe();
		return () => stopRecording?.();
	}
}
