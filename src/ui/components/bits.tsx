import { Component as ObsidianComponent, MarkdownRenderer } from 'obsidian';
import type { JSX, RefObject, TextareaHTMLAttributes } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useEnv } from '../env';
import { findLinks } from '../../links';
import { handleRenderedClick, linkResolves, openLink, openTagSearch } from '../obsidian';
import { type LinkSource, useSuggest } from './suggest';

const TAG_RE = /(^|[\s(])(#[^\s#.,;:!?()[\]{}"'`]+)/gu;

/**
 * Title text with `#tags` in the accent colour and `[[links]]` shown as links.
 * Clicking a tag opens Obsidian search; clicking a link opens its note.
 */
export function Title({ text, sourcePath }: { text: string; sourcePath: string }) {
	const { app } = useEnv();
	const links = findLinks(text);
	const pieces: { start: number; end: number; el: JSX.Element }[] = links.map((l) => ({
		start: l.index,
		end: l.end,
		el: (
			<span
				class={`pl-link${linkResolves(app, l.target, sourcePath) ? '' : ' is-unresolved'}`}
				key={l.index}
				onClick={(evt) => {
					evt.stopPropagation();
					openLink(app, evt, l.target, sourcePath);
				}}
			>
				{l.label}
			</span>
		),
	}));
	for (const m of text.matchAll(TAG_RE)) {
		const start = (m.index ?? 0) + (m[1] ?? '').length;
		const tag = m[2] ?? '';
		// A tag needs at least one non-digit character, as in Obsidian.
		if (/^#\d+$/.test(tag) || links.some((l) => start < l.end && l.index < start + tag.length)) continue;
		pieces.push({
			start,
			end: start + tag.length,
			el: (
				<span
					class="pl-tag"
					key={start}
					onClick={(evt) => {
						evt.stopPropagation();
						openTagSearch(app, tag);
					}}
				>
					{tag}
				</span>
			),
		});
	}
	const parts: (string | JSX.Element)[] = [];
	let last = 0;
	for (const p of pieces.sort((a, b) => a.start - b.start)) {
		parts.push(text.slice(last, p.start), p.el);
		last = p.end;
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
export function Markdown({
	text,
	sourcePath,
	class: cls,
	onClick,
}: {
	text: string;
	sourcePath: string;
	class?: string;
	onClick?: () => void;
}) {
	const { app } = useEnv();
	const el = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const target = el.current;
		if (!target) return;
		const owner = new ObsidianComponent();
		owner.load();
		target.empty();
		void MarkdownRenderer.render(app, text, target, sourcePath, owner);
		return () => owner.unload();
	}, [text, sourcePath]);
	return (
		<div
			ref={el}
			class={`pl-markdown markdown-rendered ${cls ?? ''}`}
			onClick={(evt) => {
				if (!handleRenderedClick(app, evt, sourcePath)) onClick?.();
			}}
		/>
	);
}

/** A textarea that grows with its content. */
export function AutoTextarea(
	props: TextareaHTMLAttributes<HTMLTextAreaElement> & {
		value: string;
		autoFocusEnd?: boolean;
		inputRef?: RefObject<HTMLTextAreaElement | null>;
	},
) {
	const { autoFocusEnd, inputRef, ...rest } = props;
	const own = useRef<HTMLTextAreaElement>(null);
	const el = inputRef ?? own;
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
	sourcePath,
	placeholder,
	links,
	onInput,
	onBlur,
	class: cls,
}: {
	value: string;
	sourcePath: string;
	placeholder: string;
	/** Notes to suggest after `[[`. */
	links?: LinkSource;
	onInput: (value: string) => void;
	onBlur?: () => void;
	class?: string;
}) {
	const [editing, setEditing] = useState(false);
	const input = useRef<HTMLTextAreaElement>(null);
	const suggest = useSuggest({ input, value, onChange: onInput, links });
	if (!editing && value.trim()) {
		return <Markdown text={value} sourcePath={sourcePath} class={`pl-markdown-field ${cls ?? ''}`} onClick={() => setEditing(true)} />;
	}
	return (
		<div class="pl-suggest-anchor">
			<AutoTextarea
				inputRef={input}
				class={`pl-textarea ${cls ?? ''}`}
				value={value}
				placeholder={placeholder}
				autoFocusEnd={editing}
				onInput={(e) => {
					onInput(e.currentTarget.value);
					suggest.onInput();
				}}
				onKeyUp={suggest.sync}
				onClick={suggest.sync}
				onFocus={() => setEditing(true)}
				onKeyDown={(e) => {
					if (suggest.onKeyDown(e)) return;
					if (e.key === 'Escape') e.currentTarget.blur();
				}}
				onBlur={() => {
					suggest.onBlur();
					setEditing(false);
					onBlur?.();
				}}
			/>
			{suggest.list}
		</div>
	);
}
