# X posts through a script, everything else through the owner's Chrome

## Decision

Two ways to pull media, nothing else:

- **X posts:** `src/worker/tools/x-post.mjs` reads the post from the fxtwitter API
  and downloads its original photos and best MP4s. No login, no browser.
- **Everything else:** Codex drives the owner's real, logged-in Chrome through its
  Chrome plugin: screenshots of what the note is about, and image or video files
  found in the page, downloaded directly. Chrome is also the fallback for X.

## Why

Much of what people save is on X, and the fxtwitter API gives exact media URLs in
one request, so a small script is the most reliable path there. For other sites,
the owner's own Chrome is already logged in and renders pages the way they saw them.

## Rejected

- **yt-dlp.** A general video downloader isn't wanted in the loop; YouTube
  downloads aren't a use case, and X video is simpler through the script.
- **Headless Playwright for screenshots.** No logins, and a second browser to keep
  working; the real Chrome replaces it.
