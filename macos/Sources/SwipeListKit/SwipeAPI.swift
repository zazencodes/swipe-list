import Foundation

/// A failure from the API (`{"error": {code, message, details}}`) or from reaching it.
public struct APIError: Error, LocalizedError, Sendable {
    /// The HTTP status, or nil when the server could not be reached or answered something unreadable.
    public let status: Int?
    public let code: String
    public let message: String
    /// Validation problems: `details.problems` on a 422, `[{path, message}]` on a 400.
    public let problems: [String]
    /// The existing item's id when a link is already saved (409 with `details.item_id`).
    public let existingItemID: Int?

    public var errorDescription: String? {
        problems.isEmpty ? message : "\(message): \(problems.joined(separator: "; "))"
    }

    public init(status: Int?, code: String, message: String, problems: [String] = [], existingItemID: Int? = nil) {
        self.status = status
        self.code = code
        self.message = message
        self.problems = problems
        self.existingItemID = existingItemID
    }

    /// Reads an error response body.
    static func from(status: Int, body: Data) -> APIError {
        guard let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let error = object["error"] as? [String: Any]
        else {
            return APIError(status: status, code: "http_error", message: "The server answered \(status).")
        }
        let details = error["details"]
        var problems: [String] = []
        if let dict = details as? [String: Any], let list = dict["problems"] as? [Any] {
            problems = list.map { "\($0)" }
        } else if let list = details as? [[String: Any]] {
            problems = list.map { entry in
                let message = entry["message"].map { "\($0)" } ?? ""
                if let path = entry["path"] as? String, !path.isEmpty { return "\(path): \(message)" }
                return message
            }
        }
        let existing = (details as? [String: Any])?["item_id"] as? Int
        return APIError(
            status: status,
            code: error["code"] as? String ?? "http_error",
            message: error["message"] as? String ?? "The server answered \(status).",
            problems: problems,
            existingItemID: existing
        )
    }
}

/// Library filters; `GET /items` drops the ones left nil.
public struct ItemFilter: Hashable, Sendable {
    public var q: String?
    public var status: ItemStatus?
    public var tag: String?
    public var media: AssetRole?
    public var limit: Int?
    public var offset: Int?

    public init(q: String? = nil, status: ItemStatus? = nil, tag: String? = nil, media: AssetRole? = nil, limit: Int? = nil, offset: Int? = nil) {
        self.q = q
        self.status = status
        self.tag = tag
        self.media = media
        self.limit = limit
        self.offset = offset
    }

    var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        func add(_ name: String, _ value: String?) {
            if let value, !value.isEmpty { items.append(URLQueryItem(name: name, value: value)) }
        }
        add("q", q)
        add("status", status?.rawValue)
        add("tag", tag)
        add("media", media?.rawValue)
        add("limit", limit.map(String.init))
        add("offset", offset.map(String.init))
        return items
    }
}

/// An image to upload as a new item.
public struct UploadFile: Sendable, Equatable {
    public let name: String
    public let contentType: String
    public let data: Data

    public init(name: String, contentType: String, data: Data) {
        self.name = name
        self.contentType = contentType
        self.data = data
    }

    /// The image types the server accepts for uploads, by file extension.
    public static let typesByExtension: [String: String] = [
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif",
    ]
    public static let maxFiles = 10
    public static let maxBytes = 25 * 1024 * 1024
}

/// The server URL and the credential that signs every request.
public struct Credential: Codable, Equatable, Sendable {
    public let server: URL
    public let token: String

    public static let tokenPrefix = "swl_"

    /// Checks the pair before it is used: an `swl_` token, and HTTPS unless the server is this Mac.
    public init(server text: String, token rawToken: String) throws {
        let token = rawToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard token.hasPrefix(Credential.tokenPrefix) else {
            throw APIError(status: nil, code: "bad_credential", message: "Credentials start with \(Credential.tokenPrefix).")
        }
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(), let host = url.host, !host.isEmpty
        else {
            throw APIError(status: nil, code: "bad_server", message: "Enter the server URL, e.g. https://swipe-api.example.com.")
        }
        let local = host == "localhost" || host == "127.0.0.1"
        guard scheme == "https" || (scheme == "http" && local) else {
            throw APIError(status: nil, code: "bad_server", message: "The server must use HTTPS.")
        }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = url.port
        self.server = components.url!
        self.token = token
    }
}

/// The Swipe List HTTP API (`/api/...`), authenticated with a credential.
public struct SwipeAPI: Sendable {
    public let credential: Credential
    let session: URLSession

    public init(credential: Credential, session: URLSession = .shared) {
        self.credential = credential
        self.session = session
    }

    public static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let date = parseDate(text) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "not an ISO 8601 date: \(text)"))
        }
        return decoder
    }()

    static func parseDate(_ text: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: text) { return date }
        return ISO8601DateFormatter().date(from: text)
    }

    // MARK: Library

    public func me() async throws -> Actor {
        struct Me: Decodable { let actor: Actor }
        return try await send("GET", "/me", as: Me.self).actor
    }

    public func items(_ filter: ItemFilter) async throws -> ItemPage {
        try await send("GET", "/items", query: filter.queryItems, as: ItemPage.self)
    }

    public func item(_ id: Int) async throws -> ItemDetail {
        try await send("GET", "/items/\(id)", as: ItemDetail.self)
    }

    public func tags() async throws -> [TagCount] {
        struct Tags: Decodable { let tags: [TagCount] }
        return try await send("GET", "/tags", as: Tags.self).tags
    }

    // MARK: Writes. Each create queues an item for the worker.

    public func addLink(url: String, note: String) async throws -> CreatedItem {
        let body = try JSONSerialization.data(withJSONObject: ["url": url, "note": note])
        return try await send("POST", "/items", body: body, contentType: "application/json", as: CreatedItem.self)
    }

    public func upload(files: [UploadFile], note: String) async throws -> CreatedItem {
        let form = MultipartForm(files: files, note: note)
        return try await send("POST", "/items/upload", body: form.body, contentType: form.contentType, as: CreatedItem.self)
    }

    public func retry(_ id: Int) async throws {
        _ = try await raw("POST", "/items/\(id)/retry")
    }

    public func delete(_ id: Int) async throws {
        _ = try await raw("DELETE", "/items/\(id)")
    }

    // MARK: Transport

    func request(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil, contentType: String? = nil) -> URLRequest {
        var components = URLComponents(url: credential.server, resolvingAgainstBaseURL: false)!
        components.path = "/api" + path
        components.queryItems = query.isEmpty ? nil : query
        // URLComponents leaves "+" literal, and the server reads a literal "+" as a space ("C++" would search "C  ").
        components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        request.httpBody = body
        return request
    }

    private func raw(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil, contentType: String? = nil) async throws -> Data {
        let request = request(method, path, query: query, body: body, contentType: contentType)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            throw APIError(status: nil, code: "unreachable", message: "Cannot reach \(credential.server.host ?? "the server"): \(error.localizedDescription)")
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: nil, code: "bad_response", message: "The server's answer was not HTTP.")
        }
        guard (200..<300).contains(http.statusCode) else { throw APIError.from(status: http.statusCode, body: data) }
        return data
    }

    private func send<T: Decodable>(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil, contentType: String? = nil, as type: T.Type) async throws -> T {
        let data = try await raw(method, path, query: query, body: body, contentType: contentType)
        do {
            return try SwipeAPI.decoder.decode(T.self, from: data)
        } catch {
            throw APIError(status: nil, code: "bad_response", message: "Could not read the server's answer to \(method) \(path): \(error)")
        }
    }
}

/// A `multipart/form-data` body with one `file` part per image and an optional `note`.
struct MultipartForm {
    let boundary: String
    let body: Data

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    init(files: [UploadFile], note: String, boundary: String = "SwipeList-\(UUID().uuidString)") {
        self.boundary = boundary
        var body = Data()
        func append(_ text: String) { body.append(Data(text.utf8)) }
        for file in files {
            // A quote or a line break in the name would end the quoted filename or the header.
            let name = file.name.filter { $0 != "\"" && $0 != "\r" && $0 != "\n" && $0 != "\r\n" }
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\n")
            append("Content-Type: \(file.contentType)\r\n\r\n")
            body.append(file.data)
            append("\r\n")
        }
        if !note.isEmpty {
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"note\"\r\n\r\n")
            append(note)
            append("\r\n")
        }
        append("--\(boundary)--\r\n")
        self.body = body
    }
}
