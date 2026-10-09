import Foundation
import Observation
import os

/// Where the app's data lives: a local cache of raw documents, an outbox of
/// changes waiting to upload, and the sync status that says which is which.
///
/// The rules this exists to keep:
///
///  - **Reads never wait for the network.** The cache loads first, so a coach
///    in a dugout with no signal still has their roster, schedule and lineups.
///  - **Nothing unsynced is called saved.** Every change sits in the outbox
///    until the server accepts it, and the status says so.
///  - **Nobody's changes are silently overwritten.** Each write carries the
///    version it was based on; if another coach saved first, the write is
///    refused and the coach chooses.
@MainActor
@Observable
final class TeamStore {
    enum SyncState: Equatable {
        case idle
        case syncing
        /// Changes waiting to upload, with no known problem.
        case pending(Int)
        /// Not reachable. Changes wait on this device.
        case offline(pending: Int)
        /// Someone else changed something this device also changed.
        case conflict(Int)
        case failed(String)

        var label: String {
            switch self {
            case .idle: return "Synced"
            case .syncing: return "Syncing…"
            case .pending(let n): return n == 1 ? "1 change uploading" : "\(n) changes uploading"
            case .offline(let n):
                return n == 0 ? "Offline — showing saved data" : "Offline — \(n) \(n == 1 ? "change" : "changes") saved on this phone"
            case .conflict(let n): return n == 1 ? "1 change needs a decision" : "\(n) changes need a decision"
            case .failed(let message): return message
            }
        }
    }

    /// A change waiting to reach the server.
    struct OutboxItem: Codable, Identifiable, Equatable {
        enum Kind: String, Codable { case set, delete }
        var id: String { path }
        let path: String
        var kind: Kind
        var object: JSONObject?
        /// The server version this change was made against. Nil for a new document.
        var baseUpdateTime: String?
        var queuedAt: Date
        /// Set when the server refused because someone else saved first.
        var conflict: Bool = false
    }

    struct CachedDocument: Codable, Equatable {
        var object: JSONObject
        var updateTime: String?
    }

    /// Everything one account can see, keyed by full document path.
    private struct Snapshot: Codable {
        var documents: [String: CachedDocument] = [:]
        var outbox: [OutboxItem] = []
        var lastSync: Date?
    }

    // MARK: State

    private(set) var syncState: SyncState = .idle
    private(set) var lastSync: Date?
    private(set) var revision = 0
    var activeTeamId: String? {
        didSet { UserDefaults.standard.set(activeTeamId, forKey: "activeTeamId") }
    }

    private var snapshot = Snapshot()
    private let auth: AuthService
    private let config: AppConfig
    private let client: FirestoreClient
    private let log = Logger(subsystem: "app.inninggrid", category: "sync")
    private var flushing = false

    static let collections = ["players", "games", "formations", "goals", "flags", "memberships"]

    init(auth: AuthService, config: AppConfig = .current) {
        self.auth = auth
        self.config = config
        self.client = FirestoreClient(config: config) { [auth] in try await auth.idToken() }
        activeTeamId = UserDefaults.standard.string(forKey: "activeTeamId")
        loadFromDisk()
    }

    // MARK: Reading

    var outbox: [OutboxItem] { snapshot.outbox }
    var conflicts: [OutboxItem] { snapshot.outbox.filter(\.conflict) }

    func isPending(_ path: String) -> Bool { snapshot.outbox.contains { $0.path == path } }

    /// Raw team documents, with access fields intact (they are needed to save).
    var teamDocuments: [JSONObject] {
        snapshot.documents
            .filter { $0.key.hasPrefix("teams/") && $0.key.split(separator: "/").count == 2 }
            .map(\.value.object)
            .sorted { ($0["name"]?.stringValue ?? "") < ($1["name"]?.stringValue ?? "") }
    }

    var teams: [TeamView] {
        teamDocuments.compactMap { try? JSONValue.object($0).decode(TeamView.self) }
    }

    var activeTeam: TeamView? {
        teams.first { $0.id == activeTeamId } ?? teams.first
    }

    func teamDocument(_ teamId: String) -> JSONObject? {
        snapshot.documents["teams/\(teamId)"]?.object
    }

    /// The signed-in coach's role on a team.
    func role(on teamId: String) -> String {
        guard let uid = auth.session?.uid else { return "ASSISTANT" }
        return teamDocument(teamId)?["roles"]?[uid]?.stringValue ?? "ASSISTANT"
    }

    func isHeadCoach(_ teamId: String) -> Bool { role(on: teamId) == "HEAD_COACH" }

    /// Raw documents in one of a team's collections, unordered.
    func raw(_ collection: String, team teamId: String) -> [JSONValue] {
        let prefix = "teams/\(teamId)/\(collection)/"
        return snapshot.documents
            .filter { $0.key.hasPrefix(prefix) }
            .sorted { $0.key < $1.key } // document-id order, as Firestore lists them
            .map { .object($0.value.object) }
    }

    func rawGame(_ gameId: String, team teamId: String) -> JSONValue? {
        snapshot.documents["teams/\(teamId)/games/\(gameId)"].map { .object($0.object) }
    }

    func rawPlayer(_ playerId: String, team teamId: String) -> JSONValue? {
        snapshot.documents["teams/\(teamId)/players/\(playerId)"].map { .object($0.object) }
    }

    // MARK: Refreshing

    /// Pull everything this account can see. Safe to call any time: pending
    /// local changes are never replaced by what the server sends back.
    func refresh() async {
        guard let session = auth.session else { return }
        if case .syncing = syncState { return }
        syncState = .syncing

        do {
            if let email = session.email { try? await claimInvitations(email: email, uid: session.uid) }

            var found: [FirestoreDocument] = try await client.teams(where: "memberUids", arrayContains: session.uid)
            if let email = session.email?.lowercased() {
                let invited = (try? await client.teams(where: "assistantEmails", arrayContains: email)) ?? []
                for team in invited where !found.contains(where: { $0.path == team.path }) { found.append(team) }
            }

            var next: [String: CachedDocument] = [:]
            for team in found {
                next[team.path] = CachedDocument(object: team.object.objectValue ?? [:], updateTime: team.updateTime)
                for collection in Self.collections {
                    /* A collection the rules deny (an invite still being claimed)
                       is an empty collection, not a failed refresh. */
                    let documents = (try? await client.list("\(team.path)/\(collection)")) ?? []
                    for document in documents {
                        next[document.path] = CachedDocument(
                            object: document.object.objectValue ?? [:],
                            updateTime: document.updateTime
                        )
                    }
                }
            }

            /* Local changes win until they upload: the server copy only fills in
               what this device has not touched. */
            for item in snapshot.outbox {
                switch item.kind {
                case .set: if let object = item.object {
                    next[item.path] = CachedDocument(object: object, updateTime: next[item.path]?.updateTime)
                }
                case .delete: next.removeValue(forKey: item.path)
                }
            }

            snapshot.documents = next
            snapshot.lastSync = Date()
            lastSync = snapshot.lastSync
            if activeTeamId == nil || !teams.contains(where: { $0.id == activeTeamId }) {
                activeTeamId = teams.first?.id
            }
            changed()
            syncState = .idle
            await flush()
        } catch FirestoreClient.FirestoreError.offline {
            syncState = .offline(pending: snapshot.outbox.count)
        } catch FirestoreClient.FirestoreError.unauthenticated {
            syncState = .failed("Signed out — sign in to sync")
        } catch {
            log.error("refresh failed: \(error.localizedDescription, privacy: .public)")
            syncState = .failed(error.localizedDescription)
        }
    }

    /// The same claim the web makes: attach this account to teams it was
    /// invited to by email. Only ever adds this uid with the assistant role,
    /// which is all the rules allow an invited coach to write.
    private func claimInvitations(email: String, uid: String) async throws {
        let invited = try await client.teams(where: "assistantEmails", arrayContains: email.lowercased())
        for team in invited {
            let members = team.fields["memberUids"]?.arrayValue?.compactMap(\.stringValue) ?? []
            guard !members.contains(uid) else { continue }
            var roles = team.fields["roles"]?.objectValue ?? [:]
            roles[uid] = "ASSISTANT"
            try await client.update(team.path, fields: [
                "memberUids": .array((members + [uid]).map(JSONValue.string)),
                "roles": .object(roles),
            ], precondition: team.updateTime.map(FirestoreClient.Precondition.updatedAt) ?? .none)
        }
    }

    // MARK: Writing

    /// Save a whole document. Applied locally at once; uploaded when possible.
    func save(_ object: JSONValue, at path: String) {
        guard var fields = object.objectValue else { return }
        if fields["id"] == nil { fields["id"] = .string(String(path.split(separator: "/").last ?? "")) }
        let base = snapshot.documents[path]?.updateTime
        snapshot.documents[path] = CachedDocument(object: fields, updateTime: base)
        enqueue(OutboxItem(path: path, kind: .set, object: fields, baseUpdateTime: base, queuedAt: Date()))
    }

    func saveGame(_ game: JSONValue) {
        guard let teamId = game["teamId"]?.stringValue, let id = game["id"]?.stringValue else { return }
        save(game, at: "teams/\(teamId)/games/\(id)")
    }

    func savePlayer(_ player: JSONValue) {
        guard let teamId = player["teamId"]?.stringValue, let id = player["id"]?.stringValue else { return }
        save(player, at: "teams/\(teamId)/players/\(id)")
    }

    func delete(at path: String) {
        let base = snapshot.documents[path]?.updateTime
        snapshot.documents.removeValue(forKey: path)
        enqueue(OutboxItem(path: path, kind: .delete, object: nil, baseUpdateTime: base, queuedAt: Date()))
    }

    private func enqueue(_ item: OutboxItem) {
        /* Two edits to one document before it uploads become one write — the
           later object, against the *original* base version, so a conflict
           with another coach is still caught. */
        if let index = snapshot.outbox.firstIndex(where: { $0.path == item.path }) {
            var merged = item
            merged.baseUpdateTime = snapshot.outbox[index].baseUpdateTime
            snapshot.outbox[index] = merged
        } else {
            snapshot.outbox.append(item)
        }
        changed()
        syncState = .pending(snapshot.outbox.count)
        Task { await flush() }
    }

    /// Upload what is waiting, oldest first. Stops at the first sign of being
    /// offline, so a queue of fifty edits is not fifty timeouts.
    func flush() async {
        guard !flushing, auth.isSignedIn else { return }
        flushing = true
        defer { flushing = false }

        for item in snapshot.outbox where !item.conflict {
            do {
                let precondition: FirestoreClient.Precondition =
                    item.baseUpdateTime.map(FirestoreClient.Precondition.updatedAt) ?? .mustNotExist
                switch item.kind {
                case .set:
                    let time = try await client.set(item.path, item.object ?? [:], precondition: precondition)
                    if var cached = snapshot.documents[item.path] {
                        cached.updateTime = time
                        snapshot.documents[item.path] = cached
                    }
                    /*
                      An edit made while this one was uploading is still queued,
                      and it was based on the version this upload just replaced.
                      Rebase it on the new one — otherwise the server refuses it
                      as a conflict with the coach's own previous save.
                    */
                    for index in snapshot.outbox.indices
                    where snapshot.outbox[index].path == item.path && snapshot.outbox[index].queuedAt != item.queuedAt {
                        snapshot.outbox[index].baseUpdateTime = time
                    }
                case .delete:
                    try await client.delete(item.path, precondition: item.baseUpdateTime.map(FirestoreClient.Precondition.updatedAt) ?? .none)
                }
                snapshot.outbox.removeAll { $0.path == item.path && $0.queuedAt == item.queuedAt }
            } catch FirestoreClient.FirestoreError.offline {
                syncState = .offline(pending: snapshot.outbox.count)
                persist()
                return
            } catch FirestoreClient.FirestoreError.conflict {
                if let index = snapshot.outbox.firstIndex(where: { $0.path == item.path }) {
                    snapshot.outbox[index].conflict = true
                }
            } catch FirestoreClient.FirestoreError.notFound where item.kind == .delete {
                /* Already gone — the goal of the delete is met. */
                snapshot.outbox.removeAll { $0.path == item.path }
            } catch {
                log.error("upload failed for \(item.path, privacy: .public): \(error.localizedDescription, privacy: .public)")
                syncState = .failed(error.localizedDescription)
                persist()
                return
            }
        }

        let conflicts = snapshot.outbox.filter(\.conflict).count
        syncState = conflicts > 0 ? .conflict(conflicts)
            : snapshot.outbox.isEmpty ? .idle : .pending(snapshot.outbox.count)
        changed()
    }

    /// Resolve a conflict by keeping this device's version over the server's.
    func keepMine(_ path: String) async {
        guard let index = snapshot.outbox.firstIndex(where: { $0.path == path }) else { return }
        let remote = try? await client.get(path)
        snapshot.outbox[index].baseUpdateTime = remote?.updateTime
        snapshot.outbox[index].conflict = false
        changed()
        await flush()
    }

    /// Resolve a conflict by discarding this device's change.
    func takeTheirs(_ path: String) async {
        snapshot.outbox.removeAll { $0.path == path }
        if let remote = try? await client.get(path) {
            snapshot.documents[path] = CachedDocument(object: remote.object.objectValue ?? [:], updateTime: remote.updateTime)
        } else {
            snapshot.documents.removeValue(forKey: path)
        }
        changed()
        await flush()
    }

    // MARK: Persistence

    func signedOut() {
        snapshot = Snapshot()
        activeTeamId = nil
        if let url = cacheURL() { try? FileManager.default.removeItem(at: url) }
        changed()
    }

    private func changed() {
        revision &+= 1
        persist()
    }

    private func cacheURL() -> URL? {
        guard let uid = auth.session?.uid else { return nil }
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        /* One file per account, so signing in as an assistant on a shared
           phone never shows the head coach's cached roster. */
        return base.appendingPathComponent("\(config.environment.rawValue)-\(uid).json")
    }

    private func persist() {
        guard let url = cacheURL(), let data = try? JSONEncoder().encode(snapshot) else { return }
        /* Complete-until-first-auth: readable for a background sync, encrypted
           at rest while the phone is locked after a restart. */
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func loadFromDisk() {
        guard let url = cacheURL(),
              let data = try? Data(contentsOf: url),
              let stored = try? JSONDecoder().decode(Snapshot.self, from: data)
        else { return }
        snapshot = stored
        lastSync = stored.lastSync
        if !stored.outbox.isEmpty { syncState = .pending(stored.outbox.count) }
        revision &+= 1
    }
}
