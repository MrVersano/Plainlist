import { describe, expect, it } from 'vitest';
import { applyEdits, patchText } from '../src/model/apply';
import { parse } from '../src/model/parse';
import {
	addProject,
	addTask,
	deleteProject,
	deleteTask,
	moveTask,
	PatchConflict,
	refOf,
	renameProject,
	restoreLines,
	setProjectDescription,
	setTaskDate,
	setTaskDescription,
	setTaskDone,
	setTaskTitle,
} from '../src/model/patch';
import type { Doc, LineEdit } from '../src/model/types';
import { changedLines, fixture, rng } from './helpers';

const TODAY = '2026-10-04';
const example = fixture('example.md');

function task(doc: Doc, prefix: string) {
	const t = doc.tasks.find((x) => x.title.startsWith(prefix));
	if (!t) throw new Error(`no task ${prefix}`);
	return t;
}

function project(doc: Doc, name: string) {
	const p = doc.projects.find((x) => x.name === name);
	if (!p) throw new Error(`no project ${name}`);
	return p;
}

/** Applies an action to `text` and returns the new text. */
function run(text: string, action: (doc: Doc) => LineEdit[]): string {
	return patchText(text, action);
}

describe('completing', () => {
	it('changes exactly one line', () => {
		const out = run(example, (d) => setTaskDone(d, refOf(task(d, 'Order standing')), true, TODAY));
		const changed = changedLines(example, out);
		expect(changed).toHaveLength(1);
		expect(out.split('\n')[changed[0]!]).toBe('- [ ] Order standing desk frame [date:: 2026-10-20]'.replace('[ ]', '[x]') + ' [done:: 2026-10-04]');
	});

	it('un-completing removes the done field and nothing else', () => {
		const out = run(example, (d) => setTaskDone(d, refOf(task(d, 'Order cable')), false, TODAY));
		expect(changedLines(example, out)).toHaveLength(1);
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
		const out = run(example, (d) =>
			setTaskDescription(d, refOf(task(d, 'Book electrician')), 'Four more outlets on the desk wall and one by the window.\nAsk about a heater circuit.'),
		);
		const changed = changedLines(example, out);
		expect(changed).toEqual([15]);
		expect(out.split('\n')[15]).toBe('\tAsk about a heater circuit.');
	});

	it('adds, grows and removes a description', () => {
		const added = run(example, (d) => setTaskDescription(d, refOf(task(d, 'Look into')), 'Two TB at least.\n\nCheck reviews.'));
		expect(added).toContain('- [ ] Look into a new backup drive\n\tTwo TB at least.\n\t\n\tCheck reviews.\n\n# Projects');
		// A blank line inside a description survives the round trip.
		expect(task(parse(added), 'Look into').description).toBe('Two TB at least.\n\nCheck reviews.');
		const removed = run(added, (d) => setTaskDescription(d, refOf(task(d, 'Look into')), '  \n'));
		expect(removed).toBe(example);
	});

	it('keeps space-indented lines that did not change', () => {
		const text = '# Inbox\n- [ ] a\n    one\n    two\n';
		const out = run(text, (d) => setTaskDescription(d, refOf(d.tasks[0]!), 'one\ntwo\nthree'));
		expect(out).toBe('# Inbox\n- [ ] a\n    one\n    two\n\tthree\n');
	});

	it('rewrites the title and keeps the date and done fields', () => {
		const out = run(example, (d) => setTaskTitle(d, refOf(task(d, 'Order cable')), 'Order 3 cable trays #errands'));
		expect(changedLines(example, out)).toHaveLength(1);
		expect(out).toContain('\n- [x] Order 3 cable trays #errands [done:: 2026-10-02]\n');
	});

	it('does not touch the line when the title is unchanged', () => {
		const text = '# Inbox\n*   [ ] spaced  [date:: 2026-10-04]\n';
		expect(run(text, (d) => setTaskTitle(d, refOf(d.tasks[0]!), 'spaced'))).toBe(text);
	});

	it('sets, replaces and clears the date', () => {
		const set = run(example, (d) => setTaskDate(d, refOf(task(d, 'Look into')), '2026-10-09'));
		expect(set).toContain('- [ ] Look into a new backup drive [date:: 2026-10-09]\n');
		const replaced = run(set, (d) => setTaskDate(d, refOf(task(d, 'Look into')), 'someday'));
		expect(replaced).toContain('- [ ] Look into a new backup drive [date:: someday]\n');
		expect(run(replaced, (d) => setTaskDate(d, refOf(task(d, 'Look into')), null))).toBe(example);
	});

	it('puts a new date before the done field', () => {
		const out = run(example, (d) => setTaskDate(d, refOf(task(d, 'Order cable')), '2026-10-01'));
		expect(out).toContain('- [x] Order cable trays [date:: 2026-10-01] [done:: 2026-10-02]\n');
	});
});

describe('conflict safety', () => {
	it('aborts when the target line changed', () => {
		const ref = refOf(task(parse(example), 'Order standing'));
		const edited = example.replace('Order standing desk frame', 'Order standing desk frame (oak)');
		expect(() => run(edited, (d) => setTaskDone(d, ref, true, TODAY))).toThrow(PatchConflict);
	});

	it('finds the line by its text when it moved', () => {
		const ref = refOf(task(parse(example), 'Order standing'));
		const shifted = example.replace('# Inbox\n', '# Inbox\n- [ ] A new first item\n');
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
		const out = run(example, (d) => addTask(d, { title: 'Call the plumber #home', date: '2026-10-06', project: null }));
		expect(out).toContain('- [ ] Look into a new backup drive\n- [ ] Call the plumber #home [date:: 2026-10-06]\n\n# Projects');
	});

	it('appends to the end of a project, after the last description', () => {
		const out = run(example, (d) => addTask(d, { title: 'Paint', date: null, project: 'Renovate home office' }));
		expect(out).toContain('- [x] Order cable trays [done:: 2026-10-02]\n- [ ] Paint\n\n## Q4 Planning');
	});

	it('adds below the description of a project with no to-dos', () => {
		const text = '# Projects\n\n## A\nAbout A.\n\n## B\n';
		expect(run(text, (d) => addTask(d, { title: 't', date: null, project: 'A' }))).toBe('# Projects\n\n## A\nAbout A.\n\n- [ ] t\n\n## B\n');
		expect(run(text, (d) => addTask(d, { title: 't', date: null, project: 'B' }))).toBe('# Projects\n\n## A\nAbout A.\n\n## B\n- [ ] t\n');
	});

	it('creates # Inbox after the frontmatter when missing', () => {
		const text = '---\nplainlist: true\n---\n\n# Projects\n';
		expect(run(text, (d) => addTask(d, { title: 't', date: null, project: null }))).toBe(
			'---\nplainlist: true\n---\n\n# Inbox\n- [ ] t\n\n# Projects\n',
		);
		expect(run('', (d) => addTask(d, { title: 't', date: null, project: null }))).toBe('# Inbox\n- [ ] t\n');
	});

	it('keeps an Inbox intro paragraph separate', () => {
		const text = '# Inbox\nTriage daily.\n';
		expect(run(text, (d) => addTask(d, { title: 't', date: null, project: null }))).toBe('# Inbox\n- [ ] t\n\nTriage daily.\n');
	});

	it('preserves a missing trailing newline', () => {
		const text = '# Inbox\n- [ ] a';
		expect(run(text, (d) => addTask(d, { title: 'b', date: null, project: null }))).toBe('# Inbox\n- [ ] a\n- [ ] b');
	});

	it('fails for an unknown project', () => {
		expect(() => run(example, (d) => addTask(d, { title: 't', date: null, project: 'Nope' }))).toThrow(PatchConflict);
	});
});

describe('moving and deleting to-dos', () => {
	it('moves a to-do with its description to another project', () => {
		const out = run(example, (d) => moveTask(d, refOf(task(d, 'Book electrician')), 'Q4 Planning'));
		expect(out).toContain(
			'## Q4 Planning\n- [ ] Prepare sprint review notes [date:: 2026-10-04]\n- [ ] Book electrician for office outlets #errands [date:: 2026-10-04]\n\tFour more outlets',
		);
		expect(out.match(/Book electrician/g)).toHaveLength(1);
	});

	it('moves a to-do to the Inbox', () => {
		const out = run(example, (d) => moveTask(d, refOf(task(d, 'Prepare sprint')), null));
		expect(out).toContain('- [ ] Look into a new backup drive\n- [ ] Prepare sprint review notes [date:: 2026-10-04]\n\n# Projects');
		expect(out.endsWith('## Q4 Planning\n')).toBe(true);
	});

	it('leaves to-dos outside Inbox and Projects in place when moved to the Inbox', () => {
		const text = fixture('opaque.md');
		expect(run(text, (d) => moveTask(d, refOf(task(d, 'Old item')), null))).toBe(text);
	});

	it('deletes a to-do and its description, and undo restores the exact lines', () => {
		const doc = parse(example);
		const { edits, removed } = deleteTask(doc, refOf(task(doc, 'Book electrician')));
		const out = applyEdits(doc, edits);
		expect(out).not.toContain('Book electrician');
		expect(out).not.toContain('Four more outlets');
		expect(run(out, (d) => restoreLines(d, removed))).toBe(example);
	});

	it('undo finds the spot after other edits shifted it', () => {
		const doc = parse(example);
		const { edits, removed } = deleteTask(doc, refOf(task(doc, 'Order standing')));
		const shifted = applyEdits(doc, edits).replace('# Inbox\n', '# Inbox\n- [ ] new\n');
		expect(run(shifted, (d) => restoreLines(d, removed))).toBe(example.replace('# Inbox\n', '# Inbox\n- [ ] new\n'));
	});

	it('undo aborts when the neighbours are gone', () => {
		const doc = parse(example);
		const { edits, removed } = deleteTask(doc, refOf(task(doc, 'Order standing')));
		const changed = applyEdits(doc, edits).replace('- [ ] Pick shelving for the back wall [date:: someday]\n', '');
		expect(() => run(changed, (d) => restoreLines(d, removed))).toThrow(PatchConflict);
	});
});

describe('projects', () => {
	it('adds a project at the end of # Projects', () => {
		const out = run(example, (d) => addProject(d, 'Garden for spring'));
		expect(out.endsWith('## Q4 Planning\n- [ ] Prepare sprint review notes [date:: 2026-10-04]\n\n## Garden for spring\n')).toBe(true);
	});

	it('adds a project before content that follows # Projects', () => {
		const text = '# Projects\n\n## A\n\n# Archive\n';
		expect(run(text, (d) => addProject(d, 'B'))).toBe('# Projects\n\n## A\n\n## B\n\n# Archive\n');
	});

	it('creates # Projects after the Inbox when missing', () => {
		const text = '# Inbox\n- [ ] a\n\n# Archive\nold\n';
		expect(run(text, (d) => addProject(d, 'P'))).toBe('# Inbox\n- [ ] a\n\n# Projects\n\n## P\n\n# Archive\nold\n');
	});

	it('rejects duplicate and empty names', () => {
		expect(() => run(example, (d) => addProject(d, 'Q4 Planning'))).toThrow(PatchConflict);
		expect(() => run(example, (d) => addProject(d, '  '))).toThrow(PatchConflict);
		expect(() => run(example, (d) => renameProject(d, refOf(project(d, 'Q4 Planning')), 'Renovate home office'))).toThrow(PatchConflict);
	});

	it('renames a project by changing one line', () => {
		const out = run(example, (d) => renameProject(d, refOf(project(d, 'Q4 Planning')), 'Q4 planning & review'));
		expect(changedLines(example, out)).toHaveLength(1);
		expect(parse(out).projects[1]!.name).toBe('Q4 planning & review');
	});

	it('edits, adds and removes a project description', () => {
		const ref = (d: Doc, n: string) => refOf(project(d, n));
		const edited = run(example, (d) => setProjectDescription(d, ref(d, 'Renovate home office'), 'Done before winter.\n'));
		expect(changedLines(example, edited)).toEqual([11]);

		const added = run(example, (d) => setProjectDescription(d, ref(d, 'Q4 Planning'), 'Quarterly goals.'));
		expect(added).toContain('## Q4 Planning\nQuarterly goals.\n\n- [ ] Prepare sprint');
		expect(project(parse(added), 'Q4 Planning').description).toBe('Quarterly goals.');

		expect(run(added, (d) => setProjectDescription(d, ref(d, 'Q4 Planning'), ''))).toBe(example);
	});

	it('deletes a project, moving its to-dos to the end of the Inbox', () => {
		const out = run(example, (d) => deleteProject(d, refOf(project(d, 'Renovate home office'))));
		expect(out).toBe(
			[
				'---',
				'plainlist: true',
				'---',
				'',
				'# Inbox',
				'- [ ] Renew domain for side project #admin [date:: 2026-10-04]',
				'- [ ] Look into a new backup drive',
				'- [ ] Book electrician for office outlets #errands [date:: 2026-10-04]',
				'\tFour more outlets on the desk wall and one by the window.',
				'\tAsk about a dedicated circuit for the heater.',
				'- [ ] Order standing desk frame [date:: 2026-10-20]',
				'- [ ] Pick shelving for the back wall [date:: someday]',
				'- [x] Order cable trays [done:: 2026-10-02]',
				'',
				'# Projects',
				'',
				'## Q4 Planning',
				'- [ ] Prepare sprint review notes [date:: 2026-10-04]',
				'',
			].join('\n'),
		);
	});

	it('keeps unknown content when deleting a project', () => {
		const text = fixture('opaque.md');
		const out = run(text, (d) => deleteProject(d, refOf(project(d, 'Renovate home office'))));
		expect(out).toContain('Trailing paragraph inside the project.');
		expect(out).toContain('### Sub-heading inside project');
		expect(out).not.toContain('## Renovate home office');
		expect(out).not.toContain('Plan in [[Office renovation]]');
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
				const p = pick(doc.projects);
				const name = `Task ${seed}-${++counter}`;
				const actions: ((d: Doc) => LineEdit[])[] = [
					(d) => addTask(d, { title: name, date: pick(['2026-10-09', 'someday', null]) ?? null, project: pick([null, ...d.projects.map((x) => x.name)]) ?? null }),
					(d) => (t ? setTaskDone(d, refOf(t), !t.done, TODAY) : []),
					(d) => (t ? setTaskTitle(d, refOf(t), name) : []),
					(d) => (t ? setTaskDate(d, refOf(t), pick(['2026-10-05', 'someday', null]) ?? null) : []),
					(d) => (t ? setTaskDescription(d, refOf(t), pick(['', `Note ${name}`, `A ${name}\n\nB ${name}`]) ?? '') : []),
					(d) => (t ? moveTask(d, refOf(t), pick([null, ...d.projects.map((x) => x.name)]) ?? null) : []),
					(d) => (t ? deleteTask(d, refOf(t)).edits : []),
					(d) => addProject(d, `Project ${seed}-${++counter}`),
					(d) => (p ? renameProject(d, refOf(p), `Renamed ${seed}-${++counter}`) : []),
					(d) => (p ? setProjectDescription(d, refOf(p), pick(['', `About ${name}`]) ?? '') : []),
					(d) => (p && random() < 0.3 ? deleteProject(d, refOf(p)) : []),
				];
				current = patchText(current, pick(actions)!);
				const after = parse(current);
				expect(after.lines.filter((l) => opaqueSet.has(l))).toEqual(opaque);
				expect(applyEdits(after, [])).toBe(current);
			}
		});
	}
});
