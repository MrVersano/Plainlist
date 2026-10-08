import { describe, expect, it } from 'vitest';
import { applyEdits, mapLine, patchText } from '../src/model/apply';
import { parse } from '../src/model/parse';
import {
	addProjectLink,
	addTask,
	deleteTask,
	extractTask,
	insertTaskLines,
	moveTaskToHeading,
	PatchConflict,
	refOf,
	completeOpenTasks,
	removeProjectLink,
	reopenTasks,
	rollOverdueTasks,
	replaceProjectLink,
	setProjectDone,
	restoreLines,
	setTaskDate,
	setTaskDescription,
	setTaskDone,
	setTaskTitle,
	indentTask,
	outdentTask,
	addSubtask,
	moveTaskNextTo,
	moveProjectLink,
	addArea,
	renameArea,
	removeArea,
	moveProjectToArea,
	moveArea,
	addSection,
	renameSection,
	moveSection,
	sectionSiblings,
} from '../src/model/patch';
import type { Doc, LineEdit } from '../src/model/types';
import { changedLines, fixture, rng } from './helpers';

const TODAY = '2026-10-04';
const example = fixture('example.md');
const note = fixture('project-note.md');

function task(doc: Doc, prefix: string) {
	const t = doc.tasks.find((x) => x.title.startsWith(prefix));
	if (!t) throw new Error(`no task ${prefix}`);
	return t;
}

/** Applies an action to `text` and returns the new text. */
function run(text: string, action: (doc: Doc) => LineEdit[]): string {
	return patchText(text, action);
}

/** Moves a to-do from one note's text to another's, as the store does. */
function move(fromText: string, prefix: string, toText: string, dest: 'inbox' | 'note'): [string, string] {
	const from = parse(fromText);
	const { lines, edits } = extractTask(from, refOf(task(from, prefix)));
	const to = parse(toText);
	return [applyEdits(from, edits), applyEdits(to, [insertTaskLines(to, lines, dest).edit])];
}

describe('completing', () => {
	it('changes exactly one line', () => {
		const out = run(note, (d) => setTaskDone(d, refOf(task(d, 'Order standing')), true, TODAY));
		const changed = changedLines(note, out);
		expect(changed).toHaveLength(1);
		expect(out.split('\n')[changed[0]!]).toBe('- [x] Order standing desk frame [date:: 2026-10-20] [done:: 2026-10-04]');
	});

	it('works on nested and numbered to-dos and keeps their prefix', () => {
		const out = run(note, (d) => setTaskDone(d, refOf(task(d, 'Measure desk')), true, TODAY));
		expect(out).toContain('\n    - [x] Measure desk height [done:: 2026-10-04]\n');
		const numbered = run('1. [ ] a\n', (d) => setTaskDone(d, refOf(d.tasks[0]!), true, TODAY));
		expect(numbered).toBe('1. [x] a [done:: 2026-10-04]\n');
	});

	it('un-completing removes the done field and nothing else', () => {
		const out = run(note, (d) => setTaskDone(d, refOf(task(d, 'Order cable')), false, TODAY));
		expect(changedLines(note, out)).toHaveLength(1);
		expect(out).toContain('\n- [ ] Order cable trays\n');
	});

	it('keeps fields in the middle of the line where they are', () => {
		const text = '# Inbox\n* [ ] a [date:: 2026-10-04] b [x:: 1]\n';
		const out = run(text, (d) => setTaskDone(d, refOf(d.tasks[0]!), true, TODAY));
		expect(out).toBe('# Inbox\n* [x] a [date:: 2026-10-04] b [x:: 1] [done:: 2026-10-04]\n');
		expect(run(out, (d) => setTaskDone(d, refOf(d.tasks[0]!), false, TODAY))).toBe(text);
	});

	it('preserves CRLF', () => {
		const text = example.replace(/\n/g, '\r\n');
		const out = run(text, (d) => setTaskDone(d, refOf(task(d, 'Look into')), true, TODAY));
		expect(out).toBe(text.replace('- [ ] Look into a new backup drive', '- [x] Look into a new backup drive [done:: 2026-10-04]'));
	});
});

describe('editing a to-do', () => {
	it('changes only the description lines', () => {
		const out = run(note, (d) =>
			setTaskDescription(d, refOf(task(d, 'Book electrician')), 'Four more outlets on the desk wall and one by the window.\nAsk about a heater circuit.'),
		);
		expect(changedLines(note, out)).toEqual([5]);
		expect(out.split('\n')[5]).toBe('\tAsk about a heater circuit.');
	});

	it('indents a nested to-do description under it', () => {
		const out = run(note, (d) => setTaskDescription(d, refOf(task(d, 'Pick frame')), 'Black or white.'));
		expect(out).toContain('    - [x] Pick frame colour [done:: 2026-10-01]\n        Black or white.\n');
		expect(task(parse(out), 'Pick frame').description).toBe('Black or white.');
	});

	it('adds, grows and removes a description', () => {
		const added = run(example, (d) => setTaskDescription(d, refOf(task(d, 'Look into')), 'Two TB at least.\n\nCheck reviews.'));
		expect(added).toContain('- [ ] Look into a new backup drive\n\tTwo TB at least.\n\t\n\tCheck reviews.\n\n# Projects');
		expect(task(parse(added), 'Look into').description).toBe('Two TB at least.\n\nCheck reviews.');
		expect(run(added, (d) => setTaskDescription(d, refOf(task(d, 'Look into')), '  \n'))).toBe(example);
	});

	it('keeps space-indented lines that did not change', () => {
		const text = '# Inbox\n- [ ] a\n    one\n    two\n';
		const out = run(text, (d) => setTaskDescription(d, refOf(d.tasks[0]!), 'one\ntwo\nthree'));
		expect(out).toBe('# Inbox\n- [ ] a\n    one\n    two\n\tthree\n');
	});

	it('rewrites the title and keeps the prefix, date and done fields', () => {
		const out = run(note, (d) => setTaskTitle(d, refOf(task(d, 'Pick frame')), 'Pick a frame colour'));
		expect(changedLines(note, out)).toHaveLength(1);
		expect(out).toContain('\n    - [x] Pick a frame colour [done:: 2026-10-01]\n');
	});

	it('sets, replaces and clears the date', () => {
		const set = run(example, (d) => setTaskDate(d, refOf(task(d, 'Look into')), '2026-10-09'));
		expect(set).toContain('- [ ] Look into a new backup drive [date:: 2026-10-09]\n');
		const replaced = run(set, (d) => setTaskDate(d, refOf(task(d, 'Look into')), 'someday'));
		expect(replaced).toContain('- [ ] Look into a new backup drive [date:: someday]\n');
		expect(run(replaced, (d) => setTaskDate(d, refOf(task(d, 'Look into')), null))).toBe(example);
	});

	it('puts a new date before the done field', () => {
		const out = run(note, (d) => setTaskDate(d, refOf(task(d, 'Order cable')), '2026-10-01'));
		expect(out).toContain('- [x] Order cable trays [date:: 2026-10-01] [done:: 2026-10-02]\n');
	});
});

describe('conflict safety', () => {
	it('aborts when the target line changed', () => {
		const ref = refOf(task(parse(note), 'Order standing'));
		const edited = note.replace('Order standing desk frame', 'Order standing desk frame (oak)');
		expect(() => run(edited, (d) => setTaskDone(d, ref, true, TODAY))).toThrow(PatchConflict);
	});

	it('finds the line by its text when it moved', () => {
		const ref = refOf(task(parse(note), 'Order standing'));
		const shifted = note.replace('# Renovate home office\n', '# Renovate home office\n- [ ] A new first item\n');
		const out = run(shifted, (d) => setTaskDone(d, ref, true, TODAY));
		expect(out).toContain('- [x] Order standing desk frame [date:: 2026-10-20] [done:: 2026-10-04]');
	});

	it('aborts when the text matches more than one moved line', () => {
		const text = '# Inbox\n- [ ] same\n- [ ] same\n';
		const ref = { line: 5, text: '- [ ] same' };
		expect(() => run(text, (d) => setTaskDone(d, ref, true, TODAY))).toThrow(PatchConflict);
	});
});

describe('adding to-dos', () => {
	it('appends to the end of the Inbox', () => {
		const out = run(example, (d) => addTask(d, { title: 'Call the plumber #home', date: '2026-10-06' }, 'inbox'));
		expect(out).toContain('- [ ] Look into a new backup drive\n- [ ] Call the plumber #home [date:: 2026-10-06]\n\n# Projects');
	});

	it('appends after the last top-level to-do of a note, past its nested lines', () => {
		const text = '# P\n- [ ] a\n- [ ] b\n    - [ ] b1\n\nNotes after.\n';
		expect(run(text, (d) => addTask(d, { title: 'c', date: null }, 'note'))).toBe('# P\n- [ ] a\n- [ ] b\n    - [ ] b1\n- [ ] c\n\nNotes after.\n');
		expect(run(note, (d) => addTask(d, { title: 'Paint', date: null }, 'note'))).toContain(
			'- [x] Order cable trays [done:: 2026-10-02]\n- [ ] Paint\n\n## Meeting notes',
		);
	});

	it('matches the indent of the note\'s to-do list', () => {
		const text = 'Intro\n  - [ ] a\n  - [ ] b\n';
		expect(run(text, (d) => addTask(d, { title: 'c', date: null }, 'note'))).toBe('Intro\n  - [ ] a\n  - [ ] b\n  - [ ] c\n');
	});

	it('appends to the end of a note without to-dos', () => {
		expect(run('# Plan\nSome notes.\n\n', (d) => addTask(d, { title: 'a', date: null }, 'note'))).toBe('# Plan\nSome notes.\n\n- [ ] a\n\n');
		expect(run('', (d) => addTask(d, { title: 'a', date: null }, 'note'))).toBe('- [ ] a\n');
		expect(run('---\nx: 1\n---\n', (d) => addTask(d, { title: 'a', date: null }, 'note'))).toBe('---\nx: 1\n---\n\n- [ ] a\n');
	});

	it('creates # Inbox after the frontmatter when missing', () => {
		const text = '---\nplainlist: true\n---\n\n# Projects\n';
		expect(run(text, (d) => addTask(d, { title: 't', date: null }, 'inbox'))).toBe(
			'---\nplainlist: true\n---\n\n# Inbox\n- [ ] t\n\n# Projects\n',
		);
		expect(run('', (d) => addTask(d, { title: 't', date: null }, 'inbox'))).toBe('# Inbox\n- [ ] t\n');
	});

	it('keeps an Inbox intro paragraph separate', () => {
		expect(run('# Inbox\nTriage daily.\n', (d) => addTask(d, { title: 't', date: null }, 'inbox'))).toBe('# Inbox\n- [ ] t\n\nTriage daily.\n');
	});

	it('preserves a missing trailing newline', () => {
		expect(run('# Inbox\n- [ ] a', (d) => addTask(d, { title: 'b', date: null }, 'inbox'))).toBe('# Inbox\n- [ ] a\n- [ ] b');
	});
});

describe('moving and deleting to-dos', () => {
	it('moves a to-do with its description and nested to-dos to another note', () => {
		const [from, to] = move(note, 'Order standing', '# Q4\n- [ ] Prep notes\n', 'note');
		expect(from).not.toContain('Order standing');
		expect(from).not.toContain('Measure desk height');
		expect(to).toBe(
			'# Q4\n- [ ] Prep notes\n- [ ] Order standing desk frame [date:: 2026-10-20]\n    - [ ] Measure desk height\n      Sitting and standing.\n    - [x] Pick frame colour [done:: 2026-10-01]\n',
		);
	});

	it('moves a nested to-do out to the left margin of the Inbox', () => {
		const [, to] = move(note, 'Measure desk', example, 'inbox');
		expect(to).toContain('- [ ] Look into a new backup drive\n- [ ] Measure desk height\n  Sitting and standing.\n\n# Projects');
		expect(task(parse(to), 'Measure desk').description).toBe('Sitting and standing.');
	});

	it('moves from the Inbox into a note at the note\'s indent', () => {
		const [from, to] = move(example, 'Renew domain', 'Intro\n  - [ ] a\n', 'note');
		expect(from).not.toContain('Renew domain');
		expect(to).toBe('Intro\n  - [ ] a\n  - [ ] Renew domain for side project #admin [date:: 2026-10-04]\n');
	});

	it('deletes a to-do and its description only, and undo restores the exact lines', () => {
		const doc = parse(note);
		const { edits, removed } = deleteTask(doc, refOf(task(doc, 'Book electrician')));
		const out = applyEdits(doc, edits);
		expect(out).not.toContain('Book electrician');
		expect(out).not.toContain('Four more outlets');
		expect(run(out, (d) => restoreLines(d, removed))).toBe(note);
	});

	it('deleting a parent deletes its sub-tasks, and undo brings them back', () => {
		const doc = parse(note);
		const { edits, removed } = deleteTask(doc, refOf(task(doc, 'Order standing')));
		const out = applyEdits(doc, edits);
		expect(out).not.toContain('Measure desk height');
		expect(out).not.toContain('Pick frame colour');
		expect(out).toContain('- [ ] Pick shelving');
		expect(run(out, (d) => restoreLines(d, removed))).toBe(note);
	});

	it('undo finds the spot after other edits shifted it', () => {
		const doc = parse(note);
		const { edits, removed } = deleteTask(doc, refOf(task(doc, 'Pick shelving')));
		const shifted = applyEdits(doc, edits).replace('# Renovate home office\n', '# Renovate home office\n- [ ] new\n');
		expect(run(shifted, (d) => restoreLines(d, removed))).toBe(note.replace('# Renovate home office\n', '# Renovate home office\n- [ ] new\n'));
	});

	it('undo aborts when the neighbours are gone', () => {
		const doc = parse(note);
		const { edits, removed } = deleteTask(doc, refOf(task(doc, 'Pick shelving')));
		const changed = applyEdits(doc, edits).replace('- [x] Order cable trays [done:: 2026-10-02]\n', '');
		expect(() => run(changed, (d) => restoreLines(d, removed))).toThrow(PatchConflict);
	});
});

describe('project links', () => {
	it('adds a link after the last one', () => {
		expect(run(example, (d) => addProjectLink(d, '[[Garden for spring]]'))).toBe(`${example}- [[Garden for spring]]\n`);
	});

	it('adds the first link under an empty # Projects', () => {
		expect(run('# Inbox\n\n# Projects\n', (d) => addProjectLink(d, '[[P]]'))).toBe('# Inbox\n\n# Projects\n- [[P]]\n');
		expect(run('# Projects\nSome text\n', (d) => addProjectLink(d, '[[P]]'))).toBe('# Projects\n- [[P]]\n\nSome text\n');
	});

	it('creates # Projects after the Inbox when missing', () => {
		const text = '# Inbox\n- [ ] a\n\n# Archive\nold\n';
		expect(run(text, (d) => addProjectLink(d, '[[P]]'))).toBe('# Inbox\n- [ ] a\n\n# Projects\n- [[P]]\n\n# Archive\nold\n');
	});

	it('rejects duplicates and non-links', () => {
		expect(() => run(example, (d) => addProjectLink(d, '[[Q4 Planning]]'))).toThrow(PatchConflict);
		expect(() => run(example, (d) => addProjectLink(d, 'Q4 Planning'))).toThrow(PatchConflict);
	});

	it('removes and replaces a link by changing one line', () => {
		const doc = parse(example);
		const q4 = doc.projectLinks[1]!;
		expect(run(example, (d) => removeProjectLink(d, refOf(q4)))).toBe(example.replace('- [[Q4 Planning]]\n', ''));
		const renamed = run(example, (d) => replaceProjectLink(d, refOf(q4), '[[Q4 planning and review]]'));
		expect(changedLines(example, renamed)).toEqual([10]);
		expect(parse(renamed).projectLinks[1]!.target).toBe('Q4 planning and review');
	});
});

describe('areas', () => {
	const text = '# Inbox\n- [ ] a\n\n# Projects\n- [[Loose]]\n\n## Work\n- [[Q4]]\n- [[Site]]\n\n## Home\n\n# Archive\nold\n';

	it('reads headings under # Projects as areas, and which area each project is in', () => {
		const doc = parse(text);
		expect(doc.areas.map((a) => [a.name, a.line, a.end])).toEqual([
			['Work', 6, 10],
			['Home', 10, 12],
		]);
		expect(doc.projectLinks.map((p) => [p.target, p.area?.name ?? null])).toEqual([
			['Loose', null],
			['Q4', 'Work'],
			['Site', 'Work'],
		]);
		expect(doc.headings).toEqual([expect.objectContaining({ name: 'Archive' })]);
	});

	it('keeps a heading with to-dos under it as a heading, not an area', () => {
		const doc = parse('# Projects\n- [[A]]\n\n## Old style\n- [ ] a to-do\n\n## Area\n- [[B]]\n');
		expect(doc.areas.map((a) => a.name)).toEqual(['Area']);
		expect(doc.tasks[0]!.heading?.name).toBe('Old style');
		expect(doc.projectLinks.map((p) => p.area?.name ?? null)).toEqual([null, 'Area']);
	});

	it('adds a new project before the first area', () => {
		expect(run(text, (d) => addProjectLink(d, '[[New]]'))).toBe(text.replace('- [[Loose]]\n', '- [[Loose]]\n- [[New]]\n'));
		const noLoose = '# Projects\n## Work\n- [[Q4]]\n';
		expect(run(noLoose, (d) => addProjectLink(d, '[[New]]'))).toBe('# Projects\n- [[New]]\n\n## Work\n- [[Q4]]\n');
	});

	it('adds an area at the end of # Projects', () => {
		expect(run(text, (d) => addArea(d, 'Side'))).toBe(text.replace('## Home\n\n', '## Home\n\n## Side\n\n'));
		expect(run('# Inbox\n- [ ] a\n', (d) => addArea(d, 'Work'))).toBe('# Inbox\n- [ ] a\n\n# Projects\n\n## Work\n');
		expect(() => run(text, (d) => addArea(d, 'work'))).toThrow(PatchConflict);
	});

	it('renames an area, keeping its level', () => {
		const out = run('# Projects\n### Work\n- [[A]]\n', (d) => renameArea(d, refOf(d.areas[0]!), 'Job'));
		expect(out).toBe('# Projects\n### Job\n- [[A]]\n');
	});

	it('removes an area heading, leaving its projects', () => {
		expect(run(text, (d) => removeArea(d, refOf(d.areas[0]!)))).toBe(text.replace('## Work\n', ''));
		expect(run(text, (d) => removeArea(d, refOf(d.areas[1]!)))).toBe(text.replace('## Home\n\n', ''));
	});

	it('moves an area with its projects, keeping the blank lines in place', () => {
		const three = '# Projects\n- [[Loose]]\n\n## Work\n- [[Q4]]\n\n## Home\n- [[Garden]]\n## Side\n- [[Blog]]\n\n# Archive\n';
		const at = (d: Doc, i: number) => refOf(d.areas[i]!);
		expect(run(three, (d) => moveArea(d, at(d, 2), at(d, 0), 'before'))).toBe(
			'# Projects\n- [[Loose]]\n\n## Side\n- [[Blog]]\n\n## Work\n- [[Q4]]\n## Home\n- [[Garden]]\n\n# Archive\n',
		);
		expect(run(three, (d) => moveArea(d, at(d, 0), at(d, 1), 'after'))).toBe(
			'# Projects\n- [[Loose]]\n\n## Home\n- [[Garden]]\n\n## Work\n- [[Q4]]\n## Side\n- [[Blog]]\n\n# Archive\n',
		);
		expect(run(three, (d) => moveArea(d, at(d, 0), at(d, 1), 'before'))).toBe(three);
		expect(run(three, (d) => moveArea(d, at(d, 0), at(d, 0), 'after'))).toBe(three);
		const moved = parse(run(three, (d) => moveArea(d, at(d, 0), at(d, 2), 'after')));
		expect(moved.projectLinks.map((p) => [p.target, p.area?.name ?? null])).toEqual([
			['Loose', null],
			['Garden', 'Home'],
			['Blog', 'Side'],
			['Q4', 'Work'],
		]);
	});

	it('moves a project to the end of an area, or out of all areas', () => {
		const doc = parse(text);
		const [loose, q4] = doc.projectLinks;
		expect(run(text, (d) => moveProjectToArea(d, refOf(loose!), refOf(d.areas[0]!)))).toBe(
			text.replace('- [[Loose]]\n', '').replace('- [[Site]]\n', '- [[Site]]\n- [[Loose]]\n'),
		);
		expect(run(text, (d) => moveProjectToArea(d, refOf(q4!), null))).toBe(
			text.replace('- [[Q4]]\n', '').replace('- [[Loose]]\n', '- [[Loose]]\n- [[Q4]]\n'),
		);
		expect(run(text, (d) => moveProjectToArea(d, refOf(q4!), refOf(d.areas[1]!)))).toBe(
			text.replace('- [[Q4]]\n', '').replace('## Home\n', '## Home\n- [[Q4]]\n'),
		);
		expect(run(text, (d) => moveProjectToArea(d, refOf(q4!), refOf(d.areas[0]!)))).toBe(text);
	});
});

describe('completing projects', () => {
	it('checks and unchecks the link line, keeping the link as written', () => {
		const text = '# Projects\n* [[Shed|The shed]]\n';
		const done = run(text, (d) => setProjectDone(d, refOf(d.projectLinks[0]!), true, TODAY));
		expect(done).toBe('# Projects\n* [x] [[Shed|The shed]] [done:: 2026-10-04]\n');
		expect(parse(done).projectLinks[0]).toMatchObject({ done: true, doneDate: '2026-10-04', target: 'Shed' });
		expect(run(done, (d) => setProjectDone(d, refOf(d.projectLinks[0]!), false, TODAY))).toBe(text);
	});

	it("completes a note's open to-dos and reopens exactly those", () => {
		const doc = parse(note);
		const { edits, completed } = completeOpenTasks(doc, TODAY);
		const out = applyEdits(doc, edits);
		expect(parse(out).tasks.every((t) => t.done)).toBe(true);
		expect(out).toContain('- [x] Order cable trays [done:: 2026-10-02]\n');
		expect(completed).toHaveLength(4);
		expect(run(out, (d) => reopenTasks(d, completed))).toBe(note);
	});

	it('reopening skips to-dos that changed since', () => {
		const doc = parse('- [ ] a\n- [ ] b\n');
		const { edits, completed } = completeOpenTasks(doc, TODAY);
		const changed = applyEdits(doc, edits).replace('- [x] a [done:: 2026-10-04]', '- [x] a, edited');
		expect(run(changed, (d) => reopenTasks(d, completed))).toBe('- [x] a, edited\n- [ ] b\n');
	});
});

describe('preservation under random actions', () => {
	const text = fixture('opaque.md');
	const original = parse(text);
	const opaque = original.nodes.filter((n) => n.kind === 'opaque' && n.text.trim()).map((n) => n.text);
	const opaqueSet = new Set(opaque);

	for (const seed of [1, 2, 3, 4, 5]) {
		it(`keeps every opaque line through 50 actions (seed ${seed})`, () => {
			const random = rng(seed);
			const pick = <T>(xs: T[]): T | undefined => xs[Math.floor(random() * xs.length)];
			let current = text;
			let counter = 0;

			for (let step = 0; step < 50; step++) {
				const doc = parse(current);
				const t = pick(doc.tasks);
				const p = pick(doc.projectLinks);
				const name = `Task ${seed}-${++counter}`;
				const actions: ((d: Doc) => LineEdit[])[] = [
					(d) => addTask(d, { title: name, date: pick(['2026-10-09', 'someday', null]) ?? null }, 'inbox'),
					(d) => addTask(d, { title: name, date: null }, 'note'),
					(d) => (t ? setTaskDone(d, refOf(t), !t.done, TODAY) : []),
					(d) => (t ? setTaskTitle(d, refOf(t), name) : []),
					(d) => (t ? setTaskDate(d, refOf(t), pick(['2026-10-05', 'someday', null]) ?? null) : []),
					(d) => (t ? setTaskDescription(d, refOf(t), pick(['', `Note ${name}`, `A ${name}\n\nB ${name}`]) ?? '') : []),
					(d) => (t ? deleteTask(d, refOf(t)).edits : []),
					(d) => (t ? extractTask(d, refOf(t)).edits : []),
					(d) => addProjectLink(d, `[[Project ${seed}-${++counter}]]`),
					(d) => (p ? replaceProjectLink(d, refOf(p), `[[Renamed ${seed}-${++counter}]]`) : []),
					(d) => (p && random() < 0.3 ? removeProjectLink(d, refOf(p)) : []),
					(d) => (p ? setProjectDone(d, refOf(p), !p.done, TODAY) : []),
					(d) => completeOpenTasks(d, TODAY).edits,
				];
				current = patchText(current, pick(actions)!);
				const after = parse(current);
				expect(after.lines.filter((l) => opaqueSet.has(l))).toEqual(opaque);
				expect(applyEdits(after, [])).toBe(current);
			}
		});
	}
});

describe('mapLine', () => {
	it('follows a line through inserts, deletes and replacements', () => {
		const doc = parse('a\nb\nc\nd\n');
		const edits: LineEdit[] = [
			{ at: 0, delete: 0, insert: ['x', 'y'] },
			{ at: 1, delete: 1, insert: ['B'] },
			{ at: 2, delete: 1, insert: [] },
		];
		expect(applyEdits(doc, edits)).toBe('x\ny\na\nB\nd\n');
		expect(mapLine(doc, edits, 0)).toBe(2);
		expect(mapLine(doc, edits, 1)).toBe(3);
		expect(mapLine(doc, edits, 2)).toBeNull();
		expect(mapLine(doc, edits, 3)).toBe(4);
	});

	it('tracks a to-do through a title edit plus description edit', () => {
		const doc = parse(note);
		const t = task(doc, 'Book electrician');
		const edits = [...setTaskTitle(doc, refOf(t), 'Book an electrician'), ...setTaskDescription(doc, refOf(t), 'Short.')];
		const out = parse(applyEdits(doc, edits));
		expect(out.lines[mapLine(doc, edits, t.line)!]).toBe('- [ ] Book an electrician [date:: 2026-10-04]');
	});
});

describe('rollOverdueTasks', () => {
	it('moves open past-dated to-dos to today and leaves the rest alone', () => {
		const doc = parse(
			[
				'- [ ] Late [date:: 2026-10-01]',
				'- [x] Done late [date:: 2026-10-01] [done:: 2026-10-02]',
				'- [ ] Now [date:: 2026-10-04]',
				'- [ ] Later [date:: 2026-10-09]',
				'- [ ] Someday [date:: someday]',
				'- [ ] Undated',
				'  - [ ] Nested late [date:: 2026-09-30]',
			].join('\n'),
		);
		const out = applyEdits(doc, rollOverdueTasks(doc, TODAY)).split('\n');
		expect(out[0]).toBe('- [ ] Late [date:: 2026-10-04]');
		expect(out[1]).toBe('- [x] Done late [date:: 2026-10-01] [done:: 2026-10-02]');
		expect(out.slice(2, 6)).toEqual(doc.lines.slice(2, 6));
		expect(out[6]).toBe('  - [ ] Nested late [date:: 2026-10-04]');
	});

	it('does nothing when no to-do is overdue', () => {
		expect(rollOverdueTasks(parse('- [ ] Now [date:: 2026-10-04]'), TODAY)).toEqual([]);
	});
});

describe('headings', () => {
	const text = [
		'# Kitchen',
		'- [ ] Paint walls',
		'',
		'# Bathroom',
		'- [ ] New tiles',
		'    - [ ] Pick grout',
		'Some notes.',
		'',
		'# Garden',
		'',
	].join('\n');

	it('attaches each to-do to the heading above it', () => {
		const doc = parse(text);
		expect(doc.headings.map((h) => h.name)).toEqual(['Kitchen', 'Bathroom', 'Garden']);
		expect(doc.tasks.map((t) => t.heading?.name)).toEqual(['Kitchen', 'Bathroom', 'Bathroom']);
	});

	it('does not treat a note title as a heading', () => {
		const doc = parse(note);
		expect(doc.headings.map((h) => h.name)).toEqual(['Meeting notes']);
		expect(doc.tasks.every((t) => t.heading === null)).toBe(true);
	});

	it('does not treat Inbox and Projects as headings', () => {
		const doc = parse(example);
		expect(doc.headings.some((h) => /^(inbox|projects)$/i.test(h.name))).toBe(false);
		expect(doc.tasks.filter((t) => t.section === 'inbox').every((t) => t.heading === null)).toBe(true);
	});

	it('adds a to-do after the last one under a heading', () => {
		const doc = parse(text);
		const heading = refOf(doc.headings[1]!);
		const out = run(text, (d) => addTask(d, { title: 'Fix tap', date: null }, { heading }));
		expect(out.split('\n').slice(3, 8)).toEqual(['# Bathroom', '- [ ] New tiles', '    - [ ] Pick grout', '- [ ] Fix tap', 'Some notes.']);
	});

	it('adds a to-do under a heading with none yet, as its own block', () => {
		const doc = parse(text);
		const heading = refOf(doc.headings[2]!);
		const out = run(text, (d) => addTask(d, { title: 'Plant bulbs', date: null }, { heading }));
		expect(out.endsWith('# Garden\n\n- [ ] Plant bulbs\n')).toBe(true);
	});

	it('moves a to-do and its nested to-dos under another heading in the same note', () => {
		const doc = parse(text);
		const r = moveTaskToHeading(doc, refOf(task(doc, 'New tiles')), refOf(doc.headings[0]!));
		const out = applyEdits(doc, r.edits);
		expect(out.split('\n').slice(0, 6)).toEqual(['# Kitchen', '- [ ] Paint walls', '- [ ] New tiles', '    - [ ] Pick grout', '', '# Bathroom']);
		expect(out.split('\n')[r.landed.line]).toBe(r.landed.text);
		expect(r.landed.text).toBe('- [ ] New tiles');
	});

	it('moves a to-do down to a later heading and reports where it landed', () => {
		const doc = parse(text);
		const r = moveTaskToHeading(doc, refOf(task(doc, 'Paint walls')), refOf(doc.headings[2]!));
		const out = applyEdits(doc, r.edits);
		expect(out.split('\n')[r.landed.line]).toBe('- [ ] Paint walls');
		expect(parse(out).tasks.find((t) => t.title === 'Paint walls')?.heading?.name).toBe('Garden');
	});

	it('does nothing when the to-do is already under that heading', () => {
		const doc = parse(text);
		expect(moveTaskToHeading(doc, refOf(task(doc, 'Paint walls')), refOf(doc.headings[0]!)).edits).toEqual([]);
	});

	it('adds a to-do for the project itself above all headings', () => {
		const out = run(text, (d) => addTask(d, { title: 'Measure room', date: null }, 'note'));
		expect(out.split('\n').slice(0, 4)).toEqual(['- [ ] Measure room', '', '# Kitchen', '- [ ] Paint walls']);
		const intro = ['Intro text.', '', '## Walls', '- [ ] Paint', ''].join('\n');
		expect(run(intro, (d) => addTask(d, { title: 'Measure room', date: null }, 'note'))).toBe(
			['Intro text.', '', '- [ ] Measure room', '', '## Walls', '- [ ] Paint', ''].join('\n'),
		);
		const titled = ['# Office', '', '- [ ] Loose', '', '## Walls', '- [ ] Paint', ''].join('\n');
		expect(run(titled, (d) => addTask(d, { title: 'Measure room', date: null }, 'note'))).toBe(
			['# Office', '', '- [ ] Loose', '- [ ] Measure room', '', '## Walls', '- [ ] Paint', ''].join('\n'),
		);
	});

	it('moves a to-do out from under its heading to above all headings', () => {
		const intro = ['Intro text.', '', '## Walls', '- [ ] Paint', '- [ ] Sand', ''].join('\n');
		const doc = parse(intro);
		const r = moveTaskToHeading(doc, refOf(task(doc, 'Sand')), null);
		const out = applyEdits(doc, r.edits);
		expect(out).toBe(['Intro text.', '', '- [ ] Sand', '', '## Walls', '- [ ] Paint', ''].join('\n'));
		expect(out.split('\n')[r.landed.line]).toBe('- [ ] Sand');
		expect(moveTaskToHeading(parse(out), refOf(task(parse(out), 'Sand')), null).edits).toEqual([]);
	});

	it('refuses a heading that is no longer there', () => {
		const doc = parse(text);
		expect(() => addTask(doc, { title: 'x', date: null }, { heading: { line: 3, text: '# Gone' } })).toThrow(PatchConflict);
	});
});

describe('sub-tasks', () => {
	const at = (text: string, title: string) => refOf(task(parse(text), title));

	it('indents a to-do, with its description and sub-tasks, under the one above', () => {
		const text = '- [ ] a\n- [ ] b\n\tnote\n\t- [ ] c\n- [ ] d\n';
		const doc = parse(text);
		const r = indentTask(doc, at(text, 'b'), at(text, 'a'));
		expect(applyEdits(doc, r.edits)).toBe('- [ ] a\n\t- [ ] b\n\t\tnote\n\t\t- [ ] c\n- [ ] d\n');
		expect(r.landed).toEqual({ line: 1, text: '\t- [ ] b' });
	});

	it('indents to match the sub-tasks already there, after the last one', () => {
		const text = '- [ ] a\n    - [ ] x\n- [ ] b\n';
		const doc = parse(text);
		const r = indentTask(doc, at(text, 'b'), at(text, 'a'));
		expect(applyEdits(doc, r.edits)).toBe('- [ ] a\n    - [ ] x\n    - [ ] b\n');
		expect(parse(applyEdits(doc, r.edits)).tasks.map((t) => t.parent)).toEqual([null, 0, 0]);
	});

	it('moves the to-do up when other lines sit between it and the new parent', () => {
		const text = '- [ ] a\nprose\n- [ ] b\n';
		const doc = parse(text);
		const r = indentTask(doc, at(text, 'b'), at(text, 'a'));
		const out = applyEdits(doc, r.edits);
		expect(out).toBe('- [ ] a\n\t- [ ] b\nprose\n');
		expect(parse(out).lines[r.landed.line]).toBe(r.landed.text);
	});

	it('will not indent under a to-do at another level', () => {
		const text = '- [ ] a\n\t- [ ] x\n- [ ] b\n';
		expect(() => indentTask(parse(text), at(text, 'b'), at(text, 'x'))).toThrow(PatchConflict);
	});

	it('outdents a last sub-task in place', () => {
		const text = '- [ ] a\n\t- [ ] b\n\t\tnote\n- [ ] c\n';
		const doc = parse(text);
		const r = outdentTask(doc, at(text, 'b'));
		expect(applyEdits(doc, r.edits)).toBe('- [ ] a\n- [ ] b\n\tnote\n- [ ] c\n');
		expect(r.landed).toEqual({ line: 1, text: '- [ ] b' });
	});

	it('outdents a sub-task to just after its parent, leaving its siblings under the parent', () => {
		const text = '- [ ] a\n\t- [ ] b\n\t- [ ] c\n- [ ] d\n';
		const doc = parse(text);
		const r = outdentTask(doc, at(text, 'b'));
		const out = applyEdits(doc, r.edits);
		expect(out).toBe('- [ ] a\n\t- [ ] c\n- [ ] b\n- [ ] d\n');
		expect(parse(out).lines[r.landed.line]).toBe(r.landed.text);
	});

	it('outdenting a top-level to-do does nothing', () => {
		const text = '- [ ] a\n';
		expect(outdentTask(parse(text), at(text, 'a')).edits).toEqual([]);
	});

	it('adds an untitled sub-task after the last one', () => {
		const text = '- [ ] a\n\tnote\n\t- [ ] x\n- [ ] b\n';
		const doc = parse(text);
		const r = addSubtask(doc, at(text, 'a'));
		expect(applyEdits(doc, r.edits)).toBe('- [ ] a\n\tnote\n\t- [ ] x\n\t- [ ]\n- [ ] b\n');
		expect(r.landed).toEqual({ line: 3, text: '\t- [ ]' });
		expect(parse(applyEdits(doc, r.edits)).tasks[2]).toMatchObject({ title: '', parent: 0 });
	});
});

describe('reordering', () => {
	const at = (text: string, title: string) => refOf(task(parse(text), title));
	const reorder = (text: string, title: string, target: string, place: 'before' | 'after') => {
		const doc = parse(text);
		const r = moveTaskNextTo(doc, at(text, title), at(text, target), place);
		const out = applyEdits(doc, r.edits);
		expect(parse(out).lines[r.landed.line]).toBe(r.landed.text);
		return out;
	};

	it('moves a to-do up, with its description and sub-tasks', () => {
		const text = '- [ ] a\n- [ ] b\n- [ ] c\n\tnote\n\t- [ ] d\n';
		expect(reorder(text, 'c', 'a', 'before')).toBe('- [ ] c\n\tnote\n\t- [ ] d\n- [ ] a\n- [ ] b\n');
	});

	it('moves a to-do down, after the target and everything nested under it', () => {
		const text = '- [ ] a\n- [ ] b\n\t- [ ] x\n- [ ] c\n';
		expect(reorder(text, 'a', 'b', 'after')).toBe('- [ ] b\n\t- [ ] x\n- [ ] a\n- [ ] c\n');
	});

	it('does nothing when the to-do is already there', () => {
		const text = '- [ ] a\n- [ ] b\n';
		const doc = parse(text);
		expect(moveTaskNextTo(doc, at(text, 'a'), at(text, 'b'), 'before').edits).toEqual([]);
		expect(moveTaskNextTo(doc, at(text, 'b'), at(text, 'a'), 'after').edits).toEqual([]);
	});

	it('reorders sub-tasks among their siblings', () => {
		const text = '- [ ] a\n\t- [ ] x\n\t- [ ] y\n- [ ] b\n';
		expect(reorder(text, 'y', 'x', 'before')).toBe('- [ ] a\n\t- [ ] y\n\t- [ ] x\n- [ ] b\n');
	});

	it('leaves other lines in place', () => {
		const text = '# Inbox\n- [ ] a\n- [ ] b\n\nSome prose\n';
		expect(reorder(text, 'b', 'a', 'before')).toBe('# Inbox\n- [ ] b\n- [ ] a\n\nSome prose\n');
	});

	it('moves a to-do under the target\'s heading', () => {
		const text = '- [ ] a\n\n## Later\n- [ ] b\n';
		const out = reorder(text, 'a', 'b', 'after');
		expect(out).toBe('\n## Later\n- [ ] b\n- [ ] a\n');
		expect(parse(out).tasks.map((t) => t.heading?.name ?? null)).toEqual(['Later', 'Later']);
	});

	it('refuses to move a to-do next to one with another parent', () => {
		const text = '- [ ] a\n\t- [ ] x\n- [ ] b\n';
		expect(() => moveTaskNextTo(parse(text), at(text, 'x'), at(text, 'b'), 'after')).toThrow(PatchConflict);
	});

	it('moves a project link', () => {
		const text = '# Projects\n- [[A]]\n- [[B]]\n- [[C]]\n';
		const doc = parse(text);
		const [a, , c] = doc.projectLinks;
		expect(applyEdits(doc, moveProjectLink(doc, refOf(c!), refOf(a!), 'before'))).toBe('# Projects\n- [[C]]\n- [[A]]\n- [[B]]\n');
		expect(applyEdits(doc, moveProjectLink(doc, refOf(a!), refOf(c!), 'after'))).toBe('# Projects\n- [[B]]\n- [[C]]\n- [[A]]\n');
		expect(moveProjectLink(doc, refOf(a!), refOf(doc.projectLinks[1]!), 'before')).toEqual([]);
	});
});

describe('sections', () => {
	const sec = (d: Doc, name: string) => refOf(d.headings.find((h) => h.name === name)!);
	const moveSec = (text: string, name: string, target: string, place: 'before' | 'after') =>
		run(text, (d) => moveSection(d, sec(d, name), sec(d, target), place));

	it('adds a section at the end of the note, at the level of its sections', () => {
		expect(run('# Plan\n\n- [ ] a\n', (d) => addSection(d, 'Later'))).toBe('# Plan\n\n- [ ] a\n\n## Later\n');
		expect(run('- [ ] a\n\n### One\n- [ ] b\n\n\n', (d) => addSection(d, ' Two '))).toBe('- [ ] a\n\n### One\n- [ ] b\n\n### Two\n\n\n');
		expect(run('', (d) => addSection(d, 'First'))).toBe('## First\n');
		expect(run('---\ntags: x\n---\n', (d) => addSection(d, 'First'))).toBe('---\ntags: x\n---\n\n## First\n');
	});

	it('refuses an empty or repeated section name', () => {
		const doc = parse('## One\n');
		expect(() => addSection(doc, '  ')).toThrow(PatchConflict);
		expect(() => addSection(doc, 'one')).toThrow(PatchConflict);
	});

	it('a new section shows as a heading to-dos can go under', () => {
		const out = run('- [ ] a\n', (d) => addSection(d, 'Later'));
		const doc = parse(out);
		expect(doc.headings.map((h) => h.name)).toEqual(['Later']);
		expect(run(out, (d) => addTask(d, { title: 'b', date: null }, { heading: sec(d, 'Later') }))).toBe('- [ ] a\n\n## Later\n\n- [ ] b\n');
	});

	it('renames a section, keeping its level', () => {
		const text = '### One\n- [ ] a\n## Two\n';
		expect(run(text, (d) => renameSection(d, sec(d, 'One'), 'First'))).toBe('### First\n- [ ] a\n## Two\n');
		expect(run(text, (d) => renameSection(d, sec(d, 'One'), 'one'))).toBe('### one\n- [ ] a\n## Two\n');
		expect(() => renameSection(parse(text), sec(parse(text), 'One'), 'two')).toThrow(PatchConflict);
	});

	it('moves a section with everything under it, keeping the spacing', () => {
		const text = '# Plan\n\n- [ ] loose\n\n## A\n- [ ] a\n\tnote\n\n## B\n- [ ] b\nprose\n\n## C\n- [ ] c\n';
		expect(moveSec(text, 'C', 'A', 'before')).toBe('# Plan\n\n- [ ] loose\n\n## C\n- [ ] c\n\n## A\n- [ ] a\n\tnote\n\n## B\n- [ ] b\nprose\n');
		expect(moveSec(text, 'A', 'C', 'after')).toBe('# Plan\n\n- [ ] loose\n\n## B\n- [ ] b\nprose\n\n## C\n- [ ] c\n\n## A\n- [ ] a\n\tnote\n');
		expect(moveSec(text, 'A', 'B', 'after')).toBe('# Plan\n\n- [ ] loose\n\n## B\n- [ ] b\nprose\n\n## A\n- [ ] a\n\tnote\n\n## C\n- [ ] c\n');
		expect(moveSection(parse(text), sec(parse(text), 'A'), sec(parse(text), 'B'), 'before')).toEqual([]);
	});

	it('moves a section with the deeper sections inside it', () => {
		const text = '## A\n- [ ] a\n### A1\n- [ ] a1\n## B\n- [ ] b\n';
		const out = moveSec(text, 'B', 'A', 'before');
		expect(out).toBe('## B\n- [ ] b\n## A\n- [ ] a\n### A1\n- [ ] a1\n');
		expect(parse(out).tasks.map((t) => `${t.title}:${t.heading?.name}`)).toEqual(['b:B', 'a:A', 'a1:A1']);
	});

	it('moves a section only among those at its level in the same section', () => {
		const text = '## A\n### A1\n### A2\n## B\n### B1\n';
		const doc = parse(text);
		const names = (name: string) => sectionSiblings(doc, doc.headings.find((h) => h.name === name)!).map((h) => h.name);
		expect(names('A1')).toEqual(['A1', 'A2']);
		expect(names('B1')).toEqual(['B1']);
		expect(names('B')).toEqual(['A', 'B']);
		expect(moveSec(text, 'A2', 'A1', 'before')).toBe('## A\n### A2\n### A1\n## B\n### B1\n');
		expect(() => moveSection(doc, sec(doc, 'B1'), sec(doc, 'A1'), 'after')).toThrow(PatchConflict);
		expect(() => moveSection(doc, sec(doc, 'B'), sec(doc, 'A1'), 'after')).toThrow(PatchConflict);
	});

	it('moves the last section when the note has no trailing newline', () => {
		expect(moveSec('## A\n- [ ] a\n\n## B\n- [ ] b', 'B', 'A', 'before')).toBe('## B\n- [ ] b\n\n## A\n- [ ] a');
	});
});
