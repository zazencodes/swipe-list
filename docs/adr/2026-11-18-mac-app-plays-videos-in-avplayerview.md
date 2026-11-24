# The Mac app plays videos in AppKit's AVPlayerView

## Decision

An item's video shows its poster with a play button, and plays inline in AppKit's `AVPlayerView`, wrapped for SwiftUI.

## Why

SwiftUI's `VideoPlayer` aborted the app (SIGABRT inside `_AVKit_SwiftUI`) as soon as its view was created. `AVPlayerView` plays the same presigned URL with native controls and full screen.

## Rejected

- **SwiftUI's `VideoPlayer`.** It crashed this app. Don't switch back without first proving it plays in the built app.
- **Opening videos in the browser.** Watching the media is the point of the item page.
