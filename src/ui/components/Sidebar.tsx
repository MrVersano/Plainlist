import { Menu, TFile } from 'obsidian';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Counts, ListId, ProjectInfo } from '../../model/lists';
import { sameList } from '../../model/lists';
import { useEnv, useLongPress } from '../env';

export const LISTS: { id: ListId; label: string }[] = [
	{ id: { kind: 'inbox' }, label: 'Inbox' },
	{ id: { kind: 'today' }, label: 'Today' },
	{ id: { kind: 'upcoming' }, label: 'Upcoming' },
	{ id: { kind: 'nodate' }, label: 'No Date' },
	{ id: { kind: 'someday' }, label: 'Someday' },
	{ id: { kind: 'completed' }, label: 'Completed' },
];

export interface ProjectActions {
	create: (name: string) => void;
	import: (file: TFile) => void;
	rename: (project: ProjectInfo, name: string) => void;
	remove: (project: ProjectInfo) => void;
	open: (project: ProjectInfo) => void;
}

export function listLabel(list: ListId, projects: ProjectInfo[]): string {
	if (list.kind === 'project') return projects.find((p) => p.path === list.path)?.name ?? '';
	return LISTS.find((l) => l.id.kind === list.kind)?.label ?? '';
}

export function projectMenu(project: ProjectInfo, actions: ProjectActions, onRename: () => void): Menu {
	const menu = new Menu();
	if (project.exists) {
		menu.addItem((i) => i.setTitle('Open note').setIcon('file-text').onClick(() => actions.open(project)));
		menu.addItem((i) => i.setTitle('Rename').setIcon('pencil').onClick(onRename));
	}
	menu.addItem((i) =>
		i
			.setTitle('Remove from Plainlist')
			.setIcon('x')
			.setWarning(true)
			.onClick(() => actions.remove(project)),
	);
	return menu;
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

export type ProjectChoice = { kind: 'create'; name: string } | { kind: 'import'; file: TFile };

/** Notes that could become projects, best matches first. */
export function noteSuggestions(files: TFile[], query: string, exclude: Set<string>, limit = 6): TFile[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	return files
		.filter((f) => !exclude.has(f.path))
		.map((f) => {
			const name = f.basename.toLowerCase();
			const score = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : f.path.toLowerCase().includes(q) ? 3 : -1;
			return { f, score };
		})
		.filter((x) => x.score >= 0)
		.sort((a, b) => a.score - b.score || a.f.path.localeCompare(b.f.path))
		.slice(0, limit)
		.map((x) => x.f);
}

/** "Create" (unless a note with that name exists) followed by matching notes to import. */
export function projectChoices(files: TFile[], query: string, exclude: Set<string>, limit = 6): ProjectChoice[] {
	const name = query.trim();
	const matches = noteSuggestions(files, name, exclude, limit);
	const exact = matches.some((f) => f.basename.toLowerCase() === name.toLowerCase());
	const create: ProjectChoice[] = name && !exact ? [{ kind: 'create', name }] : [];
	return [...create, ...matches.map((file): ProjectChoice => ({ kind: 'import', file }))];
}

/** "+ New project" input: type a name to create a note, or pick an existing note to import it. */
function AddProject({ exclude, actions, onDone }: { exclude: Set<string>; actions: ProjectActions; onDone: () => void }) {
	const { app } = useEnv();
	const [value, setValue] = useState('');
	const [active, setActive] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => input.current?.focus(), []);

	const choices = projectChoices(app.vault.getMarkdownFiles(), value, exclude);
	const index = Math.min(active, Math.max(choices.length - 1, 0));

	const choose = (c: ProjectChoice | undefined): void => {
		if (!c) return;
		onDone();
		if (c.kind === 'create') actions.create(c.name);
		else actions.import(c.file);
	};

	return (
		<div class="pl-add-project">
			<input
				ref={input}
				class="pl-nav-input"
				type="text"
				aria-label="New project"
				aria-autocomplete="list"
				placeholder="Name, or find a note"
				value={value}
				onInput={(e) => {
					setValue(e.currentTarget.value);
					setActive(0);
				}}
				onKeyDown={(e) => {
					if (e.isComposing) return;
					if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
						e.preventDefault();
						const step = e.key === 'ArrowDown' ? 1 : -1;
						setActive((index + step + choices.length) % Math.max(choices.length, 1));
					} else if (e.key === 'Enter') {
						e.preventDefault();
						choose(choices[index]);
					} else if (e.key === 'Escape') {
						e.stopPropagation();
						onDone();
					}
				}}
				// Leaving the field cancels: creating a note should always be deliberate.
				onBlur={onDone}
			/>
			{choices.length > 0 && (
				<div class="pl-add-options" role="listbox" aria-label="Create or import">
					{choices.map((c, i) => (
						<button
							type="button"
							role="option"
							aria-selected={i === index}
							key={c.kind === 'create' ? '\u0000create' : c.file.path}
							class={`pl-add-option${i === index ? ' is-active' : ''}`}
							// Keep focus in the input so its blur doesn't cancel the choice.
							onMouseDown={(e) => e.preventDefault()}
							onMouseEnter={() => setActive(i)}
							onClick={() => choose(c)}
						>
							{c.kind === 'create' ? (
								<span class="pl-add-name">Create “{c.name}”</span>
							) : (
								<>
									<span class="pl-add-name">{c.file.basename}</span>
									{c.file.parent && c.file.parent.path !== '/' && <span class="pl-add-path">{c.file.parent.path}</span>}
								</>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function ProjectItem({
	project,
	count,
	selected,
	onSelect,
	actions,
}: {
	project: ProjectInfo;
	count: number;
	selected: boolean;
	onSelect: () => void;
	actions: ProjectActions;
}) {
	const [renaming, setRenaming] = useState(false);
	const menu = (pos: { x: number; y: number }): void => {
		projectMenu(project, actions, () => setRenaming(true)).showAtPosition(pos);
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
			class={`pl-nav-item${selected ? ' is-active' : ''}${project.exists ? '' : ' is-missing'}`}
			aria-current={selected ? 'page' : undefined}
			title={project.exists ? project.path : `Note not found: ${project.path}`}
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
	masterPath,
	onSelect,
	actions,
}: {
	list: ListId;
	counts: Counts;
	projects: ProjectInfo[];
	masterPath: string;
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
					key={p.path}
					project={p}
					count={counts.projects[p.path] ?? 0}
					selected={list.kind === 'project' && list.path === p.path}
					onSelect={() => onSelect({ kind: 'project', path: p.path })}
					actions={actions}
				/>
			))}
			{adding ? (
				<AddProject
					exclude={new Set([masterPath, ...projects.map((p) => p.path)])}
					actions={actions}
					onDone={() => setAdding(false)}
				/>
			) : (
				<button type="button" class="pl-nav-add" onClick={() => setAdding(true)}>
					+ New project
				</button>
			)}
		</nav>
	);
}
