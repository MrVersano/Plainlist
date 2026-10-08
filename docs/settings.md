# Settings

Open **Settings → Community plugins → Plainlist**.

| Setting | What it does | Default |
|---|---|---|
| **Tasks file** | The note Plainlist reads and writes. **Plainlist: Open**, [quick capture](quick-capture.md), [`plainlist-add` links](adding-from-other-apps.md) and [lists in notes](lists-in-notes.md) use it. The **Open** command creates it if it is missing. | `Tasks.md` |
| **Open this file in Plainlist view by default** | Notes with `plainlist: true` in their properties open as a task list instead of as Markdown. | On |
| **Week starts on** | Used for "next week" and the [Upcoming](lists.md#upcoming) list: your locale's default, Sunday or Monday. | Locale default |
| **Project tags** | Notes with any of these tags (separated by commas) are added as [projects](projects.md#adding-projects-by-tag) automatically. When you add a tag here, notes that already have it are added when you close settings. Removing a tag doesn't remove projects; Plainlist asks first. | Empty (off) |
| **Group Today by project** | Show [Today](lists.md#today)'s to-dos under a heading for each project, with Inbox to-dos first. [Lists in notes](lists-in-notes.md) are grouped too. | Off |
| **Search completed to-dos** | Include completed to-dos in [Search to-dos](search-and-navigation.md#searching-to-dos) results. | Off |
| **System-wide quick entry** | Desktop only. Add a to-do from any app with a global shortcut while Obsidian is running. See [System-wide quick entry](quick-capture.md#system-wide-quick-entry). | Off |
| **Global shortcut** | Shown when system-wide quick entry is on. Click to record a new shortcut; it needs at least one of `Ctrl`, `Alt` or `⌘`. The reset button restores the default. | `Cmd+Option+N` / `Ctrl+Alt+N` |

## Board

For projects shown as a [board](board.md).

| Setting | What it does | Default |
|---|---|---|
| **Auto-create columns from tasks** | A `[col:: …]` field in a project note that names no column adds that column to the project's board, before Done. When off, those to-dos show in the first column, marked "unknown column". | On |
| **Show completed tasks in their column for** | How many days completed to-dos stay in their column. Older ones are behind **Show N older**. | 7 |
| **Move to the next or previous column** | **Open hotkeys** shows the two commands, to give them keys. In a board, `⌘←` and `⌘→` work anyway. | |
| **Default columns** | The columns a project's board starts with. Rename them, drag to reorder, add or delete them; the button on each sets its auto-check options. | To do, Doing, Done |

Hotkeys for Plainlist's commands are set under **Settings → Hotkeys**, not here; see [Getting started](getting-started.md#hotkeys-worth-setting).
