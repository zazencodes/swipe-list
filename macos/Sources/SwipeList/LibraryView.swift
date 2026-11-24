import SwiftUI
import SwipeListKit

private let mediaFilters: [(AssetRole?, String)] = [
    (nil, "All"), (.video, "Video"), (.image, "Images"), (.screenshot, "Pages"), (.upload, "Uploads"),
]

/// Everything the worker has pulled: search, media and tag filters, and a masonry grid a page at a time.
struct LibraryView: View {
    @Environment(AppModel.self) private var model
    @FocusState private var searchFocused: Bool

    private struct LoadKey: Hashable {
        let query: String
        let media: AssetRole?
        let tag: String?
        let changes: Int
    }

    var body: some View {
        @Bindable var library = model.library
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                filters
                content
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
            .frame(maxWidth: 1240)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.background)
        .searchable(text: $library.draft, placement: .toolbar, prompt: "Search titles, notes, tags, page text")
        .searchFocused($searchFocused)
        .onSubmit(of: .search) { library.commitSearch() }
        .onChange(of: model.searchRequests) { searchFocused = true }
        .onAppear { if model.searchRequests > 0 { searchFocused = true } }
        .task(id: library.draft) {
            // Search as you type, a beat after the last keystroke.
            try? await Task.sleep(for: .milliseconds(300))
            if !Task.isCancelled { library.commitSearch() }
        }
        .task(id: LoadKey(query: library.query, media: library.media, tag: library.tag, changes: model.changes)) {
            guard let api = model.api else { return }
            await library.reload(api)
        }
        .toolbar {
            if library.isLoading && library.loaded {
                ToolbarItem { ProgressView().controlSize(.small) }
            }
        }
    }

    private var filters: some View {
        let library = model.library
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ForEach(mediaFilters, id: \.1) { role, label in
                    Chip(name: "Show \(label)", active: library.media == role) { library.media = role } label: { Text(label) }
                }
            }
            if !library.tags.isEmpty || library.tag != nil {
                FlowLayout(spacing: 6) {
                    if let tag = library.tag {
                        Chip(name: "Clear tag \(tag)", active: true) { library.tag = nil } label: {
                            HStack(spacing: 4) {
                                Text("#\(tag)")
                                Image(systemName: "xmark").font(.system(size: 8, weight: .semibold))
                            }
                        }
                    }
                    ForEach(library.tags.filter { $0.tag != library.tag }, id: \.tag) { tag in
                        Chip(name: "Tag \(tag.tag), \(tag.count) \(tag.count == 1 ? "item" : "items")", active: false) { library.tag = tag.tag } label: {
                            HStack(spacing: 4) {
                                Text("#\(tag.tag)")
                                Text("\(tag.count)").monospacedDigit().opacity(0.6)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private var content: some View {
        let library = model.library
        if let error = library.error, library.items.isEmpty {
            ErrorBox(title: "Could not load the library", message: error)
        } else if !library.loaded {
            Masonry {
                ForEach(0..<8, id: \.self) { index in
                    RoundedRectangle(cornerRadius: Radius.lg)
                        .fill(Palette.muted)
                        .frame(height: CGFloat(120 + (index % 3) * 60))
                }
            }
            .redacted(reason: .placeholder)
        } else if library.items.isEmpty {
            if library.isFiltered {
                EmptyState(icon: "photo.on.rectangle", title: "Nothing matches") { Text("Try fewer words or clear a filter.") }
            } else {
                EmptyState(icon: "photo.on.rectangle", title: "Nothing saved yet") {
                    VStack(spacing: 10) {
                        Text("Add a link or a screenshot and it shows up here once the worker has pulled it.")
                        Button("Add inspiration") { model.tab = .add }
                            .buttonStyle(.swipe())
                            .accessibilityLabel("Add inspiration")
                    }
                }
            }
        } else {
            Eyebrow("\(library.total) \(library.total == 1 ? "item" : "items")")
            Masonry {
                ForEach(library.items) { item in
                    ItemCard(item: item) { model.open(item.id) }
                }
            }
            if let error = library.error {
                ErrorBox(title: "Could not load more", message: error)
            }
            if library.items.count < library.total {
                HStack {
                    Spacer()
                    Button {
                        guard let api = model.api else { return }
                        Task { await library.loadMore(api) }
                    } label: {
                        HStack(spacing: 6) {
                            if library.isLoadingMore { ProgressView().controlSize(.mini) }
                            Text("Show more")
                        }
                    }
                    .buttonStyle(.swipe())
                    .disabled(library.isLoadingMore)
                    .accessibilityLabel("Show more items")
                    Spacer()
                }
            }
        }
    }
}

/// A library card: the preview image, a play badge for videos, the title and the source.
struct ItemCard: View {
    let item: ItemSummary
    let open: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 6) {
                ZStack(alignment: .bottomLeading) {
                    if let preview = item.preview {
                        AssetImage(asset: preview, maxHeight: 416)
                            .scaleEffect(hovering ? 1.02 : 1, anchor: .center)
                    } else {
                        ZStack {
                            Palette.muted
                            Image(systemName: "photo").foregroundStyle(Palette.mutedForeground)
                        }
                        .aspectRatio(4.0 / 3.0, contentMode: .fit)
                    }
                    if item.hasVideo {
                        Image(systemName: "play.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(.white)
                            .frame(width: 28, height: 28)
                            .background(.black.opacity(0.6), in: Circle())
                            .padding(8)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
                .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border))
                .animation(.easeOut(duration: 0.3), value: hovering)

                VStack(alignment: .leading, spacing: 2) {
                    Text(displayTitle(title: item.title, url: item.url, fallback: "Untitled"))
                        .font(.plex(13, .medium))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text(meta.uppercased())
                        .font(.plexMono(10))
                        .tracking(0.8)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(1)
                }
                .padding(.horizontal, 2)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(spokenName)
        .accessibilityHint("Opens the item")
        .onHover { hovering = $0 }
        .contextMenu {
            Button("Open") { open() }
            if let url = item.url, let link = URL(string: url) {
                Button("Open Source in Browser") { NSWorkspace.shared.open(link) }
                Button("Copy Link") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(url, forType: .string)
                }
            }
        }
    }

    private var spokenName: String {
        let title = displayTitle(title: item.title, url: item.url, fallback: "Untitled")
        return "\(title), \(meta)" + (item.hasVideo ? ", video" : "")
    }

    private var meta: String {
        let source = item.kind == .upload ? "upload" : item.site
        return item.author.isEmpty ? source : "\(source) · \(item.author)"
    }
}

/// Columns of at least `minColumn` points; each child goes into the shortest column so far.
struct Masonry: Layout {
    var minColumn: CGFloat = 220
    var spacing: CGFloat = 14

    private func columns(for width: CGFloat) -> (count: Int, width: CGFloat) {
        let count = max(2, Int((width + spacing) / (minColumn + spacing)))
        return (count, (width - spacing * CGFloat(count - 1)) / CGFloat(count))
    }

    private func frames(width: CGFloat, subviews: Subviews) -> [CGRect] {
        let (count, columnWidth) = columns(for: width)
        var heights = Array(repeating: CGFloat(0), count: count)
        return subviews.map { subview in
            let column = heights.indices.min { heights[$0] < heights[$1] }!
            let height = subview.sizeThatFits(ProposedViewSize(width: columnWidth, height: nil)).height
            let frame = CGRect(x: CGFloat(column) * (columnWidth + spacing), y: heights[column], width: columnWidth, height: height)
            heights[column] += height + spacing
            return frame
        }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 900
        let bottom = frames(width: width, subviews: subviews).map(\.maxY).max() ?? 0
        return CGSize(width: width, height: bottom)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (subview, frame) in zip(subviews, frames(width: bounds.width, subviews: subviews)) {
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), proposal: ProposedViewSize(frame.size))
        }
    }
}
