import { CachedMetadata, Component, getAllTags, Notice, TFile } from 'obsidian';
import { patchText } from './model/apply';
import { parse } from './model/parse';
import { addProjectLink, removeProjectLink } from './model/patch';
import { hasAnyTag, parseTagList } from './model/tags';
import { ensureTasksFile, tasksFilePath } from './tasksFile';
import type PlainlistPlugin from './main';
import { confirmModal } from './ui/modals';

/**
 * Adds notes tagged with one of the "Project tags" to the task file's projects: a note when it
 * gains such a tag, and every tagged note when a tag is added to the setting. A project the user
 * removed stays removed until its note loses the tag and gets it again. Removing a tag from the
 * setting never removes projects by itself; it only offers to.
 */
export class AutoProjects extends Component {
	/** Whether each note had a project tag when last seen; null until the metadata cache is ready. */
	private matched: Map<string, boolean> | null = null;
	/** The tags the last scan used. Edits in the settings tab apply when it closes, not per keystroke. */
	private tags: string[] = [];
	/** Adds run one after another, so two never patch the task file at once. */
	private queue: Promise<void> = Promise.resolve();

	constructor(private plugin: PlainlistPlugin) {
		super();
	}

	onload(): void {
		const { metadataCache, workspace } = this.plugin.app;
		// The metadata cache is loaded by then.
		workspace.onLayoutReady(() => this.init());
		this.registerEvent(
			metadataCache.on('changed', (file, _data, cache) => {
				if (!this.matched) return;
				const now = this.isTagged(file, cache);
				const before = this.matched.get(file.path) ?? false;
				this.matched.set(file.path, now);
				if (now && !before) this.add([file], false);
			}),
		);
		this.registerEvent(
			this.plugin.app.vault.on('rename', (file, oldPath) => {
				const was = this.matched?.get(oldPath);
				if (was === undefined) return;
				this.matched?.delete(oldPath);
				this.matched?.set(file.path, was);
			}),
		);
		this.registerEvent(this.plugin.app.vault.on('delete', (file) => this.matched?.delete(file.path)));
	}

	/** Records which notes are tagged now, without adding any: they were there before Plainlist started. */
	private init(): void {
		if (this.matched) return;
		this.tags = this.wanted();
		this.matched = this.scan();
	}

	/**
	 * Call when the setting may have changed. Adds the notes that have a newly added tag;
	 * notes that only have tags already in use were handled when they got them. For removed
	 * tags, offers to remove the open projects that only had those.
	 */
	settingChanged(): void {
		if (!this.matched) return;
		const wanted = this.wanted();
		const added = wanted.filter((t) => !this.tags.includes(t));
		const removed = this.tags.filter((t) => !wanted.includes(t));
		this.tags = wanted;
		this.matched = this.scan();
		if (added.length) {
			const files = this.plugin.app.vault.getMarkdownFiles().filter((f) => {
				const cache = this.plugin.app.metadataCache.getFileCache(f);
				return this.isTagged(f, cache, added);
			});
			if (files.length) this.add(files, true);
		}
		if (removed.length) this.offerRemoval(removed);
	}

	private wanted(): string[] {
		return parseTagList(this.plugin.settings.projectTags);
	}

	private scan(): Map<string, boolean> {
		const { vault, metadataCache } = this.plugin.app;
		return new Map(vault.getMarkdownFiles().map((f) => [f.path, this.isTagged(f, metadataCache.getFileCache(f))]));
	}

	/** Task files (the configured one, or any with `plainlist: true`) are never projects. */
	private isTagged(file: TFile, cache: CachedMetadata | null, tags = this.tags): boolean {
		if (!cache || !tags.length) return false;
		if (file.path === tasksFilePath(this.plugin.settings.tasksFile)) return false;
		if (cache.frontmatter?.plainlist === true) return false;
		return hasAnyTag(getAllTags(cache) ?? [], tags);
	}

	private add(files: TFile[], fromSetting: boolean): void {
		this.enqueue(() => this.addNow(files, fromSetting), 'could not add tagged notes as projects');
	}

	private offerRemoval(removed: string[]): void {
		this.enqueue(() => this.offerRemovalNow(removed), 'could not remove projects');
	}

	private enqueue(task: () => Promise<void>, failure: string): void {
		this.queue = this.queue.then(task).catch((e) => {
			console.error(`Plainlist: ${failure}`, e);
			new Notice(`Plainlist: ${failure}. ${e instanceof Error ? e.message : String(e)}`);
		});
	}

	/**
	 * Asks whether to remove the open projects whose notes have one of the `removed` tags and none
	 * of the remaining ones. Completed projects, and projects with no such tag, are never offered.
	 */
	private async offerRemovalNow(removed: string[]): Promise<void> {
		const { app } = this.plugin;
		const master = app.vault.getAbstractFileByPath(tasksFilePath(this.plugin.settings.tasksFile));
		if (!(master instanceof TFile)) return;
		const candidates = (text: string): { line: number; text: string; file: TFile }[] =>
			parse(text).projectLinks.flatMap((link) => {
				if (link.done) return [];
				const file = app.metadataCache.getFirstLinkpathDest(link.target, master.path);
				if (!file || file === master) return [];
				const cache = app.metadataCache.getFileCache(file);
				if (!this.isTagged(file, cache, removed) || this.isTagged(file, cache)) return [];
				return [{ line: link.line, text: link.text, file }];
			});

		const offered = candidates(await app.vault.read(master)).map((c) => c.file);
		if (!offered.length) return;
		const tags = removed.map((t) => `#${t}`);
		const tagText = tags.length === 1 ? tags[0] : `${tags.slice(0, -1).join(', ')} or ${tags[tags.length - 1]}`;
		const n = offered.length;
		const names = offered.slice(0, 5).map((f) => `“${f.basename}”`);
		const message =
			n === 1
				? `${names[0]} was added for ${tagText}, which you removed from Project tags. Removing it only takes it out of Plainlist; the note and its to-dos stay as they are.`
				: `${names.join(', ')}${n > 5 ? ` and ${n - 5} more` : ''} were added for ${tagText}, which you removed from Project tags. Removing them only takes them out of Plainlist; the notes and their to-dos stay as they are.`;
		const ok = await confirmModal(app, `Remove ${n === 1 ? 'a project' : `${n} projects`} tagged ${tagText}?`, message, 'Remove', true, 'Keep');
		if (!ok) return;

		let count = 0;
		await app.vault.process(master, (text) =>
			// Re-read in case the task file changed while the dialog was open.
			patchText(text, (doc) => {
				const lines = candidates(text).filter((c) => offered.includes(c.file));
				count = lines.length;
				return lines.flatMap((c) => removeProjectLink(doc, c));
			}),
		);
		if (count) new Notice(`Plainlist: removed ${count === 1 ? '1 project' : `${count} projects`}.`);
	}

	/** Adds a link to each file that isn't a project yet, open or completed. */
	private async addNow(files: TFile[], fromSetting: boolean): Promise<void> {
		const { app } = this.plugin;
		const master = await ensureTasksFile(app, this.plugin.settings.tasksFile);
		const added: TFile[] = [];
		await app.vault.process(master, (text) => {
			const existing = new Set(
				parse(text).projectLinks.map((l) => app.metadataCache.getFirstLinkpathDest(l.target, master.path)?.path ?? l.target),
			);
			added.length = 0;
			for (const file of files) {
				if (file === master || existing.has(file.path)) continue;
				text = patchText(text, (d) => addProjectLink(d, app.fileManager.generateMarkdownLink(file, master.path)));
				existing.add(file.path);
				added.push(file);
			}
			return text;
		});
		if (added.length === 1) new Notice(`Plainlist: added “${added[0]?.basename}” as a project.`);
		else if (added.length > 1) new Notice(`Plainlist: added ${added.length} tagged notes as projects.`);
		else if (fromSetting) new Notice('Plainlist: all tagged notes are already projects.');
	}
}
