# Projects

A project is an ordinary note. Every checkbox in it, nested ones included, is one of the project's to-dos. The task file keeps a list of links to your project notes under `# Projects`; see the [file format](file-format.md).

![A project](../assets/project.png)

Click **Open note ↗** under the title to open the note itself.

## Adding a project

Click **+ New project** at the bottom of the sidebar and type:

![Adding a project](../assets/new-project.png)

- a new name, then choose **Create “name”** to make a new note (in your **Default location for new notes**), or
- part of an existing note's name, then pick the note to add it as a project. Plainlist only adds a link to the task file. The note itself is not changed until you edit one of its to-dos.

New to-dos for a project go after the last to-do in its note, or above its first heading if it has headings.

## Headings

Headings in a project note group its to-dos. The project view shows each heading above the to-dos under it, and other lists show the to-do's place as **Project › Heading**. The note's title (a single `#` heading at the top) doesn't count.

In the project picker and the `@` list in [quick capture](quick-capture.md#picking-a-project), each project lists its headings. Pick one to add or move a to-do under it. You can also type `@Project/Heading`.

## Renaming, reordering and removing

Right-click a project in the sidebar to **Open note**, **Rename** or **Remove from Plainlist**.

- **Rename** renames the note, and Obsidian updates links to it as usual. You can also click the project's title in its view to rename it.
- **Remove from Plainlist** removes the link from the task file only. The note and its checkboxes stay as they are.
- Drag projects in the sidebar to change their order.

## Completing a project

To finish a project, tick the checkbox next to its title, or right-click it and choose **Complete project**. Any open to-dos in its note are marked done too, after you confirm, and you can undo for a few seconds.

Completed projects move under a quiet "N completed" toggle at the bottom of the sidebar and appear in the [Completed](lists.md#completed) list. Right-click one and choose **Reopen project** to bring it back.
