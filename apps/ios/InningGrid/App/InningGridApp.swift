import SwiftUI

@main
struct InningGridApp: App {
    var body: some Scene {
        WindowGroup {
            EngineSmokeTest()
        }
    }
}

/// Temporary: proves the shared engine runs on-device before any UI depends on it.
struct EngineSmokeTest: View {
    @State private var lines: [String] = ["Starting engine…"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(lines, id: \.self) { Text($0).font(.system(.footnote, design: .monospaced)) }
            }
            .padding()
        }
        .task { await run() }
    }

    private func run() async {
        let core = CoreEngine.shared
        lines = ["core \(core.bundleHash) loaded"]
        do {
            let settings = try await core.run("defaultTeamSettings")
            lines.append("sync call ok: philosophy=\(settings["philosophy"]?.stringValue ?? "?")")
            let formationId = try core.call("defaultFormationId", ["BASEBALL"])
            let formation = try core.call("systemFormation", [formationId])
            let team: JSONValue = [
                "id": "t1", "name": "Smoke", "sport": "BASEBALL", "seasonName": "S", "division": "",
                "defaultInnings": 6, "defaultFormationId": formationId, "settings": settings,
                "createdAt": "2026-01-01T00:00:00.000Z",
            ]
            let names = ["Brody", "Race", "Weston", "Calvin", "Emerson", "Solomon",
                         "Finnegan", "Vasil", "Mehki", "Ashur", "Walter"]
            var players: [JSONValue] = []
            for (i, name) in names.enumerated() {
                let p = try core.call("createPlayer", [[
                    "teamId": "t1", "firstName": .string(name),
                    "canPitch": .bool(i % 3 == 0 || i == 1), "canCatch": .bool(i % 4 == 1),
                ]])
                players.append(p)
            }
            let game = try core.call("createGame", [[
                "teamId": "t1", "opponent": "Smoke", "date": "2026-05-01", "plannedInnings": 6,
                "formation": formation, "settings": settings, "players": .array(players), "seed": 7,
            ]])
            lines.append("built \(players.count) players and a game; generating…")
            let started = Date()
            let out = try await core.run("generate", [[
                "team": team, "game": game, "players": .array(players), "history": .array([game]), "seed": 7,
            ]])
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            let ok = out["result"]?["ok"]?.boolValue ?? false
            let cells = out["result"]?["defensive"]?.arrayValue?.count ?? 0
            let score = out["result"]?["quality"]?["score"]?.numberValue ?? 0
            lines.append("generate: ok=\(ok) cells=\(cells) score=\(String(format: "%.4f", score)) in \(ms)ms")
            let view = try core.call("lineupView", [out["game"]!, .array(players)])
            lines.append("lineupView: innings=\(view["innings"]?.arrayValue?.count ?? 0) hasLineup=\(view["hasLineup"]?.boolValue ?? false)")
            for text in (out["result"]?["explanations"]?.arrayValue ?? []).prefix(3) {
                lines.append("• " + (text["text"]?.stringValue ?? ""))
            }
        } catch {
            lines.append("ERROR: \(error.localizedDescription)")
        }
    }
}
