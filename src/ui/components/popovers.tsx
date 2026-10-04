import { useEffect, useRef, useState } from 'preact/hooks';
import { addDays, longDate } from '../../dates/format';
import { findDate } from '../../dates/parse';
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

interface Choice {
	label: string;
	value: string | null;
}

export function ProjectPicker({
	projects,
	current,
	onPick,
	onClose,
}: {
	/** Projects in sidebar order; values are note paths. */
	projects: { name: string; path: string }[];
	current: string | null;
	onPick: (projectPath: string | null) => void;
	onClose: () => void;
}) {
	const [filter, setFilter] = useState('');
	const [active, setActive] = useState(0);
	const wrap = useRef<HTMLDivElement>(null);
	const input = useAutoFocus<HTMLInputElement>();
	useOutsideClick(wrap, onClose);

	const all: Choice[] = [{ label: 'Inbox', value: null }, ...projects.map((p) => ({ label: p.name, value: p.path }))];
	const q = filter.trim().toLowerCase();
	const choices = q ? all.filter((c) => c.label.toLowerCase().includes(q)) : all;
	const index = Math.min(active, Math.max(choices.length - 1, 0));

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
						if (c) onPick(c.value);
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
						key={c.value ?? 'inbox'}
						class={`pl-project-option${i === index ? ' is-active' : ''}${c.value === current ? ' is-current' : ''}`}
						onMouseEnter={() => setActive(i)}
						onClick={() => onPick(c.value)}
					>
						{c.label}
					</button>
				))}
				{!choices.length && <div class="pl-project-empty">No matching project</div>}
			</div>
		</div>
	);
}
