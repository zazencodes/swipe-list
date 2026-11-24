import Foundation

/// "3 minutes ago", "yesterday", "Oct 12", the way the dashboard says when something was saved.
public func timeAgo(_ date: Date, now: Date = Date()) -> String {
    let seconds = date.timeIntervalSince(now)
    let magnitude = abs(seconds)
    if magnitude < 60 { return "just now" }
    let relative = RelativeDateTimeFormatter()
    relative.locale = Locale(identifier: "en")
    relative.dateTimeStyle = .named
    if magnitude < 3600 { return relative.localizedString(from: DateComponents(minute: Int((seconds / 60).rounded()))) }
    if magnitude < 86400 { return relative.localizedString(from: DateComponents(hour: Int((seconds / 3600).rounded()))) }
    if magnitude < 7 * 86400 { return relative.localizedString(from: DateComponents(day: Int((seconds / 86400).rounded()))) }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en")
    formatter.setLocalizedDateFormatFromTemplate(magnitude > 300 * 86400 ? "MMM d y" : "MMM d")
    return formatter.string(from: date)
}
