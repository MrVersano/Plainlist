import { describe, expect, it } from 'vitest';
import { firstOccurrence, nextOccurrence, parseRepeat, REPEAT_PHRASE_RE, withWhenDone } from '../src/dates/repeat';
import { parse } from '../src/model/parse';
import { patchText } from '../src/model/apply';
import { completeOpenTasks, completeRepeating, refOf, reopenTasks, setTaskDone, spawnRepeats, undoRepeat } from '../src/model/patch';
import { parseTaskLine, setDate, setRepeat } from '../src/model/taskLine';
import { applyEdits } from '../src/model/apply';

// 2026-10-07 is a Wednesday.
const next = (rule: string, due: string | null, done: string, weekStart: 0 | 1 = 1): string => {
	const r = parseRepeat(rule);
	if (!r) throw new Error(`not a rule: ${rule}`);
	return nextOccurrence(r, due, done, weekStart);
};

describe('parsing rules', () => {
	it.each([
		['every day', { unit: 'day', every: 1 }],
		['every 3 days', { unit: 'day', every: 3 }],
		['every other week', { unit: 'week', every: 2, weekdays: [] }],
		['every weekday', { unit: 'week', weekdays: [1, 2, 3, 4, 5] }],
		['every mon, thu', { unit: 'week', every: 1, weekdays: [1, 4] }],
		['every Monday and Friday', { unit: 'week', weekdays: [1, 5] }],
		['every 2 weeks on tue', { unit: 'week', every: 2, weekdays: [2] }],
		['every month', { unit: 'month', every: 1, monthDay: null }],
		['every month on the 15th', { unit: 'month', monthDay: 15 }],
		['every 3 months on the last day', { unit: 'month', every: 3, monthDay: 'last' }],
		['every year', { unit: 'year', every: 1 }],
		['monthly', { unit: 'month', every: 1, fromDone: false }],
		['every month when done', { unit: 'month', every: 1, fromDone: true }],
		['Every  2  Weeks', { unit: 'week', every: 2 }],
		['every 2nd monday', { unit: 'month', every: 1, nth: { n: 2, day: 1 } }],
		['every last sunday', { unit: 'month', every: 1, nth: { n: -1, day: 0 } }],
		['every first fri when done', { unit: 'month', nth: { n: 1, day: 5 }, fromDone: true }],
		['every 3 months on the 2nd tue', { unit: 'month', every: 3, nth: { n: 2, day: 2 } }],
		['every month on the last friday', { unit: 'month', nth: { n: -1, day: 5 } }],
		['every other monday', { unit: 'week', every: 2, weekdays: [1] }],
	])('%s', (text, rule) => {
		expect(parseRepeat(text)).toMatchObject(rule);
	});

	it.each(['every 2 2nd monday', 'every week on the 2nd monday', 'every 6th monday', '', 'sometimes', 'every', 'every 0 days', 'every week on the 15th', 'every month on the 40th', 'every blue moon'])(
		'rejects %j',
		(text) => expect(parseRepeat(text)).toBeNull(),
	);

	it('finds a rule in free text, not inside words or tags', () => {
		const find = (s: string) => [...s.matchAll(REPEAT_PHRASE_RE)].map((m) => m[2]);
		expect(find('Check engine oil every month when done')).toEqual(['every month when done']);
		expect(find('Water plants every 3 days #home')).toEqual(['every 3 days']);
		expect(find('Weekly review')).toEqual([]);
		expect(find('#every day')).toEqual([]);
	});

	it('puts "when done" on and off', () => {
		expect(withWhenDone('every month', true)).toBe('every month when done');
		expect(withWhenDone('every month when done', false)).toBe('every month');
		expect(withWhenDone('every month when done', true)).toBe('every month when done');
	});
});

describe('next occurrence', () => {
	it('counts plain intervals from the date', () => {
		expect(next('every day', '2026-10-07', '2026-10-07')).toBe('2026-10-08');
		expect(next('every 3 days', '2026-10-07', '2026-10-07')).toBe('2026-10-10');
		expect(next('every week', '2026-10-07', '2026-10-05')).toBe('2026-10-14');
		expect(next('every year', '2026-10-07', '2026-10-07')).toBe('2027-10-07');
	});

	it('skips dates up to the completion day when completed late', () => {
		expect(next('every week', '2026-09-30', '2026-10-07')).toBe('2026-10-14');
		expect(next('every day', '2026-10-01', '2026-10-07')).toBe('2026-10-08');
		expect(next('every month', '2026-08-01', '2026-10-07')).toBe('2026-11-01');
	});

	it('clamps to the end of the month', () => {
		expect(next('every month', '2026-01-31', '2026-01-31')).toBe('2026-02-28');
		expect(next('every month', '2028-01-31', '2028-01-31')).toBe('2028-02-29');
		expect(next('every year', '2028-02-29', '2028-02-29')).toBe('2029-02-28');
		expect(next('every month on the last day', '2026-02-28', '2026-02-28')).toBe('2026-03-31');
	});

	it('keeps to the day of the month', () => {
		expect(next('every month on the 15th', '2026-10-15', '2026-10-15')).toBe('2026-11-15');
		// Rolled over to the 20th: the 15th stays the anchor.
		expect(next('every month on the 15th', '2026-10-20', '2026-10-20')).toBe('2026-11-15');
		expect(next('every 2 months on the 1st', '2026-10-01', '2026-10-01')).toBe('2026-12-01');
	});

	it('keeps to the weekdays', () => {
		expect(next('every mon, thu', '2026-10-05', '2026-10-05')).toBe('2026-10-08');
		expect(next('every mon, thu', '2026-10-08', '2026-10-08')).toBe('2026-10-12');
		expect(next('every weekday', '2026-10-09', '2026-10-09')).toBe('2026-10-12');
		// Rolled over from Monday to Wednesday: still Mondays.
		expect(next('every mon', '2026-10-07', '2026-10-07')).toBe('2026-10-12');
		expect(next('every 2 weeks on mon', '2026-10-05', '2026-10-05')).toBe('2026-10-19');
	});

	it('keeps to the nth weekday of the month', () => {
		// October 2026: Mondays 5, 12, 19, 26; Sundays 4, 11, 18, 25.
		expect(next('every 2nd monday', '2026-10-12', '2026-10-12')).toBe('2026-11-09');
		expect(next('every last sunday', '2026-10-25', '2026-10-25')).toBe('2026-11-29');
		expect(next('every first fri', '2026-10-02', '2026-10-02')).toBe('2026-11-06');
		// Rolled over from the 12th: still the 2nd Monday, later this month counts only if ahead.
		expect(next('every 2nd monday', '2026-10-14', '2026-10-14')).toBe('2026-11-09');
		expect(next('every 2nd monday', '2026-10-01', '2026-10-01')).toBe('2026-10-12');
		expect(next('every 3 months on the 2nd tue', '2026-10-13', '2026-10-13')).toBe('2027-01-12');
		// "when done" counts from the completion day, then the next nth weekday.
		expect(next('every last sunday when done', '2026-10-25', '2026-10-28')).toBe('2026-11-29');
	});

	it('skips months without a 5th one', () => {
		// 5th Thursdays: 29 Oct 2026, then 31 Dec 2026 (November has only four).
		expect(next('every 5th thu', '2026-10-29', '2026-10-29')).toBe('2026-12-31');
	});

	it('handles the last weekday at the end of a leap February', () => {
		expect(next('every last sunday', '2028-01-30', '2028-01-30')).toBe('2028-02-27');
		expect(next('every last tue', '2028-01-25', '2028-01-25')).toBe('2028-02-29');
	});

	it('uses the first day of the week for "every N weeks on …"', () => {
		// Sunday the 11th: in a Monday week it ends the week, in a Sunday week it starts the next.
		expect(next('every 2 weeks on mon, sun', '2026-10-05', '2026-10-05', 1)).toBe('2026-10-11');
		expect(next('every 2 weeks on mon, sun', '2026-10-05', '2026-10-05', 0)).toBe('2026-10-18');
	});

	it('counts "when done" from the completion day, early or late', () => {
		expect(next('every month when done', '2026-10-07', '2026-10-20')).toBe('2026-11-20');
		expect(next('every month when done', '2026-10-07', '2026-10-01')).toBe('2026-11-01');
		expect(next('every month when done', '2026-10-07', '2026-10-07')).toBe('2026-11-07');
		expect(next('every 3 days when done', null, '2026-10-07')).toBe('2026-10-10');
	});

	it('counts from the completion day without a date', () => {
		expect(next('every week', null, '2026-10-07')).toBe('2026-10-14');
		expect(next('every week', 'someday', '2026-10-07')).toBe('2026-10-14');
	});

	it('starts today, or on the first day the rule falls on', () => {
		const first = (rule: string) => firstOccurrence(parseRepeat(rule)!, '2026-10-07', 1);
		expect(first('every 3 days')).toBe('2026-10-07');
		expect(first('every wed')).toBe('2026-10-07');
		expect(first('every fri')).toBe('2026-10-09');
		expect(first('every month on the 15th')).toBe('2026-10-15');
		expect(first('every month on the 1st')).toBe('2026-11-01');
		expect(first('every 2nd monday')).toBe('2026-10-12');
		expect(first('every first wed')).toBe('2026-10-07');
		expect(first('every 1st monday')).toBe('2026-11-02');
	});
});

describe('the repeat field', () => {
	it('reads it and takes it out of the title', () => {
		const t = parseTaskLine('- [ ] Pay rent [date:: 2026-11-01] [repeat:: every  month]');
		expect(t).toMatchObject({ title: 'Pay rent', repeat: { value: 'every month' } });
		expect(parse('- [ ] Pay rent [repeat:: every month]\n').tasks[0]).toMatchObject({ title: 'Pay rent', repeat: 'every month' });
	});

	it('leaves a field it cannot read in the title', () => {
		expect(parseTaskLine('- [ ] Pay rent [repeat:: now and then]')).toMatchObject({
			title: 'Pay rent [repeat:: now and then]',
			repeat: null,
		});
	});

	it('sets and removes it, before the done field', () => {
		expect(setRepeat('- [x] a [done:: 2026-10-07]', 'every day')).toBe('- [x] a [repeat:: every day] [done:: 2026-10-07]');
		expect(setRepeat('- [ ] a [repeat:: every day]', 'every week')).toBe('- [ ] a [repeat:: every week]');
		expect(setRepeat('- [ ] a [date:: 2026-10-07] [repeat:: every day]', null)).toBe('- [ ] a [date:: 2026-10-07]');
	});

	it('puts a new date before it', () => {
		expect(setDate('- [ ] a [repeat:: every day]', '2026-10-07')).toBe('- [ ] a [date:: 2026-10-07] [repeat:: every day]');
	});
});

describe('completing a repeating to-do', () => {
	const TODAY = '2026-10-07';
	const complete = (text: string, prefix: string, today = TODAY) =>
		patchText(text, (d) => completeRepeating(d, refOf(d.tasks.find((t) => t.title.startsWith(prefix))!), today, 1)!.edits);

	it('ticks it and adds the next one above', () => {
		const text = '# Inbox\n- [ ] Pay rent [date:: 2026-10-01] [repeat:: every month]\n- [ ] Other\n';
		expect(complete(text, 'Pay')).toBe(
			'# Inbox\n- [ ] Pay rent [date:: 2026-11-01] [repeat:: every month]\n- [x] Pay rent [date:: 2026-10-01] [done:: 2026-10-07]\n- [ ] Other\n',
		);
	});

	it('repeats "when done" from the day it is ticked', () => {
		const text = '- [ ] Check engine oil [date:: 2026-10-01] [repeat:: every month when done]\n';
		expect(complete(text, 'Check', '2026-10-20')).toBe(
			'- [ ] Check engine oil [date:: 2026-11-20] [repeat:: every month when done]\n' +
				'- [x] Check engine oil [date:: 2026-10-01] [done:: 2026-10-20]\n',
		);
	});

	it('copies the description and sub-tasks, open again, and ticks the old ones', () => {
		const text = '- [ ] Weekly review [date:: 2026-10-07] [repeat:: every wed]\n\tInbox to zero.\n\t- [x] Inbox\n\t- [ ] Calendar\n';
		expect(complete(text, 'Weekly')).toBe(
			'- [ ] Weekly review [date:: 2026-10-14] [repeat:: every wed]\n\tInbox to zero.\n\t- [ ] Inbox\n\t- [ ] Calendar\n' +
				'- [x] Weekly review [date:: 2026-10-07] [done:: 2026-10-07]\n\tInbox to zero.\n\t- [x] Inbox\n\t- [x] Calendar [done:: 2026-10-07]\n',
		);
	});

	it('gives a date to one without', () => {
		expect(complete('- [ ] Stretch [repeat:: every day]\n', 'Stretch')).toBe(
			'- [ ] Stretch [date:: 2026-10-08] [repeat:: every day]\n- [x] Stretch [done:: 2026-10-07]\n',
		);
	});

	it('returns null for a to-do without a rule', () => {
		const doc = parse('- [ ] a\n');
		expect(completeRepeating(doc, refOf(doc.tasks[0]!), TODAY, 1)).toBeNull();
	});

	it('undoes back to exactly what was there', () => {
		const text = '- [ ] Weekly review [date:: 2026-10-07] [repeat:: every wed]\n\t- [ ] Calendar\n- [ ] Other\n';
		const doc = parse(text);
		const r = completeRepeating(doc, refOf(doc.tasks[0]!), TODAY, 1)!;
		const out = applyEdits(doc, r.edits);
		expect(patchText(out, (d) => undoRepeat(d, r.repeated))).toBe(text);
	});

	it('the tracked line follows the completed one', async () => {
		const { mapLine } = await import('../src/model/apply');
		const doc = parse('- [ ] a [repeat:: every day]\n');
		const r = completeRepeating(doc, refOf(doc.tasks[0]!), TODAY, 1)!;
		expect(mapLine(doc, r.edits, 0)).toBe(1);
	});
});

describe('repeating to-dos ticked by hand', () => {
	const TODAY = '2026-10-07';

	it('schedules the next one, from its own completion date', () => {
		const text = '- [x] Check engine oil [date:: 2026-10-01] [repeat:: every month when done] [done:: 2026-10-03]\n';
		const out = patchText(text, (d) => spawnRepeats(d, TODAY, 1));
		expect(out).toBe(
			'- [ ] Check engine oil [date:: 2026-11-03] [repeat:: every month when done]\n' +
				'- [x] Check engine oil [date:: 2026-10-01] [done:: 2026-10-03]\n',
		);
	});

	it('uses today when the tick has no completion date', () => {
		const out = patchText('- [x] Stretch [repeat:: every day]\n', (d) => spawnRepeats(d, TODAY, 1));
		expect(out).toBe('- [ ] Stretch [date:: 2026-10-08] [repeat:: every day]\n- [x] Stretch [done:: 2026-10-07]\n');
	});

	it('does nothing the second time', () => {
		const once = patchText('- [x] a [repeat:: every day]\n- [x] b [repeat:: every week]\n', (d) => spawnRepeats(d, TODAY, 1));
		expect(parse(once).tasks.filter((t) => !t.done)).toHaveLength(2);
		expect(spawnRepeats(parse(once), TODAY, 1)).toEqual([]);
	});

	it('ticking through setTaskDone is picked up by the pass', () => {
		const ticked = patchText('- [ ] a [repeat:: every day]\n', (d) => setTaskDone(d, refOf(d.tasks[0]!), true, TODAY));
		expect(patchText(ticked, (d) => spawnRepeats(d, TODAY, 1))).toBe('- [ ] a [date:: 2026-10-08] [repeat:: every day]\n- [x] a [done:: 2026-10-07]\n');
	});
});

describe('completing a project', () => {
	it('drops the rules, so nothing repeats, and puts them back on undo', () => {
		const text = '- [ ] a [repeat:: every day]\n- [ ] b\n';
		const doc = parse(text);
		const { edits, completed } = completeOpenTasks(doc, '2026-10-07');
		const out = applyEdits(doc, edits);
		expect(out).toBe('- [x] a [done:: 2026-10-07]\n- [x] b [done:: 2026-10-07]\n');
		expect(spawnRepeats(parse(out), '2026-10-07', 1)).toEqual([]);
		expect(patchText(out, (d) => reopenTasks(d, completed))).toBe(text);
	});
});
