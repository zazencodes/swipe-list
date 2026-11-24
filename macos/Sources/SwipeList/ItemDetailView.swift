import AVKit
import SwiftUI
import SwipeListKit

/// One item: its media, the owner's note, the worker's description and tags, and retry and delete.
/// Refreshes every 10 seconds while the worker has it.
struct ItemDetailView: View {
    @Environment(AppModel.self) private var model
    let itemID: Int
    @State private var item: ItemDetail?
    @State private var error: String?
    @State private var actionError: String?
    @State private var working = false
    @State private var confirmingDelete = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let item {
                    loaded(item)
                } else if let error {
                    ErrorBox(title: "Could not load this item", message: error)
                } else {
                    RoundedRectangle(cornerRadius: 4).fill(Palette.muted).frame(width: 360, height: 28)
                    RoundedRectangle(cornerRadius: Radius.lg).fill(Palette.muted).aspectRatio(16.0 / 9.0, contentMode: .fit)
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
            .frame(maxWidth: 820)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.background)
        .navigationTitle(item.map { displayTitle(title: $0.title, url: $0.url, fallback: "Item \($0.id)") } ?? "")
        .task(id: "\(itemID)-\(model.changes)") { await poll() }
        .confirmationDialog("Delete this item?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { delete() }
        } message: {
            if let item {
                Text("\(displayTitle(title: item.title, url: item.url, fallback: "This item")) and its \(item.assets.count) \(item.assets.count == 1 ? "file" : "files") are deleted for good.")
            }
        }
    }

    private func poll() async {
        guard let api = model.api else { return }
        repeat {
            do {
                item = try await api.item(itemID)
                error = nil
            } catch is CancellationError {
                return
            } catch {
                self.error = error.localizedDescription
            }
            guard item?.status.isBusy == true else { return }
            try? await Task.sleep(for: .seconds(10))
        } while !Task.isCancelled
    }

    @ViewBuilder private func loaded(_ item: ItemDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if item.status != .done { StatusBadge(status: item.status.rawValue) }
                Text(meta(item).uppercased())
                    .font(.plexMono(11))
                    .tracking(0.9)
                    .foregroundStyle(Palette.mutedForeground)
                    .textSelection(.enabled)
            }
            Text(item.title.isEmpty ? (item.url ?? "Waiting for the worker") : item.title)
                .font(.plex(22, .semibold))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }

        if item.status == .failed {
            ErrorBox(title: "The worker could not pull this", message: item.lastError ?? "No reason was recorded.")
        }
        if item.status.isBusy {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(item.status == .queued ? "Queued. The worker on your Mac checks every 5 minutes." : "The worker is pulling this now.")
            }
            .foregroundStyle(Palette.mutedForeground)
        }

        if !item.assets.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(item.shownAssets) { asset in
                    VStack(alignment: .leading, spacing: 6) {
                        if asset.isVideo {
                            VideoAsset(video: asset, poster: item.poster(for: asset))
                        } else {
                            Button { NSWorkspace.shared.open(asset.url) } label: {
                                AssetImage(asset: asset)
                                    .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
                                    .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border))
                            }
                            .buttonStyle(.plain)
                            .help("Open the full image in your browser")
                            .accessibilityLabel(asset.caption.isEmpty ? "Image" : "Image: \(asset.caption)")
                            .accessibilityHint("Opens the full image in your browser")
                        }
                        if !asset.caption.isEmpty {
                            Text(asset.caption).font(.plex(12)).foregroundStyle(Palette.mutedForeground).textSelection(.enabled)
                        }
                    }
                }
            }
        }

        if !item.note.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Eyebrow("Your note")
                Text(item.note).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
        }
        if !item.description.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Eyebrow("Description")
                Text(item.description).foregroundStyle(Palette.mutedForeground).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
        }
        if !item.tags.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(item.tags, id: \.self) { tag in
                    Chip(name: "Show tag \(tag) in the library", active: false) { model.showTag(tag) } label: { Text("#\(tag)") }
                }
            }
        }

        VStack(alignment: .leading, spacing: 10) {
            Rectangle().fill(Palette.border).frame(height: 1)
            HStack(spacing: 8) {
                if let url = item.url, let link = URL(string: url) {
                    Button { NSWorkspace.shared.open(link) } label: { Label("Open source", systemImage: "arrow.up.right.square") }
                        .buttonStyle(.swipe())
                        .accessibilityLabel("Open source")
                }
                if item.status == .failed {
                    Button { retry() } label: { Label("Retry", systemImage: "arrow.clockwise") }
                        .buttonStyle(.swipe())
                        .disabled(working)
                        .accessibilityLabel("Retry")
                }
                Button { confirmingDelete = true } label: { Label("Delete", systemImage: "trash") }
                    .buttonStyle(.swipe())
                    .disabled(working)
                    .accessibilityLabel("Delete")
            }
            if let actionError {
                ErrorBox(title: "That did not work", message: actionError)
            }
        }

        if !item.extractedText.isEmpty {
            DisclosureGroup {
                Text(item.extractedText)
                    .foregroundStyle(Palette.mutedForeground)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 8)
            } label: {
                Text("Text from the source").foregroundStyle(Palette.mutedForeground)
            }
        }
    }

    private func meta(_ item: ItemDetail) -> String {
        var parts = [item.kind == .upload ? "upload" : item.site]
        if !item.author.isEmpty { parts.append(item.author) }
        parts.append("saved \(timeAgo(item.createdAt))")
        return parts.joined(separator: " · ")
    }

    private func retry() {
        perform { api in
            try await api.retry(itemID)
            model.didChange()
        }
    }

    private func delete() {
        let returnTo: Tab = item?.status == .done ? .library : .queue
        perform { api in
            try await api.delete(itemID)
            // Leave the page before the lists refresh, so the deleted item is never fetched again.
            model.path.removeAll { $0 == itemID }
            model.tab = returnTo
            model.didChange()
        }
    }

    private func perform(_ action: @escaping (SwipeAPI) async throws -> Void) {
        guard let api = model.api, !working else { return }
        working = true
        actionError = nil
        Task {
            do {
                try await action(api)
            } catch {
                actionError = error.localizedDescription
            }
            working = false
        }
    }
}

/// A video: its poster with a play button until clicked, then an inline player that streams from the bucket.
private struct VideoAsset: View {
    @Environment(AppModel.self) private var model
    let video: Asset
    let poster: Asset?
    @State private var player: AVPlayer?

    var body: some View {
        Group {
            if let player {
                PlayerView(player: player)
                    .aspectRatio(aspect, contentMode: .fit)
                    .frame(maxHeight: 640)
                    .frame(maxWidth: .infinity)
                    .background(.black)
            } else {
                Button {
                    let player = AVPlayer(url: video.url)
                    self.player = player
                    player.play()
                } label: {
                    ZStack {
                        if let poster {
                            AssetImage(asset: poster)
                        } else {
                            Color.black.aspectRatio(16.0 / 9.0, contentMode: .fit)
                        }
                        Image(systemName: "play.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(.white)
                            .frame(width: 56, height: 56)
                            .background(.black.opacity(0.6), in: Circle())
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Play")
                .accessibilityLabel(video.caption.isEmpty ? "Play video" : "Play video: \(video.caption)")
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border))
        .onDisappear { player?.pause() }
    }

    private var aspect: CGFloat {
        if let poster, let image = model.imageCache.cached(poster) { return image.size.width / max(image.size.height, 1) }
        return 16.0 / 9.0
    }
}

/// AppKit's player with inline controls. SwiftUI's `VideoPlayer` aborted this app inside `_AVKit_SwiftUI`
/// while creating its view, so the app wraps `AVPlayerView` itself.
private struct PlayerView: NSViewRepresentable {
    let player: AVPlayer

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.controlsStyle = .inline
        view.showsFullScreenToggleButton = true
        view.player = player
        return view
    }

    func updateNSView(_ view: AVPlayerView, context: Context) {
        if view.player !== player { view.player = player }
    }

    static func dismantleNSView(_ view: AVPlayerView, coordinator: ()) {
        view.player?.pause()
    }
}
