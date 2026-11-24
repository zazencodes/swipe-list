import AppKit
import SwiftUI
import SwipeListKit

@main
struct SwipeListApp: App {
    @State private var model = AppModel()

    init() {
        Plex.register()
    }

    var body: some Scene {
        Window("Swipe List", id: "main") {
            RootView()
                .environment(model)
                .frame(minWidth: 860, minHeight: 560)
                .onAppear { model.applyTheme() }
                .onOpenURL { model.handle($0) }
        }
        .defaultSize(width: 1180, height: 820)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Add Link") { model.showAdd(url: "", note: "") }
                    .keyboardShortcut("n")
                    .disabled(model.api == nil)
            }
            CommandGroup(after: .textEditing) {
                Button("Find in Library") { model.focusSearch() }
                    .keyboardShortcut("f")
                    .disabled(model.api == nil)
            }
            CommandMenu("Go") {
                ForEach(Array(Tab.allCases.enumerated()), id: \.element) { index, tab in
                    Button(tab.title) { model.tab = tab }
                        .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")))
                        .disabled(model.api == nil)
                }
                Divider()
                Button("Back") { if !model.path.isEmpty { model.path.removeLast() } }
                    .keyboardShortcut("[")
                    .disabled(model.path.isEmpty)
                Button("Refresh") { model.didChange() }
                    .keyboardShortcut("r")
                    .disabled(model.api == nil)
            }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            switch model.auth {
            case .loading:
                ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .signedOut(reason):
                SignInView(reason: reason)
            case let .unreachable(message):
                VStack(alignment: .leading, spacing: 12) {
                    ErrorBox(title: "Could not reach the Swipe List", message: message)
                    Button("Try again") { Task { await model.start() } }
                        .buttonStyle(.swipe())
                        .accessibilityLabel("Try again")
                }
                .frame(maxWidth: 440)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .ready(_, actor):
                MainView(actor: actor)
                    .id(ObjectIdentifier(model.imageCache))
            }
        }
        .font(.plex(13))
        .foregroundStyle(Palette.foreground)
        .background(Palette.background)
        .task { await model.start() }
    }
}
