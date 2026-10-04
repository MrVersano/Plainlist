import { describe, expect, it } from 'vitest';
import { computeCounts, computeList, type ListId, type ProjectInfo, type Source } from '../src/model/lists';
import { parse } from '../src/model/parse';

const TODAY = '2026-10-04';

const master = parse(
	[
		'---',
		'plainlist: true',
		'---',
		'# Inbox',
		'- [ ] Inbox undated',
		'- [ ] Inbox today [date:: 2026-10-04]',
		'- [ ] Inbox next week [date:: 2026-10-08]',
		'- [ ] Inbox someday [date:: someday]',
		'- [x] Inbox done today [date:: 2026-10-04] [done:: 2026-10-04]',
		'- [x] Inbox done earlier [done:: 2026-10-01]',
		'# Projects',
		'- [[Office]]',
		'- [[Garden]]',
		'# Notes',
		'- [ ] Loose to-do',
	].join('\n'),
);
const office = parse(
	[
		'# Office',
		'- [ ] Overdue [date:: 2026-10-02]',
		'- [ ] Today in project [date:: 2026-10-04]',
		'- [ ] Tomorrow [date:: 2026-10-05]',
		'    - [ ] Nested later this month [date:: 2026-10-20]',
		'- [ ] Undated in project',
		'- [x] Done long ago [date:: 2026-09-01] [done:: 2026-09-02]',
		'- [x] Done without date field',
	].join('\n'),
);
const garden = parse(['- [ ] Bulbs [date:: 2026-11-10]', '- [ ] Garden undated', '- [ ] Garden someday [date:: someday]'].join('\n'));

const projects: ProjectInfo[] = [
	{ path: 'Office.md', name: 'Office', line: 11, text: '- [[Office]]', exists: true },
	{ path: 'Garden.md', name: 'Garden', line: 12, text: '- [[Garden]]', exists: true },
];
const sources: Source[] = [
	// Deliberately out of sidebar order: lists must not depend on source order.
	{ path: 'Garden.md', doc: garden, project: projects[1]! },
	{ path: 'Tasks.md', doc: master, project: null },
	{ path: 'Office.md', doc: office, project: projects[0]! },
];

const titles = (list: ListId) =>
	computeList(sources, projects, list, TODAY).groups.map((g) => [g.label, g.items.map((i) => i.task.title)]);

describe('lists', () => {
	it('Inbox: open task-file to-dos (any date), loose ones included', () => {
		expect(titles({ kind: 'inbox' })).toEqual([
			['', ['Inbox undated', 'Inbox today', 'Inbox next week', 'Inbox someday', 'Loose to-do']],
		]);
	});

	it('Today: overdue first, then task file and projects in sidebar order, plus to-dos completed today', () => {
		expect(titles({ kind: 'today' })).toEqual([['', ['Overdue', 'Inbox today', 'Inbox done today', 'Today in project']]]);
	});

	it('Upcoming: grouped by day, then by month, nested to-dos included', () => {
		expect(
			computeList(sources, projects, { kind: 'upcoming' }, TODAY).groups.map((g) => [g.label, g.sublabel, g.items.map((i) => i.task.title)]),
		).toEqual([
			['Tomorrow', 'Mon 5 Oct', ['Tomorrow']],
			['Thursday', '8 Oct', ['Inbox next week']],
			['Later in October', undefined, ['Nested later this month']],
			['November', undefined, ['Bulbs']],
		]);
	});

	it('No Date: undated project to-dos only, grouped by project in sidebar order', () => {
		expect(titles({ kind: 'nodate' })).toEqual([
			['Office', ['Undated in project']],
			['Garden', ['Garden undated']],
		]);
	});

	it('Someday: grouped with Inbox first', () => {
		expect(titles({ kind: 'someday' })).toEqual([
			['Inbox', ['Inbox someday']],
			['Garden', ['Garden someday']],
		]);
	});

	it('Completed: newest first by day, undated last', () => {
		expect(titles({ kind: 'completed' })).toEqual([
			['Today', ['Inbox done today']],
			['Thursday', ['Inbox done earlier']],
			['September', ['Done long ago']],
			['Earlier', ['Done without date field']],
		]);
	});

	it('Project: open to-dos in note order, completed ones separate', () => {
		const view = computeList(sources, projects, { kind: 'project', path: 'Office.md' }, TODAY);
		expect(view.groups[0]!.items.map((i) => i.task.title)).toEqual([
			'Overdue',
			'Today in project',
			'Tomorrow',
			'Nested later this month',
			'Undated in project',
		]);
		expect(view.completed.map((i) => i.task.title)).toEqual(['Done long ago', 'Done without date field']);
		expect(view.groups[0]!.items.every((i) => i.path === 'Office.md' && i.project?.name === 'Office')).toBe(true);
	});

	it('completed to-dos stay out of the open lists', () => {
		for (const kind of ['inbox', 'upcoming', 'nodate', 'someday'] as const) {
			for (const g of computeList(sources, projects, { kind }, TODAY).groups) expect(g.items.every((i) => !i.task.done)).toBe(true);
		}
	});
});

describe('counts', () => {
	it('counts open Inbox, Today and per-project to-dos (undated included)', () => {
		expect(computeCounts(sources, projects, TODAY)).toEqual({ inbox: 5, today: 3, projects: { 'Office.md': 5, 'Garden.md': 3 } });
	});
});
