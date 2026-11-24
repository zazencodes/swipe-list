# Swipe List for macOS

A native Mac app for a Swipe List inspiration library, in the style of its phone-first dashboard. Browse and search everything the worker has pulled, filter by media and tag, watch videos and open screenshots, add a link with a note on what to pull, upload screenshots, and keep an eye on the queue.

Requires macOS 15 or later, the Xcode Command Line Tools, and a Swipe List server (see [the self-hosting guide](../docs/self-hosting.md)). The Mac app shares its library and processing queue with the iPhone dashboard and the `swipe` CLI.

## Build and install

```sh
./install.sh     # builds, replaces /Applications/Swipe List.app and launches it
./build.sh       # builds build/Swipe List.app only
SWIPE_LIST_SIGN_IDENTITY="Apple Development" ./install.sh   # sign with your developer identity, so the Keychain keeps trusting rebuilds
swift test       # unit tests
```

## Connecting

On first launch, either:

- press **Use Swipe CLI connection** to use the server and credential `swipe login` saved in `~/.config/swipe/config.json`, or
- paste the server URL and a credential (`swl_...`). Make one for this Mac on the server with `admin.mjs credentials create mac-app --allow-submit` ([step 7 of the guide](../docs/self-hosting.md#7-make-a-credential)); the token is shown once.

The app checks the credential with the server and keeps it in your login Keychain. **Sign Out** in the account menu at the bottom of the sidebar removes it.

## Using it

| Key | Does |
| --- | --- |
| ⌘N | Add a link |
| ⌘F | Search the library |
| ⌘1 ⌘2 ⌘3 | Library, Add, Queue |
| ⌘[ | Back |
| ⌘R | Refresh |
| ⌘↩ | Submit the add form |

`swipelist://add?url=<link>&note=<text>` opens the add form filled in, for share shortcuts. The theme (System, Light, Dark) is in the account menu.

Fonts: IBM Plex Sans and Mono, under the SIL Open Font License (`Resources/Fonts/OFL.txt`).
