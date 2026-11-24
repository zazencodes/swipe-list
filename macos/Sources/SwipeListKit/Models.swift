import Foundation

/// Where an item is in the queue: `queued → processing → done | failed`.
public enum ItemStatus: String, Codable, CaseIterable, Sendable {
    case queued, processing, done, failed

    public var isBusy: Bool { self == .queued || self == .processing }
}

/// What a stored file is: an upload, or media the worker pulled.
public enum AssetRole: String, Codable, CaseIterable, Sendable {
    case upload, image, video, thumbnail, screenshot
}

public enum ItemKind: String, Codable, Sendable {
    case link, upload
}

public struct Asset: Codable, Identifiable, Hashable, Sendable {
    public let id: Int
    public let role: AssetRole
    public let contentType: String
    public let sizeBytes: Int
    public let sourceUrl: String?
    public let caption: String
    public let position: Int
    /// Presigned by the server; valid for one hour.
    public let url: URL

    public var isVideo: Bool { contentType.hasPrefix("video/") }
}

/// The fields every item has, in a list and in detail.
public struct ItemSummary: Codable, Identifiable, Hashable, Sendable {
    public let id: Int
    public let kind: ItemKind
    public let url: String?
    public let site: String
    public let note: String
    public let status: ItemStatus
    public let title: String
    public let description: String
    public let tags: [String]
    public let author: String
    public let attempts: Int
    public let lastError: String?
    public let createdAt: Date
    /// Number of files per role.
    public let media: [String: Int]
    /// The asset a library card shows.
    public let preview: Asset?

    public var hasVideo: Bool { (media[AssetRole.video.rawValue] ?? 0) > 0 }
}

public struct ItemDetail: Codable, Identifiable, Hashable, Sendable {
    public let id: Int
    public let kind: ItemKind
    public let url: String?
    public let site: String
    public let note: String
    public let status: ItemStatus
    public let title: String
    public let description: String
    public let tags: [String]
    public let author: String
    public let extractedText: String
    public let attempts: Int
    public let lastError: String?
    public let createdAt: Date
    public let assets: [Asset]

    /// Assets in the order to show them. A thumbnail is the poster of the video it belongs to,
    /// so it shows as its own image only when the item has no video.
    public var shownAssets: [Asset] {
        let hasVideo = assets.contains { $0.role == .video }
        return assets.filter { $0.role != .thumbnail || !hasVideo }
    }

    /// The poster for a video: the thumbnail at the same index among thumbnails as the video among videos.
    public func poster(for video: Asset) -> Asset? {
        let videos = assets.filter { $0.role == .video }
        let thumbnails = assets.filter { $0.role == .thumbnail }
        guard let index = videos.firstIndex(of: video), index < thumbnails.count else { return nil }
        return thumbnails[index]
    }
}

public struct ItemPage: Codable, Sendable {
    public let items: [ItemSummary]
    public let total: Int
}

public struct TagCount: Codable, Hashable, Sendable {
    public let tag: String
    public let count: Int
}

/// Who the server says is calling: a credential (agents, this app) or the owner (the web dashboard).
public struct Actor: Codable, Sendable {
    public let kind: String
    public let name: String?
    public let email: String?

    public var label: String { name ?? email ?? kind }
}

/// A newly created item; the server answers creates with the item row.
public struct CreatedItem: Codable, Sendable {
    public let id: Int
}

/// The title a list or a heading shows for an item.
public func displayTitle(title: String, url: String?, fallback: String) -> String {
    if !title.isEmpty { return title }
    if let url, !url.isEmpty { return url }
    return fallback
}
