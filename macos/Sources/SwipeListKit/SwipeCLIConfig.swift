import Foundation

/// The `swipe` CLI's saved connection (`swipe login`), read so the app can be connected without handling the token.
/// The app only reads this file; it never writes or deletes it.
public enum SwipeCLIConfig {
    /// `path.join(os.homedir(), ".config", "swipe", "config.json")`, as the CLI resolves it:
    /// Node's `os.homedir()` is `$HOME` when set and non-empty, otherwise the account's home directory.
    public static func path(environment: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        let home = environment["HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? NSHomeDirectoryForUser(NSUserName()) ?? NSHomeDirectory()
        return URL(fileURLWithPath: home, isDirectory: true)
            .appendingPathComponent(".config", isDirectory: true)
            .appendingPathComponent("swipe", isDirectory: true)
            .appendingPathComponent("config.json")
    }

    /// The CLI's `{url, token}`, checked like a pasted credential.
    public static func load(from url: URL = path()) throws -> Credential {
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw APIError(status: nil, code: "no_cli_config", message: "The swipe CLI is not logged in on this Mac (\(url.path) is missing). Run `swipe login --url <server>` or paste a credential.")
        }
        struct File: Decodable { let url: String; let token: String }
        let file: File
        do {
            file = try JSONDecoder().decode(File.self, from: data)
        } catch {
            throw APIError(status: nil, code: "bad_cli_config", message: "\(url.path) is not a swipe CLI config with a url and a token.")
        }
        return try Credential(server: file.url, token: file.token)
    }
}
