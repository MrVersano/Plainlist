import { Menu } from 'obsidian';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Counts, ListId } from '../../model/lists';
import { sameList } from '../../model/lists';
import type { Project } from '../../model/types';
import { useLongPress } from '../env';

export const LISTS: { id: ListId; label: string }[] = [
	{ id: { kind: 'inbox' }, label: 'Inbox' },
	{ id: { kind: 'today' }, label: 'Today' },
	{ id: { kind: 'upcoming' }, label: 'Upcoming' },
	{ id: { kind: 'nodate' }, label: 'No Date' },
	{ id: { kind: 'someday' }, label: 'Someday' },
	{ id: { kind: 'completed' }, label: 'Completed' },
];

export interface ProjectActions {
	add: (name: string) => void;
	rename: (project: Project, name: string) => void;
	remove: (project: Project) => void;
}

export function listLabel(list: ListId): string {
	if (list.kind === 'project') return list.name;
	return LISTS.find((l) => l.id.kind === list.kind)?.label ?? '';
}

function NameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
	const [value, setValue] = useState(initial);
	const finished = useRef(false);
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => input.current?.select(), []);
	const finish = (name: string | null): void => {
		if (finished.current) return;
		finished.current = true;
		onDone(name);
	};
	return (
		<input
			class="pl-nav-input"
			type="text"
			aria-label="Project name"
			placeholder="Project name"
			value={value}
			ref={input}
			onInput={(e) => setValue(e.currentTarget.value)}
			onKeyDown={(e) => {
				if (e.isComposing) return;
				if (e.key === 'Enter') finish(e.currentTarget.value.trim() || null);
				if (e.key === 'Escape') {
					e.stopPropagation();
					finish(null);
				}
			}}
			onBlur={(e) => finish(e.currentTarget.value.trim() || null)}
		/>
	);
}

function ProjectItem({
	project,
	count,
	selected,
	onSelect,
	actions,
}: {
	project: Project;
	count: number;
	selected: boolean;
	onSelect: () => void;
	actions: ProjectActions;
}) {
	const [renaming, setRenaming] = useState(false);
	const menu = (pos: { x: number; y: number }): void => {
		new Menu()
			.addItem((i) => i.setTitle('Rename').setIcon('pencil').onClick(() => setRenaming(true)))
			.addItem((i) => i.setTitle('Delete').setIcon('trash').setWarning(true).onClick(() => actions.remove(project)))
			.showAtPosition(pos);
	};
	const longPress = useLongPress(menu);

	if (renaming) {
		return (
			<NameInput
				initial={project.name}
				onDone={(name) => {
					setRenaming(false);
					if (name && name !== project.name) actions.rename(project, name);
				}}
			/>
		);
	}
	return (
		<button
			type="button"
			class={`pl-nav-item${selected ? ' is-active' : ''}`}
			aria-current={selected ? 'page' : undefined}
			onClick={onSelect}
			onContextMenu={(e) => {
				e.preventDefault();
				menu({ x: e.clientX, y: e.clientY });
			}}
			{...longPress}
		>
			<span class="pl-nav-label">{project.name}</span>
			{selected && count > 0 && <span class="pl-nav-count">{count}</span>}
		</button>
	);
}

export function Sidebar({
	list,
	counts,
	projects,
	onSelect,
	actions,
}: {
	list: ListId;
	counts: Counts;
	projects: Project[];
	onSelect: (list: ListId) => void;
	actions: ProjectActions;
}) {
	const [adding, setAdding] = useState(false);
	const countOf = (id: ListId): number => (id.kind === 'inbox' ? counts.inbox : id.kind === 'today' ? counts.today : 0);

	return (
		<nav class="pl-sidebar" aria-label="Lists">
			{LISTS.map(({ id, label }) => {
				const active = sameList(id, list);
				const count = countOf(id);
				return (
					<button
						type="button"
						key={id.kind}
						class={`pl-nav-item${active ? ' is-active' : ''}`}
						aria-current={active ? 'page' : undefined}
						onClick={() => onSelect(id)}
					>
						<span class="pl-nav-label">{label}</span>
						{count > 0 && <span class="pl-nav-count">{count}</span>}
					</button>
				);
			})}
			<div class="pl-nav-header">Projects</div>
			{projects.map((p) => (
				<ProjectItem
					key={`${p.line}:${p.name}`}
					project={p}
					count={counts.projects[p.name] ?? 0}
					selected={list.kind === 'project' && list.name === p.name}
					onSelect={() => onSelect({ kind: 'project', name: p.name })}
					actions={actions}
				/>
			))}
			{adding ? (
				<NameInput
					initial=""
					onDone={(name) => {
						setAdding(false);
						if (name) actions.add(name);
					}}
				/>
			) : (
				<button type="button" class="pl-nav-add" onClick={() => setAdding(true)}>
					+ New project
				</button>
			)}
		</nav>
	);
}
