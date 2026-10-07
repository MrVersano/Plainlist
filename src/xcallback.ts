// x-callback-url return URLs (x-success, x-error, x-cancel), for apps such as Shortcuts
// that open Plainlist's obsidian:// URLs and want to be sent back afterwards.

/** `url` with `params` added to its query, before any `#fragment`; null when there is no `url`. */
export function withParams(url: string | undefined, params: Record<string, string> = {}): string | null {
	if (!url) return null;
	const query = new URLSearchParams(params).toString();
	if (!query) return url;
	const hash = url.indexOf('#');
	const base = hash < 0 ? url : url.slice(0, hash);
	const fragment = hash < 0 ? '' : url.slice(hash);
	const sep = !base.includes('?') ? '?' : base.endsWith('?') || base.endsWith('&') ? '' : '&';
	return `${base}${sep}${query}${fragment}`;
}
