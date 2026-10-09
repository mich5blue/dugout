import SwiftUI

struct PlayerProfileView: View {
    let playerId: String
    @Environment(Workspace.self) private var workspace

    var body: some View {
        if let player = workspace.player(playerId) {
            content(player)
        } else {
            EmptyCard(icon: "person.fill.questionmark", title: "Player not found",
                      message: "They may have been removed from the roster.")
                .padding()
                .screenBackground()
        }
    }

    private func content(_ player: PlayerView) -> some View {
        let season = workspace.season
        let usage = season?.usage[playerId]
        let standing = season?.standingByPlayer[playerId].flatMap(Standing.init)
        let editsIdentity = workspace.can("player:editIdentity")
        let editsEligibility = workspace.canEditPlayer("positionRatings")

        return ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 14) {
                    PlayerAvatar(player: player, size: 64, ring: player.overallTier == .core ? Theme.lime : nil)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(workspace.fullName(playerId)).font(.display(34)).foregroundStyle(Theme.ink)
                        HStack(spacing: 6) {
                            StandingTag(standing: standing)
                            if !player.active { Tag(text: "Inactive", color: Theme.inkMuted) }
                        }
                    }
                }

                if let usage {
                    HStack(spacing: 0) {
                        StatTile(value: "\(usage.defensiveInnings)", label: "Field innings")
                        StatTile(value: "\(usage.benchInnings)", label: "Bench", color: Theme.inkMuted)
                        StatTile(value: "\(usage.innings(.infield))", label: "Infield", color: Theme.infield)
                        StatTile(value: "\(usage.innings(.outfield))", label: "Outfield", color: Theme.outfield)
                    }
                    .card()
                    if let debt = season?.debts[playerId], usage.games > 0 {
                        Text(debtLine(debt))
                            .font(.subheadline).foregroundStyle(Theme.inkMuted)
                    }
                }

                if let formation = workspace.prepared?.formation {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionHeader("Where they can play") {
                            if editsEligibility, !player.positionRatings.isEmpty {
                                Button("Can play anywhere") {
                                    workspace.updatePlayer(playerId, ["positionRatings": .object([:])])
                                    Haptics.tap()
                                }
                                .font(.footnote.weight(.semibold))
                            }
                        }
                        Text(editsEligibility ? "Tap a position: Preferred → Allowed → Avoid → Never." : "Set by your head coach.")
                            .font(.footnote).foregroundStyle(Theme.inkMuted)
                        FieldDiagram(positions: formation.positions) { position in
                            EligibilityMarker(position: position, player: player, playedInnings: season?.positionsByPlayer[playerId]?[position.code]) {
                                guard editsEligibility, !blocked(position, player) else { return }
                                workspace.cycleEligibility(playerId, positionId: position.id)
                                Haptics.tap()
                            }
                        }
                        .frame(maxWidth: 520)
                        .frame(maxWidth: .infinity)
                        legend
                    }
                    .card()
                }

                battery(player)

                abilities(player)

                if let log = season?.gameLog[playerId], !log.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionHeader("Game by game")
                        ForEach(log) { line in
                            HStack {
                                Text("vs \(line.opponent)").font(.subheadline).foregroundStyle(Theme.ink)
                                Spacer()
                                Text("\(line.innings)/\(line.gameInnings) inn").font(.subheadline.monospacedDigit())
                                    .foregroundStyle(line.benchInnings > 0 ? Theme.inkMuted : Theme.emerald)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .card()
                }

                if editsIdentity {
                    Button(player.active ? "Mark inactive" : "Mark active") {
                        workspace.updatePlayer(playerId, ["active": .bool(!player.active)])
                    }
                    .buttonStyle(.secondary)
                    Text("Inactive players leave the lineup but keep their season history.")
                        .font(.footnote).foregroundStyle(Theme.inkFaint)
                }
            }
            .padding(Theme.gutter)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .screenBackground()
        .navigationBarTitleDisplayMode(.inline)
    }

    private func debtLine(_ debt: SeasonSummaryView.Debt) -> String {
        let gap = debt.defensiveDebt
        if abs(gap) < 1 { return "Right on target for the games they've been at." }
        let innings = Int(abs(gap).rounded())
        return gap > 0
            ? "Owed about \(innings) field inning\(innings == 1 ? "" : "s") — the next lineup will make it up."
            : "About \(innings) inning\(innings == 1 ? "" : "s") ahead of an even share."
    }

    private func blocked(_ position: Position, _ player: PlayerView) -> Bool {
        (position.isPitcher && !player.canPitch) || (position.isCatcher && !player.canCatch)
    }

    private var legend: some View {
        HStack(spacing: 12) {
            ForEach(Eligibility.allCases, id: \.self) { eligibility in
                HStack(spacing: 4) {
                    Circle().fill(EligibilityMarker.color(eligibility)).frame(width: 8, height: 8)
                    Text(eligibility.label).font(.caption).foregroundStyle(Theme.inkMuted)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func battery(_ player: PlayerView) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionHeader("Pitching & catching")
            toggle("Can pitch", "canPitch", player.canPitch)
            if player.canPitch {
                toggle("Preferred pitcher", "preferredPitcher", player.preferredPitcher ?? false).padding(.leading, 12)
            }
            toggle("Can catch", "canCatch", player.canCatch)
            if player.canCatch {
                toggle("Preferred catcher", "preferredCatcher", player.preferredCatcher ?? false).padding(.leading, 12)
            }
        }
        .tint(Theme.lime)
        .card()
    }

    /// A player toggle, disabled when this coach's role can't change that field.
    private func toggle(_ title: String, _ field: String, _ value: Bool) -> some View {
        Toggle(title, isOn: binding(value) { workspace.updatePlayer(playerId, [field: .bool($0)]) })
            .disabled(!workspace.canEditPlayer(field))
    }

    private func abilities(_ player: PlayerView) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Ability")
            Text("Defense").font(.subheadline.weight(.semibold))
            Picker("Defense", selection: binding(player.overallTier) {
                workspace.updatePlayer(playerId, ["overallTier": .string($0.rawValue)])
            }) {
                ForEach(AbilityTier.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .disabled(!workspace.canEditPlayer("overallTier"))
            Text("Hitting").font(.subheadline.weight(.semibold))
            Picker("Hitting", selection: binding(player.offensiveTier) {
                workspace.updatePlayer(playerId, ["offensiveTier": .string($0.rawValue)])
            }) {
                ForEach(AbilityTier.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .disabled(!workspace.canEditPlayer("offensiveTier"))
            Label("For your eyes only. Never printed or shared.", systemImage: "eye.slash")
                .font(.footnote).foregroundStyle(Theme.inkFaint)
        }
        .card()
    }

    private func binding<T>(_ value: T, _ set: @escaping (T) -> Void) -> Binding<T> {
        Binding(get: { value }, set: { set($0); Haptics.tap() })
    }
}

/// One position on the profile field: its code, coloured by eligibility.
struct EligibilityMarker: View {
    let position: Position
    let player: PlayerView
    let playedInnings: Int?
    let action: () -> Void

    static func color(_ eligibility: Eligibility) -> Color {
        switch eligibility {
        case .preferred: return Theme.lime
        case .allowed: return Theme.emerald
        case .avoid: return Theme.amber
        case .never: return Theme.danger
        }
    }

    private var blocked: Bool {
        (position.isPitcher && !player.canPitch) || (position.isCatcher && !player.canCatch)
    }

    private var eligibility: Eligibility { blocked ? .never : player.eligibility(at: position.id) }

    var body: some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Text(position.code).font(.display(17))
                if let playedInnings, playedInnings > 0 {
                    Text("\(playedInnings)").font(.system(size: 10, weight: .bold).monospacedDigit()).opacity(0.8)
                }
            }
            .foregroundStyle(eligibility == .preferred ? Theme.onLime : Theme.ink)
            .frame(width: 48, height: 48)
            .background(Self.color(eligibility).opacity(eligibility == .preferred ? 1 : 0.28), in: Circle())
            .overlay(Circle().strokeBorder(Self.color(eligibility), lineWidth: 2))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(position.displayName): \(blocked ? "not eligible, turn on can \(position.isPitcher ? "pitch" : "catch") first" : eligibility.label)")
        .accessibilityHint("Double tap to change")
    }
}
