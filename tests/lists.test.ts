import { describe, expect, it } from 'vitest';
import { computeCounts, computeList, ListId } from '../src/model/lists';
import { parse } from '../src/model/parse';
import { fixture } from './helpers';

const TODAY = '2026-10-04';
const doc = parse(
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
		'## Office',
		'- [ ] Overdue [date:: 2026-10-02]',
		'- [ ] Today in project [date:: 2026-10-04]',
		'- [ ] Tomorrow [date:: 2026-10-05]',
		'- [ ] Later this month [date:: 2026-10-20]',
		'- [ ] Undated in project',
		'- [x] Done long ago [date:: 2026-09-01] [done:: 2026-09-02]',
		'- [x] Done without date field',
		'## Garden',
		'- [ ] Bulbs [date:: 2026-11-10]',
		'- [ ] Garden undated',
		'- [ ] Garden someday [date:: someday]',
		'# Notes',
		'- [ ] Loose to-do',
	].join('\n'),
);

const titles = (list: ListId) => computeList(doc, list, TODAY).groups.map((g) => [g.label, g.tasks.map((t) => t.title)]);

describe('lists', () => {
	it('Inbox: open Inbox to-dos (any date) plus loose ones, in file order', () => {
		expect(titles({ kind: 'inbox' })).toEqual([
			['', ['Inbox undated', 'Inbox today', 'Inbox next week', 'Inbox someday', 'Loose to-do']],
		]);
	});

	it('Today: overdue first, then file order, plus to-dos completed today', () => {
		expect(titles({ kind: 'today' })).toEqual([
			['', ['Overdue', 'Inbox today', 'Inbox done today', 'Today in project']],
		]);
	});

	it('Upcoming: grouped by day, then by month', () => {
		expect(computeList(doc, { kind: 'upcoming' }, TODAY).groups.map((g) => [g.label, g.sublabel, g.tasks.map((t) => t.title)])).toEqual([
			['Tomorrow', 'Mon 5 Oct', ['Tomorrow']],
			['Thursday', '8 Oct', ['Inbox next week']],
			['Later in October', undefined, ['Later this month']],
			['November', undefined, ['Bulbs']],
		]);
	});

	it('No Date: undated project to-dos only, grouped by project', () => {
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

	it('Project: open to-dos, with completed ones separate', () => {
		const view = computeList(doc, { kind: 'project', name: 'Office' }, TODAY);
		expect(view.groups[0]!.tasks.map((t) => t.title)).toEqual(['Overdue', 'Today in project', 'Tomorrow', 'Later this month', 'Undated in project']);
		expect(view.completed.map((t) => t.title)).toEqual(['Done long ago', 'Done without date field']);
	});

	it('completed to-dos show only in Completed, their project toggle, and Today when done today', () => {
		const lists: ListId[] = [{ kind: 'inbox' }, { kind: 'upcoming' }, { kind: 'nodate' }, { kind: 'someday' }];
		for (const list of lists) {
			for (const g of computeList(doc, list, TODAY).groups) expect(g.tasks.every((t) => !t.done)).toBe(true);
		}
	});

	it('a dated Inbox to-do appears in Inbox and in Today or Upcoming', () => {
		const inbox = titles({ kind: 'inbox' }).flatMap(([, t]) => t);
		expect(inbox).toContain('Inbox today');
		expect(titles({ kind: 'today' }).flatMap(([, t]) => t)).toContain('Inbox today');
		expect(titles({ kind: 'upcoming' }).flatMap(([, t]) => t)).toContain('Inbox next week');
	});
});

describe('counts', () => {
	it('counts open Inbox, Today and per-project to-dos (undated included)', () => {
		expect(computeCounts(doc, TODAY)).toEqual({ inbox: 5, today: 3, projects: { Office: 5, Garden: 3 } });
	});

	it('matches the mockups on the example file', () => {
		const counts = computeCounts(parse(fixture('example.md')), TODAY);
		expect(counts.inbox).toBe(2);
		expect(counts.projects['Renovate home office']).toBe(3);
	});
});
