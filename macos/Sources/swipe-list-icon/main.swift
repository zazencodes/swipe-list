// Renders the app icon, the dashboard's brand mark (three fanned cards on ink), into an .iconset folder.
import AppKit

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: swipe-list-icon <dir.iconset>\n".utf8))
    exit(2)
}
let folder = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

func render(_ pixels: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let context = NSGraphicsContext.current!.cgContext
    let s = CGFloat(pixels) / 1024
    // macOS icon grid: an 824 pt rounded square centred in 1024.
    let tile = CGRect(x: 100 * s, y: 100 * s, width: 824 * s, height: 824 * s)
    context.addPath(CGPath(roundedRect: tile, cornerWidth: 185 * s, cornerHeight: 185 * s, transform: nil))
    context.setFillColor(CGColor(srgbRed: 0x1A / 255, green: 0x1A / 255, blue: 0x19 / 255, alpha: 1))
    context.fillPath()
    // The mark's 20-unit box, 480 pt wide, centred; SVG y runs down, so flip it.
    let unit = 480 * s / 20
    let origin = CGPoint(x: 272 * s, y: 752 * s)
    func card(x: CGFloat, y: CGFloat, degrees: CGFloat, cx: CGFloat, cy: CGFloat, alpha: CGFloat) {
        var t = CGAffineTransform(translationX: origin.x, y: origin.y).scaledBy(x: unit, y: -unit)
        t = t.translatedBy(x: cx, y: cy).rotated(by: degrees * .pi / 180).translatedBy(x: -cx, y: -cy)
        let path = CGPath(roundedRect: CGRect(x: x, y: y, width: 9, height: 12), cornerWidth: 1.5, cornerHeight: 1.5, transform: &t)
        context.addPath(path)
        context.setFillColor(CGColor(srgbRed: 0xF6 / 255, green: 0xF6 / 255, blue: 0xF3 / 255, alpha: alpha))
        context.fillPath()
    }
    card(x: 3, y: 5, degrees: -12, cx: 7.5, cy: 11, alpha: 0.45)
    card(x: 5.5, y: 4, degrees: 0, cx: 0, cy: 0, alpha: 0.7)
    card(x: 8, y: 3, degrees: 10, cx: 12.5, cy: 9, alpha: 1)
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
    try render(size).write(to: folder.appendingPathComponent("icon_\(size)x\(size).png"))
    try render(size * 2).write(to: folder.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
