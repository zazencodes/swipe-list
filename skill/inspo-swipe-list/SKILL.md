---
name: inspo-swipe-list
description: The user's inspo swipe list of saved design inspiration (the Swipe List app, `swipe` CLI). Use when the user asks to use, search, add to or remove from their swipe list or inspo, or when design work could draw on what they have saved.
---

# Inspo Swipe List

The swipe list is the Swipe List app: things the user found online that inspire
them, mostly visual design, motion and video style, and how tools, apps and sites
look and feel. Each item has the source link, the user's note on what they like,
a title, a description, tags, and stored media: images, videos, video thumbnails,
page screenshots, and images the user uploaded.

You work with it through the `swipe` CLI. Every command prints JSON. The user
browses, filters and deletes in their dashboard, at the `dashboard_url` that
`swipe whoami` prints (it is on their private network).

## If the list is not available

Run `swipe whoami` first. If `swipe` is not installed, or it is not logged in or
cannot reach the server:

- If the user explicitly asked you to use, add to or remove from the swipe list,
  stop. Tell them you can't reach it and do not finish the task without it.
  Installing needs their server's API URL and a credential from them:
  `curl -fsSL <api url>/install.sh | sh -s -- <skills dir>`, then
  `swipe login --url <api url>`.
- If you loaded this skill on your own because the work could use inspiration,
  give them a one-line warning and carry on without it.

## Using the list for inspiration

1. Search for what the task needs. `swipe search "<words>"` matches titles, the
   user's notes, descriptions, tags, authors and the source's text, best match
   first. Run a few searches with different words for the look, the technique and
   the medium (`"glass logo"`, `"chromatic"`, `"product launch"`). Narrow with
   `--tag <tag>` (see `swipe tags` for every tag in use) or
   `--media video|image|screenshot|upload`. `swipe search` with no words lists
   everything, newest first; page with `--limit` and `--offset`.
   Only `done` items have media; pass `--status done` when you need it.
2. Pick the entries relevant to the task. `swipe show <id>` gives the full item
   with every file's URL (valid for one hour) and the source's text. When the
   description is not enough to work from, look at the media:
   `swipe download <id> --dir <dir>` saves the files, then open the images (and a
   video's thumbnail) to see them.
3. If the user named a specific entry, use it. Otherwise, unless one entry is
   obviously right, ask them which to use with your question-asking tool
   (e.g. `AskUserQuestion`), not in prose. Offer your best single suggestion
   first, marked recommended, then an alternative or a group of entries to
   combine. Keep the options to the entries you found relevant. They can always
   answer with something else.
4. Say which entries you drew on (title and id) and what you took from each.

## Adding to the list

Adding an item queues work for the owner’s browser. It requires a credential the owner created with `--allow-submit`.

When the user says "add this to my swipe list" (a link, plus what they like about
it, often what to pull from it):

```sh
swipe add "<url>" --note "<what to pull and what they like, in their words>"
swipe upload <image files...> --note "<what they like>"   # screenshots and images: JPEG, PNG, WebP, GIF
```

- The note is the most important part: the worker that fetches the item follows it
  ("the second video", "just the hero section"), and search uses it. Keep the
  user's own words. Ask for the reason only if they gave none and the link doesn't
  make it obvious.
- A link that is already saved is refused with the existing item's id
  (`response.error.details.item_id`); tell the user and show that item instead.
- Items are processed later by a worker on the user's Mac (every 5 minutes while
  it is awake). The command returns right away with `"status": "queued"`; don't
  wait for it. `swipe show <id>` shows progress: `queued`, `processing`, `done`,
  or `failed` with the reason in `last_error`.
- `swipe retry <id>` queues a failed item again, or pulls a done item again, for
  example after the user adds to what they want from it.

## Removing from the list

`swipe delete <id>` deletes an item and all its files for good. Only do it when
the user asks for that item to be removed, and confirm which item first when you
found it by search.
