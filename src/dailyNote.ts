import { App, moment, TFile } from 'obsidian';

const ISO = 'YYYY-MM-DD';

/** The date format of the core Daily notes plugin, or `YYYY-MM-DD` when it is off or unset. */
export function dailyNoteFormat(app: App): string {
	// Not in the public API; the same lookup other plugins use.
	const internal = (app as unknown as { internalPlugins?: { getPluginById?: (id: string) => unknown } }).internalPlugins;
	const plugin = internal?.getPluginById?.('daily-notes') as { enabled?: boolean; instance?: { options?: { format?: unknown } } } | null | undefined;
	const format = plugin?.enabled ? plugin.instance?.options?.format : null;
	return typeof format === 'string' && format.trim() ? format.trim() : ISO;
}

/**
 * The date a note's title stands for, as `YYYY-MM-DD`: read with the Daily notes format, or
 * as `YYYY-MM-DD`. A format with folders in it (`YYYY/MM/YYYY-MM-DD`) is matched against the
 * end of the note's path.
 */
export function dateFromTitle(app: App, file: TFile): string | null {
	const stem = file.path.replace(/\.md$/i, '');
	for (const format of new Set([dailyNoteFormat(app), ISO])) {
		const depth = format.split('/').length;
		const text = stem.split('/').slice(-depth).join('/');
		const date = moment(text, format, true);
		if (date.isValid()) return date.format(ISO);
	}
	return null;
}
