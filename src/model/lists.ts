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
	/** How deeply the row is indented under its parent to-do's row. Set only in lists that keep file order. */
	depth?: number;
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

/** Where a to-do lives, for row meta: `Project › Heading`, or just the project. Blank for the task file. */
export function placeLabel(item: Item): string {
	if (!item.project) return '';
	const heading = item.task.heading?.name;
	return heading ? `${item.project.name} › ${heading}` : item.project.name;
}

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

/**
 * Indents each sub-task under its parent's row, for items in file order. A sub-task whose
 * parent is not in the list (done, or elsewhere) stays at the left.
 */
function nested(items: Item[]): Item[] {
	const depths = new Map<string, number>();
	return items.map((i) => {
		const up = i.task.parent === null ? undefined : depths.get(`${i.path}:${i.task.parent}`);
		const depth = up === undefined ? 0 : up + 1;
		depths.set(`${i.path}:${i.task.line}`, depth);
		return { ...i, depth };
	});
}

const nestedGroups = (groups: Group[]): Group[] => groups.map((g) => ({ ...g, items: nested(g.items) }));

export function isInToday(t: Task, today: string): boolean {
	return !t.done && isDated(t) && (t.date ?? '') <= today;
}

export function isOverdue(t: Task, today: string): boolean {
	return !t.done && isDated(t) && (t.date ?? '') < today;
}

/** Stable order across notes: task file first, then projects in sidebar order, then file order. */
function sourceOrder(projects: ProjectInfo[]): (i: Item) => number {
	const rank = new Map(projects.map((p, n) => [p.path, n + 1]));
	return (i) => (i.project ? (rank.get(i.project.path) ?? projects.length + 1) : 0);
}

/** Identifies a to-do in the saved Today order: its note and title, which survive completing it and date changes. */
export function todayKey(item: Item): string {
	return `${item.path}\u0000${item.task.title}`;
}

/**
 * Puts Today's to-dos in the order the user dragged them into. To-dos not in that order yet
 * (new for today, or with an edited title) follow, in their usual order.
 */
export function inTodayOrder(items: Item[], order: string[]): Item[] {
	const rank = new Map<string, number>();
	order.forEach((key, n) => {
		if (!rank.has(key)) rank.set(key, n);
	});
	const ranked = items.filter((i) => rank.has(todayKey(i)));
	ranked.sort((a, b) => (rank.get(todayKey(a)) ?? 0) - (rank.get(todayKey(b)) ?? 0));
	return [...ranked, ...items.filter((i) => !rank.has(todayKey(i)))];
}

/** The Today order after moving `key` just before or after `target`, given the keys as shown. */
export function moveInOrder(shown: string[], key: string, target: string, place: 'before' | 'after'): string[] {
	const rest = shown.filter((k) => k !== key);
	const at = rest.indexOf(target);
	if (at === -1 || key === target) return shown;
	rest.splice(place === 'before' ? at : at + 1, 0, key);
	return rest;
}

export function computeList(
	sources: Source[],
	projects: ProjectInfo[],
	list: ListId,
	today: string,
	/** Saved Today order, as `todayKey`s. */
	todayOrder: string[] = [],
): ListView {
	const items = allItems(sources);
	const rank = sourceOrder(projects);
	const byFile = (a: Item, b: Item): number => rank(a) - rank(b) || a.task.line - b.task.line;
	// A completed project's to-dos stay out of the open lists, even ones added to its note later.
	const open = items.filter((i) => !i.task.done && !i.project?.done).sort(byFile);
	const active = projects.filter((p) => !p.done);

	switch (list.kind) {
		case 'inbox':
			return flat(nested(open.filter((i) => !i.project)));
		case 'today': {
			const all = open.filter((i) => isInToday(i.task, today));
			const usual = [...all.filter((i) => isOverdue(i.task, today)), ...all.filter((i) => !isOverdue(i.task, today))];
			return flat(inTodayOrder(usual, todayOrder));
		}
		case 'upcoming': {
			const future = open
				.filter((i) => isDated(i.task) && (i.task.date ?? '') > today)
				.sort((a, b) => (a.task.date ?? '').localeCompare(b.task.date ?? '') || byFile(a, b));
			return { groups: grouped(future, (i) => upcomingGroup(i.task.date ?? today, today)), completed: [] };
		}
		case 'nodate':
			return { groups: nestedGroups(byProject(active, open.filter((i) => !i.task.date && i.project))), completed: [] };
		case 'someday':
			return { groups: nestedGroups(byProject(active, open.filter((i) => i.task.date === 'someday'))), completed: [] };
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
			// Open to-dos in file order, under their headings; those before any heading come first, unlabelled.
			const groups = grouped(
				own.filter((i) => !i.task.done),
				(i) => (i.task.heading ? { key: `heading:${i.task.heading.line}`, label: i.task.heading.name } : { key: 'all', label: '' }),
			);
			return { groups: nestedGroups(groups), completed: own.filter((i) => i.task.done) };
		}
	}
}

/**
 * One day's to-dos, for a list embedded in a note. Unlike the Today list it keeps completed
 * to-dos, crossed off. Today: the Today list plus what was completed today. An earlier day:
 * what was completed that day (its open to-dos have rolled over to today). A later day: the
 * to-dos dated that day. To-dos dated before the day come first, then Today's saved order applies.
 */
export function computeDay(sources: Source[], projects: ProjectInfo[], day: string, today: string, todayOrder: string[] = []): Item[] {
	const rank = sourceOrder(projects);
	const shown = allItems(sources)
		.filter(({ task, project }) => {
			if (task.done) return task.doneDate === day || (day > today && task.date === day);
			if (project?.done) return false;
			return day === today ? isInToday(task, today) : day > today && task.date === day;
		})
		.sort((a, b) => rank(a) - rank(b) || a.task.line - b.task.line);
	// Not isOverdue: a to-do completed today keeps its place among them.
	const early = (i: Item): boolean => isDated(i.task) && (i.task.date ?? '') < day;
	return inTodayOrder([...shown.filter(early), ...shown.filter((i) => !early(i))], todayOrder);
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

/**
 * The list that always shows a to-do: its project (behind "N completed" when done), the
 * Inbox for open to-dos in the task file, or Completed for done ones.
 */
export function homeList(item: Item): ListId {
	if (item.project) return { kind: 'project', path: item.project.path };
	return item.task.done ? { kind: 'completed' } : { kind: 'inbox' };
}
