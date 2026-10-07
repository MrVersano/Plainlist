# File format

Plainlist stores everything as plain Markdown in your notes. You can edit those notes by hand, sync them, or read them with other tools, and the view picks up the changes straight away.

## The task file

```markdown
---
plainlist: true
---

# Inbox
- [ ] Renew domain for side project #admin [date:: 2026-10-04]
- [ ] Look into a new backup drive

# Projects
- [[Renovate home office]]
- [x] [[Garden for spring]] [done:: 2026-10-03]

## Work
- [[Q4 Planning]]
```

The `plainlist: true` property makes the note open in the Plainlist view. `# Inbox` holds to-dos that aren't in a project, and `# Projects` lists links to your [project](projects.md) notes. A heading under `# Projects`, such as `## Work`, is an [area](projects.md#areas): the links below it are its projects.

## A project note

A project note, `Renovate home office.md`, can contain anything. Plainlist reads its checkboxes:

```markdown
Finish the office before winter.

- [ ] Book electrician for office outlets #errands [date:: 2026-10-04]
	Four more outlets on the desk wall and one by the window.
- [ ] Order standing desk frame [date:: 2026-10-20]
    - [ ] Measure the desk wall
- [x] Order cable trays [done:: 2026-10-02]

## Notes
The electrician is free Thursday mornings.
```

## Syntax

| Element | Syntax |
|---|---|
| Inbox | To-dos under `# Inbox` in the task file |
| Project | A link list item (`- [[Note]]` or `- [Note](Note.md)`) under `# Projects` in the task file |
| Completed project | `- [x] [[Note]] [done:: YYYY-MM-DD]` |
| Area | A heading under `# Projects` (`## Work`), followed by its projects' links. A heading with to-dos under it is not an area |
| To-do | Any checkbox, at any indent: `- [ ] title`, `* [x] title`, `1. [ ] title` |
| Sub-task | A checkbox indented under another one: `- [ ] parent`, then `\t- [ ] sub-task` on the next line |
| Description | Indented lines directly under a to-do that are not themselves checkboxes |
| Date | `[date:: YYYY-MM-DD]` or `[date:: someday]` (Dataview inline-field syntax) |
| Repeat | `[repeat:: every week]`, after the date; see [Rules](todos.md#rules) |
| Completed | `[x]` plus `[done:: YYYY-MM-DD]`, added when you complete a to-do |
| Tags | `#tag` anywhere in a title or description |
| Heading | Any heading in a project note groups the to-dos under it; see [Headings](projects.md#headings) |

## Details

- To-dos elsewhere in the task file (under another heading, say) show up in the Inbox but are never moved.
- Checkboxes inside code blocks and callouts are ignored.
- Unknown inline fields such as `[priority:: high]` stay in the title, and so does a `[repeat:: …]` rule Plainlist can't read.
- Completing a repeating to-do adds a new line above it with the rule and the next date, and takes the rule off the completed one. A ticked line that still has its rule (ticked by hand) gets its next one the same way.
- Moving or deleting a to-do takes its sub-tasks with it.
- Plainlist only changes the lines it owns. Headings, notes, tables and callouts it does not understand stay exactly as they are.
- The custom order of the Today list is kept in Plainlist's own data, not in your notes.

Because dates use Dataview's inline-field syntax, you can query your to-dos with [Dataview](https://github.com/blacksmithgu/obsidian-dataview) too.
