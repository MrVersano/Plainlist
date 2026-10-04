import { describe, expect, it } from 'vitest';
import { applyEdits } from '../src/model/apply';
import { parse, projectLinkTarget } from '../src/model/parse';
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

describe('parse: task file', () => {
	const doc = parse(fixture('example.md'));

	it('reads frontmatter and sections', () => {
		expect(doc.isPlainlist).toBe(true);
		expect(doc.frontmatterEnd).toBe(3);
		expect(doc.inbox?.line).toBe(4);
		expect(doc.projectsSection?.line).toBe(8);
		expect(doc.eol).toBe('\n');
	});

	it('reads project links', () => {
		expect(doc.projectLinks.map((p) => [p.line, p.target])).toEqual([
			[9, 'Renovate home office'],
			[10, 'Q4 Planning'],
		]);
	});

	it('reads Inbox to-dos', () => {
		expect(doc.tasks.map((t) => [t.title, t.date, t.section])).toEqual([
			['Renew domain for side project #admin', '2026-10-04', 'inbox'],
			['Look into a new backup drive', null, 'inbox'],
		]);
	});

	it('labels every line', () => {
		expect(doc.nodes.map((n) => n.kind)).toEqual([
			'frontmatter', 'frontmatter', 'frontmatter', 'opaque',
			'section', 'task', 'task', 'opaque',
			'section', 'projectLink', 'projectLink',
		]);
	});
});

describe('parse: project note', () => {
	const doc = parse(fixture('project-note.md'));
	const byTitle = (prefix: string) => doc.tasks.find((t) => t.title.startsWith(prefix))!;

	it('reads every checkbox, nested ones included, but not fenced ones', () => {
		expect(doc.tasks.map((t) => t.title)).toEqual([
			'Book electrician for office outlets #errands',
			'Order standing desk frame',
			'Measure desk height',
			'Pick frame colour',
			'Pick shelving for the back wall',
			'Order cable trays',
		]);
	});

	it('reads descriptions at any depth', () => {
		expect(byTitle('Book electrician').description).toBe(
			'Four more outlets on the desk wall and one by the window.\nAsk about a dedicated circuit for the heater.',
		);
		expect(byTitle('Measure desk height')).toMatchObject({ indent: '    ', description: 'Sitting and standing.' });
		expect(byTitle('Order standing').description).toBe('');
	});

	it('knows the block nested under a to-do', () => {
		const frame = byTitle('Order standing');
		expect(frame.end).toBe(frame.line + 1);
		expect(doc.lines.slice(frame.line, frame.subtreeEnd)).toEqual([
			'- [ ] Order standing desk frame [date:: 2026-10-20]',
			'    - [ ] Measure desk height',
			'      Sitting and standing.',
			'    - [x] Pick frame colour [done:: 2026-10-01]',
		]);
	});

	it('leaves headings and prose alone', () => {
		expect(doc.inbox).toBeNull();
		expect(doc.projectLinks).toEqual([]);
		expect(doc.nodes[0]!.kind).toBe('opaque');
		expect(doc.nodes[1]!.kind).toBe('opaque');
	});
});

describe('parse: tolerant of unknown content', () => {
	const doc = parse(fixture('opaque.md'));
	const byTitle = (prefix: string) => doc.tasks.find((t) => t.title.startsWith(prefix));

	it('ignores to-dos in fences, callouts, and non-standard checkboxes', () => {
		expect(doc.tasks.some((t) => t.title.includes('fenced'))).toBe(false);
		expect(doc.tasks.some((t) => t.title.includes('callout'))).toBe(false);
		expect(doc.tasks.some((t) => t.title.includes('Cancelled'))).toBe(false);
		expect(doc.nodes.filter((n) => n.kind === 'section')).toHaveLength(2);
	});

	it('accepts * bullets and keeps unknown inline fields in the title', () => {
		expect(byTitle('Starred')?.section).toBe('inbox');
		expect(byTitle('Call the insurance')).toMatchObject({
			title: 'Call the insurance company #admin [priority:: high]',
			date: '2026-10-08',
		});
	});

	it('keeps blank lines in descriptions, and a nested checkbox is its own to-do', () => {
		expect(byTitle('Draft garden plan')?.description).toBe(
			'First paragraph of the description.\n\nSecond paragraph after a blank line, see [[Garden notes|notes]].',
		);
		expect(byTitle('Nested checkbox')).toMatchObject({ indent: '\t', section: 'inbox' });
	});

	it('strips the common space indent', () => {
		expect(byTitle('Spaces-indented')?.description).toBe('four spaces here\n  six spaces here');
	});

	it('treats to-dos outside the Inbox as other', () => {
		expect(byTitle('To-do under Notes')?.section).toBe('other');
		expect(byTitle('Old item')?.section).toBe('other');
		expect(byTitle('Stray to-do')?.section).toBe('other');
		expect(byTitle('Task under old heading')?.section).toBe('other');
	});

	it('reads wiki and Markdown project links, and nothing else, under # Projects', () => {
		expect(doc.projectLinks.map((p) => p.target)).toEqual(['Renovate home office', 'Garden for spring.md', 'Archive/Old project']);
	});

	it('ends the Inbox region at the next heading', () => {
		expect(doc.inbox?.end).toBe(doc.lines.indexOf('## Notes'));
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

	it('takes fenced code inside a description whole', () => {
		const doc = parse('- [ ] a\n\t```\n\t- [ ] not a to-do\n\t```\n- [ ] b\n');
		expect(doc.tasks.map((t) => t.title)).toEqual(['a', 'b']);
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

	it('accepts any indent and list marker', () => {
		expect(parseTaskLine('- [X] a')!.done).toBe(true);
		expect(parseTaskLine('    + [ ] b')).toMatchObject({ indent: '    ', prefix: '    + ', title: 'b' });
		expect(parseTaskLine('2. [ ] c')).toMatchObject({ prefix: '2. ', title: 'c' });
		expect(parseTaskLine('> - [ ] quoted')).toBeNull();
	});
});

describe('projectLinkTarget', () => {
	it.each([
		['- [[Note]]', 'Note'],
		['* [[Folder/Note|Alias]]', 'Folder/Note'],
		['- [[Note#Heading]]', 'Note'],
		['- [Note](Folder/My%20Note.md)', 'Folder/My Note.md'],
		['- [Note](<Folder/My Note.md>)', 'Folder/My Note.md'],
	])('%s → %s', (line, target) => {
		expect(projectLinkTarget(line)).toBe(target);
	});

	it.each(['- [[Note]] and text', '- plain', '[[Note]]', '- [ ] [[Note]]'])('%s → null', (line) => {
		expect(projectLinkTarget(line)).toBeNull();
	});
});
