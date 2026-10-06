import { describe, expect, it } from 'vitest';
import { allItems, computeCounts, computeList, homeList, placeLabel, type ListId, type ProjectInfo, type Source } from '../src/model/lists';
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

const project = (path: string, line: number, extra: Partial<ProjectInfo> = {}): ProjectInfo => ({
	path,
	name: path.replace('.md', ''),
	line,
	text: `- [[${path.replace('.md', '')}]]`,
	exists: true,
	done: false,
	doneDate: null,
	...extra,
});
const projects: ProjectInfo[] = [project('Office.md', 11), project('Garden.md', 12)];
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

describe('completed projects', () => {
	const shed = parse(['- [x] Paint the shed [done:: 2026-10-03]', '- [ ] Added to the note later [date:: 2026-10-04]'].join('\n'));
	const shedProject = project('Shed.md', 13, { done: true, doneDate: '2026-10-03' });
	const old = project('Old.md', 14, { done: true, doneDate: null });
	const all = [...projects, shedProject, old];
	const withShed: Source[] = [...sources, { path: 'Shed.md', doc: shed, project: shedProject }, { path: 'Old.md', doc: parse(''), project: old }];
	const names = (list: ListId) => computeList(withShed, all, list, TODAY).groups.flatMap((g) => g.items.map((i) => i.task.title));

	it("keeps a completed project's open to-dos out of the open lists and counts", () => {
		for (const kind of ['inbox', 'today', 'upcoming', 'nodate', 'someday'] as const) expect(names({ kind })).not.toContain('Added to the note later');
		expect(computeCounts(withShed, all, TODAY).today).toBe(3);
	});

	it('still shows them in the project view', () => {
		expect(computeList(withShed, all, { kind: 'project', path: 'Shed.md' }, TODAY).groups[0]!.items.map((i) => i.task.title)).toEqual([
			'Added to the note later',
		]);
	});

	it('lists completed projects in Completed, in their day group, before its to-dos', () => {
		const groups = computeList(withShed, all, { kind: 'completed' }, TODAY).groups;
		expect(groups.map((g) => [g.label, (g.projects ?? []).map((p) => p.name), g.items.map((i) => i.task.title)])).toEqual([
			['Today', [], ['Inbox done today']],
			['Yesterday', ['Shed'], ['Paint the shed']],
			['Thursday', [], ['Inbox done earlier']],
			['September', [], ['Done long ago']],
			['Earlier', ['Old'], ['Done without date field']],
		]);
	});

	it('adds a day group for a project completed on a day with no to-dos', () => {
		const lone = project('Lone.md', 15, { done: true, doneDate: '2026-10-02' });
		const groups = computeList([...sources, { path: 'Lone.md', doc: parse(''), project: lone }], [...projects, lone], { kind: 'completed' }, TODAY).groups;
		expect(groups.map((g) => g.label)).toEqual(['Today', 'Friday', 'Thursday', 'September', 'Earlier']);
	});
});

describe('headings in a project', () => {
	const sectioned = parse(['- [ ] Loose', '## Walls', '- [ ] Paint', '- [x] Sand [done:: 2026-10-01]', '## Floor', '- [ ] Tiles [date:: 2026-10-04]'].join('\n'));
	const p = project('Office.md', 11);
	const sources: Source[] = [{ path: 'Tasks.md', doc: master, project: null }, { path: 'Office.md', doc: sectioned, project: p }];

	it('groups the project view by heading, with to-dos before any heading first', () => {
		const view = computeList(sources, [p], { kind: 'project', path: 'Office.md' }, TODAY);
		expect(view.groups.map((g) => [g.label, g.items.map((i) => i.task.title)])).toEqual([
			['', ['Loose']],
			['Walls', ['Paint']],
			['Floor', ['Tiles']],
		]);
		expect(view.completed.map((i) => i.task.title)).toEqual(['Sand']);
	});

	it('labels a to-do with its project and heading', () => {
		const item = computeList(sources, [p], { kind: 'today' }, TODAY).groups[0]!.items.find((i) => i.task.title === 'Tiles')!;
		expect(placeLabel(item)).toBe('Office › Floor');
	});
});

describe('homeList', () => {
	it('is a list that shows every to-do, done ones and loose ones included', () => {
		const done = project('Office.md', 11, { done: true, doneDate: '2026-10-03' });
		for (const ps of [projects, [done, projects[1]!]]) {
			const srcs = sources.map((s) => (s.project?.path === 'Office.md' ? { ...s, project: ps[0]! } : s));
			for (const item of allItems(srcs)) {
				const view = computeList(srcs, ps, homeList(item), TODAY);
				const shown = [...view.groups.flatMap((g) => g.items), ...view.completed];
				expect(shown.some((i) => i.path === item.path && i.task.line === item.task.line), item.task.title).toBe(true);
			}
		}
	});
});
