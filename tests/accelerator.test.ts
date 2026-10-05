import { describe, expect, it } from 'vitest';
import { acceleratorFromEvent, formatAccelerator } from '../src/accelerator';

function key(code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) {
	return { code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods } as KeyboardEvent;
}

describe('acceleratorFromEvent', () => {
	it('maps ⌘ on macOS and Ctrl elsewhere to CmdOrCtrl', () => {
		expect(acceleratorFromEvent(key('Space', { metaKey: true, shiftKey: true }), true)).toBe('CmdOrCtrl+Shift+Space');
		expect(acceleratorFromEvent(key('Space', { ctrlKey: true, shiftKey: true }), false)).toBe('CmdOrCtrl+Shift+Space');
	});

	it('keeps Control on macOS and Super elsewhere distinct', () => {
		expect(acceleratorFromEvent(key('KeyN', { ctrlKey: true, altKey: true }), true)).toBe('Ctrl+Alt+N');
		expect(acceleratorFromEvent(key('KeyN', { metaKey: true }), false)).toBe('Super+N');
	});

	it('maps digits, punctuation, arrows and F-keys', () => {
		expect(acceleratorFromEvent(key('Digit1', { altKey: true }), true)).toBe('Alt+1');
		expect(acceleratorFromEvent(key('Numpad5', { altKey: true }), true)).toBe('Alt+num5');
		expect(acceleratorFromEvent(key('Period', { metaKey: true }), true)).toBe('CmdOrCtrl+.');
		expect(acceleratorFromEvent(key('ArrowUp', { altKey: true }), true)).toBe('Alt+Up');
		expect(acceleratorFromEvent(key('F13'), true)).toBe('F13');
	});

	it('rejects lone modifiers and shortcuts that would swallow typing', () => {
		expect(acceleratorFromEvent(key('ShiftLeft', { shiftKey: true }), true)).toBeNull();
		expect(acceleratorFromEvent(key('KeyA'), true)).toBeNull();
		expect(acceleratorFromEvent(key('KeyA', { shiftKey: true }), false)).toBeNull();
	});
});

describe('formatAccelerator', () => {
	it('uses symbols on macOS', () => {
		expect(formatAccelerator('CmdOrCtrl+Shift+Space', true)).toBe('⇧⌘Space');
		expect(formatAccelerator('CmdOrCtrl+Alt+N', true)).toBe('⌥⌘N');
		expect(formatAccelerator('Ctrl+Alt+N', true)).toBe('⌃⌥N');
	});

	it('spells modifiers out elsewhere', () => {
		expect(formatAccelerator('CmdOrCtrl+Shift+Space', false)).toBe('Ctrl+Shift+Space');
		expect(formatAccelerator('CmdOrCtrl+Plus', false)).toBe('Ctrl+Plus');
	});
});
