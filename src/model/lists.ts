// Computes the lists shown in the view from the task file, the project notes and
// today's date. Nothing here is stored.

import { completedGroup, upcomingGroup } from '../dates/format';
import type { Doc, Task } from './types';

export interface ProjectInfo {
	/** Path of the project note, or the link target when the note is missing. */
	path: string;
	name: string;
	/** The project's link line in the task file. */
	line: number;
	text: string;
	/** False when the link does not resolve to a note. */
	exists: boolean;
	done: boolean;
	doneDate: string | null;
}

/** A note Plainlist reads: the task file (project null) or a project note. */
export interface Source {
	path: string;
	doc: Doc;
	project: ProjectInfo | null;
}

export interface Item {
	task: Task;
	/** Path of the note the to-do lives in. */
	path: string;
	project: ProjectInfo | null;
}

export type ListId =
	| { kind: 'inbox' }
	| { kind: 'today' }
	| { kind: 'upcoming' }
	| { kind: 'nodate' }
	| { kind: 'someday' }
	| { kind: 'completed' }
	| { kind: 'project'; path: string };

export interface Group {
	key: string;
	/** Empty for the single unlabelled group of a flat list. */
	label: string;
	sublabel?: string;
	items: Item[];
	/** Completed list only: projects completed on this group's day, shown before its to-dos. */
	projects?: ProjectInfo[];
}

export interface ListView {
	groups: Group[];
	/** Project view only: completed to-dos behind the "N completed" toggle. */
	completed: Item[];
}

export const INBOX_GROUP = 'Inbox';

const isDated = (t: Task): boolean => !!t.date && t.date !== 'someday';

export function allItems(sources: Source[]): Item[] {
	return sources.flatMap((s) => s.doc.tasks.map((task) => ({ task, path: s.path, project: s.project })));
}

/** Groups items by project in sidebar order, with Inbox items first. */
function byProject(projects: ProjectInfo[], items: Item[]): Group[] {
	const groups: Group[] = [];
	const inbox = items.filter((i) => !i.project);
	if (inbox.length) groups.push({ key: 'inbox', label: INBOX_GROUP, items: inbox });
	for (const p of projects) {
		const own = items.filter((i) => i.project?.path === p.path);
		if (own.length) groups.push({ key: `project:${p.path}`, label: p.name, items: own });
	}
	return groups;
}

function grouped(items: Item[], groupOf: (i: Item) => { key: string; label: string; sublabel?: string }): Group[] {
	const groups: Group[] = [];
	for (const item of items) {
		const g = groupOf(item);
		const last = groups[groups.length - 1];
		if (last?.key === g.key) last.items.push(item);
		else groups.push({ ...g, items: [item] });
	}
	return groups;
}

function flat(items: Item[]): ListView {
	return { groups: items.length ? [{ key: 'all', label: '', items }] : [], completed: [] };
}

export function isInToday(t: Task, today: string): boolean {
	if (!isDated(t) || (t.date ?? '') > today) return false;
	return !t.done || t.doneDate === today;
}

export function isOverdue(t: Task, today: string): boolean {
	return !t.done && isDated(t) && (t.date ?? '') < today;
}

/** Stable order across notes: task file first, then projects in sidebar order, then file order. */
function sourceOrder(projects: ProjectInfo[]): (i: Item) => number {
	const rank = new Map(projects.map((p, n) => [p.path, n + 1]));
	return (i) => (i.project ? (rank.get(i.project.path) ?? projects.length + 1) : 0);
}

export function computeList(sources: Source[], projects: ProjectInfo[], list: ListId, today: string): ListView {
	const items = allItems(sources);
	const rank = sourceOrder(projects);
	const byFile = (a: Item, b: Item): number => rank(a) - rank(b) || a.task.line - b.task.line;
	// A completed project's to-dos stay out of the open lists, even ones added to its note later.
	const open = items.filter((i) => !i.task.done && !i.project?.done).sort(byFile);
	const active = projects.filter((p) => !p.done);

	switch (list.kind) {
		case 'inbox':
			return flat(open.filter((i) => !i.project));
		case 'today': {
			const all = items.filter((i) => isInToday(i.task, today) && (!i.project?.done || i.task.done)).sort(byFile);
			return flat([...all.filter((i) => isOverdue(i.task, today)), ...all.filter((i) => !isOverdue(i.task, today))]);
		}
		case 'upcoming': {
			const future = open
				.filter((i) => isDated(i.task) && (i.task.date ?? '') > today)
				.sort((a, b) => (a.task.date ?? '').localeCompare(b.task.date ?? '') || byFile(a, b));
			return { groups: grouped(future, (i) => upcomingGroup(i.task.date ?? today, today)), completed: [] };
		}
		case 'nodate':
			return { groups: byProject(active, open.filter((i) => !i.task.date && i.project)), completed: [] };
		case 'someday':
			return { groups: byProject(active, open.filter((i) => i.task.date === 'someday')), completed: [] };
		case 'completed': {
			const done = items.filter((i) => i.task.done);
			const dated = done
				.filter((i) => i.task.doneDate)
				.sort((a, b) => (b.task.doneDate ?? '').localeCompare(a.task.doneDate ?? '') || byFile(a, b));
			const groups = grouped(dated, (i) => completedGroup(i.task.doneDate ?? today, today));
			const undated = done.filter((i) => !i.task.doneDate).sort(byFile);
			if (undated.length) groups.push({ key: 'earlier', label: 'Earlier', items: undated });
			// Completed projects join the group for their day (or Earlier), ahead of its to-dos.
			for (const p of projects.filter((x) => x.done)) {
				const g = p.doneDate ? completedGroup(p.doneDate, today) : { key: 'earlier', label: 'Earlier' };
				let group = groups.find((x) => x.key === g.key);
				if (!group) {
					group = { ...g, items: [] };
					const at = groups.findIndex((x) => x.key === 'earlier' || (p.doneDate !== null && x.key < g.key));
					groups.splice(at === -1 ? groups.length : at, 0, group);
				}
				(group.projects ??= []).push(p);
			}
			return { groups, completed: [] };
		}
		case 'project': {
			const own = items.filter((i) => i.project?.path === list.path).sort(byFile);
			return { ...flat(own.filter((i) => !i.task.done)), completed: own.filter((i) => i.task.done) };
		}
	}
}

export interface Counts {
	inbox: number;
	today: number;
	/** Open to-dos per project path. */
	projects: Record<string, number>;
}

export function computeCounts(sources: Source[], projects: ProjectInfo[], today: string): Counts {
	const open = allItems(sources).filter((i) => !i.task.done && !i.project?.done);
	const counts: Record<string, number> = {};
	for (const p of projects) counts[p.path] = 0;
	for (const i of open) if (i.project) counts[i.project.path] = (counts[i.project.path] ?? 0) + 1;
	return {
		inbox: open.filter((i) => !i.project).length,
		today: open.filter((i) => isInToday(i.task, today)).length,
		projects: counts,
	};
}

export function sameList(a: ListId, b: ListId): boolean {
	return a.kind === b.kind && (a.kind !== 'project' || a.path === (b as { path: string }).path);
}
