import type { ListId } from '../model/lists';
import type { RunResult } from '../store';
import { quoted, type UndoEntry } from '../undo';
import { AreaSuggestModal } from './AreaSuggestModal';
import type { ProjectActions } from './components/Sidebar';
import type { Env } from './env';

export interface ProjectActionHooks {
	today: string;
	/** Shows a list: a new project once it is made, the Inbox once the one shown is removed. */
	go: (list: ListId) => void;
	/** The list being shown, if any. */
	current: () => ListId | null;
	/** Says "Completed", offering to undo it. */
	undoToast: (message: string, entry: UndoEntry | null) => void;
}

/** What the sidebar's and a project header's buttons and menus do to projects and areas. */
export function projectActions(env: Env, hooks: ProjectActionHooks): ProjectActions {
	const { app, workspace } = env;
	/** Lets Mod+Z put back what an action wrote. */
	const remember = (label: string, res: Promise<RunResult>): Promise<RunResult> =>
		res.then((r) => {
			workspace.remember(label, r);
			return r;
		});
	const actions: ProjectActions = {
		create: (name) => {
			void workspace.createProject(name).then((p) => p && hooks.go({ kind: 'project', path: p.path }));
		},
		import: (file) => {
			void workspace.importProject(file).then((p) => p && hooks.go({ kind: 'project', path: p.path }));
		},
		rename: (p, name) => void workspace.renameProject(p, name),
		remove: (p) => {
			void env
				.confirm(`Remove “${p.name}” from Plainlist?`, 'The note and its checkboxes stay as they are; its to-dos just stop showing here.', 'Remove')
				.then((ok) => {
					if (!ok) return;
					void workspace.removeProject(p).then((res) => {
						const list = hooks.current();
						if (res.ok && list?.kind === 'project' && list.path === p.path) hooks.go({ kind: 'inbox' });
					});
				});
		},
		open: (p) => (env.openNote ? env.openNote(p.path) : void app.workspace.openLinkText(p.path, workspace.masterPath, 'tab')),
		complete: (p) => {
			const open = workspace.openTaskCount(p);
			const go = (): void => {
				void workspace.completeProject(p, hooks.today).then((undo) => {
					if (!undo) return;
					// Kept on the undo history too, for Mod+Z.
					const entry = workspace.undo.push(`Completed ${quoted(p.name)}`, () => {
						undo();
						return Promise.resolve(true);
					});
					hooks.undoToast('Completed', entry);
				});
			};
			if (!open) return go();
			void env
				.confirm(`Complete “${p.name}”?`, `Its ${open} open to-do${open === 1 ? '' : 's'} will be marked as done too.`, 'Complete', false)
				.then((ok) => ok && go());
		},
		reopen: (p) => void workspace.reopenProject(p),
		move: (p, target, place) => void remember(`Moved ${quoted(p.name)}`, workspace.moveProject(p, target, place)),
		moveToArea: (p, area) => void remember(`Moved ${quoted(p.name)}`, workspace.moveProjectToArea(p, area)),
		chooseArea: (p) => new AreaSuggestModal(app, workspace.areas, (area) => actions.moveToArea(p, area)).open(),
		addArea: (name) => void remember(`Added the area ${quoted(name)}`, workspace.addArea(name)),
		renameArea: (area, name) => void remember(`Renamed the area ${quoted(area.name)}`, workspace.renameArea(area, name)),
		moveArea: (area, target, place) => void remember(`Moved the area ${quoted(area.name)}`, workspace.moveArea(area, target, place)),
		removeArea: (area) => {
			void env
				.confirm(`Remove the area “${area.name}”?`, 'Its projects stay in Plainlist, and join the list above it.', 'Remove')
				.then((ok) => ok && void remember(`Removed the area ${quoted(area.name)}`, workspace.removeArea(area)));
		},
	};
	return actions;
}
