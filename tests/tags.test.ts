import { describe, expect, it } from 'vitest';
import { completeTag, hasAnyTag, parseTagList, suggestTags, tagQuery } from '../src/model/tags';

describe('parseTagList', () => {
	it('is empty for an empty setting', () => {
		expect(parseTagList('')).toEqual([]);
		expect(parseTagList('  , ')).toEqual([]);
	});

	it('splits on commas and spaces, drops # and lower-cases', () => {
		expect(parseTagList('#project, Work  #area/Home')).toEqual(['project', 'work', 'area/home']);
	});

	it('drops repeats', () => {
		expect(parseTagList('project #Project')).toEqual(['project']);
	});
});

describe('hasAnyTag', () => {
	it('matches a tag with or without #, ignoring case', () => {
		expect(hasAnyTag(['#Project'], ['project'])).toBe(true);
		expect(hasAnyTag(['project'], ['project'])).toBe(true);
	});

	it('matches nested tags under a wanted tag', () => {
		expect(hasAnyTag(['#project/client'], ['project'])).toBe(true);
	});

	it('does not match tags that only share a prefix', () => {
		expect(hasAnyTag(['#projects'], ['project'])).toBe(false);
		expect(hasAnyTag(['#project'], ['project/client'])).toBe(false);
	});

	it('matches nothing when no tags are wanted', () => {
		expect(hasAnyTag(['#project'], [])).toBe(false);
	});
});

describe('tagQuery', () => {
	it('is the tag after the last comma or space, without #', () => {
		expect(tagQuery('')).toBe('');
		expect(tagQuery('#pro')).toBe('pro');
		expect(tagQuery('#project, #cl')).toBe('cl');
		expect(tagQuery('#project #cl')).toBe('cl');
		expect(tagQuery('#project, ')).toBe('');
	});
});

describe('completeTag', () => {
	it('replaces the tag being typed and adds a separator', () => {
		expect(completeTag('#pro', 'project')).toBe('#project, ');
		expect(completeTag('#project, cl', 'client')).toBe('#project, #client, ');
		expect(completeTag('#project, ', 'client')).toBe('#project, #client, ');
	});
});

describe('suggestTags', () => {
	const counts = new Map([
		['project', 3],
		['work/project', 9],
		['Projector', 1],
		['home', 5],
	]);

	it('puts prefix matches first, then by use', () => {
		expect(suggestTags(counts, 'proj', [])).toEqual(['project', 'Projector', 'work/project']);
	});

	it('leaves out tags already listed, ignoring case', () => {
		expect(suggestTags(counts, 'proj', ['projector', 'project'])).toEqual(['work/project']);
	});

	it('lists every tag by use for an empty query', () => {
		expect(suggestTags(counts, '', [])).toEqual(['work/project', 'home', 'project', 'Projector']);
	});
});
