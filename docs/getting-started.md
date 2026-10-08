# Getting started

## Installing

In Obsidian, open **Settings → Community plugins → Browse**, search for **Plainlist**, then install and enable it.

To install by hand, download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/MrVersano/Plainlist/releases/latest) into `<your vault>/.obsidian/plugins/plainlist/`, then enable Plainlist under **Settings → Community plugins**.

Plainlist needs Obsidian 1.13 or later, and works on desktop and mobile.

## Opening Plainlist

Run **Plainlist: Open** from the command palette (or click the ribbon icon). It opens your task file, `Tasks.md` by default, and creates it if needed. You can pick another file under [Settings](settings.md).

![The Today list](../assets/today.png)

The sidebar on the left holds the [lists](lists.md) (Inbox, Today, Upcoming, No Date, Someday and Completed) and your [projects](projects.md). The main area shows the list you picked. On a phone, or in a narrow pane, the sidebar becomes a menu: tap the list's name at the top to switch lists, add a project or add an area.

Any note with `plainlist: true` in its properties opens in the Plainlist view. To see the raw Markdown, right-click the tab and choose **Open as Markdown**, or run **Plainlist: Switch between task list and Markdown**. Run the command again to go back. On desktop, Plainlist hides Obsidian's view header so the sidebar reaches the top of the tab; the tab's right-click menu still has the header's options.

## Adding your first to-do

- Press `N` in the view, or click **Press N to add a to-do** below the list.
- Or run **Plainlist: New to-do** from anywhere in Obsidian to open [quick capture](quick-capture.md).

A to-do added while you're on a list fits that list: one added in Today is dated today, one added in Someday is marked someday, and one added in a project goes into that project's note. Anywhere else, it goes to the Inbox with no date.

## Hotkeys worth setting

Plainlist does not set hotkeys for you. Under **Settings → Hotkeys**, search for "Plainlist" and bind:

| Command | Suggested hotkey | What it does |
|---|---|---|
| **New to-do** | `Mod+Shift+N` | Opens [quick capture](quick-capture.md) from anywhere in Obsidian |
| **Search to-dos** | your choice | Finds any to-do by name; see [Search and navigation](search-and-navigation.md) |
| **Move selected to-dos to a project**, **Schedule selected to-dos** | your choice | Moves or schedules the [selected to-dos](todos.md#working-on-several-to-dos-at-once) |
| **Undo** | your choice | [Undoes](todos.md#undo) the last change; `Mod+Z` already does this in the view |
| **Go to Inbox**, **Go to Today**, **Go to Upcoming**, **Go to No Date**, **Go to Someday** | your choice | Opens Plainlist on that list |

On desktop you can also capture from other apps with a global shortcut; see [System-wide quick entry](quick-capture.md#system-wide-quick-entry).

## Next steps

- [Lists](lists.md): what goes where.
- [To-dos](todos.md): editing, sub-tasks, reordering and pasting.
- [Projects](projects.md): turning notes into projects.
- [File format](file-format.md): what Plainlist writes to your notes.
