# Adding from other apps

Opening an `obsidian://plainlist-add` link adds a to-do to the Inbox. Shortcuts, Drafts, Alfred, Raycast and similar apps can use it to capture into Plainlist, on desktop and on mobile.

```
obsidian://plainlist-add?title=Buy%20milk
```

## Parameters

| Parameter | |
| --- | --- |
| `title` | The to-do, URL-encoded. It is added exactly as written; date phrases are not read. |
| `palette=true` | Opens the [New to-do palette](quick-capture.md) with `title` filled in, for you to check and save. There, dates and `@project` work as usual. |
| `vault` | The vault to add to, if you have more than one (Obsidian's own parameter). |
| `x-success` | A URL to open once the to-do is added. |
| `x-error` | A URL to open if it could not be added, with `errorMessage` appended. |
| `x-cancel` | With `palette=true`, a URL to open if you close the palette without saving. |

The to-do goes into the task file set under [Settings](settings.md).

## Examples

Add a to-do straight to the Inbox:

```
obsidian://plainlist-add?title=Call%20the%20dentist
```

Open the palette so that "fri" and `@Garden for spring` are read as a date and a project:

```
obsidian://plainlist-add?palette=true&title=Order%20tulip%20bulbs%20fri%20%40Garden%20for%20spring
```

Go back to the app you came from once the to-do is saved (x-callback-url):

```
obsidian://plainlist-add?title=Buy%20milk&x-success=shortcuts%3A%2F%2F
```

## Apple Shortcuts

1. Add an **Ask for Input** action (or use the text passed to the shortcut).
2. Add a **URL Encode** action on that text.
3. Add an **Open URLs** action with `obsidian://plainlist-add?title=` followed by the encoded text.

Add the shortcut to the Share Sheet or the Home Screen to capture from anywhere on iOS.

For a global shortcut on desktop without any other app, use [System-wide quick entry](quick-capture.md#system-wide-quick-entry) instead.
