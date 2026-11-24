import SwiftUI
import SwipeListKit

/// First run: paste a Swipe List credential. It is checked with the server, then kept in the login Keychain.
struct SignInView: View {
    @Environment(AppModel.self) private var model
    let reason: String?
    @State private var server = ""
    @State private var token = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?

    private enum Field { case server, token }

    var body: some View {
        HStack(spacing: 0) {
            aside
            form.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear {
            server = model.lastServer
            focus = .token
        }
    }

    private var aside: some View {
        VStack(alignment: .leading) {
            HStack(spacing: 12) {
                BrandMark(size: 32)
                Text("Swipe List").font(.plex(15, .semibold))
            }
            Spacer()
            SwipeArt()
            Spacer()
            Text("Save what catches your eye. The worker pulls the media; you find it again when you need it.")
                .font(.plex(13))
                .foregroundStyle(Palette.mutedForeground)
                .frame(maxWidth: 360, alignment: .leading)
        }
        .padding(40)
        .frame(width: 420)
        .frame(maxHeight: .infinity)
        .background(Palette.sidebar)
        .overlay(alignment: .trailing) { Rectangle().fill(Palette.border).frame(width: 1) }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 28) {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow("Sign in")
                Text("Connect your library").font(.plex(24, .semibold))
                Text("Paste a Swipe List credential. It is checked with the server and kept in your login Keychain.")
                    .font(.plex(13))
                    .foregroundStyle(Palette.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let message = error ?? reason {
                ErrorBox(title: "Could not sign in", message: message)
            }

            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Server").font(.plex(13, .medium))
                    TextField("https://swipe-api.example.com", text: $server)
                        .accessibilityLabel("Server")
                        .focused($focus, equals: .server)
                        .fieldChrome(height: 38, focused: focus == .server)
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Credential").font(.plex(13, .medium))
                    SecureField("swl_...", text: $token)
                        .accessibilityLabel("Credential")
                        .focused($focus, equals: .token)
                        .fieldChrome(height: 38, focused: focus == .token)
                        .onSubmit(submit)
                }
                Button(action: submit) {
                    HStack(spacing: 8) {
                        if busy { ProgressView().controlSize(.small).tint(Palette.primaryForeground) }
                        Text("Sign in")
                    }
                }
                .buttonStyle(.swipe(.primary, tall: true, fullWidth: true))
                .disabled(busy || token.trimmingCharacters(in: .whitespaces).isEmpty)
                .keyboardShortcut(.defaultAction)
                .accessibilityLabel("Sign in")

                HStack(spacing: 10) {
                    Rectangle().fill(Palette.border).frame(height: 1)
                    Eyebrow("or")
                    Rectangle().fill(Palette.border).frame(height: 1)
                }
                Button(action: useCLI) {
                    Label("Use Swipe CLI connection", systemImage: "terminal")
                }
                .buttonStyle(.swipe(.outline, tall: true, fullWidth: true))
                .disabled(busy)
                .accessibilityLabel("Use Swipe CLI connection")
                Text("Reads \(SwipeCLIConfig.path().path(percentEncoded: false)), checks it with the server, and keeps a copy in the Keychain.")
                    .font(.plex(12))
                    .foregroundStyle(Palette.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Make a credential for this Mac on the server; the token is shown once:")
                    .font(.plex(12))
                    .foregroundStyle(Palette.mutedForeground)
                Text("admin.mjs credentials create mac-app --allow-submit")
                    .font(.plexMono(11.5))
                    .textSelection(.enabled)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(Palette.muted, in: RoundedRectangle(cornerRadius: Radius.md))
            }
        }
        .frame(maxWidth: 380)
        .padding(32)
    }

    private func submit() {
        run { try await model.signIn(server: server, token: token) }
    }

    private func useCLI() {
        run { try await model.signInWithCLI() }
    }

    private func run(_ attempt: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        error = nil
        Task {
            do {
                try await attempt()
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}

/// A faint contact sheet of saved cards: decorative.
private struct SwipeArt: View {
    private let cards: [(String, String)] = [
        ("Glass logo concept", "x.com"),
        ("Launch film, 3D geometry", "x.com"),
        ("Dark gradient hero", "linear.app"),
        ("Pricing card grid", "upload"),
        ("Album art wall", "apple.com"),
        ("Type specimen", "upload"),
    ]

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: 3), spacing: 12) {
            ForEach(Array(cards.enumerated()), id: \.offset) { index, card in
                VStack(alignment: .leading, spacing: 0) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Palette.foreground.opacity(0.06))
                        .aspectRatio(index % 3 == 1 ? 3.0 / 4.0 : 4.0 / 3.0, contentMode: .fit)
                    Text(card.0).font(.plex(11)).lineLimit(1).padding(.top, 8)
                    Text(card.1.uppercased()).font(.plexMono(9.5)).tracking(0.8).lineLimit(1).opacity(0.7)
                }
                .padding(8)
                .background(Palette.background.opacity(0.4), in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.foreground.opacity(0.1)))
            }
        }
        .foregroundStyle(Palette.mutedForeground.opacity(0.7))
        .accessibilityHidden(true)
    }
}
