import { describe, expect, it } from 'vitest';
import { applyEdits } from '../src/model/apply';
import { parse } from '../src/model/parse';
import { parseTaskLine } from '../src/model/taskLine';
import { allFixtures, fixture, variants } from './helpers';

describe('round-trip identity', () => {
	for (const { name, text } of allFixtures()) {
		for (const v of variants(text)) {
			it(`${name} (${v.label})`, () => {
				expect(applyEdits(parse(v.text), [])).toBe(v.text);
			});
		}
	}

	it('keeps a lone CR inside a line', () => {
		const text = '# Inbox\n- [ ] a\rb\n';
		expect(applyEdits(parse(text), [])).toBe(text);
	});
});

describe('parse: example file', () => {
	const doc = parse(fixture('example.md'));

	it('reads frontmatter and sections', () => {
		expect(doc.isPlainlist).toBe(true);
		expect(doc.frontmatterEnd).toBe(3);
		expect(doc.inbox?.line).toBe(4);
		expect(doc.projectsSection?.line).toBe(8);
		expect(doc.eol).toBe('\n');
	});

	it('reads projects and their descriptions', () => {
		expect(doc.projects.map((p) => p.name)).toEqual(['Renovate home office', 'Q4 Planning']);
		const office = doc.projects[0]!;
		expect(office.description).toBe('Finish the office unit before winter so it works for full days.');
		expect(office.tasks).toHaveLength(4);
		expect(doc.projects[1]!.description).toBe('');
	});

	it('reads to-dos', () => {
		expect(doc.tasks).toHaveLength(7);
		const [renew, backup, electrician, , shelving, trays] = doc.tasks;
		expect(renew).toMatchObject({ title: 'Renew domain for side project #admin', date: '2026-10-04', section: 'inbox', project: null });
		expect(backup).toMatchObject({ date: null, section: 'inbox' });
		expect(electrician).toMatchObject({
			title: 'Book electrician for office outlets #errands',
			project: 'Renovate home office',
			description: 'Four more outlets on the desk wall and one by the window.\nAsk about a dedicated circuit for the heater.',
		});
		expect(electrician!.end - electrician!.line).toBe(3);
		expect(shelving!.date).toBe('someday');
		expect(trays).toMatchObject({ done: true, doneDate: '2026-10-02', title: 'Order cable trays' });
	});

	it('labels every line', () => {
		expect(doc.nodes.map((n) => n.kind)).toEqual([
			'frontmatter', 'frontmatter', 'frontmatter', 'opaque',
			'section', 'task', 'task', 'opaque',
			'section', 'opaque',
			'project', 'projectDesc', 'opaque',
			'task', 'taskDesc', 'taskDesc', 'task', 'task', 'task', 'opaque',
			'project', 'task',
		]);
	});
});

describe('parse: tolerant of unknown content', () => {
	const doc = parse(fixture('opaque.md'));
	const byTitle = (prefix: string) => doc.tasks.find((t) => t.title.startsWith(prefix));

	it('ignores to-dos in fences, callouts, and non-standard checkboxes', () => {
		expect(doc.tasks.some((t) => t.title.includes('fenced'))).toBe(false);
		expect(doc.tasks.some((t) => t.title.includes('callout'))).toBe(false);
		expect(doc.tasks.some((t) => t.title.includes('Cancelled'))).toBe(false);
		// `# Inbox` inside a fence is not a second Inbox.
		expect(doc.nodes.filter((n) => n.kind === 'section')).toHaveLength(2);
	});

	it('accepts * bullets and keeps unknown inline fields in the title', () => {
		expect(byTitle('Starred')?.section).toBe('inbox');
		expect(byTitle('Call the insurance')).toMatchObject({
			title: 'Call the insurance company #admin [priority:: high]',
			date: '2026-10-08',
		});
		expect(byTitle('Book electrician')?.title).toBe('Book electrician #errands [effort:: 2h]');
	});

	it('keeps blank lines and to-do-like lines inside descriptions', () => {
		expect(byTitle('Draft garden plan')?.description).toBe(
			'First paragraph of the description.\n\nSecond paragraph after a blank line, see [[Garden notes|notes]].\n- [ ] looks like a subtask but is description',
		);
		expect(doc.tasks.some((t) => t.title.startsWith('looks like'))).toBe(false);
	});

	it('strips the common space indent', () => {
		expect(byTitle('Spaces-indented')?.description).toBe('four spaces here\n  six spaces here');
	});

	it('treats to-dos outside Inbox and Projects as other', () => {
		expect(byTitle('To-do under Notes')).toMatchObject({ section: 'other', project: null });
		expect(byTitle('Old item')).toMatchObject({ section: 'other', project: null });
	});

	it('keeps to-dos under a sub-heading in their project', () => {
		expect(byTitle('Under a sub-heading')?.project).toBe('Renovate home office');
	});

	it('reads multi-line project descriptions and empty projects', () => {
		expect(doc.projects.map((p) => p.name)).toEqual(['Renovate home office', 'Empty project', 'Garden for spring']);
		expect(doc.projects[0]!.description).toBe('Finish the office unit before winter.\nPlan in [[Office renovation]].');
		expect(doc.projects[1]!.description).toBe('');
		expect(doc.projects[1]!.tasks).toHaveLength(0);
	});

	it('ends the Inbox region at the next heading', () => {
		const notes = doc.lines.indexOf('## Notes');
		expect(doc.inbox?.end).toBe(notes);
		expect(doc.projectsSection?.end).toBe(doc.lines.indexOf('# Archive'));
	});
});

describe('parse: edge cases', () => {
	it('handles an empty file', () => {
		const doc = parse('');
		expect(doc.lines).toEqual([]);
		expect(doc.tasks).toEqual([]);
		expect(doc.inbox).toBeNull();
	});

	it('handles a file without frontmatter or sections', () => {
		const doc = parse(fixture('no-sections.md'));
		expect(doc.isPlainlist).toBe(false);
		expect(doc.tasks).toHaveLength(1);
		expect(doc.tasks[0]!.section).toBe('other');
	});

	it('detects CRLF', () => {
		expect(parse(fixture('crlf-no-trailing.md'))).toMatchObject({ eol: '\r\n', trailingNewline: false });
	});

	it('does not treat #tags as headings', () => {
		const doc = parse('# Inbox\n#tag on its own line\n- [ ] a\n');
		expect(doc.tasks[0]!.section).toBe('inbox');
	});
});

describe('parseTaskLine', () => {
	it('takes the first valid date field and ignores invalid ones', () => {
		const t = parseTaskLine('- [ ] a [date:: tomorrow] b [date:: 2026-10-05]')!;
		expect(t.date?.value).toBe('2026-10-05');
		expect(t.title).toBe('a [date:: tomorrow] b');
	});

	it('normalises Someday', () => {
		expect(parseTaskLine('- [ ] a [date:: Someday]')!.date?.value).toBe('someday');
	});

	it('reads an empty title', () => {
		expect(parseTaskLine('- [ ]')!.title).toBe('');
		expect(parseTaskLine('- [ ]title')).toBeNull();
	});

	it('accepts upper-case X', () => {
		expect(parseTaskLine('- [X] a')!.done).toBe(true);
	});
});
