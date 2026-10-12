import { useMemo } from 'preact/hooks';
import { computeCounts, type ListId } from '../../model/lists';
import type { UndoEntry } from '../../undo';
import { useEnv, useToday, useWorkspace } from '../env';
import { projectActions } from '../projectActions';
import { LISTS, Sidebar } from './Sidebar';

/**
 * The lists and projects in Obsidian's left sidebar. `list` is the one the Plainlist tab
 * shows, or null with no tab open; picking one shows it there.
 */
export function Nav({
	list,
	onSelect,
	undoToast,
}: {
	list: ListId | null;
	onSelect: (list: ListId) => void;
	undoToast: (message: string, entry: UndoEntry | null) => void;
}) {
	const env = useEnv();
	const { workspace, clock } = env;
	const version = useWorkspace(workspace);
	const today = useToday(clock);
	const sources = useMemo(() => workspace.sources(), [version]);
	const counts = useMemo(() => computeCounts(sources, workspace.projects, today), [sources, today]);
	const actions = projectActions(env, { today, go: onSelect, current: () => list, undoToast });
	return (
		<div class="pl-root pl-nav-root">
			<Sidebar
				list={list}
				counts={counts}
				projects={workspace.projects}
				areas={workspace.areas}
				masterPath={workspace.masterPath}
				onSelect={onSelect}
				actions={actions}
			/>
		</div>
	);
}

/** Just the lists, while the tasks file doesn't exist yet: picking one creates it. */
export function NavPlaceholder({ onSelect }: { onSelect: (list: ListId) => void }) {
	return (
		<div class="pl-root pl-nav-root">
			<nav class="pl-sidebar" aria-label="Lists">
				{LISTS.map(({ id, label }) => (
					<button type="button" key={id.kind} class="pl-nav-item" onClick={() => onSelect(id)}>
						<span class="pl-nav-label">{label}</span>
					</button>
				))}
			</nav>
		</div>
	);
}
