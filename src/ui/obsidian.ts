// Thin wrappers around Obsidian behaviour the view relies on, including two
// undocumented internals (global search, hotkey manager) guarded so a change
// in Obsidian degrades gracefully instead of throwing.

import { App, Keymap, Platform } from 'obsidian';

interface SearchPlugin {
	instance?: { openGlobalSearch?: (query: string) => void };
}

interface InternalApp {
	internalPlugins?: { getPluginById?: (id: string) => SearchPlugin | null };
	hotkeyManager?: {
		getHotkeys?: (id: string) => { modifiers: string[]; key: string }[] | undefined;
		getDefaultHotkeys?: (id: string) => { modifiers: string[]; key: string }[] | undefined;
	};
}

/** Opens Obsidian search for `tag:#name`. */
export function openTagSearch(app: App, tag: string): void {
	const search = (app as unknown as InternalApp).internalPlugins?.getPluginById?.('global-search');
	search?.instance?.openGlobalSearch?.(`tag:${tag.startsWith('#') ? tag : `#${tag}`}`);
}

/** Handles clicks on links and tags inside rendered Markdown. Returns true when handled. */
export function handleRenderedClick(app: App, evt: MouseEvent, sourcePath: string): boolean {
	const target = evt.target instanceof HTMLElement ? evt.target.closest('a') : null;
	if (!target) return false;
	evt.preventDefault();
	evt.stopPropagation();
	if (target.hasClass('tag')) {
		openTagSearch(app, target.getText());
	} else if (target.hasClass('internal-link')) {
		const href = target.getAttr('data-href') ?? target.getAttr('href') ?? '';
		void app.workspace.openLinkText(href, sourcePath, Keymap.isModEvent(evt));
	} else {
		const href = target.getAttr('href');
		if (href) window.open(href, '_blank');
	}
	return true;
}

const MAC_SYMBOLS: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Meta: '⌘', Alt: '⌥', Shift: '⇧' };

/** The user's hotkey for a command, e.g. "⌘⇧N" or "Ctrl+Shift+N"; null when none is bound. */
export function hotkeyLabel(app: App, commandId: string): string | null {
	const manager = (app as unknown as InternalApp).hotkeyManager;
	const custom = manager?.getHotkeys?.(commandId);
	const keys = custom ?? manager?.getDefaultHotkeys?.(commandId);
	const hotkey = keys?.[0];
	if (!hotkey) return null;
	const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
	if (Platform.isMacOS) return hotkey.modifiers.map((m) => MAC_SYMBOLS[m] ?? m).join('') + key;
	return [...hotkey.modifiers.map((m) => (m === 'Mod' ? 'Ctrl' : m)), key].join('+');
}

/**
 * The corner radius the current theme gives task checkboxes, scaled to `size` pixels.
 * Read from a real (hidden) checkbox so themes that style it with their own selectors count too.
 */
export function themeCheckboxRadius(doc: Document, size = 18): string {
	const host = doc.body.createDiv({ cls: 'markdown-rendered markdown-preview-view pl-probe' });
	const input = host
		.createEl('ul', { cls: 'contains-task-list' })
		.createEl('li', { cls: 'task-list-item', attr: { 'data-task': ' ' } })
		.createEl('input', { type: 'checkbox', cls: 'task-list-item-checkbox' });
	const style = getComputedStyle(input);
	const radius = style.borderTopLeftRadius;
	const width = parseFloat(style.width);
	host.remove();
	if (radius.endsWith('%')) return radius;
	const px = parseFloat(radius);
	if (!Number.isFinite(px) || !width) return 'var(--checkbox-radius, 50%)';
	if (px >= width / 2) return '50%';
	return `${Math.round(((px * size) / width) * 10) / 10}px`;
}
