import Foundation

/// `seasonSummary` from the core: everything Home and Season draw, computed by
/// the same functions the website uses so the two can never disagree.
struct SeasonSummaryView: Decodable, Sendable {
    struct Standings: Decodable, Sendable, Hashable {
        let owed: Int, onTarget: Int, ahead: Int, unplayed: Int
        enum CodingKeys: String, CodingKey {
            case owed = "OWED", onTarget = "ON_TARGET", ahead = "AHEAD", unplayed
        }
        var total: Int { owed + onTarget + ahead }
    }

    struct Alert: Decodable, Sendable, Hashable, Identifiable {
        let id: String
        let playerId: String
        let kind: String
        let message: String
        let magnitude: Double
        let priorityKind: String
    }

    struct Fairness: Decodable, Sendable {
        let averageDefensiveInnings: Double
        let averageBenchInnings: Double
        let averageInfieldInnings: Double
        let averageOutfieldInnings: Double
        /// 0…1 against what each player was actually there for.
        let balanceScore: Double
        let alerts: [Alert]
    }

    struct Outlook: Decodable, Sendable {
        struct Worst: Decodable, Sendable { let playerId: String; let debt: Double }
        let gamesRemaining: Int
        let worst: Worst?
        let atRisk: [String]
        let headline: String
    }

    struct Usage: Decodable, Sendable {
        let games: Int
        let defensiveInnings: Int
        let benchInnings: Int
        let availableInnings: Int
        let byGroup: [String: Int]
        let byPositionCode: [String: Int]
        let uniquePositionCodes: Int
        let pitchingInnings: Int
        let catchingInnings: Int

        func innings(_ group: PositionGroup) -> Int { byGroup[group.rawValue] ?? 0 }
    }

    struct Debt: Decodable, Sendable {
        let expectedDefensiveInnings: Double
        let actualDefensiveInnings: Double
        let defensiveDebt: Double
        let infieldDebt: Double
    }

    struct PositionCode: Decodable, Sendable, Hashable, Identifiable {
        let code: String
        let displayName: String
        let group: PositionGroup
        var id: String { code }
    }

    struct GameLine: Decodable, Sendable, Hashable, Identifiable {
        let gameId: String
        let date: String
        let opponent: String
        let innings: Int
        let benchInnings: Int
        let gameInnings: Int
        var id: String { gameId }
    }

    let usage: [String: Usage]
    let debts: [String: Debt]
    let standings: Standings
    /// playerId → OWED | ON_TARGET | AHEAD.
    let standingByPlayer: [String: String]
    let fairness: Fairness
    let outlook: Outlook
    let positionCodes: [PositionCode]
    let positionsByPlayer: [String: [String: Int]]
    let gameLog: [String: [GameLine]]
}

enum Standing: String, Sendable {
    case owed = "OWED", onTarget = "ON_TARGET", ahead = "AHEAD"

    var label: String {
        switch self {
        case .owed: return "Owed"
        case .onTarget: return "On target"
        case .ahead: return "Ahead"
        }
    }
}
