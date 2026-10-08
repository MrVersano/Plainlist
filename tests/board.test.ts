import { describe, expect, it } from 'vitest';
import { applyEdits, patchText } from '../src/model/apply';
import {
	columnOf,
	DEFAULT_COLUMNS,
	enterColumn,
	fieldFor,
	headingBoard,
	moveCard,
	normaliseBoard,
	reconcileColumns,
	renameColumn,
	setColumnFlag,
	statusBoard,
	unknownColumns,
	withNewColumns,
	type ColumnDef,
} from '../src/model/board';
import { allItems } from '../src/model/lists';
import { parse } from '../src/model/parse';
import { completeRepeating, refOf, setTaskDone, setTaskTitle } from '../src/model/patch';
import { parseTaskLine, setCol, setDate, setDone, setRepeat, setTitle } from '../src/model/taskLine';
import type { Doc } from '../src/model/types';

const TODAY = '2026-10-08';
const cols = DEFAULT_COLUMNS;

function task(doc: Doc, prefix: string) {
	const t = doc.tasks.find((x) => x.title.startsWith(prefix));
	if (!t) throw new Error(`no task ${prefix}`);
	return t;
}

describe('the col field', () => {
	it('is read, trimmed, and kept out of the title', () => {
		const t = parseTaskLine('- [ ] Learn SNOW AI [date:: 2026-10-08] [col::  Doing ]');
		expect(t?.title).toBe('Learn SNOW AI');
		expect(t?.col?.value).toBe('Doing');
		expect(parse('- [ ] A [col:: Doing]\n').tasks[0]?.col).toBe('Doing');
		expect(parse('- [ ] A\n').tasks[0]?.col).toBeNull();
	});

	it('is set at the end, replaced, and removed', () => {
		expect(setCol('- [ ] A [date:: 2026-10-08]', 'Doing')).toBe('- [ ] A [date:: 2026-10-08] [col:: Doing]');
		expect(setCol('- [ ] A [col:: Doing]', 'Waiting')).toBe('- [ ] A [col:: Waiting]');
		expect(setCol('- [ ] A [col:: Doing]', null)).toBe('- [ ] A');
		expect(setCol('- [ ] A', null)).toBe('- [ ] A');
	});

	it('stays last when other fields are added', () => {
		expect(setDone('- [ ] A [col:: Done]', true, TODAY)).toBe(`- [x] A [done:: ${TODAY}] [col:: Done]`);
		expect(setDone(`- [x] A [done:: ${TODAY}] [col:: Done]`, false, TODAY)).toBe('- [ ] A [col:: Done]');
		expect(setDate('- [ ] A [col:: Doing]', TODAY)).toBe(`- [ ] A [date:: ${TODAY}] [col:: Doing]`);
		expect(setRepeat('- [ ] A [col:: Doing]', 'every day')).toBe('- [ ] A [repeat:: every day] [col:: Doing]');
	});

	it('survives editing the title', () => {
		expect(setTitle('- [ ] A [date:: 2026-10-08] [col:: Doing]', 'B')).toBe('- [ ] B [date:: 2026-10-08] [col:: Doing]');
		expect(patchText('- [ ] A [col:: Doing]\n', (d) => setTaskTitle(d, refOf(d.tasks[0]!), 'B'))).toBe('- [ ] B [col:: Doing]\n');
	});

	it('is dropped from the next one of a repeating to-do', () => {
		const doc = parse('- [ ] Water [date:: 2026-10-08] [repeat:: every day] [col:: Doing]\n');
		const r = completeRepeating(doc, refOf(doc.tasks[0]!), TODAY, 1);
		expect(applyEdits(doc, r!.edits)).toBe(
			'- [ ] Water [date:: 2026-10-09] [repeat:: every day]\n' + `- [x] Water [date:: 2026-10-08] [done:: ${TODAY}] [col:: Doing]\n`,
		);
	});
});

describe('columns', () => {
	it('puts a to-do by its field, without one in the first column, and checked ones in Done', () => {
		expect(columnOf(cols, { col: null, done: false }).index).toBe(0);
		expect(columnOf(cols, { col: 'doing ', done: false }).index).toBe(1);
		expect(columnOf(cols, { col: null, done: true }).index).toBe(2);
		expect(columnOf(cols, { col: 'Waiting', done: false })).toEqual({ index: 0, unknown: 'Waiting' });
		expect(columnOf([{ name: 'A' }, { name: 'B' }], { col: null, done: true }).index).toBe(0);
	});

	it('writes no field for the first column, unless a checked one would then go to Done', () => {
		expect(fieldFor(cols, 0, false)).toBeNull();
		expect(fieldFor(cols, 0, true)).toBe('To do');
		expect(fieldFor(cols, 1, false)).toBe('Doing');
		expect(fieldFor(cols, 2, true)).toBe('Done');
	});

	it('checks when entering Done and unchecks when leaving it', () => {
		expect(enterColumn(cols, 0, 2, false)).toEqual({ field: 'Done', done: true });
		expect(enterColumn(cols, 2, 1, true)).toEqual({ field: 'Doing', done: false });
		expect(enterColumn(cols, 2, 0, true)).toEqual({ field: null, done: false });
		const keep: ColumnDef[] = [{ name: 'To do' }, { name: 'Done', checkOnEnter: true, receivesChecked: true }];
		expect(enterColumn(keep, 1, 0, true)).toEqual({ field: 'To do', done: true });
	});

	it('finds unknown fields and adds them before the column that checks', () => {
		const doc = parse('- [ ] A [col:: Waiting]\n- [ ] B [col:: doing]\n\t- [ ] C [col:: Nested]\n- [ ] D [col:: waiting]\n');
		expect(unknownColumns(doc, cols)).toEqual(['Waiting']);
		expect(withNewColumns(cols, ['Waiting']).map((c) => c.name)).toEqual(['To do', 'Doing', 'Waiting', 'Done']);
		expect(withNewColumns([{ name: 'A' }], ['B']).map((c) => c.name)).toEqual(['A', 'B']);
	});

	it('lets only one column receive checked to-dos', () => {
		const next = setColumnFlag(cols, 1, 'receivesChecked', true);
		expect(next.map((c) => !!c.receivesChecked)).toEqual([false, true, false]);
		expect(setColumnFlag(cols, 2, 'checkOnEnter', false)[2]).toEqual({ name: 'Done', receivesChecked: true });
	});

	it('reads saved settings defensively', () => {
		const b = normaliseBoard({ doneDays: 3, defaultColumns: [{ name: 'A' }, { name: 'a' }, { name: '' }], projects: { 'P.md': { view: 'board', columns: 'x' } } });
		expect(b.doneDays).toBe(3);
		expect(b.autoCreateColumns).toBe(true);
		expect(b.defaultColumns).toEqual([{ name: 'A' }]);
		expect(b.projects['P.md']).toEqual({ view: 'board', groupBy: 'status' });
		expect(normaliseBoard(null).defaultColumns.map((c) => c.name)).toEqual(['To do', 'Doing', 'Done']);
	});
});

describe('renaming and deleting columns', () => {
	it('rewrites every matching field in one go', () => {
		const text = '- [ ] A [col:: Doing]\n- [ ] B\n- [x] C [done:: 2026-10-01] [col:: doing]\n- [ ] D [col:: Done]\n';
		expect(patchText(text, (d) => renameColumn(d, 'Doing', 'In progress'))).toBe(
			'- [ ] A [col:: In progress]\n- [ ] B\n- [x] C [done:: 2026-10-01] [col:: In progress]\n- [ ] D [col:: Done]\n',
		);
		expect(patchText(text, (d) => renameColumn(d, 'Doing', null))).toBe('- [ ] A\n- [ ] B\n- [x] C [done:: 2026-10-01]\n- [ ] D [col:: Done]\n');
	});
});

describe('moving cards', () => {
	const move = (text: string, prefix: string, m: Parameters<typeof moveCard>[2]) => {
		const doc = parse(text);
		const r = moveCard(doc, refOf(task(doc, prefix)), m);
		const out = applyEdits(doc, r.edits);
		expect(parse(out).lines[r.landed.line]).toBe(r.landed.text);
		return out;
	};
	const base = { today: TODAY, weekStart: 1 as const };

	it('sets the field and keeps the line in place', () => {
		expect(move('- [ ] A\n- [ ] B\n', 'A', { ...base, field: 'Doing', to: null })).toBe('- [ ] A [col:: Doing]\n- [ ] B\n');
		expect(move('- [ ] A [col:: Doing]\n- [ ] B\n', 'A', { ...base, field: null, to: null })).toBe('- [ ] A\n- [ ] B\n');
	});

	it('moves the line next to another card, sub-tasks and all', () => {
		const text = '- [ ] A\n\t- [ ] A1\n- [ ] B\n- [ ] C [col:: Doing]\n';
		const doc = parse(text);
		const c = task(doc, 'C');
		expect(move(text, 'A', { ...base, field: 'Doing', to: { target: refOf(c), place: 'after' } })).toBe(
			'- [ ] B\n- [ ] C [col:: Doing]\n- [ ] A [col:: Doing]\n\t- [ ] A1\n',
		);
		expect(move(text, 'C', { ...base, field: null, to: { target: refOf(task(doc, 'A')), place: 'before' } })).toBe(
			'- [ ] C\n- [ ] A\n\t- [ ] A1\n- [ ] B\n',
		);
	});

	it('checks and unchecks', () => {
		expect(move('- [ ] A\n', 'A', { ...base, field: 'Done', done: true, to: null })).toBe(`- [x] A [done:: ${TODAY}] [col:: Done]\n`);
		expect(move(`- [x] A [done:: ${TODAY}] [col:: Done]\n`, 'A', { ...base, field: 'Doing', done: false, to: null })).toBe('- [ ] A [col:: Doing]\n');
	});

	it('leaves the next one of a repeating to-do in the first column, where it was', () => {
		const text = '- [ ] Water [date:: 2026-10-08] [repeat:: every day] [col:: Doing]\n- [ ] B [col:: Done]\n';
		const b = task(parse(text), 'B');
		expect(move(text, 'Water', { ...base, field: 'Done', done: true, to: { target: refOf(b), place: 'after' } })).toBe(
			'- [ ] Water [date:: 2026-10-09] [repeat:: every day]\n' + '- [ ] B [col:: Done]\n' + `- [x] Water [date:: 2026-10-08] [done:: ${TODAY}] [col:: Done]\n`,
		);
	});

	it('moves under another heading, or above all of them', () => {
		const text = '- [ ] A\n\n## Later\n- [ ] B\n';
		const doc = parse(text);
		const later = doc.headings[0]!;
		expect(move(text, 'A', { ...base, to: { heading: refOf(later) } })).toBe('\n## Later\n- [ ] B\n- [ ] A\n');
		expect(move(text, 'B', { ...base, to: { heading: null } })).toBe('- [ ] A\n- [ ] B\n\n## Later\n');
		expect(move(text, 'B', { ...base, to: { target: refOf(task(doc, 'A')), place: 'before' } })).toBe('- [ ] B\n- [ ] A\n\n## Later\n');
	});
});

describe('checking and unchecking anywhere', () => {
	const reconcile = (before: string, after: string, columns = cols) => {
		const b = parse(before);
		const a = parse(after);
		return applyEdits(a, reconcileColumns(b, a, columns));
	};

	it('moves a card checked outside Done to Done', () => {
		expect(reconcile('- [ ] A [col:: Doing]\n', `- [x] A [done:: ${TODAY}] [col:: Doing]\n`)).toBe(`- [x] A [done:: ${TODAY}] [col:: Done]\n`);
		// Without a field it is in Done already.
		expect(reconcile('- [ ] A\n', `- [x] A [done:: ${TODAY}]\n`)).toBe(`- [x] A [done:: ${TODAY}]\n`);
	});

	it('moves a card unchecked in Done to the first column', () => {
		expect(reconcile(`- [x] A [done:: ${TODAY}] [col:: Done]\n`, '- [ ] A [col:: Done]\n')).toBe('- [ ] A\n');
		expect(reconcile(`- [x] A [done:: ${TODAY}]\n`, '- [ ] A\n')).toBe('- [ ] A\n');
	});

	it('leaves checked cards elsewhere, sub-tasks, and unrelated edits alone', () => {
		const done = `- [x] A [done:: ${TODAY}] [col:: Doing]\n- [ ] B\n`;
		expect(reconcile(done, done.replace('B', 'B2'))).toBe(done.replace('B', 'B2'));
		expect(reconcile(done, `- [x] A2 [done:: ${TODAY}] [col:: Doing]\n- [ ] B\n`)).toBe(`- [x] A2 [done:: ${TODAY}] [col:: Doing]\n- [ ] B\n`);
		expect(reconcile('- [ ] A\n\t- [ ] S\n', `- [ ] A\n\t- [x] S [done:: ${TODAY}]\n`)).toBe(`- [ ] A\n\t- [x] S [done:: ${TODAY}]\n`);
		expect(reconcile('- [ ] A\n', `- [x] A [done:: ${TODAY}]\n`, [{ name: 'A' }, { name: 'B' }])).toBe(`- [x] A [done:: ${TODAY}]\n`);
	});

	it('handles a repeating to-do: the completed one goes to Done, the next one stays first', () => {
		const before = '- [ ] W [date:: 2026-10-08] [repeat:: every day] [col:: Doing]\n';
		const doc = parse(before);
		const after = applyEdits(doc, completeRepeating(doc, refOf(doc.tasks[0]!), TODAY, 1)!.edits);
		expect(reconcile(before, after)).toBe('- [ ] W [date:: 2026-10-09] [repeat:: every day]\n' + `- [x] W [date:: 2026-10-08] [done:: ${TODAY}] [col:: Done]\n`);
	});

	it('works for a list toggle', () => {
		const before = '- [ ] A [col:: Doing]\n- [ ] B\n';
		const doc = parse(before);
		const after = applyEdits(doc, setTaskDone(doc, refOf(task(doc, 'A')), true, TODAY));
		expect(reconcile(before, after)).toBe(`- [x] A [done:: ${TODAY}] [col:: Done]\n- [ ] B\n`);
	});
});

describe('the board', () => {
	const text = [
		'- [ ] A',
		'\t- [ ] A1',
		'- [ ] B [col:: Doing]',
		`- [x] C [done:: ${TODAY}]`,
		'- [x] D [done:: 2026-09-01] [col:: Done]',
		'- [ ] E [col:: Waiting]',
		'',
		'## Later',
		'- [ ] F [col:: Doing]',
		'',
	].join('\n');
	const doc = parse(text);
	const items = allItems([{ path: 'P.md', doc, project: null }]);

	it('splits cards by status, hides sub-tasks, and keeps old completed ones apart', () => {
		const board = statusBoard(items, cols, TODAY, 7);
		expect(board.map((c) => c.cards.map((i) => i.task.title))).toEqual([['A', 'E'], ['B', 'F'], ['C']]);
		expect(board.map((c) => c.older.map((i) => i.task.title))).toEqual([[], [], ['D']]);
		expect(board.map((c) => c.open)).toEqual([2, 2, 0]);
	});

	it('splits cards by heading, with every completed card kept out of sight', () => {
		const board = headingBoard(items, doc, TODAY);
		expect(board.map((c) => c.name)).toEqual(['No section', 'Later']);
		expect(board.map((c) => c.cards.map((i) => i.task.title))).toEqual([['A', 'B', 'E'], ['F']]);
		expect(board.map((c) => c.older.map((i) => i.task.title))).toEqual([['C', 'D'], []]);
	});
});

describe('removing a section', () => {
	it('drops the heading and keeps its to-dos', async () => {
		const { removeSection } = await import('../src/model/patch');
		const text = '- [ ] A\n\n## Later\n- [ ] B\n';
		expect(patchText(text, (d) => removeSection(d, refOf(d.headings[0]!)))).toBe('- [ ] A\n\n- [ ] B\n');
		expect(patchText('- [ ] A\n\n## Later\n\n- [ ] B\n', (d) => removeSection(d, refOf(d.headings[0]!)))).toBe('- [ ] A\n\n- [ ] B\n');
	});
});

describe('checking by hand', () => {
	it('dates a card checked without a completion date', () => {
		const b = parse('- [ ] A [col:: Doing]\n- [ ] B\n');
		const a = parse('- [x] A [col:: Doing]\n- [x] B\n');
		expect(applyEdits(a, reconcileColumns(b, a, DEFAULT_COLUMNS, TODAY))).toBe(`- [x] A [done:: ${TODAY}] [col:: Done]\n- [x] B [done:: ${TODAY}]\n`);
	});
});
