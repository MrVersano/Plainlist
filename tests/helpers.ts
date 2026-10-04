import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { expect } from 'vitest';

const dir = join(import.meta.dirname, 'fixtures');

export function fixture(name: string): string {
	return readFileSync(join(dir, name), 'utf8');
}

export function allFixtures(): { name: string; text: string }[] {
	return readdirSync(dir)
		.filter((f) => f.endsWith('.md'))
		.map((name) => ({ name, text: fixture(name) }));
}

/** The fixture plus CRLF, no-trailing-newline and mixed-ending variants. */
export function variants(text: string): { label: string; text: string }[] {
	const lf = text.replace(/\r\n/g, '\n');
	const crlf = lf.replace(/\n/g, '\r\n');
	let count = 0;
	const mixed = lf.replace(/\n/g, () => (count++ % 2 === 0 ? '\r\n' : '\n'));
	return [
		{ label: 'as is', text },
		{ label: 'LF', text: lf },
		{ label: 'CRLF', text: crlf },
		{ label: 'LF, no trailing newline', text: lf.replace(/\n$/, '') },
		{ label: 'CRLF, no trailing newline', text: crlf.replace(/\r\n$/, '') },
		{ label: 'mixed endings', text: mixed },
	];
}

/** Indices of lines that differ between two texts with the same line count. */
export function changedLines(before: string, after: string): number[] {
	const a = before.split('\n');
	const b = after.split('\n');
	expect(b.length).toBe(a.length);
	return a.flatMap((l, i) => (l === b[i] ? [] : [i]));
}

/** Deterministic PRNG (mulberry32) so random-action tests are reproducible. */
export function rng(seed: number): () => number {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
