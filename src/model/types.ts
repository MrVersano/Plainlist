// Pure data types for a parsed Tasks file. No Obsidian imports here.

export type LineKind =
	| 'frontmatter'
	| 'section'
	| 'project'
	| 'projectDesc'
	| 'task'
	| 'taskDesc'
	| 'opaque';

export interface LineNode {
	kind: LineKind;
	/** Line text without its line ending. */
	text: string;
}

/** `YYYY-MM-DD` or `someday`. */
export type TaskDate = string;

export interface Task {
	/** Index of the title line. */
	line: number;
	/** Original title line text, used to locate the task when patching. */
	text: string;
	done: boolean;
	/** Title text with the recognised `date` and `done` fields removed. */
	title: string;
	date: TaskDate | null;
	/** Completion date, `YYYY-MM-DD`. */
	doneDate: string | null;
	description: string;
	/** Description lines are `[line + 1, end)`. */
	end: number;
	/**
	 * `inbox`: directly under `# Inbox`. `project`: under a `## Name` in `# Projects`.
	 * `other`: anywhere else; shown as an Inbox item but never moved in the file.
	 */
	section: 'inbox' | 'project' | 'other';
	/** Project name when `section` is `project`. */
	project: string | null;
}

export interface Project {
	name: string;
	/** Index of the `## Name` line. */
	line: number;
	text: string;
	description: string;
	/** Description lines are `[descStart, descEnd)`; empty range when there is none. */
	descStart: number;
	descEnd: number;
	/** First line after the project's region (next level 1–2 heading, or EOF). */
	end: number;
	tasks: Task[];
}

export interface Section {
	/** Index of the `# Inbox` / `# Projects` line. */
	line: number;
	/**
	 * First line after the section's own region. For Inbox: the next heading of any level.
	 * For Projects: the next level-1 heading.
	 */
	end: number;
}

export interface Doc {
	lines: string[];
	/** Line ending after each line (`\n`, `\r\n`, or `` for a last line without one). */
	eols: string[];
	/** Line ending used for inserted lines. */
	eol: string;
	/** Whether the file should end with a line ending. */
	trailingNewline: boolean;
	nodes: LineNode[];
	/** Lines `[0, frontmatterEnd)` are frontmatter; 0 when there is none. */
	frontmatterEnd: number;
	/** Frontmatter contains `plainlist: true`. */
	isPlainlist: boolean;
	inbox: Section | null;
	projectsSection: Section | null;
	projects: Project[];
	/** All tasks in file order. */
	tasks: Task[];
}

/**
 * A line edit against the original document: insert `insert` before line `at`,
 * after removing `delete` lines starting at `at`.
 */
export interface LineEdit {
	at: number;
	delete: number;
	insert: string[];
}
