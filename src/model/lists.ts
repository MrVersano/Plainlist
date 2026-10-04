// Computes the lists shown in the view from a Doc and today's date. Nothing here is stored.

import { completedGroup, upcomingGroup } from '../dates/format';
import type { Doc, Task } from './types';

export type ListId =
	| { kind: 'inbox' }
	| { kind: 'today' }
	| { kind: 'upcoming' }
	| { kind: 'nodate' }
	| { kind: 'someday' }
	| { kind: 'completed' }
	| { kind: 'project'; name: string };

export interface Group {
	key: string;
	/** Empty for the single unlabelled group of a flat list. */
	label: string;
	sublabel?: string;
	tasks: Task[];
}

export interface ListView {
	groups: Group[];
	/** Project view only: completed to-dos behind the "N completed" toggle. */
	completed: Task[];
}

export const INBOX_GROUP = 'Inbox';

const isDated = (t: Task): t is Task & { date: string } => !!t.date && t.date !== 'someday';
const inInbox = (t: Task): boolean => t.section !== 'project';

/** Groups to-dos by project in sidebar order, with Inbox items first. */
function byProject(doc: Doc, tasks: Task[]): Group[] {
	const groups: Group[] = [];
	const inbox = tasks.filter(inInbox);
	if (inbox.length) groups.push({ key: 'inbox', label: INBOX_GROUP, tasks: inbox });
	for (const p of doc.projects) {
		const own = tasks.filter((t) => t.section === 'project' && t.project === p.name);
		if (own.length) groups.push({ key: `project:${p.line}`, label: p.name, tasks: own });
	}
	return groups;
}

function grouped(tasks: Task[], groupOf: (t: Task) => { key: string; label: string; sublabel?: string }): Group[] {
	const groups: Group[] = [];
	for (const t of tasks) {
		const g = groupOf(t);
		const last = groups[groups.length - 1];
		if (last?.key === g.key) last.tasks.push(t);
		else groups.push({ ...g, tasks: [t] });
	}
	return groups;
}

function flat(tasks: Task[]): ListView {
	return { groups: tasks.length ? [{ key: 'all', label: '', tasks }] : [], completed: [] };
}

export function isInToday(t: Task, today: string): boolean {
	if (!isDated(t) || t.date > today) return false;
	return !t.done || t.doneDate === today;
}

export function isOverdue(t: Task, today: string): boolean {
	return !t.done && isDated(t) && t.date < today;
}

export function computeList(doc: Doc, list: ListId, today: string): ListView {
	const open = doc.tasks.filter((t) => !t.done);
	switch (list.kind) {
		case 'inbox':
			return flat(open.filter(inInbox));
		case 'today': {
			const all = doc.tasks.filter((t) => isInToday(t, today));
			return flat([...all.filter((t) => isOverdue(t, today)), ...all.filter((t) => !isOverdue(t, today))]);
		}
		case 'upcoming': {
			const future = open
				.filter((t): t is Task & { date: string } => isDated(t) && t.date > today)
				.sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line);
			return { groups: grouped(future, (t) => upcomingGroup(t.date ?? today, today)), completed: [] };
		}
		case 'nodate':
			return { groups: byProject(doc, open.filter((t) => !t.date && t.section === 'project')), completed: [] };
		case 'someday':
			return { groups: byProject(doc, open.filter((t) => t.date === 'someday')), completed: [] };
		case 'completed': {
			const done = doc.tasks.filter((t) => t.done);
			const dated = done
				.filter((t) => t.doneDate)
				.sort((a, b) => (b.doneDate ?? '').localeCompare(a.doneDate ?? '') || a.line - b.line);
			const groups = grouped(dated, (t) => completedGroup(t.doneDate ?? today, today));
			const undated = done.filter((t) => !t.doneDate);
			if (undated.length) groups.push({ key: 'earlier', label: 'Earlier', tasks: undated });
			return { groups, completed: [] };
		}
		case 'project': {
			const own = doc.tasks.filter((t) => t.section === 'project' && t.project === list.name);
			return { ...flat(own.filter((t) => !t.done)), completed: own.filter((t) => t.done) };
		}
	}
}

export interface Counts {
	inbox: number;
	today: number;
	projects: Record<string, number>;
}

export function computeCounts(doc: Doc, today: string): Counts {
	const open = doc.tasks.filter((t) => !t.done);
	const projects: Record<string, number> = {};
	for (const p of doc.projects) projects[p.name] = 0;
	for (const t of open) if (t.section === 'project' && t.project !== null) projects[t.project] = (projects[t.project] ?? 0) + 1;
	return {
		inbox: open.filter(inInbox).length,
		today: open.filter((t) => isInToday(t, today)).length,
		projects,
	};
}

export function sameList(a: ListId, b: ListId): boolean {
	return a.kind === b.kind && (a.kind !== 'project' || a.name === (b as { name: string }).name);
}
