import { describe, expect, it } from 'vitest';
import { recognise, recogniseEdit } from '../src/recognise';

const NAMES = ['House', 'Garden'];
// Sun 2026-10-04
const TODAY = '2026-10-04';
const found = (text: string) => {
	const { match, mention } = recognise(text, NAMES, TODAY, 1);
	return { date: match?.date ?? null, project: mention ? NAMES[mention.project] : null };
};
const edited = (text: string, original: string) => {
	const { match, mention } = recogniseEdit(text, original, NAMES, TODAY, 1);
	return { date: match?.text ?? null, project: mention?.text ?? null };
};

describe('recognise', () => {
	it('finds the date and project', () => {
		expect(found('Paint fence @House fri')).toEqual({ date: '2026-10-09', project: 'House' });
	});

	it('does not read a date inside a mention or a link', () => {
		expect(found('Read [[Oct 20 meeting]]')).toEqual({ date: null, project: null });
	});
});

describe('recogniseEdit', () => {
	it('acts on a date or project added during the edit', () => {
		expect(edited('Paint fence fri', 'Paint fence')).toEqual({ date: 'fri', project: null });
		expect(edited('Paint fence @Garden', 'Paint fence')).toEqual({ date: null, project: '@Garden' });
	});

	it('leaves phrases that were already in the title alone', () => {
		expect(edited('Plan today and tomorrow!', 'Plan today and tomorrow')).toEqual({ date: null, project: null });
		expect(edited('Email @House folks', 'Email @House folks')).toEqual({ date: null, project: null });
	});

	it('finds a new phrase next to an old one, wherever it is typed', () => {
		expect(edited('Review today notes fri', 'Review today notes')).toEqual({ date: 'fri', project: null });
		expect(edited('fri Review today notes', 'Review today notes')).toEqual({ date: 'fri', project: null });
	});

	it('counts a repeated phrase once per occurrence in the original', () => {
		expect(edited('Today: plan, then today', 'Today: plan')).toEqual({ date: 'today', project: null });
	});
});

describe('repeat rules', () => {
	const rule = (text: string) => {
		const { match, repeat } = recognise(text, NAMES, TODAY, 1);
		return { date: match?.text ?? null, repeat: repeat?.rule ?? null };
	};

	it('finds the rule, and does not read its weekday as a date', () => {
		expect(rule('Bins out every Mon')).toEqual({ date: null, repeat: 'every mon' });
		expect(rule('Check engine oil every month when done')).toEqual({ date: null, repeat: 'every month when done' });
		expect(rule('Book club every 2nd monday')).toEqual({ date: null, repeat: 'every 2nd monday' });
		expect(rule('Backups every last sunday when done')).toEqual({ date: null, repeat: 'every last sunday when done' });
	});

	it('finds a date next to it', () => {
		expect(rule('Water plants every 3 days from fri')).toEqual({ date: 'fri', repeat: 'every 3 days' });
	});

	it('leaves titles without "every" alone', () => {
		expect(rule('Weekly review')).toEqual({ date: null, repeat: null });
	});

	it('only counts a rule typed during an edit', () => {
		expect(recogniseEdit('Bins every mon', 'Bins every mon', NAMES, TODAY, 1).repeat).toBeNull();
		expect(recogniseEdit('Bins every mon', 'Bins', NAMES, TODAY, 1).repeat?.rule).toBe('every mon');
	});
});
