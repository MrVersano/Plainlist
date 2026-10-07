import { useEffect, useRef, useState } from 'preact/hooks';
import { addDays, longDate } from '../../dates/format';
import { findDate } from '../../dates/parse';
import { parseRepeat, withWhenDone } from '../../dates/repeat';
import type { LineRef } from '../../model/patch';
import { useOutsideClick } from '../env';

function useAutoFocus<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	useEffect(() => ref.current?.focus(), []);
	return ref;
}

export function DatePopover({
	today,
	weekStart,
	onPick,
	onClose,
}: {
	today: string;
	weekStart: 0 | 1;
	onPick: (date: string | null) => void;
	onClose: () => void;
}) {
	const [text, setText] = useState('');
	const wrap = useRef<HTMLDivElement>(null);
	const input = useAutoFocus<HTMLInputElement>();
	useOutsideClick(wrap, onClose);
	const match = text.trim() ? findDate(text, today, weekStart) : null;

	return (
		<div
			ref={wrap}
			class="pl-popover pl-date-popover"
			onKeyDown={(e) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					onClose();
				}
			}}
		>
			<input
				ref={input}
				class="pl-popover-input"
				type="text"
				placeholder="fri, next week, oct 20, someday"
				aria-label="Date"
				value={text}
				onInput={(e) => setText(e.currentTarget.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && !e.isComposing) {
						e.preventDefault();
						e.stopPropagation();
						if (match) onPick(match.date);
					}
				}}
			/>
			<div class="pl-date-preview" aria-live="polite">
				{text.trim() ? (match ? longDate(match.date, today) : 'No date recognised') : ' '}
			</div>
			<div class="pl-date-shortcuts">
				<button type="button" onClick={() => onPick(today)}>Today</button>
				<button type="button" onClick={() => onPick(addDays(today, 1))}>Tomorrow</button>
				<button type="button" onClick={() => onPick('someday')}>Someday</button>
				<button type="button" onClick={() => onPick(null)}>Clear</button>
			</div>
		</div>
	);
}

const REPEAT_PRESETS: [string, string][] = [
	['Daily', 'every day'],
	['Weekdays', 'every weekday'],
	['Weekly', 'every week'],
	['Monthly', 'every month'],
	['Yearly', 'every year'],
];

/**
 * Picks a repeat rule: a preset or a typed one ("every 2 weeks on mon"). "From completion"
 * adds "when done", and changes the current rule straight away.
 */
export function RepeatPopover({
	current,
	onPick,
	onClose,
}: {
	current: string | null;
	/** `close` is false for a change made with the popover still open. */
	onPick: (rule: string | null, close: boolean) => void;
	onClose: () => void;
}) {
	const [text, setText] = useState('');
	const [fromDone, setFromDone] = useState(current ? (parseRepeat(current)?.fromDone ?? false) : false);
	const wrap = useRef<HTMLDivElement>(null);
	const input = useAutoFocus<HTMLInputElement>();
	useOutsideClick(wrap, onClose);
	const typed = text.trim() ? withWhenDone(text.trim().replace(/\s+/g, ' ').toLowerCase(), fromDone) : '';
	const valid = typed && parseRepeat(typed) ? typed : null;
	const pick = (rule: string): void => onPick(withWhenDone(rule, fromDone), true);

	return (
		<div
			ref={wrap}
			class="pl-popover pl-date-popover"
			onKeyDown={(e) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					onClose();
				}
			}}
		>
			<input
				ref={input}
				class="pl-popover-input"
				type="text"
				placeholder="every 2 weeks, every mon, thu"
				aria-label="Repeat"
				value={text}
				onInput={(e) => setText(e.currentTarget.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && !e.isComposing) {
						e.preventDefault();
						e.stopPropagation();
						if (valid) onPick(valid, true);
					}
				}}
			/>
			<div class="pl-date-preview" aria-live="polite">
				{text.trim() ? (valid ? `Repeats ${valid}` : 'Not a repeat rule') : ' '}
			</div>
			<div class="pl-date-shortcuts">
				{REPEAT_PRESETS.map(([label, rule]) => (
					<button type="button" key={rule} onClick={() => pick(rule)}>
						{label}
					</button>
				))}
				<button type="button" onClick={() => onPick(null, true)}>
					Never
				</button>
			</div>
			<label class="pl-repeat-from-done">
				<input
					type="checkbox"
					checked={fromDone}
					onChange={(e) => {
						const on = e.currentTarget.checked;
						setFromDone(on);
						if (current) onPick(withWhenDone(current, on), false);
					}}
				/>
				Repeat from the day it's completed
			</label>
		</div>
	);
}

/** A heading in a project note that to-dos can go under. */
export interface HeadingChoice {
	name: string;
	line: number;
	text: string;
}

export interface PickerProject {
	name: string;
	/** Note path. */
	path: string;
	headings?: HeadingChoice[];
}

interface Choice {
	key: string;
	label: string;
	value: string | null;
	heading: HeadingChoice | null;
	/** Text the filter matches against. */
	search: string;
}

export function ProjectPicker({
	projects,
	current,
	currentHeading = null,
	onPick,
	onClose,
}: {
	/** Projects in sidebar order, each followed by its headings. */
	projects: PickerProject[];
	current: string | null;
	/** Line of the current heading in the current project. */
	currentHeading?: number | null;
	onPick: (projectPath: string | null, heading: LineRef | null) => void;
	onClose: () => void;
}) {
	const [filter, setFilter] = useState('');
	const [active, setActive] = useState(0);
	const wrap = useRef<HTMLDivElement>(null);
	const input = useAutoFocus<HTMLInputElement>();
	useOutsideClick(wrap, onClose);

	const all: Choice[] = [{ key: 'inbox', label: 'Inbox', value: null, heading: null, search: 'inbox' }];
	for (const p of projects) {
		all.push({ key: p.path, label: p.name, value: p.path, heading: null, search: p.name.toLowerCase() });
		for (const h of p.headings ?? []) {
			const search = `${p.name} ${h.name}`.toLowerCase();
			all.push({ key: `${p.path}#${h.line}`, label: h.name, value: p.path, heading: h, search });
		}
	}
	const q = filter.trim().toLowerCase();
	// A project stays listed while any of its headings match, so they keep their context.
	const choices = q
		? all.filter((c) => c.search.includes(q) || (!c.heading && all.some((x) => x.heading && x.value === c.value && x.search.includes(q))))
		: all;
	const index = Math.min(active, Math.max(choices.length - 1, 0));
	const isCurrent = (c: Choice): boolean => c.value === current && (c.heading?.line ?? null) === currentHeading;
	const pick = (c: Choice): void => onPick(c.value, c.heading && { line: c.heading.line, text: c.heading.text });

	return (
		<div ref={wrap} class="pl-popover pl-project-popover">
			<input
				ref={input}
				class="pl-popover-input"
				type="text"
				placeholder="Find a project"
				aria-label="Project"
				value={filter}
				onInput={(e) => {
					setFilter(e.currentTarget.value);
					setActive(0);
				}}
				onKeyDown={(e) => {
					if (e.isComposing) return;
					if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
						e.preventDefault();
						const step = e.key === 'ArrowDown' ? 1 : -1;
						setActive((index + step + choices.length) % Math.max(choices.length, 1));
					} else if (e.key === 'Enter' || (e.key === 'Tab' && choices.length)) {
						e.preventDefault();
						e.stopPropagation();
						const c = choices[index];
						if (c) pick(c);
					} else if (e.key === 'Escape') {
						e.preventDefault();
						e.stopPropagation();
						onClose();
					}
				}}
			/>
			<div class="pl-project-options" role="listbox" aria-label="Projects">
				{choices.map((c, i) => (
					<button
						type="button"
						role="option"
						aria-selected={i === index}
						key={c.key}
						class={`pl-project-option${c.heading ? ' is-heading' : ''}${i === index ? ' is-active' : ''}${isCurrent(c) ? ' is-current' : ''}`}
						// Not mouseenter: a list re-laid out under a resting pointer would move the choice.
						onMouseMove={() => i !== index && setActive(i)}
						onClick={() => pick(c)}
					>
						{c.label}
					</button>
				))}
				{!choices.length && <div class="pl-project-empty">No matching project</div>}
			</div>
		</div>
	);
}
