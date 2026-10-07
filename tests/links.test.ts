import { describe, expect, it } from 'vitest';
import { findLinks, linkLabels, linkQuery } from '../src/links';

describe('findLinks', () => {
	it('finds links with and without aliases', () => {
		expect(findLinks('See [[Plan]] and [[Notes/Call#Agenda|the call]]')).toEqual([
			{ target: 'Plan', label: 'Plan', index: 4, end: 12 },
			{ target: 'Notes/Call#Agenda', label: 'the call', index: 17, end: 47 },
		]);
	});

	it('ignores unclosed and empty brackets', () => {
		expect(findLinks('[[Plan and [[]]')).toEqual([]);
	});
});

describe('linkLabels', () => {
	it('shows each link by its label', () => {
		expect(linkLabels('See [[Plan]] and [[Notes/Call#Agenda|the call]]!')).toBe('See Plan and the call!');
		expect(linkLabels('No links here')).toBe('No links here');
	});
});

describe('linkQuery', () => {
	it('returns the text typed after [[', () => {
		expect(linkQuery('Read [[Pla', 10)).toEqual({ index: 5, query: 'Pla' });
		expect(linkQuery('Read [[', 7)).toEqual({ index: 5, query: '' });
		expect(linkQuery('Read [[House plans', 18)).toEqual({ index: 5, query: 'House plans' });
	});

	it('looks only before the caret', () => {
		expect(linkQuery('Read [[Pla', 4)).toBeNull();
	});

	it('stops once the link is closed or a heading, block or alias starts', () => {
		expect(linkQuery('Read [[Plan]] now', 17)).toBeNull();
		expect(linkQuery('Read [[Plan#Hea', 15)).toBeNull();
		expect(linkQuery('Read [[Plan|ali', 15)).toBeNull();
		expect(linkQuery('Read [[Plan^blo', 15)).toBeNull();
	});
});
