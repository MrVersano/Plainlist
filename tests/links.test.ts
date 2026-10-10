import { describe, expect, it } from 'vitest';
import { bareUrl, findLinks, linkLabels, linkQuery, markdownLink, pageTitle } from '../src/links';

describe('findLinks', () => {
	it('finds links with and without aliases', () => {
		expect(findLinks('See [[Plan]] and [[Notes/Call#Agenda|the call]]')).toEqual([
			{ target: 'Plan', label: 'Plan', index: 4, end: 12, external: false },
			{ target: 'Notes/Call#Agenda', label: 'the call', index: 17, end: 47, external: false },
		]);
	});

	it('finds Markdown links, to web pages and to notes', () => {
		expect(findLinks('Read [the docs](https://example.com/a?b=1) and [Plan](My%20Plan.md)')).toEqual([
			{ target: 'https://example.com/a?b=1', label: 'the docs', index: 5, end: 42, external: true },
			{ target: 'My Plan.md', label: 'Plan', index: 47, end: 67, external: false },
		]);
	});

	it('reads escaped brackets, <urls> and urls with parentheses', () => {
		expect(findLinks(String.raw`[A \[draft\]](<https://x.com/a b>)`)).toMatchObject([{ label: 'A [draft]', target: 'https://x.com/a b' }]);
		expect(findLinks('[Foo](https://en.wikipedia.org/wiki/Foo_(bar))')).toMatchObject([{ target: 'https://en.wikipedia.org/wiki/Foo_(bar)' }]);
	});

	it('keeps wikilinks and fields from reading as Markdown links', () => {
		expect(findLinks('[[Plan]](x)')).toMatchObject([{ target: 'Plan', external: false }]);
		expect(findLinks('Call [date:: 2026-10-10] (Sam)')).toEqual([]);
	});

	it('ignores unclosed and empty brackets', () => {
		expect(findLinks('[[Plan and [[]]')).toEqual([]);
	});
});

describe('linkLabels', () => {
	it('shows each link by its label', () => {
		expect(linkLabels('See [[Plan]] and [[Notes/Call#Agenda|the call]]!')).toBe('See Plan and the call!');
		expect(linkLabels('No links here')).toBe('No links here');
		expect(linkLabels('Read [the docs](https://example.com) today')).toBe('Read the docs today');
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

describe('bareUrl', () => {
	it('accepts a title that is only a web address', () => {
		expect(bareUrl('  https://example.com/a?b=1#c ')).toBe('https://example.com/a?b=1#c');
		expect(bareUrl('http://example.com')).toBe('http://example.com');
	});

	it('rejects anything more, or other schemes', () => {
		expect(bareUrl('Read https://example.com')).toBeNull();
		expect(bareUrl('ftp://example.com')).toBeNull();
		expect(bareUrl('[Docs](https://example.com)')).toBeNull();
	});
});

describe('markdownLink', () => {
	it('escapes brackets in the label and wraps urls with parentheses', () => {
		expect(markdownLink('Docs', 'https://example.com')).toBe('[Docs](https://example.com)');
		expect(markdownLink(' A  [draft] ', 'https://x.com/Foo_(bar)')).toBe(String.raw`[A \[draft\]](<https://x.com/Foo_(bar)>)`);
	});

	it('round-trips through findLinks', () => {
		const url = 'https://x.com/Foo_(bar)';
		expect(findLinks(markdownLink('A [b] \\ c', url))).toMatchObject([{ label: 'A [b] \\ c', target: url, external: true }]);
	});
});

describe('pageTitle', () => {
	it('prefers og:title, in either attribute order', () => {
		expect(pageTitle('<title>Site</title><meta property="og:title" content="The &amp; Post">')).toBe('The & Post');
		expect(pageTitle("<meta content='Post' property='og:title'><title>Site</title>")).toBe('Post');
	});

	it('falls back to <title>, decoding entities and whitespace', () => {
		expect(pageTitle('<head><title>\n  Tom &#38; Jerry &#x2014; Wiki&nbsp;page \n</title></head>')).toBe('Tom & Jerry — Wiki page');
		expect(pageTitle('<meta property="og:title" content=""><title>Site</title>')).toBe('Site');
	});

	it('returns null without a title', () => {
		expect(pageTitle('<p>Hi</p>')).toBeNull();
		expect(pageTitle('<title>  </title>')).toBeNull();
	});
});
