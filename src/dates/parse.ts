// Finds a date phrase in free text: custom phrases first, then chrono-node.

import * as chrono from 'chrono-node';
import { addDays, toISO, weekday } from './format';

export interface DateMatch {
	/** `YYYY-MM-DD` or `someday`. */
	date: string;
	/** The phrase as typed. */
	text: string;
	index: number;
	end: number;
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

// Group 1 is the character before the phrase (no lookbehind: iOS < 16.4 lacks it), so
// `#tag` and word-internal text never match. Group 2 is the phrase itself.
const W = '(^|[^\\p{L}\\p{N}_#/-])(';
const E = ')(?![\\p{L}\\p{N}_])';

interface Custom {
	re: RegExp;
	resolve: (m: RegExpExecArray, today: string, weekStart: 0 | 1) => string;
}

const CUSTOM: Custom[] = [
	{ re: new RegExp(`${W}(?:today|tod|tonight)${E}`, 'giu'), resolve: (_, today) => today },
	{ re: new RegExp(`${W}(?:tomorrow|tmrw|tmr)${E}`, 'giu'), resolve: (_, today) => addDays(today, 1) },
	{ re: new RegExp(`${W}someday${E}`, 'giu'), resolve: () => 'someday' },
	{
		re: new RegExp(`${W}next\\s+week${E}`, 'giu'),
		resolve: (_, today, weekStart) => addDays(today, ((weekStart - weekday(today) + 7) % 7) || 7),
	},
	{
		re: new RegExp(`${W}this\\s+weekend${E}`, 'giu'),
		resolve: (_, today) => addDays(today, (6 - weekday(today) + 7) % 7),
	},
	{
		re: new RegExp(`${W}next\\s+(${Object.keys(DAYS).join('|')})${E}`, 'giu'),
		resolve: (m, today) => {
			const target = DAYS[(m[3] ?? '').toLowerCase()] ?? 0;
			return addDays(today, ((target - weekday(today) + 7) % 7) || 7);
		},
	},
];

/** Ranges that must never be read as dates: [[links]], `code`, URLs and #tags. */
function protectedRanges(text: string): [number, number][] {
	const ranges: [number, number][] = [];
	for (const re of [/\[\[[^\]]*\]\]/g, /`[^`]*`/g, /\b(?:https?:\/\/|www\.)\S+/gi, /#[^\s#]+/g]) {
		for (const m of text.matchAll(re)) ranges.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
	}
	return ranges;
}

function blank(text: string, ranges: [number, number][]): string {
	let out = text;
	for (const [a, b] of ranges) out = out.slice(0, a) + ' '.repeat(b - a) + out.slice(b);
	return out;
}

/**
 * Finds the last recognised date phrase in `text`. `today` is the local `YYYY-MM-DD`
 * reference day; `weekStart` is 0 (Sunday) or 1 (Monday).
 */
export function findDate(text: string, today: string, weekStart: 0 | 1 = 1): DateMatch | null {
	let masked = blank(text, protectedRanges(text));
	const matches: DateMatch[] = [];

	for (const c of CUSTOM) {
		for (const m of masked.matchAll(c.re)) {
			const phrase = m[2] ?? '';
			const index = (m.index ?? 0) + (m[1] ?? '').length;
			matches.push({ date: c.resolve(m, today, weekStart), text: phrase, index, end: index + phrase.length });
		}
	}
	masked = blank(masked, matches.map((m) => [m.index, m.end]));

	const ref = new Date(`${today}T12:00:00`);
	for (const r of chrono.en.casual.parse(masked, ref, { forwardDate: true })) {
		const s = r.start;
		const tags = r.tags();
		// Time-only phrases ("3pm"), "now", and anything pointing backwards are not dates for a to-do.
		if (!(['day', 'weekday', 'month'] as const).some((k) => s.isCertain(k))) continue;
		if (tags.has('casualReference/now') || /^last\s/i.test(r.text)) continue;
		const date = toISO(s.date());
		if (date < today) continue;
		matches.push({ date, text: r.text, index: r.index, end: r.index + r.text.length });
	}

	return matches.reduce<DateMatch | null>((last, m) => (!last || m.index > last.index ? m : last), null);
}

/** Removes the matched phrase from `text`, collapsing the space it leaves. */
export function stripDate(text: string, match: DateMatch): string {
	return (text.slice(0, match.index) + text.slice(match.end)).replace(/[ \t]{2,}/g, ' ').trim();
}
