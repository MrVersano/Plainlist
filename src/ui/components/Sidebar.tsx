import { Menu, TFile } from 'obsidian';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Counts, ListId, ProjectInfo } from '../../model/lists';
import { sameList } from '../../model/lists';
import type { Place } from '../../model/patch';
import { useEnv, type SidebarLayout } from '../env';
import { useReorder } from '../reorder';

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
	complete: (project: ProjectInfo) => void;
	reopen: (project: ProjectInfo) => void;
	/** Moves a project just before or after another in the sidebar. */
	move: (project: ProjectInfo, target: ProjectInfo, place: Place) => void;
}

export function listLabel(list: ListId, projects: ProjectInfo[]): string {
	if (list.kind === 'project') return projects.find((p) => p.path === list.path)?.name ?? '';
	return LISTS.find((l) => l.id.kind === list.kind)?.label ?? '';
}

export function projectMenu(project: ProjectInfo, actions: ProjectActions, onRename: () => void): Menu {
	const menu = new Menu();
	menu.addItem((i) =>
		project.done
			? i.setTitle('Reopen project').setIcon('rotate-ccw').onClick(() => actions.reopen(project))
			: i.setTitle('Complete project').setIcon('check').onClick(() => actions.complete(project)),
	);
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
	renaming,
	onSelect,
	onRenamed,
	drag,
	actions,
}: {
	project: ProjectInfo;
	count: number;
	selected: boolean;
	renaming: boolean;
	onSelect: () => void;
	onRenamed: () => void;
	/** Drag-to-reorder handlers (they also open the menu), and the item's drag state class. */
	drag: { props: Record<string, unknown>; cls: string };
	actions: ProjectActions;
}) {
	if (renaming) {
		return (
			<NameInput
				initial={project.name}
				onDone={(name) => {
					onRenamed();
					if (name && name !== project.name) actions.rename(project, name);
				}}
			/>
		);
	}
	return (
		<button
			type="button"
			class={`pl-nav-item${selected ? ' is-active' : ''}${project.exists ? '' : ' is-missing'}${project.done ? ' is-done' : ''}${drag.cls}`}
			aria-current={selected ? 'page' : undefined}
			title={project.exists ? project.path : `Note not found: ${project.path}`}
			onClick={onSelect}
			{...drag.props}
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
	const open = projects.filter((p) => !p.done);
	const done = projects.filter((p) => p.done);
	const [showDone, setShowDone] = useState(false);
	// Viewing a completed project: keep it visible in the sidebar.
	const viewingDone = list.kind === 'project' && done.some((p) => p.path === list.path);
	useEffect(() => {
		if (viewingDone) setShowDone(true);
	}, [viewingDone]);
	const countOf = (id: ListId): number => (id.kind === 'inbox' ? counts.inbox : id.kind === 'today' ? counts.today : 0);
	/** Path of the project being renamed inline. */
	const [renaming, setRenaming] = useState<string | null>(null);
	// Open projects can be dragged into a new order; completed ones only have the menu.
	const reorder = useReorder<ProjectInfo>({
		entries: projects.map((p) => ({ key: p.path, item: p })),
		canDrag: (p) => !p.done,
		canDrop: (a, b) => !a.done && !b.done,
		onDrop: actions.move,
		onMenu: (p, pos) => projectMenu(p, actions, () => setRenaming(p.path)).showAtPosition(pos),
	});
	const item = (p: ProjectInfo, count: number) => (
		<ProjectItem
			key={p.path}
			project={p}
			count={count}
			selected={list.kind === 'project' && list.path === p.path}
			renaming={renaming === p.path}
			onSelect={() => onSelect({ kind: 'project', path: p.path })}
			onRenamed={() => setRenaming(null)}
			drag={{ props: reorder.rowProps(p.path), cls: reorder.rowClass(p.path) }}
			actions={actions}
		/>
	);

	return (
		<nav class="pl-sidebar" aria-label="Lists" {...reorder.scopeProps}>
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
			{open.map((p) => item(p, counts.projects[p.path] ?? 0))}
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
			{done.length > 0 && (
				<button type="button" class="pl-nav-completed" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
					{showDone ? 'Hide completed' : `${done.length} completed`}
				</button>
			)}
			{showDone && done.map((p) => item(p, 0))}
		</nav>
	);
}

/** The narrowest and widest the sidebar can be dragged. Below COLLAPSE_AT it closes. */
const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const COLLAPSE_AT = 100;
/** Room the to-do list keeps when the sidebar is dragged wide. */
const MIN_CONTENT = 320;
const KEY_STEP = 20;

/**
 * The sidebar's right edge: drag it to resize the sidebar, or all the way left to close it.
 * Closed, it sits at the view's left edge, where dragging (or clicking) brings the sidebar back.
 * `onChange` is called while dragging, then once more with `done` when the drag ends.
 */
export function SidebarHandle({ layout, onChange }: { layout: SidebarLayout; onChange: (layout: SidebarLayout, done: boolean) => void }) {
	const maxWidth = (root: HTMLElement): number => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, root.clientWidth - MIN_CONTENT));

	const onPointerDown = (e: PointerEvent): void => {
		if (e.button !== 0) return;
		e.preventDefault();
		const handle = e.currentTarget as HTMLElement;
		const root = handle.closest<HTMLElement>('.pl-root');
		if (!root) return;
		const left = root.getBoundingClientRect().left;
		const start = layout;
		let current = layout;
		let moved = false;
		handle.setPointerCapture(e.pointerId);
		root.addClass('is-resizing');
		const move = (evt: PointerEvent): void => {
			if (!moved && Math.abs(evt.clientX - e.clientX) < 3) return;
			moved = true;
			const width = evt.clientX - left;
			current = width < COLLAPSE_AT ? { width: start.width, hidden: true } : { width: Math.round(Math.min(width, maxWidth(root))), hidden: false };
			current.width = Math.max(MIN_WIDTH, current.width);
			onChange(current, false);
		};
		const up = (): void => {
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			handle.removeEventListener('pointercancel', up);
			root.removeClass('is-resizing');
			// Clicking the closed sidebar's edge opens it again.
			if (!moved && start.hidden) current = { ...start, hidden: false };
			onChange(current, true);
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up);
		handle.addEventListener('pointercancel', up);
	};

	const onKeyDown = (e: KeyboardEvent): void => {
		const root = (e.currentTarget as HTMLElement).closest<HTMLElement>('.pl-root');
		if (!root) return;
		let next: SidebarLayout | null = null;
		if (e.key === 'Enter' || e.key === ' ') next = { ...layout, hidden: !layout.hidden };
		else if (e.key === 'ArrowRight') {
			next = layout.hidden ? { ...layout, hidden: false } : { ...layout, width: Math.min(layout.width + KEY_STEP, maxWidth(root)) };
		} else if (e.key === 'ArrowLeft' && !layout.hidden) {
			next = layout.width - KEY_STEP < MIN_WIDTH ? { ...layout, hidden: true } : { ...layout, width: layout.width - KEY_STEP };
		}
		if (!next) return;
		e.preventDefault();
		e.stopPropagation();
		onChange(next, true);
	};

	return (
		<div
			class={`pl-sidebar-handle${layout.hidden ? ' is-closed' : ''}`}
			role="separator"
			aria-orientation="vertical"
			aria-label={layout.hidden ? 'Show sidebar' : 'Resize sidebar'}
			aria-valuemin={0}
			aria-valuemax={MAX_WIDTH}
			aria-valuenow={layout.hidden ? 0 : layout.width}
			title={layout.hidden ? 'Drag or click to show the sidebar' : 'Drag to resize, or all the way left to hide'}
			tabIndex={0}
			onPointerDown={onPointerDown}
			onKeyDown={onKeyDown}
		/>
	);
}
