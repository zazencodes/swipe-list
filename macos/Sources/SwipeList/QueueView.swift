import SwiftUI
import SwipeListKit

/// What the worker has yet to pull or could not pull, with retry. Refreshes every 10 seconds while anything waits.
struct QueueView: View {
    @Environment(AppModel.self) private var model
    @State private var sections: [ItemStatus: ItemPage] = [:]
    @State private var error: String?

    private let order: [(ItemStatus, String)] = [(.processing, "Pulling now"), (.queued, "Waiting"), (.failed, "Failed")]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Queue").font(.plex(20, .semibold))
                    Text("The worker on your Mac checks every 5 minutes while the Mac is awake.")
                        .foregroundStyle(Palette.mutedForeground)
                }
                if let error {
                    ErrorBox(title: "Could not load the queue", message: error)
                }
                if sections.count == order.count {
                    if sections.values.allSatisfy({ $0.total == 0 }) {
                        EmptyState(icon: "checkmark.circle", title: "Nothing waiting") {
                            Text("Everything you added has been pulled into the library.")
                        }
                    } else {
                        ForEach(order, id: \.0) { status, title in
                            if let page = sections[status], !page.items.isEmpty {
                                VStack(alignment: .leading, spacing: 0) {
                                    Eyebrow("\(title) · \(page.total)").padding(.bottom, 4)
                                    ForEach(Array(page.items.enumerated()), id: \.element.id) { index, item in
                                        if index > 0 { Rectangle().fill(Palette.border).frame(height: 1) }
                                        QueueRow(item: item)
                                    }
                                }
                            }
                        }
                    }
                } else if error == nil {
                    RoundedRectangle(cornerRadius: Radius.lg).fill(Palette.muted).frame(height: 64)
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.background)
        .task(id: model.changes) { await poll() }
    }

    private func poll() async {
        guard let api = model.api else { return }
        while !Task.isCancelled {
            do {
                var loaded: [ItemStatus: ItemPage] = [:]
                for (status, _) in order {
                    loaded[status] = try await api.items(ItemFilter(status: status, limit: 100))
                }
                sections = loaded
                error = nil
            } catch is CancellationError {
                return
            } catch {
                self.error = error.localizedDescription
            }
            let waiting = (sections[.queued]?.total ?? 0) + (sections[.processing]?.total ?? 0)
            guard waiting > 0 else { return }
            try? await Task.sleep(for: .seconds(10))
        }
    }
}

private struct QueueRow: View {
    @Environment(AppModel.self) private var model
    let item: ItemSummary
    @State private var retrying = false
    @State private var retryError: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: item.kind == .upload ? "photo" : "link")
                .foregroundStyle(Palette.mutedForeground)
                .frame(width: 16)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Button { model.open(item.id) } label: {
                    Text(displayTitle(title: item.title, url: item.url, fallback: "Uploaded images"))
                        .font(.plex(13, .medium))
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(displayTitle(title: item.title, url: item.url, fallback: "Uploaded images"))")
                if !item.note.isEmpty {
                    Text(item.note).font(.plex(12)).foregroundStyle(Palette.mutedForeground).lineLimit(2)
                }
                if item.status == .failed, let lastError = item.lastError {
                    Text(lastError).font(.plex(12)).foregroundStyle(Palette.critical).lineLimit(3).textSelection(.enabled)
                }
                if let retryError {
                    Text(retryError).font(.plex(12)).foregroundStyle(Palette.critical)
                }
                HStack(spacing: 8) {
                    StatusBadge(status: item.status.rawValue)
                    Text(timeAgo(item.createdAt) + (item.attempts > 1 ? " · attempt \(item.attempts)" : ""))
                        .font(.plex(12))
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            Spacer(minLength: 0)
            if item.status == .failed {
                Button(action: retry) { Label("Retry", systemImage: "arrow.clockwise") }
                    .buttonStyle(.swipe())
                    .disabled(retrying)
                    .accessibilityLabel("Retry \(displayTitle(title: item.title, url: item.url, fallback: "uploaded images"))")
            }
        }
        .padding(.vertical, 12)
    }

    private func retry() {
        guard let api = model.api else { return }
        retrying = true
        retryError = nil
        Task {
            do {
                try await api.retry(item.id)
                model.didChange()
            } catch {
                retryError = error.localizedDescription
            }
            retrying = false
        }
    }
}
