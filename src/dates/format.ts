// Date helpers and English labels. Dates are local calendar days, stored as `YYYY-MM-DD`.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number): string => String(n).padStart(2, '0');

export function toISO(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(iso: string): Date {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: string, days: number): string {
	const d = fromISO(iso);
	d.setDate(d.getDate() + days);
	return toISO(d);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
	return Math.round((fromISO(to).getTime() - fromISO(from).getTime()) / 86_400_000);
}

export function weekday(iso: string): number {
	return fromISO(iso).getDay();
}

const short = (s: string): string => s.slice(0, 3);
const sameYear = (a: string, b: string): boolean => a.slice(0, 4) === b.slice(0, 4);

/** "Sunday, 4 October" — the Today list header. */
export function headerDate(iso: string): string {
	const d = fromISO(iso);
	return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "Tue, 6 October" (with the year when it is not this year), or "Someday". */
export function longDate(date: string, today: string): string {
	if (date === 'someday') return 'Someday';
	const d = fromISO(date);
	const year = sameYear(date, today) ? '' : ` ${d.getFullYear()}`;
	return `${short(WEEKDAYS[d.getDay()] ?? '')}, ${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}

/** "12 Oct" (with the year when it is not this year). */
export function shortDate(date: string, today: string): string {
	const d = fromISO(date);
	const year = sameYear(date, today) ? '' : ` ${d.getFullYear()}`;
	return `${d.getDate()} ${short(MONTHS[d.getMonth()] ?? '')}${year}`;
}

/** Row meta for a date: "Today", "Tomorrow", "Yesterday", "12 Oct", "Someday". */
export function metaDate(date: string, today: string): string {
	if (date === 'someday') return 'Someday';
	const diff = daysBetween(today, date);
	if (diff === 0) return 'Today';
	if (diff === 1) return 'Tomorrow';
	if (diff === -1) return 'Yesterday';
	return shortDate(date, today);
}

/** "2 days ago" for overdue dates; "Yesterday" for one day. */
export function overdueLabel(date: string, today: string): string {
	const days = daysBetween(date, today);
	if (days === 1) return 'Yesterday';
	if (days < 14) return `${days} days ago`;
	if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
	return shortDate(date, today);
}

export interface GroupLabel {
	key: string;
	label: string;
	sublabel?: string;
}

function monthGroup(date: string, today: string, currentMonthLabel: (month: string) => string): GroupLabel {
	const d = fromISO(date);
	const month = MONTHS[d.getMonth()] ?? '';
	const key = date.slice(0, 7);
	if (key === today.slice(0, 7)) return { key, label: currentMonthLabel(month) };
	return { key, label: sameYear(date, today) ? month : `${month} ${d.getFullYear()}` };
}

/** Group for a date after today in the Upcoming list. */
export function upcomingGroup(date: string, today: string): GroupLabel {
	const diff = daysBetween(today, date);
	const d = fromISO(date);
	if (diff === 1) return { key: date, label: 'Tomorrow', sublabel: `${short(WEEKDAYS[d.getDay()] ?? '')} ${shortDate(date, today)}` };
	if (diff <= 7) return { key: date, label: WEEKDAYS[d.getDay()] ?? '', sublabel: shortDate(date, today) };
	return monthGroup(date, today, (m) => `Later in ${m}`);
}

/** Group for a completion date in the Completed list. */
export function completedGroup(doneDate: string, today: string): GroupLabel {
	const diff = daysBetween(doneDate, today);
	const d = fromISO(doneDate);
	if (diff <= 0) return { key: doneDate, label: 'Today' };
	if (diff === 1) return { key: doneDate, label: 'Yesterday', sublabel: `${short(WEEKDAYS[d.getDay()] ?? '')} ${shortDate(doneDate, today)}` };
	if (diff < 7) return { key: doneDate, label: WEEKDAYS[d.getDay()] ?? '', sublabel: shortDate(doneDate, today) };
	return monthGroup(doneDate, today, (m) => `Earlier in ${m}`);
}
