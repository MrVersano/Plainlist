import { describe, expect, it } from 'vitest';
import { patchText } from '../src/model/apply';
import { addTasks } from '../src/model/patch';
import { pastedTasks } from '../src/model/paste';

const titles = (text: string) => pastedTasks(text)?.map((t) => t.title) ?? null;

describe('pastedTasks', () => {
	it('reads checkboxes with and without a space, and plain bullets', () => {
		expect(titles('- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3')).toEqual(['Task 1', 'Task 2', 'Task 3']);
		expect(titles('- [] Task 1\n- []Task 2')).toEqual(['Task 1', 'Task 2']);
		expect(titles('- Task 1\n* Task 2\n1. Task 3')).toEqual(['Task 1', 'Task 2', 'Task 3']);
		expect(titles('[ ] Task 1\r\n[] Task 2\r\n')).toEqual(['Task 1', 'Task 2']);
	});

	it('nests indented items, skips blank lines and keeps dates', () => {
		expect(pastedTasks('- [ ] A [date:: 2026-10-08]\n\n    - [x] B')).toEqual([
			{ title: 'A', date: '2026-10-08', depth: 0 },
			{ title: 'B', date: null, depth: 1 },
		]);
	});

	it('reads depth from relative indentation, one step at a time', () => {
		const depths = (text: string) => pastedTasks(text)?.map((t) => t.depth);
		expect(depths('- a\n  - b\n    - c\n  - d\n- e')).toEqual([0, 1, 2, 1, 0]);
		expect(depths('  - a\n\t\t- b\n- c')).toEqual([0, 1, 0]);
	});

	it('ignores text that is not a list', () => {
		expect(pastedTasks('Hello world')).toBeNull();
		expect(pastedTasks('- [ ] A\nsome prose')).toBeNull();
		expect(pastedTasks('-not a bullet')).toBeNull();
		expect(pastedTasks('- [ ]\n- ')).toBeNull();
		expect(pastedTasks('')).toBeNull();
	});
});

describe('addTasks', () => {
	it('appends the to-dos to the Inbox in order', () => {
		const text = '# Inbox\n- [ ] Existing\n\n# Projects\n';
		expect(patchText(text, (d) => addTasks(d, [{ title: 'A', date: null }, { title: 'B', date: '2026-10-06' }], 'inbox'))).toBe(
			'# Inbox\n- [ ] Existing\n- [ ] A\n- [ ] B [date:: 2026-10-06]\n\n# Projects\n',
		);
	});

	it('writes nested to-dos as sub-tasks', () => {
		const tasks = pastedTasks('- [ ] A\n  - [ ] B\n- [ ] C')!;
		expect(patchText('# Inbox\n', (d) => addTasks(d, tasks, 'inbox'))).toBe('# Inbox\n- [ ] A\n\t- [ ] B\n- [ ] C\n');
	});
});
