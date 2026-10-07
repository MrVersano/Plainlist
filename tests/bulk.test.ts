import { describe, expect, it } from 'vitest';
import { applyEdits, patchText } from '../src/model/apply';
import { parse } from '../src/model/parse';
import {
	completeTasks,
	deleteTasks,
	extractTasks,
	insertTaskLines,
	moveTasksToHeading,
	refOf,
	restoreAll,
	setTasksDate,
	undoComplete,
} from '../src/model/patch';
import type { Doc } from '../src/model/types';
import { fixture } from './helpers';

const TODAY = '2026-10-04';
const note = fixture('project-note.md');

function refs(doc: Doc, ...prefixes: string[]) {
	return prefixes.map((p) => {
		const t = doc.tasks.find((x) => x.title.startsWith(p));
		if (!t) throw new Error(`no task ${p}`);
		return refOf(t);
	});
}

describe('bulk delete', () => {
	it('deletes several to-dos at once, and undo restores the exact text', () => {
		const doc = parse(note);
		const { edits, removed } = deleteTasks(doc, refs(doc, 'Book electrician', 'Pick shelving', 'Order cable'));
		const out = applyEdits(doc, edits);
		expect(out).not.toContain('Book electrician');
		expect(out).not.toContain('Four more outlets');
		expect(out).not.toContain('Pick shelving');
		expect(out).not.toContain('Order cable');
		expect(out).toContain('- [ ] Order standing desk frame');
		// The last two were next to each other: one run of lines.
		expect(removed).toHaveLength(2);
		expect(patchText(out, (d) => restoreAll(d, removed))).toBe(note);
	});

	it('a selected sub-task goes with its selected parent', () => {
		const doc = parse(note);
		const { edits, removed } = deleteTasks(doc, refs(doc, 'Measure desk', 'Order standing', 'Pick frame'));
		const out = applyEdits(doc, edits);
		expect(out).not.toContain('Order standing');
		expect(out).not.toContain('Pick frame colour');
		expect(removed).toHaveLength(1);
		expect(patchText(out, (d) => restoreAll(d, removed))).toBe(note);
	});
});

describe('bulk complete', () => {
	it('ticks each one, and undo reopens them', () => {
		const doc = parse(note);
		const done = completeTasks(doc, refs(doc, 'Book electrician', 'Pick shelving', 'Order cable'), true, TODAY, 1);
		// The cable trays are done already.
		expect(done.changed).toHaveLength(2);
		const out = applyEdits(doc, done.edits);
		expect(out).toContain(`- [x] Book electrician for office outlets #errands [date:: 2026-10-04] [done:: ${TODAY}]`);
		expect(patchText(out, (d) => undoComplete(d, done))).toBe(note);
	});

	it('reopens done ones', () => {
		const doc = parse(note);
		const done = completeTasks(doc, refs(doc, 'Order cable', 'Pick frame'), false, TODAY, 1);
		const out = applyEdits(doc, done.edits);
		expect(out).toContain('- [ ] Order cable trays\n');
		expect(out).toContain('    - [ ] Pick frame colour\n');
	});

	it('adds the next one for a repeating to-do, and knows where every line lands', () => {
		const text = '- [ ] Water plants [date:: 2026-10-04] [repeat:: every week]\n- [ ] Call mum\n- [ ] Pay rent [date:: 2026-10-01] [repeat:: every month]\n- [ ] Last\n';
		const doc = parse(text);
		const done = completeTasks(doc, refs(doc, 'Water plants', 'Call mum', 'Pay rent'), true, TODAY, 1);
		const out = applyEdits(doc, done.edits);
		const after = parse(out);
		expect(out.split('\n').slice(0, 6)).toEqual([
			'- [ ] Water plants [date:: 2026-10-11] [repeat:: every week]',
			`- [x] Water plants [date:: 2026-10-04] [done:: ${TODAY}]`,
			`- [x] Call mum [done:: ${TODAY}]`,
			'- [ ] Pay rent [date:: 2026-11-01] [repeat:: every month]',
			`- [x] Pay rent [date:: 2026-10-01] [done:: ${TODAY}]`,
			'- [ ] Last',
		]);
		for (const line of done.lines) expect(after.tasks.find((t) => t.line === line)?.done).toBe(true);
		expect(done.lines).toEqual([1, 2, 4]);
		expect(patchText(out, (d) => undoComplete(d, done))).toBe(text);
	});
});

describe('bulk schedule', () => {
	it('gives each the same date', () => {
		const doc = parse(note);
		const out = applyEdits(doc, setTasksDate(doc, refs(doc, 'Book electrician', 'Measure desk'), '2026-11-02'));
		expect(out).toContain('- [ ] Book electrician for office outlets #errands [date:: 2026-11-02]');
		expect(out).toContain('    - [ ] Measure desk height [date:: 2026-11-02]');
	});
});

describe('bulk move', () => {
	it('takes several to-dos out of a note, in order, and inserts them elsewhere', () => {
		const from = parse(note);
		const { lines, edits } = extractTasks(from, refs(from, 'Pick shelving', 'Book electrician', 'Measure desk'));
		expect(lines).toEqual([
			'- [ ] Book electrician for office outlets #errands [date:: 2026-10-04]',
			'\tFour more outlets on the desk wall and one by the window.',
			'\tAsk about a dedicated circuit for the heater.',
			'- [ ] Measure desk height',
			'  Sitting and standing.',
			'- [ ] Pick shelving for the back wall [date:: someday]',
		]);
		const left = applyEdits(from, edits);
		expect(left).toContain('- [ ] Order standing desk frame [date:: 2026-10-20]\n    - [x] Pick frame colour');
		const to = parse('# Q4\n- [ ] Prep\n');
		expect(applyEdits(to, [insertTaskLines(to, lines, 'note').edit])).toBe(`# Q4\n- [ ] Prep\n${lines.join('\n')}\n`);
	});

	it('moves several to-dos under a heading in the same note', () => {
		const text = '- [ ] a\n- [ ] b\n- [ ] c\n\n## Later\n- [ ] d\n';
		const doc = parse(text);
		const heading = doc.headings[0]!;
		const out = applyEdits(doc, moveTasksToHeading(doc, refs(doc, 'a', 'c', 'd'), refOf(heading)));
		expect(out).toBe('- [ ] b\n\n## Later\n- [ ] d\n- [ ] a\n- [ ] c\n');
	});
});
