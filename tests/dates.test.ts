import { describe, expect, it } from 'vitest';
import {
	addDays,
	completedGroup,
	headerDate,
	longDate,
	metaDate,
	overdueLabel,
	upcomingGroup,
} from '../src/dates/format';
import { findDate, stripDate } from '../src/dates/parse';

const SUN = '2026-10-04';
const MON = '2026-10-05';
const date = (text: string, today = SUN, weekStart: 0 | 1 = 1) => findDate(text, today, weekStart)?.date ?? null;

describe('findDate (reference Sun 2026-10-04)', () => {
	it.each([
		['today', '2026-10-04'],
		['tod', '2026-10-04'],
		['tonight', '2026-10-04'],
		['tomorrow', '2026-10-05'],
		['tmr', '2026-10-05'],
		['tmrw', '2026-10-05'],
		['next tue', '2026-10-06'],
		['fri', '2026-10-09'],
		['in 3 days', '2026-10-07'],
		['oct 20', '2026-10-20'],
		['someday', 'someday'],
		['Someday', 'someday'],
		['this weekend', '2026-10-10'],
		['jan 5', '2027-01-05'],
		['in 2 weeks', '2026-10-18'],
	])('%s → %s', (text, expected) => {
		expect(date(text)).toBe(expected);
	});

	it.each([
		'buy 3 chairs',
		'see [[Oct 20 meeting]]',
		'check `oct 20` in code',
		'read https://example.com/today/fri',
		'tag #tomorrow',
		'call at 3pm',
		'do it now',
		'yesterday',
		'last friday',
		'todays list',
	])('%s → no date', (text) => {
		expect(date(text)).toBeNull();
	});

	it('takes the last phrase', () => {
		expect(date('tomorrow or maybe fri')).toBe('2026-10-09');
		expect(date('fri or maybe tomorrow')).toBe('2026-10-05');
	});

	it('next <weekday> is the very next one', () => {
		expect(date('next tue', MON)).toBe('2026-10-06');
		expect(date('next mon', MON)).toBe('2026-10-12');
		expect(date('next sunday', SUN)).toBe('2026-10-11');
	});

	it('next week respects the week start', () => {
		expect(date('next week', SUN, 1)).toBe('2026-10-05');
		expect(date('next week', SUN, 0)).toBe('2026-10-11');
		expect(date('next week', MON, 1)).toBe('2026-10-12');
	});

	it('this weekend is always Saturday', () => {
		expect(date('this weekend', '2026-10-10', 0)).toBe('2026-10-10');
		expect(date('this weekend', '2026-10-09', 0)).toBe('2026-10-10');
	});

	it('reports the matched text and position', () => {
		expect(findDate('Call plumber next tue #home', SUN)).toMatchObject({ text: 'next tue', index: 13, end: 21 });
	});
});

describe('stripDate', () => {
	const strip = (text: string) => stripDate(text, findDate(text, SUN)!);

	it('removes the phrase and keeps tags where typed', () => {
		expect(strip('Call plumber next tue #home')).toBe('Call plumber #home');
		expect(strip('Call the plumber about the basement drain next tue #home')).toBe('Call the plumber about the basement drain #home');
		expect(strip('tomorrow water the herbs')).toBe('water the herbs');
	});
});

describe('labels', () => {
	it('formats header and long dates', () => {
		expect(headerDate(SUN)).toBe('Sunday, 4 October');
		expect(longDate('2026-10-06', SUN)).toBe('Tue, 6 October');
		expect(longDate('2027-01-05', SUN)).toBe('Tue, 5 January 2027');
		expect(longDate('someday', SUN)).toBe('Someday');
	});

	it('formats row meta', () => {
		expect(metaDate(SUN, SUN)).toBe('Today');
		expect(metaDate('2026-10-05', SUN)).toBe('Tomorrow');
		expect(metaDate('2026-10-12', SUN)).toBe('12 Oct');
		expect(metaDate('someday', SUN)).toBe('Someday');
		expect(overdueLabel('2026-10-02', SUN)).toBe('2 days ago');
		expect(overdueLabel('2026-10-03', SUN)).toBe('Yesterday');
	});

	it('groups upcoming dates', () => {
		expect(upcomingGroup('2026-10-05', SUN)).toMatchObject({ label: 'Tomorrow', sublabel: 'Mon 5 Oct' });
		expect(upcomingGroup('2026-10-06', SUN)).toMatchObject({ label: 'Tuesday', sublabel: '6 Oct' });
		expect(upcomingGroup(addDays(SUN, 7), SUN)).toMatchObject({ label: 'Sunday', sublabel: '11 Oct' });
		expect(upcomingGroup('2026-10-12', SUN)).toMatchObject({ label: 'Later in October' });
		expect(upcomingGroup('2026-11-10', SUN)).toMatchObject({ label: 'November' });
		expect(upcomingGroup('2027-01-05', SUN)).toMatchObject({ label: 'January 2027' });
	});

	it('groups completion dates', () => {
		expect(completedGroup(SUN, SUN).label).toBe('Today');
		expect(completedGroup('2026-10-03', SUN).label).toBe('Yesterday');
		expect(completedGroup('2026-10-01', SUN)).toMatchObject({ label: 'Thursday', sublabel: '1 Oct' });
		expect(completedGroup('2026-09-20', SUN).label).toBe('September');
		expect(completedGroup('2025-12-20', SUN).label).toBe('December 2025');
	});
});
