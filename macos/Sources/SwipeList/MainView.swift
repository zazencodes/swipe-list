import SwiftUI
import SwipeListKit

/// Sidebar with Library, Add and Queue, and the account and theme menu; the content column shows the tab
/// with item pages pushed on top.
struct MainView: View {
    @Environment(AppModel.self) private var model
    let actor: Actor

    var body: some View {
        @Bindable var model = model
        NavigationSplitView {
            Sidebar(actor: actor)
                .navigationSplitViewColumnWidth(min: 190, ideal: 210, max: 260)
        } detail: {
            NavigationStack(path: $model.path) {
                tabView
                    .navigationDestination(for: Int.self) { ItemDetailView(itemID: $0) }
            }
            .background(Palette.background)
        }
        .toolbarBackground(Palette.background, for: .windowToolbar)
        .navigationTitle(model.path.isEmpty ? model.tab.title : "")
        .task {
            // Keeps the Queue badge current while the window is open.
            while !Task.isCancelled {
                await model.refreshCounts()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    @ViewBuilder private var tabView: some View {
        switch model.tab {
        case .library: LibraryView()
        case .add: AddView()
        case .queue: QueueView()
        }
    }
}

private struct Sidebar: View {
    @Environment(AppModel.self) private var model
    let actor: Actor

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                BrandMark(size: 26)
                Text("Swipe List").font(.plex(14, .semibold))
            }
            .padding(.horizontal, 14)
            .padding(.top, 6)
            .padding(.bottom, 14)

            VStack(spacing: 2) {
                ForEach(Tab.allCases) { tab in
                    SidebarRow(tab: tab, selected: model.tab == tab && model.path.isEmpty) {
                        model.tab = tab
                        model.path = []
                    }
                }
            }
            .padding(.horizontal, 8)

            Spacer()
            AccountMenu(actor: actor).padding(8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.sidebar)
    }
}

private struct SidebarRow: View {
    @Environment(AppModel.self) private var model
    let tab: Tab
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: tab.icon).frame(width: 18)
                Text(tab.title)
                Spacer()
                if tab == .queue { QueueBadge() }
            }
            .font(.plex(13))
            .foregroundStyle(selected || hovering ? Palette.foreground : Palette.mutedForeground)
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(selected ? Palette.sidebarAccent : .clear, in: RoundedRectangle(cornerRadius: Radius.md))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(spokenName)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .onHover { hovering = $0 }
    }

    private var spokenName: String {
        guard tab == .queue else { return tab.title }
        if model.failedCount > 0 { return "Queue, \(model.failedCount) failed" }
        if model.pendingCount > 0 { return "Queue, \(model.pendingCount) waiting" }
        return "Queue"
    }
}

/// Failed items in red, otherwise items waiting for the worker; hidden when there are none.
struct QueueBadge: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let failed = model.failedCount
        let count = failed > 0 ? failed : model.pendingCount
        if count > 0 {
            Text("\(count)")
                .font(.plex(10, .medium))
                .monospacedDigit()
                .padding(.horizontal, 6)
                .frame(height: 16)
                .foregroundStyle(failed > 0 ? .white : Palette.foreground)
                .background(failed > 0 ? Palette.critical : Palette.foreground.opacity(0.1), in: Capsule())
        }
    }
}

private struct AccountMenu: View {
    @Environment(AppModel.self) private var model
    let actor: Actor

    var body: some View {
        @Bindable var model = model
        Menu {
            Text("Signed in as \(actor.label)")
            Text(model.api?.credential.server.host ?? "")
            Divider()
            Picker("Theme", selection: $model.theme) {
                ForEach(ThemeChoice.allCases) { choice in
                    Label(choice.title, systemImage: choice.icon).tag(choice)
                }
            }
            .pickerStyle(.inline)
            Divider()
            Button("Sign Out") { model.signOut() }
        } label: {
            HStack(spacing: 8) {
                Text(String(actor.label.prefix(1)).uppercased())
                    .font(.plex(11, .medium))
                    .frame(width: 24, height: 24)
                    .background(Palette.foreground.opacity(0.1), in: Circle())
                VStack(alignment: .leading, spacing: 0) {
                    Text(actor.label).font(.plex(12, .medium)).lineLimit(1)
                    Text(model.api?.credential.server.host ?? "").font(.plexMono(10)).foregroundStyle(Palette.mutedForeground).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9)).foregroundStyle(Palette.mutedForeground)
            }
            .padding(6)
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .help("Account and theme")
        .accessibilityLabel("Account and theme, signed in as \(actor.label)")
    }
}
