// swift-tools-version:6.0
import PackageDescription

let v5: [SwiftSetting] = [.swiftLanguageMode(.v5)]

let package = Package(
    name: "SwipeList",
    platforms: [.macOS(.v15)],
    targets: [
        .target(name: "SwipeListKit", swiftSettings: v5),
        .executableTarget(name: "SwipeList", dependencies: ["SwipeListKit"], swiftSettings: v5),
        .executableTarget(name: "swipe-list-icon", swiftSettings: v5),
        .testTarget(name: "SwipeListKitTests", dependencies: ["SwipeListKit"], swiftSettings: v5),
    ]
)
