import { describe, expect, it } from 'vitest';
import { findMention, mentionQuery, mentionTargets, stripRanges, targetName } from '../src/mentions';

const NAMES = ['House', 'House Renovation 2026', 'Garden for spring'];
const found = (text: string) => {
	const m = findMention(text, NAMES);
	return m && { name: NAMES[m.project], text: m.text };
};

describe('findMention', () => {
	it('finds a multi-word project, preferring the longest name', () => {
		expect(found('Call plumber @House Renovation 2026')).toEqual({ name: 'House Renovation 2026', text: '@House Renovation 2026' });
		expect(found('@house renovation 2026 call plumber')?.name).toBe('House Renovation 2026');
		expect(found('Paint @House today')?.name).toBe('House');
	});

	it('allows trailing punctuation but not a longer word', () => {
		expect(found('Seeds (@Garden for spring)')?.name).toBe('Garden for spring');
		expect(found('Paint @Housework')).toBeNull();
	});

	it('ignores @ inside a word and unknown names', () => {
		expect(found('mail me@House')).toBeNull();
		expect(found('@Office stuff')).toBeNull();
	});

	it('takes the last mention', () => {
		expect(found('@House then @Garden for spring')?.name).toBe('Garden for spring');
	});
});

describe('mentionQuery', () => {
	it('returns the query before the caret, spaces included', () => {
		expect(mentionQuery('Call @House Ren', 15)).toEqual({ index: 5, query: 'House Ren' });
		expect(mentionQuery('@', 1)).toEqual({ index: 0, query: '' });
	});

	it('ignores @ inside a word', () => {
		expect(mentionQuery('me@ho', 5)).toBeNull();
		expect(mentionQuery('no mention', 10)).toBeNull();
	});
});

describe('stripRanges', () => {
	it('removes ranges and collapses spaces', () => {
		const text = 'Call plumber tomorrow @House Renovation 2026 #home';
		expect(stripRanges(text, [{ index: 22, end: 44 }, { index: 13, end: 21 }])).toBe('Call plumber #home');
	});
});

describe('mention targets', () => {
	const targets = mentionTargets([
		{ name: 'House', path: 'House.md', headings: [{ name: 'Kitchen', line: 3, text: '## Kitchen' }] },
		{ name: 'Garden', path: 'Garden.md' },
	]);

	it('lists each project followed by its headings', () => {
		expect(targets.map((t) => t.label)).toEqual(['House', 'House/Kitchen', 'Garden']);
		expect(targetName(targets[1]!)).toBe('House › Kitchen');
	});

	it('finds a heading mention, preferring it over the bare project', () => {
		const names = targets.map((t) => t.label);
		expect(targets[findMention('Fix tap @house/kitchen today', names)!.project]?.heading?.name).toBe('Kitchen');
		expect(targets[findMention('Fix tap @House today', names)!.project]?.heading).toBeNull();
	});
});
