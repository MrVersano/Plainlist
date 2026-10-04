import { App, normalizePath, TFile } from 'obsidian';
import type { ProjectInfo } from './model/lists';
import type { Doc } from './model/types';

/** Resolves the task file's project links to notes. Links to the task file itself, and repeats, are skipped. */
export function resolveProjects(app: App, master: TFile, doc: Doc): (ProjectInfo & { file: TFile | null })[] {
	const seen = new Set<string>();
	const out: (ProjectInfo & { file: TFile | null })[] = [];
	for (const link of doc.projectLinks) {
		const file = app.metadataCache.getFirstLinkpathDest(link.target, master.path);
		if (file === master) continue;
		const path = file?.path ?? link.target;
		if (seen.has(path)) continue;
		seen.add(path);
		const name = file?.basename ?? link.target.split('/').pop()?.replace(/\.md$/i, '') ?? link.target;
		out.push({ path, name, line: link.line, text: link.text, exists: !!file, file });
	}
	return out;
}

const BAD_NAME = /[\\/:*?"<>|#^[\]]/;

/** Checks a project name is usable as a note name; returns an error message, or null. */
export function projectNameError(name: string): string | null {
	if (!name.trim()) return 'Enter a project name.';
	if (BAD_NAME.test(name)) return 'Project names can’t contain any of \\ / : * ? " < > | # ^ [ ]';
	if (name.trim().startsWith('.')) return 'Project names can’t start with a dot.';
	return null;
}

/** Path for a new note called `name` in `folder` ('/' is the vault root). */
export function notePath(folder: string, name: string): string {
	return normalizePath(folder === '/' || !folder ? `${name.trim()}.md` : `${folder}/${name.trim()}.md`);
}
