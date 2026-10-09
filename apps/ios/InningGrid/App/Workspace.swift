import Foundation
import Observation
import os

/// The active team, as the screens need it — prepared by the shared core.
///
/// Every list a screen draws and every argument the engine is given comes from
/// `prepareTeam`, the same function the website uses, so roster order and the
/// lineups that depend on it match exactly. Recomputed only when the store's
/// revision moves, not on every redraw.
@MainActor
@Observable
final class Workspace {
    let store: TeamStore
    let auth: AuthService
    let core = CoreEngine.shared
    private let log = Logger(subsystem: "app.inninggrid", category: "workspace")

    init(store: TeamStore, auth: AuthService) {
        self.store = store
        self.auth = auth
    }

    // MARK: Prepared team

    struct Prepared {
        let teamId: String
        /// The team with access fields stripped, as the engine expects.
        let team: JSONValue
        let players: [JSONValue]
        let games: [JSONValue]
        let goals: [JSONValue]
        let flags: [JSONValue]
        /// The team's own formations; system ones live in the core.
        let formations: [JSONValue]
        /// The team's default formation, resolved by the core.
        let formation: Formation?
        /// HEAD_COACH or ASSISTANT, and what that role may do — from the core's table.
        let role: String
        let permissions: Set<String>
        let playerViews: [PlayerView]
        let gameViews: [GameView]
        let names: [String: NamesView]
        /// Season order, from the core — the order the website's schedule uses.
        let ordered: [GameView]
        let upcoming: [GameView]
        let awaitingResults: [GameView]
    }

    /* Written from inside getters that views read while drawing, so they must
       not be observed: the store's revision is what views actually track. */
    @ObservationIgnored private var preparedCache: (key: String, value: Prepared)?
    @ObservationIgnored private var seasonCache: (key: String, value: SeasonSummaryView)?

    /// Changes when the data does, the team does, or the day does.
    private var cacheKey: String? {
        guard let teamId = store.activeTeam?.id else { return nil }
        return "\(teamId)#\(store.revision)#\(Self.todayISO)"
    }

    var prepared: Prepared? {
        guard let key = cacheKey, let teamId = store.activeTeam?.id,
              let teamDocument = store.teamDocument(teamId) else { return nil }
        if let cached = preparedCache, cached.key == key { return cached.value }

        do {
            let result = try core.call("prepareTeam", [
                .object(teamDocument),
                .array(store.raw("players", team: teamId)),
                .array(store.raw("games", team: teamId)),
            ])
            let players = result["players"]?.arrayValue ?? []
            let games = result["games"]?.arrayValue ?? []
            let names = try core.call("playerNames", [.array(players)])
            let gameViews = games.compactMap { try? $0.decode(GameView.self) }
            func views(_ function: String, _ arguments: [JSONValue]) -> [GameView] {
                let ids = (try? core.call(function, arguments).arrayValue?.compactMap(\.stringValue)) ?? []
                return ids.compactMap { id in gameViews.first { $0.id == id } }
            }
            let today = JSONValue.string(Self.todayISO)
            let role = store.role(on: teamId)
            let permissions = (try? core.call("permissions", [.string(role)]).arrayValue?.compactMap(\.stringValue)) ?? []
            let formations = store.raw("formations", team: teamId)
            let formation = try? core.call("teamFormation", [result["team"] ?? .null, .array(formations)]).decode(Formation.self)
            let value = Prepared(
                teamId: teamId,
                team: result["team"] ?? .null,
                players: players,
                games: games,
                goals: store.raw("goals", team: teamId),
                flags: store.raw("flags", team: teamId),
                formations: formations,
                formation: formation,
                role: role,
                permissions: Set(permissions),
                playerViews: players.compactMap { try? $0.decode(PlayerView.self) },
                gameViews: gameViews,
                names: (try? names.decode([String: NamesView].self)) ?? [:],
                ordered: views("orderedGames", [.array(games)]),
                upcoming: views("upcomingGames", [.array(games), today]),
                awaitingResults: views("awaitingResults", [.array(games), today])
            )
            preparedCache = (key, value)
            return value
        } catch {
            log.error("prepareTeam failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    var season: SeasonSummaryView? {
        guard let key = cacheKey, let prepared else { return nil }
        if let cached = seasonCache, cached.key == key { return cached.value }
        do {
            let value = try core.call("seasonSummary", [.array(prepared.games), .array(prepared.players)])
                .decode(SeasonSummaryView.self)
            seasonCache = (key, value)
            return value
        } catch {
            log.error("seasonSummary failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    // MARK: Convenience

    var activePlayers: [PlayerView] { prepared?.playerViews.filter(\.active) ?? [] }

    func player(_ id: String) -> PlayerView? { prepared?.playerViews.first { $0.id == id } }
    func game(_ id: String) -> GameView? { prepared?.gameViews.first { $0.id == id } }
    func rawGame(_ id: String) -> JSONValue? { prepared?.games.first { $0["id"]?.stringValue == id } }
    func rawPlayer(_ id: String) -> JSONValue? { prepared?.players.first { $0["id"]?.stringValue == id } }

    func name(_ playerId: String) -> String { prepared?.names[playerId]?.short ?? "Player" }
    func fullName(_ playerId: String) -> String { prepared?.names[playerId]?.full ?? "Player" }

    /// What the signed-in coach may do on this team, e.g. `can("game:edit")`.
    ///
    /// For deciding what to show. The Firestore rules decide what is allowed.
    func can(_ permission: String) -> Bool { prepared?.permissions.contains(permission) ?? false }

    var role: String { prepared?.role ?? "ASSISTANT" }
    var canEdit: Bool { can("game:edit") }

    static var todayISO: String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    var orderedGames: [GameView] { prepared?.ordered ?? [] }
    var upcoming: [GameView] { prepared?.upcoming ?? [] }
    var awaitingResults: [GameView] { prepared?.awaitingResults ?? [] }

    func lineup(for gameId: String) -> LineupView? {
        guard let raw = rawGame(gameId), let prepared else { return nil }
        return try? core.call("lineupView", [raw, .array(prepared.players)]).decode(LineupView.self)
    }

    func nextAction(for gameId: String) -> NextActionView? {
        guard let raw = rawGame(gameId) else { return nil }
        return try? core.call("nextAction", [raw, .string(Self.todayISO)]).decode(NextActionView.self)
    }

    func attendance(for gameId: String) -> AttendanceCount? {
        guard let raw = rawGame(gameId) else { return nil }
        return try? core.call("attendance", [raw]).decode(AttendanceCount.self)
    }

    // MARK: Changing a game through the core

    /// Apply a core mutation to a game and queue it for upload.
    ///
    /// The one way a game changes on iOS: the raw document goes in, the core's
    /// own function changes it — the same function the website runs — and the
    /// whole document goes back out. Nothing here edits a field by hand.
    @discardableResult
    func mutateGame(_ gameId: String, _ function: String, _ arguments: [JSONValue] = []) -> Bool {
        guard let raw = rawGame(gameId) else { return false }
        do {
            let next = try core.call(function, [raw] + arguments)
            store.saveGame(next)
            return true
        } catch {
            log.error("\(function, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            return false
        }
    }

    // MARK: Creating and editing through the core

    /// A new game, made by the same function as the website's New Game page.
    func newGame(opponent: String, date: String, innings: Int?) throws -> String {
        guard let prepared else { throw CoreEngine.CoreError.badResult("newGame") }
        var options: JSONObject = [
            "opponent": .string(opponent),
            "date": .string(date),
            "seed": .number(Double(Int(Date().timeIntervalSince1970 * 1000) % 100_000)),
        ]
        if let innings { options["plannedInnings"] = .number(Double(innings)) }
        let game = try core.call("newGame", [prepared.team, .array(prepared.players), .array(prepared.formations), .object(options)])
        store.saveGame(game)
        return game["id"]?.stringValue ?? ""
    }

    func newPlayer(firstName: String, lastInitial: String, jerseyNumber: String) throws {
        guard let prepared else { throw CoreEngine.CoreError.badResult("newPlayer") }
        let player = try core.call("createPlayer", [[
            "teamId": .string(prepared.teamId),
            "firstName": .string(firstName),
            "lastInitial": .string(lastInitial),
            "jerseyNumber": .string(jerseyNumber),
        ]])
        store.savePlayer(player)
    }

    /// Change a player, filtered through the coach's role by the core.
    func updatePlayer(_ playerId: String, _ changes: JSONObject) {
        guard let raw = rawPlayer(playerId) else { return }
        if let next = try? core.call("updatePlayer", [raw, .string(role), .object(changes)]) {
            store.savePlayer(next)
        }
    }

    func cycleEligibility(_ playerId: String, positionId: String) {
        guard let raw = rawPlayer(playerId) else { return }
        if let next = try? core.call("cycleEligibility", [raw, .string(role), .string(positionId)]) {
            store.savePlayer(next)
        }
    }

    /// Replace a game with a whole new document the core produced.
    func replaceGame(_ game: JSONValue) { store.saveGame(game) }

    /// Generate a lineup. Runs the engine off the main thread.
    func generate(gameId: String, game override: JSONValue? = nil, seed: Int? = nil, frozenInnings: Int = 0) async throws -> GenerationResult {
        guard let prepared, let raw = override ?? rawGame(gameId) else {
            throw CoreEngine.CoreError.badResult("generate")
        }
        var options: JSONObject = [
            "team": prepared.team,
            "game": raw,
            "players": .array(prepared.players),
            "history": .array(prepared.games),
            "goals": .array(prepared.goals),
            "flags": .array(prepared.flags),
            "frozenInnings": .number(Double(frozenInnings)),
        ]
        if let seed { options["seed"] = .number(Double(seed)) }

        let output = try await core.run("generate", [.object(options)])
        let result = try (output["result"] ?? .null).decode(GenerationResult.self)
        log.info("generated with core \(self.core.bundleHash, privacy: .public): ok=\(result.ok) in \(Int(result.elapsedMs))ms")
        if result.ok, let game = output["game"] { store.saveGame(game) }
        return result
    }
}
