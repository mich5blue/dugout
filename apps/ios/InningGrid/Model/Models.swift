import Foundation

/*
  Read-only views over the raw documents.

  These are for drawing screens. Nothing is ever saved *from* one of them — a
  save sends the raw document back, changed only by the shared core — so a
  field missing here is a display gap, never data loss. Every property the web
  might omit is optional, because `ignoreUndefinedProperties` means an absent
  field is simply not there.
*/

enum PositionGroup: String, Codable, Sendable, CaseIterable {
    case battery = "BATTERY", infield = "INFIELD", outfield = "OUTFIELD", bench = "BENCH"
}

enum AbilityTier: String, Codable, Sendable, CaseIterable {
    case developing = "DEVELOPING", regular = "REGULAR", core = "CORE"

    var label: String {
        switch self {
        case .developing: return "Developing"
        case .regular: return "Regular"
        case .core: return "Core"
        }
    }
}

enum Eligibility: String, Codable, Sendable, CaseIterable {
    case preferred = "PREFERRED", allowed = "ALLOWED", avoid = "AVOID", never = "NEVER"

    var label: String {
        switch self {
        case .preferred: return "Preferred"
        case .allowed: return "Allowed"
        case .avoid: return "Avoid"
        case .never: return "Never"
        }
    }
}

struct Position: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let code: String
    let displayName: String
    let group: PositionGroup
    let role: String?
    let sortOrder: Int
    let diagramX: Double?
    let diagramY: Double?

    var isPitcher: Bool { role == "PITCHER" }
    var isCatcher: Bool { role == "CATCHER" }
}

struct Formation: Codable, Sendable, Hashable {
    let id: String
    let name: String
    let positions: [Position]
}

struct TeamView: Decodable, Sendable, Identifiable, Hashable {
    let id: String
    let name: String
    let sport: String
    let seasonName: String?
    let division: String?
    let defaultInnings: Int?
    let defaultFormationId: String?
}

struct PositionRating: Decodable, Sendable, Hashable {
    let positionId: String
    let eligibility: Eligibility
    let abilityTier: AbilityTier?
}

struct PlayerView: Decodable, Sendable, Identifiable, Hashable {
    let id: String
    let teamId: String
    let firstName: String
    let lastInitial: String?
    let jerseyNumber: String?
    let active: Bool
    let overallTier: AbilityTier
    let offensiveTier: AbilityTier
    let positionRatings: [String: PositionRating]
    let canPitch: Bool
    let canCatch: Bool
    let preferredPitcher: Bool?
    let preferredCatcher: Bool?
    let maxPitchingInnings: Int?
    let maxCatchingInnings: Int?

    func eligibility(at positionId: String) -> Eligibility {
        positionRatings[positionId]?.eligibility ?? .allowed
    }
}

struct GamePlayerView: Decodable, Sendable, Hashable {
    let playerId: String
    let available: Bool
    let arrivalInning: Int?
    let departureInning: Int?
}

enum GameStatus: String, Decodable, Sendable {
    case planned = "PLANNED", inProgress = "IN_PROGRESS", completed = "COMPLETED"
}

struct LiveStateView: Decodable, Sendable, Hashable {
    let inning: Int
    let batterIndex: Int
}

struct GameView: Decodable, Sendable, Identifiable, Hashable {
    let id: String
    let teamId: String
    let opponent: String
    let date: String
    let plannedInnings: Int
    let actualInnings: Int?
    let status: GameStatus
    let attendanceConfirmedAt: String?
    let note: String?
    let gamePlayers: [GamePlayerView]
    let formationSnapshot: Formation
    let liveState: LiveStateView?
    private let defensiveAssignments: [Assignment]

    private struct Assignment: Decodable, Sendable, Hashable { let assignmentType: String }

    var hasLineup: Bool { !defensiveAssignments.isEmpty }
    var opponentLabel: String { opponent.isEmpty ? "TBD" : opponent }
    var availableCount: Int { gamePlayers.filter(\.available).count }

    /// The game date as a calendar day, parsed at noon so no timezone can move it.
    var day: Date? {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.date(from: "\(date) 12:00")
    }
}

// MARK: - What the core returns

struct SlotView: Decodable, Sendable, Hashable {
    enum State: String, Decodable, Sendable { case field = "FIELD", rest = "REST", out = "OUT" }
    let state: State
    let positionId: String?
    let code: String?
    let group: PositionGroup?
    let locked: Bool?
}

struct CellView: Decodable, Sendable, Hashable {
    let playerId: String
    let locked: Bool
    let assignmentType: String
}

struct NamesView: Decodable, Sendable, Hashable {
    let short: String
    let full: String
    let plain: String
}

struct BattingEntry: Decodable, Sendable, Hashable, Identifiable {
    let playerId: String
    let slot: Int
    let locked: Bool
    var id: String { playerId }
}

/// `lineupView` from the core: a lineup, flattened for drawing.
struct LineupView: Decodable, Sendable, Hashable {
    let positions: [Position]
    let innings: [Int]
    let playerIds: [String]
    let cells: [String: [String: CellView]]
    let byPlayer: [String: [String: SlotView]]
    let bench: [String: [String]]
    let defensiveInnings: [String: Int]
    let benchInnings: [String: Int]
    let battingOrder: [BattingEntry]
    let names: [String: NamesView]
    let hasLineup: Bool
    let pitchingPlan: [String: String]

    func slot(_ playerId: String, _ inning: Int) -> SlotView? { byPlayer[playerId]?[String(inning)] }
    func cell(_ inning: Int, _ positionId: String) -> CellView? { cells[String(inning)]?[positionId] }
    func benchAt(_ inning: Int) -> [String] { bench[String(inning)] ?? [] }
    func short(_ playerId: String) -> String { names[playerId]?.short ?? "?" }
}

struct QualityCheck: Decodable, Sendable, Hashable { let ok: Bool; let label: String }
struct QualityMetric: Decodable, Sendable, Hashable {
    let key: String; let label: String; let value: Double; let rating: String; let detail: String?
}
struct Quality: Decodable, Sendable, Hashable {
    let metrics: [QualityMetric]; let checks: [QualityCheck]; let score: Double
}
struct Explanation: Decodable, Sendable, Hashable { let playerId: String?; let text: String }
struct Conflict: Decodable, Sendable, Hashable { let severity: String; let code: String; let message: String }
struct Relaxation: Decodable, Sendable, Hashable {
    let message: String
    let impact: Double
    let action: JSONValue?
}

struct GenerationResult: Decodable, Sendable {
    let ok: Bool
    let quality: Quality
    let explanations: [Explanation]
    let conflicts: [Conflict]
    let relaxations: [Relaxation]
    let elapsedMs: Double
}

struct NextActionView: Decodable, Sendable, Hashable {
    let kind: String
    let label: String
    let href: String
    let hint: String?
}

struct AttendanceCount: Decodable, Sendable, Hashable {
    let expected: Int; let absent: Int; let limited: Int; let total: Int
}
