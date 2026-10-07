// Repeat rules, as written in a `[repeat:: …]` field: "every day", "every 2 weeks",
// "every mon, thu", "every month on the 15th", "every 2nd monday", "every last sunday",
// "every year", optionally "… when done".

import { addDays, fromISO, toISO, weekday } from './format';
import { blank, protectedRanges } from './parse';

export type RepeatUnit = 'day' | 'week' | 'month' | 'year';

export interface RepeatRule {
	unit: RepeatUnit;
	/** Every how many units. */
	every: number;
	/** `week` only: the weekdays it falls on (0 is Sunday), in order; empty for "every week". */
	weekdays: number[];
	/** `month` only: the day of the month it falls on, or `last`; null to keep the date's own day. */
	monthDay: number | 'last' | null;
	/** `month` only: the nth weekday of the month it falls on ("2nd monday"); `n` is -1 for the last. */
	nth: { n: number; day: number } | null;
	/** "when done": the next date counts from the day it was completed, not from its date. */
	fromDone: boolean;
}

const DAYS: Record<string, number> = {
	sun: 0, sunday: 0,
	mon: 1, monday: 1,
	tue: 2, tues: 2, tuesday: 2,
	wed: 3, weds: 3, wednesday: 3,
	thu: 4, thur: 4, thurs: 4, thursday: 4,
	fri: 5, friday: 5,
	sat: 6, saturday: 6,
};
const DAY_NAMES = Object.keys(DAYS).sort((a, b) => b.length - a.length).join('|');
const UNITS: Record<string, RepeatUnit> = { day: 'day', week: 'week', month: 'month', year: 'year' };
const ADVERBS: Record<string, RepeatUnit> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year', annually: 'year' };
const WORDS: Record<string, number> = { other: 2, two: 2, three: 3, four: 4, five: 5, six: 6 };
const ORDINALS: Record<string, number> = {
	'1st': 1, first: 1,
	'2nd': 2, second: 2,
	'3rd': 3, third: 3,
	'4th': 4, fourth: 4,
	'5th': 5, fifth: 5,
	last: -1,
};

const DAY_LIST = `(?:${DAY_NAMES})(?:\\s*(?:,|and|&)\\s*(?:${DAY_NAMES}))*`;
const ORDINAL = `(?:${Object.keys(ORDINALS).join('|')})`;
const COUNT = `(?<count>\\d{1,3}|other|two|three|four|five|six)\\s+`;
const MONTH_DAY =
	`on\\s+the\\s+(?:(?<onNth>${ORDINAL})\\s+(?<onNthDay>${DAY_NAMES})` +
	`|(?:(?<monthDay>\\d{1,2})(?:st|nd|rd|th)?|(?<last>last))(?:\\s+day)?)`;
const WHEN_DONE = `(?:\\s+when\\s+done)?`;

/** What follows "every": "2 weeks on mon", "month on the 15th", "2nd monday", "mon, thu", "weekday". */
const EVERY_BODY =
	`(?:${COUNT})?(?:(?<unit>day|week|month|year)s?(?:\\s+on\\s+(?<onDays>${DAY_LIST})|\\s+${MONTH_DAY})?` +
	`|(?<nth>${ORDINAL})\\s+(?<nthDay>${DAY_NAMES})|(?<days>${DAY_LIST})|(?<weekday>weekday))`;
/** A whole rule, or an adverb ("weekly"). */
const RULE_RE = new RegExp(`^(?:every\\s+${EVERY_BODY}|(?<adverb>daily|weekly|monthly|yearly|annually))${WHEN_DONE}$`, 'i');

/**
 * A rule inside free text. Group 1 is the character before it, group 2 the phrase. Only
 * phrases starting with "every" count: an adverb alone is too likely to be part of a title.
 */
export const REPEAT_PHRASE_RE = new RegExp(`(^|[^\\p{L}\\p{N}_#/-])(every\\s+${EVERY_BODY}${WHEN_DONE})(?![\\p{L}\\p{N}_])`, 'giu');

function dayList(text: string): number[] {
	const found = new Set<number>();
	for (const m of text.toLowerCase().matchAll(new RegExp(DAY_NAMES, 'g'))) found.add(DAYS[m[0]] ?? 0);
	return [...found].sort((a, b) => a - b);
}

/** Reads a rule such as "every 2 weeks" or "every month when done"; null if it is not one. */
export function parseRepeat(text: string): RepeatRule | null {
	const m = RULE_RE.exec(text.trim().replace(/\s+/g, ' '));
	if (!m?.groups) return null;
	const fromDone = /when\s+done$/i.test(m[0]);
	const g = m.groups;
	const rule = (unit: RepeatUnit, every: number, more: Partial<RepeatRule> = {}): RepeatRule => ({
		unit,
		every,
		weekdays: [],
		monthDay: null,
		nth: null,
		fromDone,
		...more,
	});
	const nthOf = (ordinal: string, day: string): RepeatRule['nth'] => ({
		n: ORDINALS[ordinal.toLowerCase()] ?? 1,
		day: DAYS[day.toLowerCase()] ?? 0,
	});
	if (g.adverb) return rule(ADVERBS[g.adverb.toLowerCase()] ?? 'day', 1);
	const every = g.count ? (WORDS[g.count.toLowerCase()] ?? Number(g.count)) : 1;
	if (!every) return null;
	if (g.weekday) return g.count ? null : rule('week', 1, { weekdays: [1, 2, 3, 4, 5] });
	// "every other mon": every 2 weeks, on Mondays.
	if (g.days) return rule('week', every, { weekdays: dayList(g.days) });
	if (g.nth && g.nthDay) return g.count ? null : rule('month', 1, { nth: nthOf(g.nth, g.nthDay) });
	const u = UNITS[(g.unit ?? '').toLowerCase()];
	if (!u) return null;
	if (g.onDays) return u === 'week' ? rule('week', every, { weekdays: dayList(g.onDays) }) : null;
	if (g.onNth && g.onNthDay) return u === 'month' ? rule('month', every, { nth: nthOf(g.onNth, g.onNthDay) }) : null;
	if (g.monthDay || g.last) {
		if (u !== 'month') return null;
		const n = Number(g.monthDay);
		if (g.monthDay && (n < 1 || n > 31)) return null;
		return rule('month', every, { monthDay: g.last ? 'last' : n });
	}
	return rule(u, every);
}

function daysInMonth(year: number, month: number): number {
	return new Date(year, month + 1, 0).getDate();
}

/** `iso` moved by whole months, on `day` (or the date's own day), clamped to the end of the month. */
function addMonths(iso: string, months: number, day: number | 'last' | null): string {
	const d = fromISO(iso);
	const first = new Date(d.getFullYear(), d.getMonth() + months, 1);
	const max = daysInMonth(first.getFullYear(), first.getMonth());
	const want = day === 'last' ? max : Math.min(day ?? d.getDate(), max);
	return toISO(new Date(first.getFullYear(), first.getMonth(), want));
}

/** The nth `day` (0 is Sunday) of the month `iso` is in; `n` -1 is the last. Null when there is no 5th. */
function nthWeekday(iso: string, n: number, day: number): string | null {
	const d = fromISO(iso);
	const year = d.getFullYear();
	const month = d.getMonth();
	if (n === -1) {
		const last = daysInMonth(year, month);
		const back = (new Date(year, month, last).getDay() - day + 7) % 7;
		return toISO(new Date(year, month, last - back));
	}
	const date = 1 + ((day - new Date(year, month, 1).getDay() + 7) % 7) + 7 * (n - 1);
	return date > daysInMonth(year, month) ? null : toISO(new Date(year, month, date));
}

/** The first day of the week `iso` is in. */
function weekOf(iso: string, weekStart: 0 | 1): string {
	return addDays(iso, -((weekday(iso) - weekStart + 7) % 7));
}

/** The occurrence after `from`. */
function step(rule: RepeatRule, from: string, weekStart: 0 | 1): string {
	switch (rule.unit) {
		case 'day':
			return addDays(from, rule.every);
		case 'year':
			return addMonths(from, 12 * rule.every, null);
		case 'month': {
			if (rule.nth) {
				const { n, day } = rule.nth;
				// Later this month still counts; a month without a 5th one is skipped.
				const same = nthWeekday(from, n, day);
				if (same && same > from) return same;
				for (let k = 1; k <= 120; k++) {
					const next = nthWeekday(addMonths(from, k * rule.every, 1), n, day);
					if (next) return next;
				}
				return addMonths(from, rule.every, null);
			}
			// "on the 15th": the 15th later this month still counts, when the date is before it.
			if (rule.monthDay !== null) {
				const same = addMonths(from, 0, rule.monthDay);
				if (same > from) return same;
			}
			return addMonths(from, rule.every, rule.monthDay);
		}
		case 'week': {
			if (!rule.weekdays.length) return addDays(from, 7 * rule.every);
			const start = weekOf(from, weekStart);
			// A later day this week, then the first day in the week `every` weeks on.
			for (let i = 1; i < 7; i++) {
				const d = addDays(from, i);
				if (weekOf(d, weekStart) !== start) break;
				if (rule.weekdays.includes(weekday(d))) return d;
			}
			const next = addDays(start, 7 * rule.every);
			for (let i = 0; i < 7; i++) {
				const d = addDays(next, i);
				if (rule.weekdays.includes(weekday(d))) return d;
			}
			return next;
		}
	}
}

/**
 * The date of the occurrence after one due on `due` and completed on `done`. A "when done"
 * rule counts from `done`. Otherwise it counts from `due`, skipping any dates up to `done`, so
 * a late completion doesn't leave the next one already overdue. Without a date (or "someday"),
 * it counts from `done`.
 */
export function nextOccurrence(rule: RepeatRule, due: string | null, done: string, weekStart: 0 | 1): string {
	if (rule.fromDone || !due || due === 'someday') return step(rule, done, weekStart);
	let next = step(rule, due, weekStart);
	for (let i = 0; next <= done && i < 10_000; i++) next = step(rule, next, weekStart);
	return next;
}

/**
 * The first date for a new repeating to-do with no date of its own: today when the rule
 * allows it ("every day", "every mon" on a Monday), otherwise the next day it falls on.
 */
export function firstOccurrence(rule: RepeatRule, today: string, weekStart: 0 | 1): string {
	if (rule.unit === 'week' && rule.weekdays.length && !rule.weekdays.includes(weekday(today))) {
		return step({ ...rule, every: 1 }, today, weekStart);
	}
	if (rule.unit === 'month' && rule.nth && nthWeekday(today, rule.nth.n, rule.nth.day) !== today) {
		return step({ ...rule, every: 1 }, today, weekStart);
	}
	if (rule.unit === 'month' && rule.monthDay !== null && addMonths(today, 0, rule.monthDay) !== today) {
		return step({ ...rule, every: 1 }, today, weekStart);
	}
	return today;
}

/** Puts "when done" on a rule's text, or takes it off. */
export function withWhenDone(text: string, fromDone: boolean): string {
	const base = text.trim().replace(/\s+when\s+done$/i, '');
	return fromDone ? `${base} when done` : base;
}

export interface RepeatMatch {
	/** The rule, with spacing tidied, as it goes in the `[repeat:: …]` field. */
	rule: string;
	/** The phrase as typed. */
	text: string;
	index: number;
	end: number;
}

/** Finds the last "every …" phrase in `text`, outside [[links]], `code`, URLs and #tags. */
export function findRepeat(text: string): RepeatMatch | null {
	const masked = blank(text, protectedRanges(text));
	let found: RepeatMatch | null = null;
	for (const m of masked.matchAll(REPEAT_PHRASE_RE)) {
		const index = (m.index ?? 0) + (m[1] ?? '').length;
		const phrase = m[2] ?? '';
		if (!parseRepeat(phrase)) continue;
		found = { rule: phrase.trim().replace(/\s+/g, ' ').toLowerCase(), text: text.slice(index, index + phrase.length), index, end: index + phrase.length };
	}
	return found;
}
