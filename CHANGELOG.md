# Changelog

All notable changes to Plainlist, newest first. Each release is on [GitHub](https://github.com/MrVersano/Plainlist/releases).

## 1.0.28

*October 8, 2026*

### Improvements

- On desktop, Plainlist tabs no longer show Obsidian's view header, so the sidebar reaches the top of the tab. The header's options are in the tab's right-click menu, along with **Open as Markdown**. Mobile keeps the header, because it is the navigation bar there.

## 1.0.27

*October 7, 2026*

### Improvements

- Areas now work on mobile and in narrow panes. The list picker at the top of the view shows each area with its projects under it, and has a **New area** item next to **New project**.
- Tapping an area's name in the list picker offers **Rename** and **Remove area**, the same options as right-clicking it in the sidebar.

## 1.0.26

*October 7, 2026*

### New

- Swiping a to-do left opens a sheet of dates: Today, Tomorrow, This weekend, Next week, Someday, **Other date…** and **Remove date**. It works in the Plainlist view and in lists in notes, and shows a toast with Undo.
- Lists in notes have **Schedule…** in their right-click menu.

### Improvements

- Swiping right on a completed to-do shows an arrow back instead of a check, because the swipe reopens it.

## 1.0.25

*October 7, 2026*

### New

- **Areas:** group projects under headings such as Work and Home. Add one with **+ New area** in the sidebar, then drag projects onto it or use **Move to area…**. Click an area's name to fold it.
- **Undo:** `Mod+Z` in the Plainlist view undoes your last change, up to 30 steps back. It covers completing, deleting, scheduling, moving and reordering to-dos, edits to an open to-do, pasting, completing projects and changes to areas. A **Plainlist: Undo** command lets you set your own hotkey.
- **Swipe:** on touch screens, swipe a to-do right to complete it, or left to schedule it.
- Each project in the sidebar shows a small ring that fills as its to-dos get done.

### Improvements

- Moving to-dos now shows a toast with Undo.
- Undo only restores a note while it still reads exactly as Plainlist left it, so it never overwrites changes made later.
- The sidebar starts a little wider on desktop.

## 1.0.24

*October 7, 2026*

### Improvements

- **Search to-dos** shows `[[links]]` in titles by their name or alias, without brackets, the same as the list does. Search matches this visible text.

## 1.0.23

*October 7, 2026*

### New

- **Project tags:** notes with a tag you list in the new setting become projects. Notes that already have the tag are added when you close settings, and other notes are added as soon as they get it. Nested tags count, case doesn't matter, and the setting suggests tags from your vault.

### Improvements

- Removing a tag from the setting never removes projects on its own. Plainlist asks whether to remove the open projects that only had that tag, and **Keep** is the default answer.

## 1.0.22

*October 7, 2026*

### New

- **Group Today by project:** a new setting, off by default, shows Today's to-dos under a heading for each project. Inbox to-dos come first, and projects follow in sidebar order. Lists in notes are grouped the same way.

## 1.0.21

*October 7, 2026*

### New

- A recognised date, repeat rule or `@project` can be kept as plain words. Press Backspace right after the highlighted phrase and the highlight goes away, but no text is deleted.

### No longer broken

- When editing a title, text on both sides of an ignored phrase is no longer read as one date. For example, "on Jul 23 fri" was read as "on fri".

## 1.0.20

*October 7, 2026*

### New

- **Select several to-dos:** use `Mod`-click, `Shift`-click, `Shift+↑/↓` or `Mod+A`. On mobile, long-press a to-do, choose **Select**, then tap others. A bar at the bottom of the list offers **Complete**, **Schedule**, **Move** and **Delete**.
- New commands **Move selected to-dos to a project** and **Schedule selected to-dos**, which you can bind to hotkeys.
- The right-click menu has **Schedule**, **Move to** and **Select**.

### No longer broken

- A project picker opened from the keyboard no longer selects a heading because the mouse pointer happens to rest over it.

## 1.0.19

*October 7, 2026*

### Improvements

- Someday to-dos that aren't in a project no longer appear in the Inbox or count toward its total. They appear only in the Someday list.

## 1.0.18

*October 7, 2026*

### New

- **Repeating to-dos:** "every 3 days", "every weekday", "every mon, thu", "every other week", "every month on the 15th", "every 2nd monday", "every last sunday" or "every year". Set a rule in the editor's new **Repeat** field, or type it in the title or in quick capture.
- When you complete a repeating to-do, a new copy with the next date is added above it. The completed to-do stays in the note as a record.
- Add "when done" to a rule to count the next date from the day you complete the to-do, for example "Check engine oil every month when done".

### Improvements

- When you complete a project, its repeating to-dos don't come back, and Undo restores their rules.

## 1.0.17

*October 7, 2026*

### New

- **Add from other apps:** `obsidian://plainlist-add?title=…` links add a to-do to the Inbox from Shortcuts, Drafts, Alfred or Raycast. Add `palette=true` to open the New to-do palette with the title filled in. The links support x-callback-url, with `x-success`, `x-error` and `x-cancel`.

## 1.0.16

*October 6, 2026*

### Improvements

- In lists in notes, open to-dos come first and completed ones follow, crossed off. A to-do you complete in the list stays in place for a few seconds before it moves down.

## 1.0.15

*October 6, 2026*

### New

- **Lists in notes:** a `plainlist` code block shows an interactive list inside any note. `Today` shows Today's to-dos, including ones completed today. In a daily note, `Note Title` shows the day the note is named after.
- You can complete, edit, drag and right-click rows in these lists. Click a row to give the list the keyboard, and press `Esc` to return to the note.

### Improvements

- When Today's order changes, every open list updates at once, including the view.

## 1.0.14

*October 6, 2026*

### New

- **Reorder to-dos:** drag them, or press `Alt+↑` / `Alt+↓`. On touch screens, hold a to-do, then drag it. In Today, any to-do can go anywhere. In other lists, moving a to-do reorders its lines in its note.
- Drag projects in the sidebar to reorder them.
- Drag the sidebar's edge to resize it, or drag it all the way left to hide it. Each device remembers its own sidebar width.

## 1.0.13

*October 6, 2026*

### New

- **Sub-tasks:** a checkbox indented under another one is a sub-task, and lists show it under its parent. Press `Tab` / `Shift+Tab` to indent or outdent a to-do. You can also right-click a to-do (or long-press it on mobile) to add a sub-task, indent it or outdent it.

### Improvements

- Pasted lists keep their nesting.
- Deleting a to-do also deletes its sub-tasks, and Undo restores them all.

## 1.0.12

*October 6, 2026*

### Improvements

- Press Delete or Backspace by itself to delete the selected to-do. The **Deleted · Undo** toast still appears.

## 1.0.11

*October 6, 2026*

### New

- **Paste a list:** with the view focused, paste lines such as `- [ ] Task`, `- Task` or `[ ] Task`, and each line becomes a to-do in the current list. Text that isn't a list is ignored.

### Improvements

- The New to-do palette also accepts pasted lists. Several items become separate to-dos, and a single item is pasted into the field without its `- [ ]`.

## 1.0.10

*October 6, 2026*

### New

- New commands **Go to Inbox**, **Go to Today**, **Go to Upcoming**, **Go to No Date** and **Go to Someday** open a list directly, from anywhere in Obsidian, and focus it so the keyboard works right away.

## 1.0.9

*October 6, 2026*

### Improvements

- Long to-do titles wrap onto more lines in every list instead of being cut off. Very long words and links break instead of running past the edge.
- While you edit a to-do, its title wraps and the field grows as you type. Line breaks pasted into a title become spaces.

## 1.0.8

*October 6, 2026*

### Improvements

- A completed to-do stays in its list, crossed off, for 3 seconds before it fades away, so you can reopen it if you checked it by mistake.
- Today no longer shows to-dos completed today.

## 1.0.7

*October 6, 2026*

### New

- **Search to-dos:** a quick-switcher-style command that fuzzy-finds a to-do by its title, project or heading and jumps to it.
- New **Search completed to-dos** setting.

## 1.0.6

*October 6, 2026*

### New

- Headings in project notes group the project's to-dos. Other lists show a to-do's place as "Project › Heading".
- The project picker and the `@` list show headings, so you can add or move a to-do under one, or type `@Project/Heading`.

## 1.0.5

*October 5, 2026*

### New

- Overdue open to-dos move to today when the view opens and again at midnight.

## 1.0.4

*October 5, 2026*

### New

- `[[links]]` work in to-do titles, and typing `[[` suggests notes.

### Improvements

- Editing a to-do's title recognises date phrases and `@project` the same way quick capture does.

### No longer broken

- An expanded to-do no longer saves another to-do's title when you open a second row.

## 1.0.2

*October 5, 2026*

### New

- **System-wide quick entry** (desktop): an opt-in global shortcut, `Cmd+Option+N` / `Ctrl+Alt+N` by default, opens the New to-do palette in a small floating window above any app.

## 1.0.1

*October 5, 2026*

### New

- **`@project` mentions** in the capture palette, with an inline suggestion list.

### No longer broken

- Project lists in the capture palette extend past its edge instead of scrolling inside it.
- When a list is open in the capture palette, Escape closes the list first and leaves the palette open.
- Text typed in the palette no longer disappears when you hover over the input.

## 1.0.0

*October 4, 2026*

First public release.

- A Things-style view over a plain Markdown task file, with Inbox, Today, Upcoming, No Date, Someday, Completed and per-project lists.
- Projects are their own notes. Every checkbox in a project note is one of its to-dos.
- A to-do editor that opens in place, with date and project pickers, descriptions, and delete with Undo.
- A quick capture palette that recognises dates as you type, such as "tomorrow", "next tue" or "someday".
- Projects can be completed, and their completed to-dos stay out of the open lists.
- Full keyboard navigation, a narrow and mobile layout, and styles that follow your theme.
- Plainlist only edits the lines it owns in your notes.
