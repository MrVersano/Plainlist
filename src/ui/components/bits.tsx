import { Component as ObsidianComponent, MarkdownRenderer } from 'obsidian';
import type { JSX, TextareaHTMLAttributes } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useEnv } from '../env';
import { handleRenderedClick, openTagSearch } from '../obsidian';

const TAG_RE = /(^|[\s(])(#[^\s#.,;:!?()[\]{}"'`]+)/gu;

/** Title text with `#tags` in the accent colour. Clicking a tag opens Obsidian search. */
export function Title({ text }: { text: string }) {
	const { app } = useEnv();
	const parts: (string | JSX.Element)[] = [];
	let last = 0;
	for (const m of text.matchAll(TAG_RE)) {
		const start = (m.index ?? 0) + (m[1] ?? '').length;
		const tag = m[2] ?? '';
		// A tag needs at least one non-digit character, as in Obsidian.
		if (/^#\d+$/.test(tag)) continue;
		parts.push(text.slice(last, start));
		parts.push(
			<span
				class="pl-tag"
				key={start}
				onClick={(evt) => {
					evt.stopPropagation();
					openTagSearch(app, tag);
				}}
			>
				{tag}
			</span>,
		);
		last = start + tag.length;
	}
	parts.push(text.slice(last));
	return <>{parts}</>;
}

export function Checkbox({ done, title, onToggle }: { done: boolean; title: string; onToggle: () => void }) {
	return (
		<button
			type="button"
			class={`pl-check${done ? ' is-done' : ''}`}
			role="checkbox"
			aria-checked={done}
			aria-label={`${done ? 'Reopen' : 'Complete'}: ${title}`}
			onClick={(evt) => {
				evt.stopPropagation();
				onToggle();
			}}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true">
				<path d="M4 8.2l2.6 2.6L12 5.4" />
			</svg>
		</button>
	);
}

/** Markdown rendered by Obsidian, so links, tags and embeds behave natively. */
export function Markdown({ text, class: cls, onClick }: { text: string; class?: string; onClick?: () => void }) {
	const { app, file } = useEnv();
	const el = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const target = el.current;
		if (!target) return;
		const owner = new ObsidianComponent();
		owner.load();
		target.empty();
		void MarkdownRenderer.render(app, text, target, file.path, owner);
		return () => owner.unload();
	}, [text, file.path]);
	return (
		<div
			ref={el}
			class={`pl-markdown markdown-rendered ${cls ?? ''}`}
			onClick={(evt) => {
				if (!handleRenderedClick(app, evt, file.path)) onClick?.();
			}}
		/>
	);
}

/** A textarea that grows with its content. */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; autoFocusEnd?: boolean }) {
	const { autoFocusEnd, ...rest } = props;
	const el = useRef<HTMLTextAreaElement>(null);
	useLayoutEffect(() => {
		const t = el.current;
		if (!t) return;
		t.setCssProps({ height: 'auto' });
		t.setCssProps({ height: `${t.scrollHeight}px` });
	}, [props.value]);
	useEffect(() => {
		const t = el.current;
		if (!autoFocusEnd || !t) return;
		t.focus();
		t.setSelectionRange(t.value.length, t.value.length);
	}, []);
	return <textarea ref={el} rows={1} {...rest} />;
}

/**
 * Description shown as rendered Markdown, switching to a textarea when clicked
 * (or straight away when empty).
 */
export function MarkdownField({
	value,
	placeholder,
	onInput,
	onBlur,
	class: cls,
}: {
	value: string;
	placeholder: string;
	onInput: (value: string) => void;
	onBlur?: () => void;
	class?: string;
}) {
	const [editing, setEditing] = useState(false);
	if (!editing && value.trim()) {
		return <Markdown text={value} class={`pl-markdown-field ${cls ?? ''}`} onClick={() => setEditing(true)} />;
	}
	return (
		<AutoTextarea
			class={`pl-textarea ${cls ?? ''}`}
			value={value}
			placeholder={placeholder}
			autoFocusEnd={editing}
			onInput={(e) => onInput(e.currentTarget.value)}
			onFocus={() => setEditing(true)}
			onKeyDown={(e) => {
				if (e.key === 'Escape') e.currentTarget.blur();
			}}
			onBlur={() => {
				setEditing(false);
				onBlur?.();
			}}
		/>
	);
}
