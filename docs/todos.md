# To-dos

A to-do has a title, an optional description, a date and a project. Every one of them is an ordinary Markdown checkbox in a note, so you can edit it in the Plainlist view or in the note itself. See the [file format](file-format.md) for what that looks like.

## Editing a to-do

Click a to-do's title to open it in place:

![An open to-do](../assets/todo-open.png)

- **Title:** edit it directly. Dates and `@project` typed into the title work as in [quick capture](quick-capture.md): "Call Sam fri" moves the to-do to Friday and takes "fri" out of the title.
- **Description:** the notes under the title. They're stored as indented lines under the checkbox.
- **Date:** type a date ("fri", "next week", "oct 20", "someday") or pick **Today**, **Tomorrow**, **Someday** or **Clear**.
- **Project:** move the to-do to another project or to the Inbox, or under a heading in a project note.

Press **Done** or `Esc`, or `Enter` in the title, to close it.

### Tags and links

`#tags` and `[[links]]` work in both the title and the description. Typing `[[` suggests notes, as in the Obsidian editor. Click a link to open the note.

## Completing a to-do

Click the checkbox, or select the to-do and press `Space`. A completed to-do stays in its list, crossed off, for a few seconds, then moves to [Completed](lists.md#completed). Plainlist writes `[x]` and a `[done:: YYYY-MM-DD]` date to the line.

To reopen one, find it in Completed (or in its project's "N completed" section) and click its checkbox again.

## Sub-tasks

A checkbox indented under another checkbox is its sub-task. It shows indented under its parent in every list.

- Press `Tab` to make the selected to-do a sub-task of the one above it, and `Shift+Tab` to move it out of its parent.
- Or right-click a to-do and choose **Add sub-task**.

Moving or deleting a parent takes its sub-tasks with it.

## The right-click menu

Right-click a to-do (or long-press it without moving, on mobile) for its menu:

![Right-click menu](../assets/context-menu.png)

It offers whichever of these fit the to-do and the list you're on: **Complete** (or **Mark as open**), **Add sub-task**, **Indent**, **Outdent** and **Delete**. Deleting shows a toast with **Undo** for a few seconds.

## Reordering

Drag a to-do to a new place. On touch screens, hold it, then drag. With the keyboard, select it and press `Alt+↑` / `Alt+↓`.

- **In Today,** put to-dos in any order. Plainlist remembers it in its own data, not in your notes.
- **Everywhere else,** the to-do's lines move in its note. So it moves among the to-dos of its own note, next to others with the same parent.

Drag projects in the sidebar to reorder them.

## Pasting a list

Paste a list into Plainlist and each line becomes a to-do in the list you're on. Each line can be any of:

```markdown
- [ ] Book the venue
- [] Send invites
- Order the cake
[ ] Pick a playlist
```

Indented lines become sub-tasks of the line above. `[date:: …]` fields in the pasted text are kept. If any line isn't a list item or a checkbox, Plainlist leaves the paste alone.

## Safe editing

Plainlist only changes the lines it owns. Headings, notes, tables and callouts it does not understand stay exactly as they are. Anything you type into a note by hand shows up in the view straight away.
