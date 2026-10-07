import { describe, expect, it } from 'vitest';
import { mergeChanges, quoted, UndoStack } from '../src/undo';

const ok = () => Promise.resolve(true);

describe('UndoStack', () => {
	it('undoes newest first, and keeps the last 30', () => {
		const stack = new UndoStack();
		for (let i = 1; i <= 32; i++) stack.push(`#${i}`, ok);
		expect(stack.size).toBe(30);
		expect(stack.peek()?.label).toBe('#32');
		expect(stack.pop()?.label).toBe('#32');
		expect(stack.pop()?.label).toBe('#31');
		while (stack.size > 1) stack.pop();
		expect(stack.pop()?.label).toBe('#3');
		expect(stack.pop()).toBeNull();
	});

	it("takes an entry off once, when its toast's Undo is used", () => {
		const stack = new UndoStack();
		const a = stack.push('a', ok);
		stack.push('b', ok);
		expect(stack.take(a)).toBe(true);
		expect(stack.take(a)).toBe(false);
		expect(stack.pop()?.label).toBe('b');
		expect(stack.size).toBe(0);
	});
});

describe('mergeChanges', () => {
	it('folds each note to its first and last text', () => {
		expect(
			mergeChanges([
				{ path: 'A.md', before: '1', after: '2' },
				{ path: 'B.md', before: 'x', after: 'y' },
				{ path: 'A.md', before: '2', after: '3' },
			]),
		).toEqual([
			{ path: 'A.md', before: '1', after: '3' },
			{ path: 'B.md', before: 'x', after: 'y' },
		]);
	});

	it('drops notes that end as they started', () => {
		expect(mergeChanges([{ path: 'A.md', before: '1', after: '2' }, { path: 'A.md', before: '2', after: '1' }])).toEqual([]);
	});

	it('gives up when something else wrote to a note in between', () => {
		expect(mergeChanges([{ path: 'A.md', before: '1', after: '2' }, { path: 'A.md', before: '2b', after: '3' }])).toBeNull();
	});
});

describe('quoted', () => {
	it('quotes a title, shortening a long one', () => {
		expect(quoted(' Call Sam ')).toBe('“Call Sam”');
		expect(quoted('a'.repeat(50), 10)).toBe(`“${'a'.repeat(9)}…”`);
	});
});
