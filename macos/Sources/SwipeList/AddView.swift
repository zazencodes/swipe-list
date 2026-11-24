import AppKit
import SwiftUI
import SwipeListKit
import UniformTypeIdentifiers

/// Add a link with a note, or upload screenshots. Either one queues an item for the worker.
struct AddView: View {
    @State private var mode: Mode = .link

    enum Mode { case link, upload }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Add inspiration").font(.plex(20, .semibold))
                HStack(spacing: 0) {
                    segment(.link, "Link", "link")
                    segment(.upload, "Upload", "photo.badge.plus")
                }
                .padding(4)
                .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border))

                switch mode {
                case .link: LinkForm()
                case .upload: UploadForm()
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.background)
    }

    private func segment(_ value: Mode, _ title: String, _ icon: String) -> some View {
        Button { mode = value } label: {
            Label(title, systemImage: icon)
                .font(.plex(13))
                .foregroundStyle(mode == value ? Palette.foreground : Palette.mutedForeground)
                .frame(maxWidth: .infinity)
                .frame(height: 32)
                .background(mode == value ? Palette.accent : .clear, in: RoundedRectangle(cornerRadius: Radius.md))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityAddTraits(mode == value ? .isSelected : [])
    }
}

/// The note box both forms share, with a placeholder.
private struct NoteField: View {
    @Binding var text: String
    let placeholder: String
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Note").font(.plex(13, .medium))
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder)
                        .foregroundStyle(Palette.mutedForeground)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 0)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $text)
                    .accessibilityLabel("Note")
                    .scrollContentBackground(.hidden)
                    .scrollIndicators(.never)
                    .focused($focused)
            }
            .font(.plex(13))
            .padding(.vertical, 8)
            .padding(.horizontal, 5)
            .frame(height: 104)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(focused ? Palette.ring.opacity(0.6) : Palette.input, lineWidth: focused ? 2 : 1))
        }
    }
}

private struct LinkForm: View {
    @Environment(AppModel.self) private var model
    @State private var url = ""
    @State private var note = ""
    @State private var busy = false
    @State private var error: String?
    @State private var existing: Int?
    @FocusState private var urlFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Link").font(.plex(13, .medium))
                HStack(spacing: 8) {
                    TextField("https://x.com/...", text: $url)
                        .accessibilityLabel("Link")
                        .focused($urlFocused)
                        .fieldChrome(height: 38, focused: urlFocused)
                        .onSubmit(submit)
                    Button(action: paste) { Label("Paste", systemImage: "doc.on.clipboard") }
                        .buttonStyle(.swipe(tall: true))
                        .accessibilityLabel("Paste link")
                }
                if let existing {
                    HStack(spacing: 4) {
                        Text("Already saved:").foregroundStyle(Palette.mutedForeground)
                        Button("open it") { model.open(existing) }
                            .buttonStyle(.plain)
                            .underline()
                            .accessibilityLabel("Open the saved item")
                    }
                }
            }
            NoteField(text: $note, placeholder: "What to pull and what you like about it, e.g. the second video, the glassy edges")
            if let error, existing == nil {
                ErrorBox(title: "Could not add this link", message: error)
            }
            Button(action: submit) {
                HStack(spacing: 8) {
                    if busy { ProgressView().controlSize(.small) }
                    Text("Add to queue")
                }
            }
            .buttonStyle(.swipe(.primary, tall: true, fullWidth: true))
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(busy || url.trimmingCharacters(in: .whitespaces).isEmpty)
            .accessibilityLabel("Add to queue")
            Text("⌘↩ adds it. The worker on your Mac pulls it within 5 minutes.")
                .font(.plex(12))
                .foregroundStyle(Palette.mutedForeground)
        }
        .onAppear {
            if let prefill = model.addPrefill {
                url = prefill.url
                note = prefill.note
                model.addPrefill = nil
            }
            urlFocused = url.isEmpty
        }
        .onChange(of: model.addPrefill?.url) {
            if let prefill = model.addPrefill {
                url = prefill.url
                note = prefill.note
                model.addPrefill = nil
            }
        }
    }

    private func paste() {
        if let text = NSPasteboard.general.string(forType: .string) {
            url = text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    private func submit() {
        let link = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let api = model.api, !busy, !link.isEmpty else { return }
        busy = true
        error = nil
        existing = nil
        Task {
            do {
                let created = try await api.addLink(url: link, note: note.trimmingCharacters(in: .whitespacesAndNewlines))
                url = ""
                note = ""
                model.didChange()
                model.open(created.id)
            } catch let failure as APIError {
                existing = failure.existingItemID
                error = failure.localizedDescription
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}

/// A picked image, read into memory with a preview.
private struct PickedImage: Identifiable {
    let id = UUID()
    let file: UploadFile
    let preview: NSImage?

    /// Reads an image the server accepts; anything else is refused with a reason.
    static func read(_ url: URL) throws -> PickedImage {
        guard let type = UploadFile.typesByExtension[url.pathExtension.lowercased()] else {
            throw APIError(status: nil, code: "bad_type", message: "\(url.lastPathComponent) is not a JPEG, PNG, WebP or GIF.")
        }
        let data = try Data(contentsOf: url)
        guard data.count <= UploadFile.maxBytes else {
            throw APIError(status: nil, code: "too_big", message: "\(url.lastPathComponent) is over \(UploadFile.maxBytes / 1024 / 1024) MB.")
        }
        return PickedImage(file: UploadFile(name: url.lastPathComponent, contentType: type, data: data), preview: NSImage(data: data))
    }
}

private struct UploadForm: View {
    @Environment(AppModel.self) private var model
    @State private var images: [PickedImage] = []
    @State private var note = ""
    @State private var busy = false
    @State private var error: String?
    @State private var dropping = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Group {
                if images.isEmpty {
                    Button(action: choose) {
                        VStack(spacing: 8) {
                            Image(systemName: "photo.badge.plus").font(.system(size: 22))
                            Text("Choose or drop screenshots or images")
                            Text("JPEG, PNG, WebP or GIF, up to \(UploadFile.maxFiles)").font(.plex(12))
                        }
                        .foregroundStyle(Palette.mutedForeground)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Choose images to upload")
                } else {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                        ForEach(images) { picked in
                            ZStack(alignment: .topTrailing) {
                                Color.clear
                                    .aspectRatio(1, contentMode: .fit)
                                    .overlay {
                                        if let preview = picked.preview {
                                            Image(nsImage: preview).resizable().scaledToFill()
                                        }
                                    }
                                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                                    .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border))
                                Button { images.removeAll { $0.id == picked.id } } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundStyle(.white)
                                        .frame(width: 22, height: 22)
                                        .background(.black.opacity(0.6), in: Circle())
                                }
                                .buttonStyle(.plain)
                                .padding(4)
                                .help("Remove \(picked.file.name)")
                                .accessibilityLabel("Remove \(picked.file.name)")
                            }
                        }
                        if images.count < UploadFile.maxFiles {
                            Button(action: choose) {
                                Image(systemName: "photo.badge.plus")
                                    .foregroundStyle(Palette.mutedForeground)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                    .aspectRatio(1, contentMode: .fit)
                                    .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Choose more images")
                        }
                    }
                    .padding(8)
                }
            }
            .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(dropping ? Palette.ring : Palette.border, style: StrokeStyle(lineWidth: 1, dash: images.isEmpty || dropping ? [4, 3] : [])))
            .dropDestination(for: URL.self) { urls, _ in
                add(urls)
                return true
            } isTargeted: { dropping = $0 }

            NoteField(text: $note, placeholder: "What you like about it")
            if let error {
                ErrorBox(title: "Could not upload", message: error)
            }
            Button(action: submit) {
                HStack(spacing: 8) {
                    if busy { ProgressView().controlSize(.small) }
                    Text("Upload")
                }
            }
            .buttonStyle(.swipe(.primary, tall: true, fullWidth: true))
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(busy || images.isEmpty)
            .accessibilityLabel(images.isEmpty ? "Upload" : images.count == 1 ? "Upload 1 image" : "Upload \(images.count) images")
        }
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.jpeg, .png, .webP, .gif]
        panel.message = "Choose up to \(UploadFile.maxFiles) images"
        if panel.runModal() == .OK { add(panel.urls) }
    }

    private func add(_ urls: [URL]) {
        error = nil
        var problems: [String] = []
        for url in urls where images.count < UploadFile.maxFiles {
            do {
                images.append(try PickedImage.read(url))
            } catch {
                problems.append(error.localizedDescription)
            }
        }
        if urls.count > problems.count + images.count { problems.append("Only \(UploadFile.maxFiles) images go in one upload.") }
        if !problems.isEmpty { error = problems.joined(separator: "\n") }
    }

    private func submit() {
        guard let api = model.api, !busy, !images.isEmpty else { return }
        busy = true
        error = nil
        Task {
            do {
                let created = try await api.upload(files: images.map(\.file), note: note.trimmingCharacters(in: .whitespacesAndNewlines))
                images = []
                note = ""
                model.didChange()
                model.open(created.id)
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}
