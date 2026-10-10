// Fetches a web page's title, so a to-do added as a bare URL can show as `[title](url)`.

import { App, requestUrl, type TFile } from 'obsidian';
import { patchText } from './model/apply';
import { retitleTasks } from './model/patch';
import { bareUrl, markdownLink, pageTitle } from './links';

/** Looks up a page's title; resolves to null when it can't. */
export type LinkTitle = (url: string) => Promise<string | null>;

const TIMEOUT_MS = 10_000;

/**
 * Sites behind bot protection (IMDb, for one) answer an ordinary request with an empty
 * challenge page, but serve link-preview crawlers. A second try identifies as one.
 */
const LINK_PREVIEW_HEADERS = { 'User-Agent': 'facebookexternalhit/1.1', Accept: 'text/html' };

/** The page's title from one request, or null when there is none to read. */
async function requestTitle(url: string, headers?: Record<string, string>): Promise<string | null> {
	try {
		const res = await requestUrl({ url, headers, throw: false });
		if (res.status >= 300) return null;
		const type = Object.entries(res.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
		if (type && !/html/i.test(type)) return null;
		return pageTitle(res.text);
	} catch {
		return null;
	}
}

/**
 * The title of the page at `url`, or null when it can't be fetched in time or isn't HTML.
 * When the first request finds no title, it tries once more as a link-preview crawler.
 */
export async function fetchPageTitle(url: string): Promise<string | null> {
	let timer = 0;
	const lookup = async (): Promise<string | null> => (await requestTitle(url)) ?? requestTitle(url, LINK_PREVIEW_HEADERS);
	try {
		return await Promise.race([lookup(), new Promise<null>((resolve) => (timer = window.setTimeout(() => resolve(null), TIMEOUT_MS)))]);
	} finally {
		window.clearTimeout(timer);
	}
}

/** `title` as a Markdown link when it is a bare URL whose page title can be found, else as is. */
export async function linkedTitle(title: string, linkTitle: LinkTitle): Promise<string> {
	const url = bareUrl(title);
	const label = url && (await linkTitle(url));
	return url && label ? markdownLink(label, url) : title;
}

/**
 * For a to-do just written to `file` with a bare URL as its title: once the page's title
 * arrives, turns the open to-dos titled with that URL into `[title](url)`.
 */
export async function linkUrlTasksLater(app: App, file: TFile, title: string, linkTitle: LinkTitle): Promise<void> {
	const url = bareUrl(title);
	if (!url) return;
	const linked = await linkedTitle(url, linkTitle);
	if (linked === url) return;
	try {
		await app.vault.process(file, (text) => patchText(text, (doc) => retitleTasks(doc, url, linked)));
	} catch {
		// The note changed or went away; the to-do keeps its URL.
	}
}
