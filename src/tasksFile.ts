import { App, normalizePath, TFile, TFolder } from 'obsidian';

export const SKELETON = ['---', 'plainlist: true', '---', '', '# Inbox', '', '# Projects', ''].join('\n');

export function tasksFilePath(setting: string): string {
	const path = normalizePath(setting.trim() || 'Tasks.md');
	return path.toLowerCase().endsWith('.md') ? path : `${path}.md`;
}

/** Returns the tasks file, creating it (and its folders) with the skeleton if it is missing. */
export async function ensureTasksFile(app: App, setting: string): Promise<TFile> {
	const path = tasksFilePath(setting);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;
	if (existing) throw new Error(`${path} is a folder`);

	const parts = path.split('/').slice(0, -1);
	for (let i = 1; i <= parts.length; i++) {
		const folder = parts.slice(0, i).join('/');
		const found = app.vault.getAbstractFileByPath(folder);
		if (!found) await app.vault.createFolder(folder);
		else if (!(found instanceof TFolder)) throw new Error(`${folder} is not a folder`);
	}
	return app.vault.create(path, SKELETON);
}
