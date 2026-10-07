// Reads a date phrase, a repeat rule and an @project out of a to-do title.

import { type DateMatch, findDate } from './dates/parse';
import { findRepeat, type RepeatMatch } from './dates/repeat';
import { findMention, type Mention } from './mentions';

interface Range {
	index: number;
	end: number;
}

export interface Recognised {
	match: DateMatch | null;
	mention: Mention | null;
	repeat: RepeatMatch | null;
}

function blank(text: string, ranges: Range[], fill = ' '): string {
	let out = text;
	for (const r of ranges) out = out.slice(0, r.index) + fill.repeat(r.end - r.index) + out.slice(r.end);
	return out;
}

/**
 * The date, repeat rule and @project in `text`, outside `ignore`. The mention, then the rule,
 * are blanked out before looking for a date, so "every fri" is not read as Friday.
 */
export function recognise(text: string, names: string[], today: string, weekStart: 0 | 1, ignore: Range[] = []): Recognised {
	// Not spaces: the words on either side of an ignored phrase must not read as one ("on … fri").
	const masked = blank(text, ignore, '\u200b');
	const mention = findMention(masked, names);
	const unmentioned = mention ? blank(masked, [mention]) : masked;
	const repeat = findRepeat(unmentioned);
	const match = findDate(repeat ? blank(unmentioned, [repeat]) : unmentioned, today, weekStart);
	return {
		mention: mention && { ...mention, text: text.slice(mention.index, mention.end) },
		match: match && { ...match, text: text.slice(match.index, match.end) },
		repeat: repeat && { ...repeat, text: text.slice(repeat.index, repeat.end) },
	};
}

/** Every date phrase, repeat rule and @project in `text`, as typed. */
function allPhrases(text: string, names: string[], today: string, weekStart: 0 | 1): string[] {
	const found: (DateMatch | Mention | RepeatMatch)[] = [];
	for (;;) {
		const { match, mention, repeat } = recognise(text, names, today, weekStart, found);
		const next = [match, mention, repeat].filter((r) => r !== null);
		if (!next.length) return found.map((r) => r.text);
		found.push(...next);
	}
}

/** Where each phrase sits in `text` (case-insensitive), each matched once, earliest free spot first. */
export function locate(text: string, phrases: string[]): Range[] {
	const lower = text.toLowerCase();
	const taken: Range[] = [];
	for (const p of phrases) {
		const needle = p.toLowerCase();
		for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + 1)) {
			const r = { index: at, end: at + needle.length };
			if (!taken.some((t) => r.index < t.end && t.index < r.end)) {
				taken.push(r);
				break;
			}
		}
	}
	return taken;
}

/**
 * Like `recognise`, for an edited title: phrases already in `original`, and the `kept` ones,
 * are left alone, so only a date, repeat rule or @project typed during the edit counts.
 */
export function recogniseEdit(
	text: string,
	original: string,
	names: string[],
	today: string,
	weekStart: 0 | 1,
	kept: string[] = [],
): Recognised {
	return recognise(text, names, today, weekStart, locate(text, [...allPhrases(original, names, today, weekStart), ...kept]));
}

/** The recognised phrase that ends at `caret`: Backspace there keeps it as plain text. */
export function phraseBefore(found: Recognised, caret: number): string | null {
	const r = [found.match, found.repeat, found.mention].find((r) => r?.end === caret);
	return r ? r.text : null;
}

/** The kept phrases still in `text`; deleting one and typing it again recognises it again. */
export function stillKept(kept: string[], text: string): string[] {
	const lower = text.toLowerCase();
	const next = kept.filter((p) => lower.includes(p.toLowerCase()));
	return next.length === kept.length ? kept : next;
}
