import { App, Menu } from 'obsidian';
import { addDays, longDate } from '../dates/format';
import { findDate } from '../dates/parse';
import type { TaskDate } from '../model/types';
import { dateModal } from './modals';

/**
 * The date choices for one to-do, in Obsidian's own menu (a sheet at the bottom of the screen on
 * phones): one tap for the usual dates, or "Other date…" to type one.
 */
export function scheduleMenu(
	app: App,
	{ current, today, weekStart, onPick }: { current: TaskDate | null; today: string; weekStart: 0 | 1; onPick: (date: TaskDate | null) => void },
): Menu {
	const menu = new Menu();
	const phrase = (text: string): string => findDate(text, today, weekStart)?.date ?? today;
	const choices: { title: string; icon: string; date: TaskDate }[] = [
		{ title: 'Today', icon: 'star', date: today },
		{ title: 'Tomorrow', icon: 'sunrise', date: addDays(today, 1) },
		{ title: 'This weekend', icon: 'sofa', date: phrase('this weekend') },
		{ title: 'Next week', icon: 'calendar', date: phrase('next week') },
		{ title: 'Someday', icon: 'archive', date: 'someday' },
	];
	menu.addItem((i) => i.setTitle('Schedule').setIsLabel(true));
	for (const c of choices) {
		// Dates further off say which day they are.
		const title = c.date === 'someday' || c.date === today || c.date === addDays(today, 1) ? c.title : `${c.title} · ${longDate(c.date, today)}`;
		menu.addItem((i) =>
			i
				.setTitle(title)
				.setIcon(c.icon)
				.setChecked(current === c.date ? true : null)
				.onClick(() => onPick(c.date)),
		);
	}
	menu.addItem((i) =>
		i
			.setTitle('Other date…')
			.setIcon('calendar-days')
			.onClick(() => void dateModal(app, today, weekStart).then((date) => date && onPick(date))),
	);
	if (current !== null) {
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle('Remove date')
				.setIcon('x')
				.onClick(() => onPick(null)),
		);
	}
	return menu;
}
