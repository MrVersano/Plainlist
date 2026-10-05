// Electron accelerator strings ("CmdOrCtrl+Shift+Space") for the system-wide Quick Entry shortcut.
// Pure functions with no Electron dependency, so the cross-platform settings tab can use them.

// Not ⇧⌘Space: macOS 27 reserves it for Visual Intelligence, and Electron can't detect clashes with system shortcuts.
export const DEFAULT_SHORTCUT = 'CmdOrCtrl+Alt+N';

const CODE_KEYS: Record<string, string> = {
	Space: 'Space',
	Enter: 'Enter',
	Tab: 'Tab',
	Backspace: 'Backspace',
	Delete: 'Delete',
	Insert: 'Insert',
	Home: 'Home',
	End: 'End',
	PageUp: 'PageUp',
	PageDown: 'PageDown',
	ArrowUp: 'Up',
	ArrowDown: 'Down',
	ArrowLeft: 'Left',
	ArrowRight: 'Right',
	Minus: '-',
	Equal: '=',
	BracketLeft: '[',
	BracketRight: ']',
	Backslash: '\\',
	Semicolon: ';',
	Quote: "'",
	Comma: ',',
	Period: '.',
	Slash: '/',
	Backquote: '`',
};

/** The accelerator key for a `KeyboardEvent.code`, or null for keys a global shortcut can't use. */
function keyFromCode(code: string): string | null {
	const letter = /^Key([A-Z])$/.exec(code);
	if (letter) return letter[1] ?? null;
	const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
	if (digit) return code.startsWith('Numpad') ? `num${digit[1]}` : (digit[1] ?? null);
	if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
	return CODE_KEYS[code] ?? null;
}

/**
 * The accelerator for a key press, using CmdOrCtrl for ⌘ on macOS and Ctrl elsewhere.
 * Returns null for a lone modifier, or for a key without Cmd/Ctrl/Alt/Super (except F-keys),
 * which would swallow ordinary typing in every app.
 */
export function acceleratorFromEvent(evt: KeyboardEvent, isMac: boolean): string | null {
	const key = keyFromCode(evt.code);
	if (!key) return null;
	const mods: string[] = [];
	if (isMac ? evt.metaKey : evt.ctrlKey) mods.push('CmdOrCtrl');
	if (isMac && evt.ctrlKey) mods.push('Ctrl');
	if (!isMac && evt.metaKey) mods.push('Super');
	if (evt.altKey) mods.push('Alt');
	if (evt.shiftKey) mods.push('Shift');
	const strong = mods.some((m) => m !== 'Shift');
	if (!strong && !/^F\d+$/.test(key)) return null;
	return [...mods, key].join('+');
}

const MAC_SYMBOLS: Record<string, string> = {
	CmdOrCtrl: '⌘',
	CommandOrControl: '⌘',
	Command: '⌘',
	Cmd: '⌘',
	Ctrl: '⌃',
	Control: '⌃',
	Alt: '⌥',
	Option: '⌥',
	Shift: '⇧',
	Super: '⌘',
	Meta: '⌘',
};

const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'];

/** A readable label, e.g. "⇧⌘Space" on macOS or "Ctrl+Shift+Space" elsewhere. */
export function formatAccelerator(accelerator: string, isMac: boolean): string {
	const parts = accelerator.split('+').filter(Boolean);
	if (accelerator.endsWith('++')) parts.push('+');
	const key = parts.pop() ?? '';
	if (isMac) {
		// macOS lists modifiers as ⌃⌥⇧⌘.
		const symbols = parts.map((p) => MAC_SYMBOLS[p] ?? p);
		symbols.sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
		return symbols.join('') + key;
	}
	const names = parts.map((p) => (p === 'CmdOrCtrl' || p === 'CommandOrControl' ? 'Ctrl' : p));
	return [...names, key].join('+');
}
