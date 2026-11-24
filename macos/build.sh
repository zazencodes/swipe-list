#!/usr/bin/env bash
# Builds build/Swipe List.app.
#
# Signs ad hoc. If you have an Apple Development identity, set SWIPE_LIST_SIGN_IDENTITY="Apple Development" so the
# Keychain keeps trusting the app across rebuilds and doesn't ask for the credential again.
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
app="$root/build/Swipe List.app"
identity="${SWIPE_LIST_SIGN_IDENTITY:--}"
# The app shares the repository's version, from package.json.
version="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$root/../package.json")"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "package.json must have a version X.Y.Z" >&2
    exit 1
fi

cd "$root"
swift build -c release --product SwipeList
swift build -c release --product swipe-list-icon
bin="$(swift build -c release --show-bin-path)"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin/SwipeList" "$app/Contents/MacOS/SwipeList"
cp -R "$root/Resources/Fonts" "$app/Contents/Resources/Fonts"

iconset="$(mktemp -d)/SwipeList.iconset"
"$bin/swipe-list-icon" "$iconset"
iconutil -c icns "$iconset" -o "$app/Contents/Resources/SwipeList.icns"
rm -rf "$(dirname "$iconset")"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Swipe List</string>
  <key>CFBundleDisplayName</key><string>Swipe List</string>
  <key>CFBundleIdentifier</key><string>com.zazencodes.swipelist</string>
  <key>CFBundleExecutable</key><string>SwipeList</string>
  <key>CFBundleIconFile</key><string>SwipeList</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>com.zazencodes.swipelist</string>
      <key>CFBundleURLSchemes</key><array><string>swipelist</string></array>
    </dict>
  </array>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>ZazenCodes</string>
</dict>
</plist>
PLIST

codesign --force --timestamp=none --sign "$identity" "$app"
echo "Built $app"
