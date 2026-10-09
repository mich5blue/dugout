import Foundation

/// Firestore over its REST API, authenticated as the signed-in coach.
///
/// Every request carries the coach's Firebase ID token, so `firestore.rules` —
/// the same rules the website is held to — decide what this app may read and
/// write. Changing a team id in a request gets a 403, not somebody else's
/// roster.
actor FirestoreClient {
    enum Precondition: Sendable {
        case none
        /// The document must still be at this version. Fails if anyone saved it since.
        case updatedAt(String)
        /// The document must not exist yet.
        case mustNotExist
    }

    enum FirestoreError: LocalizedError, Equatable {
        case offline
        case unauthenticated
        case permissionDenied
        case notFound
        /// Someone else changed the document after this device last saw it.
        case conflict
        case server(Int, String)

        var errorDescription: String? {
            switch self {
            case .offline: return "No connection. Your change is saved on this device and will upload when you're back online."
            case .unauthenticated: return "You've been signed out. Sign in again to keep syncing."
            case .permissionDenied: return "Your account can't make that change on this team."
            case .notFound: return "That item no longer exists."
            case .conflict: return "Another coach changed this while you were editing."
            case .server(let code, let message): return "The server returned \(code): \(message)"
            }
        }
    }

    private let config: AppConfig
    private let token: @Sendable () async throws -> String
    private let session: URLSession

    init(config: AppConfig, token: @escaping @Sendable () async throws -> String) {
        self.config = config
        self.token = token
        let configuration = URLSessionConfiguration.default
        /* A field with one bar fails slowly; a coach waiting thirty seconds for
           a spinner is worse than being told it's offline and carrying on. */
        configuration.timeoutIntervalForRequest = 15
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    // MARK: Reads

    func get(_ path: String) async throws -> FirestoreDocument {
        let json = try await request("GET", url: config.firestoreBase.appendingPathComponent(path))
        guard let document = FirestoreDocument(rest: json, databasePath: config.databasePath) else {
            throw FirestoreError.server(200, "unreadable document")
        }
        return document
    }

    /// Every document in a collection, following pagination.
    func list(_ collectionPath: String) async throws -> [FirestoreDocument] {
        var documents: [FirestoreDocument] = []
        var pageToken: String?
        repeat {
            var components = URLComponents(
                url: config.firestoreBase.appendingPathComponent(collectionPath),
                resolvingAgainstBaseURL: false
            )!
            components.queryItems = [URLQueryItem(name: "pageSize", value: "300")]
                + (pageToken.map { [URLQueryItem(name: "pageToken", value: $0)] } ?? [])
            let json = try await request("GET", url: components.url!)
            for raw in (json["documents"] as? [[String: Any]]) ?? [] {
                if let document = FirestoreDocument(rest: raw, databasePath: config.databasePath) {
                    documents.append(document)
                }
            }
            pageToken = json["nextPageToken"] as? String
        } while pageToken != nil
        return documents
    }

    /// Top-level `teams` where an array field contains a value — the two
    /// queries the web uses to find a coach's teams.
    func teams(where field: String, arrayContains value: String) async throws -> [FirestoreDocument] {
        let body: [String: Any] = [
            "structuredQuery": [
                "from": [["collectionId": "teams"]],
                "where": [
                    "fieldFilter": [
                        "field": ["fieldPath": field],
                        "op": "ARRAY_CONTAINS",
                        "value": ["stringValue": value],
                    ],
                ],
            ],
        ]
        let url = URL(string: "\(config.firestoreRoot.absoluteString)/documents:runQuery")!
        let rows = try await requestArray("POST", url: url, body: body)
        return rows.compactMap { row in
            (row["document"] as? [String: Any])
                .flatMap { FirestoreDocument(rest: $0, databasePath: config.databasePath) }
        }
    }

    // MARK: Writes

    /// Replace a whole document, as the web's `setDoc` does.
    ///
    /// Returns the new `updateTime`, which becomes the precondition for the
    /// next save from this device.
    @discardableResult
    func set(_ path: String, _ object: JSONObject, precondition: Precondition) async throws -> String {
        var fields = object
        /* The id is the document's name; the web stores it in the fields too,
           so it is kept — dropping it would make iOS-saved documents differ. */
        if fields["id"] == nil { fields["id"] = .string(String(path.split(separator: "/").last ?? "")) }
        var write: [String: Any] = [
            "update": ["name": fullName(path), "fields": FirestoreCodec.encode(fields)],
        ]
        if let current = currentDocument(precondition) { write["currentDocument"] = current }
        return try await commit([write])
    }

    /// Change only some fields, as the web's `updateDoc` does.
    @discardableResult
    func update(_ path: String, fields: JSONObject, precondition: Precondition) async throws -> String {
        var write: [String: Any] = [
            "update": ["name": fullName(path), "fields": FirestoreCodec.encode(fields)],
            "updateMask": ["fieldPaths": fields.keys.map(Self.quotePath)],
        ]
        if let current = currentDocument(precondition) { write["currentDocument"] = current }
        return try await commit([write])
    }

    func delete(_ path: String, precondition: Precondition = .none) async throws {
        var write: [String: Any] = ["delete": fullName(path)]
        if let current = currentDocument(precondition) { write["currentDocument"] = current }
        _ = try await commit([write])
    }

    // MARK: Plumbing

    private func commit(_ writes: [[String: Any]]) async throws -> String {
        let url = URL(string: "\(config.firestoreRoot.absoluteString)/documents:commit")!
        let json = try await request("POST", url: url, body: ["writes": writes])
        let results = (json["writeResults"] as? [[String: Any]]) ?? []
        return (results.first?["updateTime"] as? String) ?? (json["commitTime"] as? String) ?? ""
    }

    private func fullName(_ path: String) -> String { "\(config.databasePath)/documents/\(path)" }

    private func currentDocument(_ precondition: Precondition) -> [String: Any]? {
        switch precondition {
        case .none: return nil
        case .updatedAt(let time): return ["updateTime": time]
        case .mustNotExist: return ["exists": false]
        }
    }

    /// Field paths with characters outside [A-Za-z0-9_] must be backquoted —
    /// a role map keyed by uid (`roles.abc-123`) would otherwise be rejected.
    static func quotePath(_ path: String) -> String {
        path.split(separator: ".").map { segment -> String in
            let plain = segment.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" }
                && !(segment.first?.isNumber ?? true)
            return plain ? String(segment) : "`\(segment.replacingOccurrences(of: "`", with: "\\`"))`"
        }.joined(separator: ".")
    }

    private func request(_ method: String, url: URL, body: [String: Any]? = nil) async throws -> [String: Any] {
        let data = try await send(method, url: url, body: body)
        if data.isEmpty { return [:] }
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private func requestArray(_ method: String, url: URL, body: [String: Any]) async throws -> [[String: Any]] {
        let data = try await send(method, url: url, body: body)
        return (try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
    }

    private func send(_ method: String, url: URL, body: [String: Any]?) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where Self.isOffline(error) {
            throw FirestoreError.offline
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw Self.error(status: status, data: data) }
        return data
    }

    private static func isOffline(_ error: URLError) -> Bool {
        [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost,
         .cannotConnectToHost, .dataNotAllowed, .internationalRoamingOff]
            .contains(error.code)
    }

    private static func error(status: Int, data: Data) -> FirestoreError {
        let payload = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? [String: Any]
        let reason = payload?["status"] as? String ?? ""
        let message = payload?["message"] as? String ?? HTTPURLResponse.localizedString(forStatusCode: status)
        switch (status, reason) {
        case (401, _): return .unauthenticated
        case (403, _): return .permissionDenied
        case (404, _): return .notFound
        /* A failed precondition is how a stale write shows up — someone saved
           the document after this device last read it. */
        case (_, "FAILED_PRECONDITION"), (_, "ABORTED"), (409, _): return .conflict
        default: return .server(status, message)
        }
    }
}
