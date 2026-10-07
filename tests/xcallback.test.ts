import { describe, expect, it } from 'vitest';
import { withParams } from '../src/xcallback';

describe('withParams', () => {
	it('is null without a URL', () => {
		expect(withParams(undefined)).toBeNull();
		expect(withParams('')).toBeNull();
	});

	it('leaves the URL alone with no params', () => {
		expect(withParams('shortcuts://')).toBe('shortcuts://');
	});

	it('starts or extends the query', () => {
		expect(withParams('drafts://x-callback-url/open', { errorMessage: 'No title' })).toBe('drafts://x-callback-url/open?errorMessage=No+title');
		expect(withParams('app://done?a=1', { b: '2' })).toBe('app://done?a=1&b=2');
		expect(withParams('app://done?', { b: '2' })).toBe('app://done?b=2');
	});

	it('keeps the fragment last', () => {
		expect(withParams('app://done?a=1#top', { b: '2' })).toBe('app://done?a=1&b=2#top');
	});
});
