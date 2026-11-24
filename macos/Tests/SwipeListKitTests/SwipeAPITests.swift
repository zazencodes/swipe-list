import Foundation
import Testing
@testable import SwipeListKit

/// Answers every request from the test's handler, so no test ever reaches a real server.
final class StubProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest, Data?) -> (Int, Data))?
    nonisolated(unsafe) static var requests: [(URLRequest, Data?)] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let body = request.httpBody ?? request.httpBodyStream.map(Self.read)
        StubProtocol.requests.append((request, body))
        let (status, data) = StubProtocol.handler!(request, body)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

func stubbedAPI(_ handler: @escaping (URLRequest, Data?) -> (Int, Data)) throws -> SwipeAPI {
    StubProtocol.handler = handler
    StubProtocol.requests = []
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubProtocol.self]
    let credential = try Credential(server: "https://swipe.example.test", token: "swl_test")
    return SwipeAPI(credential: credential, session: URLSession(configuration: config))
}

let detailJSON = """
{"id":6,"kind":"link","url":"https://x.com/a/status/1","site":"x.com","note":"the chart","status":"done",
"title":"Tests visualised","description":"A dashboard","tags":["video","ui"],"author":"@a","extracted_text":"text",
"attempts":1,"last_error":null,"claimed_by":null,"claim_expires_at":null,"created_by":"agent:mac-worker",
"created_at":"2026-11-09T17:15:38.639Z","updated_at":"2026-11-09T17:16:33.977Z","processed_at":"2026-11-09T17:16:33.977Z",
"assets":[
 {"id":8,"role":"video","content_type":"video/mp4","size_bytes":1125706,"source_url":null,"caption":"clip","position":0,
  "created_at":"2026-11-09T17:16:33.977Z","url":"https://bucket.example.test/v.mp4?sig=1"},
 {"id":9,"role":"thumbnail","content_type":"image/jpeg","size_bytes":47610,"source_url":null,"caption":"poster","position":1,
  "created_at":"2026-11-09T17:16:33.977Z","url":"https://bucket.example.test/t.jpg?sig=1"}]}
"""

// Tests share the stub's static state, so they run one at a time.
@Suite(.serialized) struct SwipeAPITests {
    @Test func decodesAnItemAndPairsTheVideoWithItsPoster() async throws {
        let api = try stubbedAPI { _, _ in (200, Data(detailJSON.utf8)) }
        let item = try await api.item(6)
        #expect(item.extractedText == "text")
        #expect(item.assets.map(\.role) == [.video, .thumbnail])
        #expect(item.shownAssets.map(\.id) == [8])
        #expect(item.poster(for: item.assets[0])?.id == 9)
        #expect(Calendar(identifier: .gregorian).component(.year, from: item.createdAt) == 2026)
        let request = StubProtocol.requests[0].0
        #expect(request.url?.absoluteString == "https://swipe.example.test/api/items/6")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer swl_test")
    }

    @Test func sendsOnlyTheFiltersThatAreSet() async throws {
        let api = try stubbedAPI { _, _ in (200, Data(#"{"items":[],"total":0}"#.utf8)) }
        _ = try await api.items(ItemFilter(q: "glass edges", status: .done, tag: nil, media: .video, limit: 48, offset: 0))
        let url = try #require(StubProtocol.requests[0].0.url)
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(query.map(\.name) == ["q", "status", "media", "limit", "offset"])
        #expect(query.first?.value == "glass edges")
    }

    @Test func encodesAPlusSoTheServerDoesNotReadASpace() async throws {
        let api = try stubbedAPI { _, _ in (200, Data(#"{"items":[],"total":0}"#.utf8)) }
        _ = try await api.items(ItemFilter(q: "C++ a+b"))
        #expect(StubProtocol.requests[0].0.url?.query == "q=C%2B%2B%20a%2Bb")
    }

    @Test func stripsQuotesAndLineBreaksFromUploadFileNames() {
        let file = UploadFile(name: "a\"b\r\nContent-Type: text/html\n.png", contentType: "image/png", data: Data())
        let text = String(decoding: MultipartForm(files: [file], note: "", boundary: "B").body, as: UTF8.self)
        #expect(text.contains("filename=\"abContent-Type: text/html.png\"\r\n"))
        #expect(text.components(separatedBy: "\r\n").filter { $0.hasPrefix("Content-Type:") } == ["Content-Type: image/png"])
    }

    @Test func addsALinkWithItsNote() async throws {
        let api = try stubbedAPI { _, _ in (201, Data(#"{"id":42,"kind":"link","status":"queued"}"#.utf8)) }
        let created = try await api.addLink(url: "https://linear.app", note: "the hero")
        #expect(created.id == 42)
        let (request, body) = StubProtocol.requests[0]
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/api/items")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        let sent = try JSONSerialization.jsonObject(with: try #require(body)) as! [String: String]
        #expect(sent == ["url": "https://linear.app", "note": "the hero"])
    }

    @Test func reportsTheExistingItemForADuplicateLink() async throws {
        let body = #"{"error":{"code":"conflict","message":"this link is already saved as item 7","details":{"item_id":7}}}"#
        let api = try stubbedAPI { _, _ in (409, Data(body.utf8)) }
        do {
            _ = try await api.addLink(url: "https://linear.app", note: "")
            Issue.record("expected a conflict")
        } catch let error as APIError {
            #expect(error.status == 409)
            #expect(error.existingItemID == 7)
            #expect(error.errorDescription == "this link is already saved as item 7")
        }
    }

    @Test func readsValidationProblems() {
        let body = #"{"error":{"code":"bad_request","message":"request did not match the expected shape","details":[{"path":"url","message":"Invalid URL"}]}}"#
        let error = APIError.from(status: 400, body: Data(body.utf8))
        #expect(error.problems == ["url: Invalid URL"])
        #expect(error.errorDescription == "request did not match the expected shape: url: Invalid URL")
    }

    @Test func uploadsImagesAsMultipartWithTheNote() async throws {
        let api = try stubbedAPI { _, _ in (201, Data(#"{"id":43}"#.utf8)) }
        let file = UploadFile(name: "shot.png", contentType: "image/png", data: Data([0x89, 0x50]))
        _ = try await api.upload(files: [file, file], note: "the grid")
        let (request, body) = StubProtocol.requests[0]
        let contentType = try #require(request.value(forHTTPHeaderField: "Content-Type"))
        #expect(contentType.hasPrefix("multipart/form-data; boundary="))
        let text = String(decoding: try #require(body), as: UTF8.self)
        #expect(text.components(separatedBy: "name=\"file\"; filename=\"shot.png\"").count == 3)
        #expect(text.contains("name=\"note\"\r\n\r\nthe grid\r\n"))
        #expect(text.hasSuffix("--\r\n"))
    }

    @Test func retriesAndDeletesByID() async throws {
        let api = try stubbedAPI { request, _ in request.httpMethod == "DELETE" ? (204, Data()) : (200, Data("{}".utf8)) }
        try await api.retry(5)
        try await api.delete(5)
        #expect(StubProtocol.requests.map { "\($0.0.httpMethod!) \($0.0.url!.path)" } == ["POST /api/items/5/retry", "DELETE /api/items/5"])
    }
}

@Suite struct CredentialTests {
    @Test func keepsOnlyTheServerOrigin() throws {
        let credential = try Credential(server: " https://swipe-api.example.com/api/ ", token: " swl_abc\n")
        #expect(credential.server.absoluteString == "https://swipe-api.example.com")
        #expect(credential.token == "swl_abc")
    }

    @Test func refusesPlainHTTPExceptOnThisMac() throws {
        #expect(throws: APIError.self) { try Credential(server: "http://swipe-api.example.com", token: "swl_abc") }
        #expect(try Credential(server: "http://localhost:9022", token: "swl_abc").server.absoluteString == "http://localhost:9022")
    }

    @Test func refusesATokenThatIsNotACredential() {
        #expect(throws: APIError.self) { try Credential(server: "https://swipe-api.example.com", token: "eyJhbGciOi") }
    }
}

@Suite struct TimeAgoTests {
    @Test func readsLikeTheDashboard() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(timeAgo(now.addingTimeInterval(-20), now: now) == "just now")
        #expect(timeAgo(now.addingTimeInterval(-180), now: now) == "3 minutes ago")
        #expect(timeAgo(now.addingTimeInterval(-86400), now: now) == "yesterday")
    }
}

@Suite struct SwipeCLIConfigTests {
    @Test func resolvesTheCLIPathFromHomeLikeNode() {
        #expect(SwipeCLIConfig.path(environment: ["HOME": "/tmp/somebody"]).path == "/tmp/somebody/.config/swipe/config.json")
        #expect(SwipeCLIConfig.path(environment: ["HOME": ""]).path == NSHomeDirectoryForUser(NSUserName())! + "/.config/swipe/config.json")
        #expect(SwipeCLIConfig.path(environment: [:]).path.hasSuffix("/.config/swipe/config.json"))
    }

    @Test func readsTheCLIConnection() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("config.json")
        try Data(#"{"url": "https://swipe-api.example.com", "token": "swl_fromcli"}"#.utf8).write(to: file)
        let credential = try SwipeCLIConfig.load(from: file)
        #expect(credential.server.absoluteString == "https://swipe-api.example.com")
        #expect(credential.token == "swl_fromcli")
        #expect(throws: APIError.self) { try SwipeCLIConfig.load(from: dir.appendingPathComponent("missing.json")) }
        try Data(#"{"url": "http://swipe-api.example.com", "token": "swl_x"}"#.utf8).write(to: file)
        #expect(throws: APIError.self) { try SwipeCLIConfig.load(from: file) }
    }
}
