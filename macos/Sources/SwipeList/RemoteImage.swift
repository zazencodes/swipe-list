import AppKit
import SwiftUI
import SwipeListKit

/// Downloads asset images from their presigned bucket URLs and keeps them in memory by asset id, since every
/// API answer signs the same file with a new URL. These requests carry no credential.
@MainActor final class ImageCache {
    private let cache = NSCache<NSNumber, NSImage>()
    private let session = URLSession(configuration: .ephemeral)

    func cached(_ asset: Asset) -> NSImage? {
        cache.object(forKey: NSNumber(value: asset.id))
    }

    func image(for asset: Asset) async throws -> NSImage {
        if let image = cached(asset) { return image }
        let (data, response) = try await session.data(from: asset.url)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw URLError(.badServerResponse)
        }
        guard let image = NSImage(data: data) else { throw URLError(.cannotDecodeContentData) }
        cache.setObject(image, forKey: NSNumber(value: asset.id), cost: data.count)
        return image
    }
}

/// An asset image that fills its width. Its height follows the image, capped at `maxHeight` (cropped from the top),
/// with a 4:3 placeholder while it loads.
struct AssetImage: View {
    @Environment(AppModel.self) private var model
    let asset: Asset
    var maxHeight: CGFloat = .infinity
    @State private var image: NSImage?
    @State private var failed = false

    var body: some View {
        let shown = image ?? model.imageCache.cached(asset)
        CappedAspect(aspect: shown.map { $0.size.width / max($0.size.height, 1) } ?? 4.0 / 3.0, maxHeight: maxHeight) {
            if let shown {
                GeometryReader { geometry in
                    Image(nsImage: shown)
                        .resizable()
                        .interpolation(.high)
                        .scaledToFill()
                        .frame(width: geometry.size.width, height: geometry.size.height, alignment: .top)
                        .clipped()
                }
            } else {
                ZStack {
                    Palette.muted
                    Image(systemName: failed ? "exclamationmark.triangle" : "photo")
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
        }
        .task(id: asset.id) {
            guard shown == nil else { return }
            do {
                let cache = model.imageCache
                let loaded = try await cache.image(for: asset)
                guard !Task.isCancelled, cache === model.imageCache else { return }
                image = loaded
            } catch {
                failed = true
            }
        }
    }
}

/// Takes the proposed width and a height of `width / aspect`, at most `maxHeight`.
private struct CappedAspect: Layout {
    let aspect: CGFloat
    let maxHeight: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 240
        return CGSize(width: width, height: min(width / max(aspect, 0.01), maxHeight))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for subview in subviews {
            subview.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
        }
    }
}
