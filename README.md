# Plainlist

Plainlist shows one Markdown note as a clean, minimal task manager in Obsidian. The note is the only storage: everything you do in the view is written back as plain Markdown, and anything you type into the note by hand shows up in the view straight away.

![Today](assets/today.png)

- **Lists:** Inbox, Today, Upcoming, No Date, Someday and Completed, plus one list per project.
- **To-dos:** a title, a description (with `#tags` and `[[links]]`), a date and a project. Click a to-do to edit it in place.
- **Quick capture:** the **New to-do** command opens a small palette that understands dates as you type: "today", "tonight", "fri", "next tue", "in 3 days", "oct 20", "someday".
- **Safe editing:** Plainlist only changes the lines it owns. Headings, notes, tables and callouts it does not understand stay exactly as they are.

| Upcoming | Project |
|---|---|
| ![Upcoming](assets/upcoming.png) | ![Project](assets/project.png) |

## Getting started

Run **Plainlist: Open** from the command palette (or click the ribbon icon). It opens `Tasks.md`, creating it if needed. Any note with `plainlist: true` in its properties opens in the Plainlist view; use the header button or **Plainlist: Switch between task list and Markdown** to see the raw Markdown.

Plainlist does not set a hotkey for you. To capture from anywhere, bind **Plainlist: New to-do** under **Settings → Hotkeys**; `Mod+Shift+N` works well.

## File format

```markdown
---
plainlist: true
---

# Inbox
- [ ] Renew domain for side project #admin [date:: 2026-10-04]
- [ ] Look into a new backup drive

# Projects

## Renovate home office
Finish the office unit before winter so it works for full days.

- [ ] Book electrician for office outlets #errands [date:: 2026-10-04]
	Four more outlets on the desk wall and one by the window.
	Ask about a dedicated circuit for the heater.
- [ ] Pick shelving for the back wall [date:: someday]
- [x] Order cable trays [done:: 2026-10-02]

## Q4 Planning
- [ ] Prepare sprint review notes [date:: 2026-10-04]
```

| Element | Syntax |
|---|---|
| Inbox | To-dos under `# Inbox` |
| Project | `## Name` under `# Projects`; text between the heading and the first to-do is the project's description |
| To-do | `- [ ] title` or `- [x] title` at the start of a line |
| Description | Lines indented with a tab (or two or more spaces) directly under a to-do. Indented lines that look like to-dos are description text, not subtasks |
| Date | `[date:: YYYY-MM-DD]` or `[date:: someday]` (Dataview inline-field syntax) |
| Completed | `- [x]` plus `[done:: YYYY-MM-DD]`, added when you complete a to-do |
| Tags | `#tag` anywhere in a title or description |

To-dos elsewhere in the note (under another heading, say) show up in the Inbox but are never moved. Unknown inline fields such as `[priority:: high]` stay in the title.

## Keyboard

With the Plainlist view focused:

| Key | Action |
|---|---|
| `↑` `↓` | Move the selection |
| `Enter` | Open or close the selected to-do |
| `Esc` | Close the open to-do |
| `N` | New to-do in the current list |
| `Space` or `Mod+Enter` | Complete or reopen the selected to-do |
| `Mod+Backspace` | Delete the selected to-do (with undo) |

Right-click (or long-press on mobile) a to-do to complete or delete it, or a project to rename or delete it.

## Settings

- **Tasks file:** the note the **Open** command uses. Default: `Tasks.md`.
- **Open this file in Plainlist view by default:** notes with `plainlist: true` open as a task list. Default: on.
- **Week starts on:** used for "next week". Default: your locale.

## Development

```bash
npm install
npm run setup-vault   # installs the Hot Reload plugin into test-vault/
npm run dev           # builds into test-vault/.obsidian/plugins/plainlist and rebuilds on change
npm test              # vitest
npm run lint
npm run build         # type-check and production build (main.js, styles.css)
```

Open `test-vault/` as a vault in Obsidian, turn off Restricted mode, and enable Plainlist and Hot Reload under **Settings → Community plugins**. To build into another vault, set `PLAINLIST_VAULT=/path/to/vault` before `npm run dev`.

The file model (`src/model/`) and date parsing (`src/dates/`) have no Obsidian imports and are covered by the tests in `tests/`.

## Releasing

1. `npm version patch` (or `minor` / `major`) updates `manifest.json`, `package.json` and `versions.json`.
2. Push the tag (`git push --follow-tags`). The release workflow builds the plugin and creates a draft GitHub release with `main.js`, `manifest.json` and `styles.css`.
