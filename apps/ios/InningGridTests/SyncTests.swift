import XCTest
@testable import InningGrid

/// Offline game-day reliability, conflicts, and refused writes — without a server.
@MainActor
final class SyncTests: XCTestCase {
    private var store: TeamStore!
    private let path = "teams/t1/games/g1"
    private let game: JSONValue = ["id": "g1", "teamId": "t1", "opponent": "Cubs", "note": "first"]

    override func setUp() async throws {
        let config = AppConfig(environment: .emulator, projectId: "test", apiKey: "key",
                               webOrigin: URL(string: "https://example.test")!, emulatorHost: "127.0.0.1")
        let auth = AuthService(config: config)
        auth.useTestSession(AuthSession(uid: "sync-test-\(UUID().uuidString)", email: "coach@inninggrid.test",
                                        displayName: "Test", idToken: "token", refreshToken: "refresh",
                                        expiresAt: Date().addingTimeInterval(3600)))
        let client = FirestoreClient(config: config, protocolClasses: [StubURLProtocol.self]) { "token" }
        StubURLProtocol.requests = []
        StubURLProtocol.handler = { _ in .offline }
        store = TeamStore(auth: auth, config: config, client: client)
    }

    override func tearDown() async throws {
        store.signedOut()
    }

    /// Let the flush the save started finish, then run one more.
    private func settle() async throws {
        for _ in 0..<100 where store.isFlushing { try await Task.sleep(for: .milliseconds(20)) }
        await store.flush()
    }

    func testAnEditMadeOfflineIsKeptAndUploadsLater() async throws {
        store.saveGame(game)
        try await settle()
        XCTAssertEqual(store.syncState, .offline(pending: 1))
        XCTAssertEqual(store.outbox.count, 1)
        XCTAssertEqual(store.rawGame("g1", team: "t1")?["note"], .string("first"), "the coach still sees their edit")

        StubURLProtocol.handler = { _ in .json(200, ["writeResults": [["updateTime": "2026-10-09T12:00:00Z"]]]) }
        await store.flush()
        XCTAssertEqual(store.syncState, .idle)
        XCTAssertTrue(store.outbox.isEmpty)
    }

    func testANewDocumentMustNotAlreadyExist() async throws {
        StubURLProtocol.handler = { _ in .json(200, ["writeResults": [["updateTime": "t"]]]) }
        store.saveGame(game)
        try await settle()
        let commit = try XCTUnwrap(StubURLProtocol.requests.last(where: { $0.url?.absoluteString.hasSuffix(":commit") == true }))
        let body = try XCTUnwrap(Self.body(commit))
        let write = try XCTUnwrap((body["writes"] as? [[String: Any]])?.first)
        XCTAssertEqual((write["currentDocument"] as? [String: Any])?["exists"] as? Bool, false)
    }

    func testAnotherCoachsNewerEditIsAConflictNotAnOverwrite() async throws {
        StubURLProtocol.handler = { _ in .json(400, ["error": ["status": "FAILED_PRECONDITION", "message": "stale"]]) }
        store.saveGame(game)
        try await settle()
        XCTAssertEqual(store.syncState, .conflict(1))
        XCTAssertEqual(store.conflicts.first?.path, path)
    }

    func testARefusedEditIsPutBackAndDoesNotBlockTheQueue() async throws {
        let other: JSONValue = ["id": "g2", "teamId": "t1", "opponent": "Braves"]
        StubURLProtocol.handler = { request in
            let url = request.url!.absoluteString
            if request.httpMethod == "GET" {
                return .json(200, ["name": "projects/test/databases/(default)/documents/teams/t1/games/g1",
                                   "fields": ["id": ["stringValue": "g1"], "teamId": ["stringValue": "t1"],
                                              "opponent": ["stringValue": "Cubs"], "note": ["stringValue": "server"]],
                                   "updateTime": "2026-10-09T12:00:00Z"])
            }
            let body = Self.body(request)
            let name = ((body?["writes"] as? [[String: Any]])?.first?["update"] as? [String: Any])?["name"] as? String ?? ""
            if url.hasSuffix(":commit"), name.hasSuffix("/g1") {
                return .json(403, ["error": ["status": "PERMISSION_DENIED", "message": "no"]])
            }
            return .json(200, ["writeResults": [["updateTime": "t2"]]])
        }
        store.saveGame(game)
        store.saveGame(other)
        try await settle()

        XCTAssertTrue(store.outbox.isEmpty, "the refused write was dropped and the next one went up")
        XCTAssertNotNil(store.rejection)
        XCTAssertEqual(store.rawGame("g1", team: "t1")?["note"], .string("server"), "the screen shows what's really saved")
    }

    private static func body(_ request: URLRequest) -> [String: Any]? {
        var data = request.httpBody
        if data == nil, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 65_536)
            var collected = Data()
            while stream.hasBytesAvailable {
                let read = stream.read(&buffer, maxLength: buffer.count)
                if read <= 0 { break }
                collected.append(buffer, count: read)
            }
            stream.close()
            data = collected
        }
        return data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }
}
