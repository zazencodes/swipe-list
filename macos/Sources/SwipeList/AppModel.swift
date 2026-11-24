import AppKit
import Observation
import SwipeListKit

enum Tab: String, CaseIterable, Identifiable {
    case library, add, queue
    var id: String { rawValue }

    var title: String {
        switch self {
        case .library: "Library"
        case .add: "Add"
        case .queue: "Queue"
        }
    }

    var icon: String {
        switch self {
        case .library: "photo.on.rectangle"
        case .add: "plus"
        case .queue: "checklist"
        }
    }
}

enum ThemeChoice: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var icon: String {
        switch self {
        case .system: "desktopcomputer"
        case .light: "sun.max"
        case .dark: "moon"
        }
    }
}

/// The library filters and loaded pages. Search runs a beat after the last keystroke.
@MainActor @Observable final class LibraryModel {
    static let pageSize = 48

    var draft = ""
    private(set) var query = ""
    var media: AssetRole?
    var tag: String?
    private(set) var items: [ItemSummary] = []
    private(set) var total = 0
    private(set) var tags: [TagCount] = []
    private(set) var loaded = false
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var error: String?
    private var generation = 0

    var isFiltered: Bool { !query.isEmpty || tag != nil || media != nil }

    private func filter(offset: Int) -> ItemFilter {
        ItemFilter(q: query.isEmpty ? nil : query, status: .done, tag: tag, media: media, limit: Self.pageSize, offset: offset)
    }

    func commitSearch() {
        query = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Loads the first page and the tag list. A reload started later wins over an earlier one.
    func reload(_ api: SwipeAPI) async {
        generation += 1
        let mine = generation
        isLoading = true
        defer { if mine == generation { isLoading = false } }
        do {
            async let page = api.items(filter(offset: 0))
            async let tagList = api.tags()
            let (result, tagResult) = try await (page, tagList)
            guard mine == generation else { return }
            items = result.items
            total = result.total
            tags = tagResult
            error = nil
            loaded = true
        } catch is CancellationError {
        } catch {
            guard mine == generation else { return }
            self.error = error.localizedDescription
            loaded = true
        }
    }

    func loadMore(_ api: SwipeAPI) async {
        guard !isLoadingMore, items.count < total else { return }
        let mine = generation
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await api.items(filter(offset: items.count))
            guard mine == generation else { return }
            let known = Set(items.map(\.id))
            items += page.items.filter { !known.contains($0.id) }
            total = page.total
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    func reset() {
        draft = ""
        query = ""
        media = nil
        tag = nil
        items = []
        total = 0
        tags = []
        loaded = false
        error = nil
    }
}

/// Signed-in state, navigation and the counts the sidebar shows.
@MainActor @Observable final class AppModel {
    enum Auth {
        case loading
        case signedOut(reason: String?)
        case unreachable(String)
        case ready(SwipeAPI, Actor)
    }

    private(set) var auth: Auth = .loading
    var tab: Tab = .library {
        didSet { if oldValue != tab { path = [] } }
    }
    /// Item ids pushed on top of the current tab.
    var path: [Int] = []
    let library = LibraryModel()
    private(set) var imageCache = ImageCache()
    /// Link and note to put in the add form (from a `swipelist://add` URL).
    var addPrefill: (url: String, note: String)?
    /// Bumped by Find (⌘F) to focus the library search field.
    private(set) var searchRequests = 0
    /// Bumped after every write, so open screens reload.
    private(set) var changes = 0
    private(set) var pendingCount = 0
    private(set) var failedCount = 0
    var theme: ThemeChoice {
        didSet {
            UserDefaults.standard.set(theme.rawValue, forKey: "theme")
            applyTheme()
        }
    }

    private let store = CredentialStore(service: "com.zazencodes.swipelist")

    init() {
        let stored = UserDefaults.standard.string(forKey: "theme")
        theme = stored.flatMap(ThemeChoice.init(rawValue:)) ?? .system
    }

    var api: SwipeAPI? {
        if case let .ready(api, _) = auth { return api }
        return nil
    }

    func applyTheme() {
        NSApp.appearance = switch theme {
        case .system: nil
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        }
    }

    // MARK: Auth

    func start() async {
        auth = .loading
        let credential: Credential?
        do {
            credential = try store.load()
        } catch {
            auth = .unreachable(error.localizedDescription)
            return
        }
        guard let credential else {
            auth = .signedOut(reason: nil)
            return
        }
        let api = SwipeAPI(credential: credential)
        do {
            auth = .ready(api, try await api.me())
        } catch let error as APIError where error.status == 401 {
            auth = .signedOut(reason: "The saved credential was refused: \(error.message). Paste a new one.")
        } catch {
            auth = .unreachable(error.localizedDescription)
        }
    }

    /// Checks the credential with the server, then keeps it in the Keychain.
    func signIn(server: String, token: String) async throws {
        try await connect(try Credential(server: server, token: token))
    }

    /// Uses the connection `swipe login` saved for the CLI. Only when asked: signing out never brings it back.
    func signInWithCLI() async throws {
        try await connect(try SwipeCLIConfig.load())
    }

    private func connect(_ credential: Credential) async throws {
        let api = SwipeAPI(credential: credential)
        let actor = try await api.me()
        try store.save(credential)
        UserDefaults.standard.set(credential.server.absoluteString, forKey: "server")
        imageCache = ImageCache()
        library.reset()
        auth = .ready(api, actor)
    }

    func signOut() {
        do {
            try store.delete()
        } catch {
            NSAlert(error: error).runModal()
            return
        }
        imageCache = ImageCache()
        library.reset()
        path = []
        tab = .library
        pendingCount = 0
        failedCount = 0
        auth = .signedOut(reason: nil)
    }

    /// The server last signed in to, to fill the sign-in form.
    var lastServer: String {
        UserDefaults.standard.string(forKey: "server") ?? ""
    }

    // MARK: Navigation

    func open(_ itemID: Int) {
        path.append(itemID)
    }

    func focusSearch() {
        tab = .library
        path = []
        searchRequests += 1
    }

    func showTag(_ tag: String) {
        library.tag = tag
        tab = .library
        path = []
    }

    func showAdd(url: String, note: String) {
        addPrefill = (url, note)
        tab = .add
        path = []
    }

    /// Opens `swipelist://add?url=<link>&note=<text>`, the desktop form of the dashboard's `/add?url=&note=`.
    func handle(_ url: URL) {
        guard url.scheme == "swipelist", url.host == "add" else { return }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        showAdd(url: query.first { $0.name == "url" }?.value ?? "", note: query.first { $0.name == "note" }?.value ?? "")
    }

    // MARK: Data

    func didChange() {
        changes += 1
        Task { await refreshCounts() }
    }

    func refreshCounts() async {
        guard let api else { return }
        do {
            async let queued = api.items(ItemFilter(status: .queued, limit: 1))
            async let processing = api.items(ItemFilter(status: .processing, limit: 1))
            async let failed = api.items(ItemFilter(status: .failed, limit: 1))
            let (q, p, f) = try await (queued, processing, failed)
            pendingCount = q.total + p.total
            failedCount = f.total
        } catch {
            // The badge keeps its last counts; the Queue screen shows the error when opened.
        }
    }
}
