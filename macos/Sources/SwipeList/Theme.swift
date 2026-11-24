import AppKit
import CoreText
import SwiftUI

/// The dashboard's palette (web/src/index.css), as colors that follow the window's light or dark appearance.
enum Palette {
    static let background = dynamic(0xF6F6F3, 0x0F0F0E)
    static let foreground = dynamic(0x0B0B0B, 0xF0EFEC)
    static let card = dynamic(0xFFFFFF, 0x1A1A19)
    static let primary = dynamic(0x1A1A19, 0xF0EFEC)
    static let primaryForeground = dynamic(0xF6F6F3, 0x1A1A19)
    static let muted = dynamic(0xEFEEEA, 0x262624)
    static let mutedForeground = dynamic(0x62615C, 0xA3A29B)
    static let accent = dynamic(0xEFEEEA, 0x2A2A28)
    static let border = dynamic(0xE1E0D9, 0x2C2C2A)
    static let input = dynamic(0xD6D5CD, 0x383835)
    static let ring = dynamic(0x2A78D6, 0x3987E5)
    static let warning = dynamic(0xB97A00, 0xFAB219)
    static let critical = dynamic(0xC23434, 0xE66767)
    static let sidebar = dynamic(0xF0EFEB, 0x141413)
    static let sidebarAccent = dynamic(0xE4E3DD, 0x242422)

    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return rgb(isDark ? dark : light)
        })
    }

    private static func rgb(_ hex: UInt32) -> NSColor {
        NSColor(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

/// The dashboard's corner radius (0.5rem) and its derived sizes.
enum Radius {
    static let md: CGFloat = 6.4
    static let lg: CGFloat = 8
}

/// IBM Plex Sans and Mono, the dashboard's type, bundled in the app.
enum Plex {
    /// Registers the bundled fonts for this process. A missing font file is a broken build, so it stops the app.
    static func register() {
        guard let folder = Bundle.main.resourceURL?.appendingPathComponent("Fonts") else { fatalError("the app has no Resources folder") }
        for file in ["IBMPlexSans.woff2", "IBMPlexMono-Regular.woff2", "IBMPlexMono-Medium.woff2"] {
            let url = folder.appendingPathComponent(file)
            var error: Unmanaged<CFError>?
            guard CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) else {
                fatalError("could not load the bundled font \(file): \(String(describing: error?.takeRetainedValue()))")
            }
        }
    }
}

extension Font {
    static func plex(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .medium: name = "IBMPlexSans-Medium"
        case .semibold: name = "IBMPlexSans-SemiBold"
        case .bold: name = "IBMPlexSans-Bold"
        default: name = "IBMPlexSans-Regular"
        }
        return .custom(name, fixedSize: size)
    }

    static func plexMono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom(weight == .medium ? "IBMPlexMono-Medium" : "IBMPlexMono-Regular", fixedSize: size)
    }
}

// MARK: - Shared pieces

/// Small uppercase mono label above a section ("YOUR NOTE", "7 ITEMS").
struct Eyebrow: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(.plexMono(11))
            .tracking(0.9)
            .foregroundStyle(Palette.mutedForeground)
    }
}

/// The app mark: three fanned cards, a swipe file, drawn in the current ink.
struct BrandMark: View {
    var size: CGFloat = 28

    var body: some View {
        RoundedRectangle(cornerRadius: Radius.md)
            .fill(Palette.primary)
            .frame(width: size, height: size)
            .overlay {
                ZStack {
                    ForEach(FannedCard.all.indices, id: \.self) { index in
                        FannedCard.all[index].fill(Palette.primaryForeground.opacity(FannedCard.all[index].opacity))
                    }
                }
                .frame(width: size * 4 / 7, height: size * 4 / 7)
            }
            .accessibilityHidden(true)
    }
}

/// One of the brand mark's cards in a 20×20 box, from the dashboard's SVG.
struct FannedCard: Shape {
    let x: CGFloat, y: CGFloat, degrees: CGFloat, cx: CGFloat, cy: CGFloat, opacity: Double

    static let all = [
        FannedCard(x: 3, y: 5, degrees: -12, cx: 7.5, cy: 11, opacity: 0.45),
        FannedCard(x: 5.5, y: 4, degrees: 0, cx: 0, cy: 0, opacity: 0.7),
        FannedCard(x: 8, y: 3, degrees: 10, cx: 12.5, cy: 9, opacity: 1),
    ]

    func path(in rect: CGRect) -> Path {
        let scale = rect.width / 20
        let turn = CGAffineTransform(translationX: cx, y: cy).rotated(by: degrees * .pi / 180).translatedBy(x: -cx, y: -cy)
        return Path(roundedRect: CGRect(x: x, y: y, width: 9, height: 12), cornerRadius: 1.5)
            .applying(turn)
            .applying(CGAffineTransform(scaleX: scale, y: scale))
            .applying(CGAffineTransform(translationX: rect.minX, y: rect.minY))
    }
}

/// Status pill: QUEUED, PROCESSING, FAILED.
struct StatusBadge: View {
    let status: String

    var body: some View {
        let tint: Color = switch status {
        case "processing": Palette.warning
        case "failed": Palette.critical
        default: Palette.mutedForeground
        }
        Text(status.uppercased())
            .font(.plexMono(10.5))
            .tracking(0.9)
            .foregroundStyle(tint)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .overlay(Capsule().strokeBorder(status == "queued" || status == "done" ? Palette.foreground.opacity(0.2) : tint.opacity(0.4)))
    }
}

/// A dashed box with an icon, for "nothing here" states.
struct EmptyState<Content: View>: View {
    let icon: String
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 18)).foregroundStyle(Palette.mutedForeground)
            Text(title).font(.plex(13, .medium))
            content.font(.plex(13)).foregroundStyle(Palette.mutedForeground).multilineTextAlignment(.center).frame(maxWidth: 380)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .padding(.horizontal, 24)
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }
}

extension EmptyState where Content == EmptyView {
    init(icon: String, title: String) {
        self.init(icon: icon, title: title) { EmptyView() }
    }
}

/// The destructive alert box the dashboard uses for errors.
struct ErrorBox: View {
    let title: String
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.circle").foregroundStyle(Palette.critical)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.plex(13, .medium)).foregroundStyle(Palette.critical)
                Text(message).font(.plex(13)).foregroundStyle(Palette.critical.opacity(0.9)).textSelection(.enabled)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg).strokeBorder(Palette.critical.opacity(0.35)))
    }
}

// MARK: - Buttons

enum ButtonKind { case primary, outline, ghost, destructive }

/// The dashboard's shadcn buttons: solid ink, outlined, ghost and destructive.
struct SwipeButtonStyle: ButtonStyle {
    var kind: ButtonKind = .outline
    var tall = false
    var fullWidth = false

    func makeBody(configuration: Configuration) -> some View {
        StyledButton(configuration: configuration, kind: kind, tall: tall, fullWidth: fullWidth)
    }

    private struct StyledButton: View {
        let configuration: Configuration
        let kind: ButtonKind
        let tall: Bool
        let fullWidth: Bool
        @Environment(\.isEnabled) private var enabled
        @State private var hovering = false

        var body: some View {
            configuration.label
                .font(.plex(13, .medium))
                .labelStyle(.titleAndIcon)
                .foregroundStyle(foreground)
                .padding(.horizontal, 12)
                .frame(height: tall ? 38 : 30)
                .frame(maxWidth: fullWidth ? .infinity : nil)
                .background(background, in: RoundedRectangle(cornerRadius: Radius.md))
                .overlay {
                    if kind == .outline { RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Palette.border) }
                }
                .opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.5)
                .contentShape(Rectangle())
                .onHover { hovering = $0 }
        }

        private var foreground: Color {
            switch kind {
            case .primary: Palette.primaryForeground
            case .destructive: .white
            case .outline, .ghost: Palette.foreground
            }
        }

        private var background: Color {
            switch kind {
            case .primary: hovering && enabled ? Palette.primary.opacity(0.9) : Palette.primary
            case .destructive: hovering && enabled ? Palette.critical.opacity(0.9) : Palette.critical
            case .outline: hovering && enabled ? Palette.accent : Palette.background
            case .ghost: hovering && enabled ? Palette.accent : .clear
            }
        }
    }
}

extension ButtonStyle where Self == SwipeButtonStyle {
    static func swipe(_ kind: ButtonKind = .outline, tall: Bool = false, fullWidth: Bool = false) -> SwipeButtonStyle {
        SwipeButtonStyle(kind: kind, tall: tall, fullWidth: fullWidth)
    }
}

/// A rounded filter pill; the active one is solid ink.
struct Chip<Label: View>: View {
    /// What VoiceOver says for the chip.
    let name: String
    let active: Bool
    let action: () -> Void
    @ViewBuilder var label: Label
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            label
                .font(.plex(12))
                .lineLimit(1)
                .foregroundStyle(active ? Palette.background : (hovering ? Palette.foreground : Palette.mutedForeground))
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .background(active ? Palette.foreground : .clear, in: Capsule())
                .overlay(Capsule().strokeBorder(active ? Palette.foreground : Palette.border))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
        .accessibilityAddTraits(active ? .isSelected : [])
        .onHover { hovering = $0 }
    }
}

/// The dashboard's text field: bordered, rounded, on the card color.
struct FieldChrome: ViewModifier {
    var height: CGFloat? = 36
    var focused = false

    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .font(.plex(13))
            .padding(.horizontal, 10)
            .frame(height: height)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(focused ? Palette.ring.opacity(0.6) : Palette.input, lineWidth: focused ? 2 : 1))
    }
}

extension View {
    func fieldChrome(height: CGFloat? = 36, focused: Bool = false) -> some View {
        modifier(FieldChrome(height: height, focused: focused))
    }
}

/// Lays children out left to right, wrapping onto new rows: tag pills.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = arrange(width: width, subviews: subviews)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        let used = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? used, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
        }
    }

    private struct Row { var indices: [Int] = []; var y: CGFloat = 0; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if !row.indices.isEmpty && row.width + spacing + size.width > width {
                rows.append(row)
                row = Row(y: row.y + row.height + spacing)
            }
            row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}
