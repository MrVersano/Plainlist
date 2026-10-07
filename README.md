# Plainlist

Plainlist turns your notes into a clean, minimal task manager in Obsidian. A task file holds your Inbox and a list of projects, and each project is an ordinary note: any checkbox in it is a to-do. Everything you do in the view is written back as plain Markdown, and anything you type into the notes by hand shows up in the view straight away.

![Today](assets/today.png)

## Features

- **[Lists](docs/lists.md):** Inbox, Today, Upcoming, No Date, Someday and Completed, plus one list per project. Open to-dos from past days move to today.
- **[Projects are notes](docs/projects.md):** create a new project note, or turn an existing note into a project. Its checkboxes, nested ones included, become the project's to-dos, grouped by the note's headings.
- **[To-dos](docs/todos.md):** a title, a description, a date and a project, with `#tags` and `[[links]]`. Click a to-do to edit it in place.
  - **[Sub-tasks](docs/todos.md#sub-tasks):** indent a checkbox under another, or press `Tab` / `Shift+Tab`.
  - **[Reorder](docs/todos.md#reordering):** drag to-dos, or press `Alt+↑` / `Alt+↓`. Today keeps any order you like.
  - **[Paste a list](docs/todos.md#pasting-a-list):** paste `- [ ] Task` lines and each one becomes a to-do.
- **[Quick capture](docs/quick-capture.md):** a small palette that understands dates as you type ("fri", "next tue", "in 3 days", "someday") and `@project`.
- **[System-wide quick entry](docs/quick-capture.md#system-wide-quick-entry):** on desktop, a global shortcut opens the palette from any app.
- **[Add from other apps](docs/adding-from-other-apps.md):** `obsidian://plainlist-add` links, with x-callback-url, for Shortcuts, Drafts, Alfred and Raycast.
- **[Search and navigation](docs/search-and-navigation.md):** fuzzy-find any to-do, and jump to any list with a command or hotkey.
- **[Lists in notes](docs/lists-in-notes.md):** a `plainlist` code block shows Today's list inside any note, or a daily note's own day.
- **[Keyboard shortcuts](docs/keyboard.md):** move, open, complete, indent and reorder to-dos without the mouse.
- **[Plain Markdown](docs/file-format.md):** to-dos are ordinary checkboxes with `[date:: …]` fields. Plainlist only changes the lines it owns.

| Upcoming | Project |
|---|---|
| ![Upcoming](assets/upcoming.png) | ![Project](assets/project.png) |

Quick capture recognises dates as you type and takes them out of the title:

![Quick capture](assets/capture.png)

## Installing

In Obsidian, open **Settings → Community plugins → Browse**, search for **Plainlist**, then install and enable it. Plainlist needs Obsidian 1.13 or later, and works on desktop and mobile.

Run **Plainlist: Open** from the command palette (or click the ribbon icon) to get started. See [Getting started](docs/getting-started.md) for installing by hand and the hotkeys worth setting.

## Documentation

- [Getting started](docs/getting-started.md)
- [Lists](docs/lists.md)
- [To-dos](docs/todos.md)
- [Projects](docs/projects.md)
- [Quick capture](docs/quick-capture.md)
- [Adding from other apps](docs/adding-from-other-apps.md)
- [Search and navigation](docs/search-and-navigation.md)
- [Lists in notes](docs/lists-in-notes.md)
- [Keyboard shortcuts](docs/keyboard.md)
- [File format](docs/file-format.md)
- [Settings](docs/settings.md)
- [Development and releasing](docs/development.md)
