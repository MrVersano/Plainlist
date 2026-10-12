// Opens notes marked `plainlist: true` in the Plainlist view, the way the Kanban plugin does:
// by adjusting the view type in WorkspaceLeaf.setViewState. A per-leaf flag lets the user
// keep a note in Markdown after choosing "Open as Markdown". With "Open project notes in
// Plainlist" on, projects' notes open as the tasks file's tab, showing the project.

import { around } from 'monkey-around';
import { MarkdownView, TFile, WorkspaceLeaf, type ViewState } from 'obsidian';
import { VIEW_ICON, VIEW_TYPE } from './constants';
import type PlainlistPlugin from './main';

export function isPlainlistFile(plugin: PlainlistPlugin, file: TFile | null | undefined): file is TFile {
	if (!file || file.extension !== 'md') return false;
	return plugin.app.metadataCache.getFileCache(file)?.frontmatter?.plainlist === true;
}

export function installViewSwitch(plugin: PlainlistPlugin): void {
	/** Leaves the user switched to Markdown, with the path they were showing. */
	const forceMarkdown = new WeakMap<WorkspaceLeaf, string>();
	plugin.forceMarkdown = forceMarkdown;

	plugin.register(
		around(WorkspaceLeaf.prototype, {
			setViewState(next) {
				return function (this: WorkspaceLeaf, state: ViewState, ...rest: unknown[]) {
					const path = typeof state.state?.file === 'string' ? state.state.file : null;
					if (state.type === 'markdown' && path && forceMarkdown.get(this) !== path) {
						const file = plugin.app.vault.getAbstractFileByPath(path);
						const project = plugin.projectView(path);
						if (plugin.settings.openByDefault && file instanceof TFile && isPlainlistFile(plugin, file)) {
							state = { ...state, type: VIEW_TYPE };
						} else if (project) {
							// A project's note: the tasks file's tab, showing the project.
							state = { ...state, type: VIEW_TYPE, state: { ...state.state, ...project } };
						}
					}
					return next.call(this, state, ...rest);
				};
			},
		}),
	);

	const opensInPlainlist = (file: TFile | null): boolean => {
		const path = file?.path;
		return isPlainlistFile(plugin, file) || (!!path && !!plugin.projectView(path));
	};

	// "Open in Plainlist" on Markdown views of marked notes, and of projects' notes.
	const actions = new WeakMap<MarkdownView, HTMLElement>();
	const refreshActions = (): void => {
		plugin.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) return;
			const wanted = opensInPlainlist(view.file);
			const existing = actions.get(view);
			if (wanted && !existing) {
				actions.set(view, view.addAction(VIEW_ICON, 'Open in Plainlist', () => void plugin.openInPlainlist(leaf)));
			} else if (!wanted && existing) {
				existing.remove();
				actions.delete(view);
			}
		});
	};
	plugin.registerEvent(plugin.app.workspace.on('layout-change', refreshActions));
	plugin.registerEvent(plugin.app.workspace.on('file-open', refreshActions));
	plugin.registerEvent(plugin.app.metadataCache.on('changed', refreshActions));
	plugin.app.workspace.onLayoutReady(refreshActions);

	plugin.registerEvent(
		plugin.app.workspace.on('file-menu', (menu, file, _source, leaf) => {
			if (!(file instanceof TFile)) return;
			if (leaf?.view.getViewType() === VIEW_TYPE) {
				menu.addItem((i) =>
					i
						.setTitle('Open as Markdown')
						.setIcon('file-text')
						.setSection('pane')
						.onClick(() => void plugin.openAsMarkdown(leaf)),
				);
			} else if (opensInPlainlist(file)) {
				menu.addItem((i) =>
					i
						.setTitle('Open in Plainlist')
						.setIcon(VIEW_ICON)
						.setSection('pane')
						.onClick(() => void plugin.openInPlainlist(leaf ?? plugin.app.workspace.getLeaf(false), file)),
				);
			}
		}),
	);
}
