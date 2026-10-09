import SwiftUI

/// Build a lineup: who's here → pitching → how to coach → review → generate.
///
/// Every tap is saved as it happens, through the core's own builder functions,
/// so a coach interrupted between attendance and generating comes back to the
/// attendance they marked — on this phone or on the website.
struct BuildLineupView: View {
    let gameId: String
    @Environment(Workspace.self) private var workspace
    @Environment(Navigator.self) private var navigator
    @State private var step: Step = .players
    @State private var generating = false
    @State private var failure: GenerationResult?
    @State private var error: String?

    enum Step: Int, CaseIterable, Identifiable {
        case players, pitching, style, review
        var id: Int { rawValue }
        var title: String {
            switch self {
            case .players: return "Players"
            case .pitching: return "Pitching"
            case .style: return "Game style"
            case .review: return "Review"
            }
        }
    }

    var body: some View {
        if let game = workspace.game(gameId) {
            if game.status == .completed {
                EmptyCard(icon: "flag.checkered", title: "This game is final",
                          message: "Correct what actually happened from the game screen instead.")
                    .padding().screenBackground()
            } else if workspace.can("game:edit") {
                content(game)
            } else {
                EmptyCard(icon: "lock", title: "Head coach only",
                          message: "Assistant coaches can see the lineup once it's built.")
                    .padding().screenBackground()
            }
        } else {
            EmptyCard(icon: "calendar.badge.exclamationmark", title: "Game not found", message: "It may have been deleted.")
                .padding().screenBackground()
        }
    }

    private func content(_ game: GameView) -> some View {
        VStack(spacing: 0) {
            StepBar(current: step) { target in
                withAnimation(.snappy) { step = target }
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.vertical, 10)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    switch step {
                    case .players: PlayersStep(gameId: gameId, game: game)
                    case .pitching: PitchingStep(gameId: gameId, game: game)
                    case .style: StyleStep(gameId: gameId, game: game)
                    case .review: ReviewStep(gameId: gameId, game: game, failure: failure, onApply: apply)
                    }
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline).foregroundStyle(Theme.danger)
                    }
                }
                .padding(Theme.gutter)
                .padding(.bottom, 90)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .screenBackground()
        .safeAreaInset(edge: .bottom) { footer(game) }
        .toolbar(.hidden, for: .tabBar)
        .navigationTitle("vs \(game.opponentLabel)")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            /* Land on the first thing not done yet. */
            if game.attendanceConfirmedAt != nil, step == .players, !game.hasLineup { step = .pitching }
            #if DEBUG
            let defaults = UserDefaults.standard
            if let raw = defaults.object(forKey: "uiTestStep") as? Int ?? Int(defaults.string(forKey: "uiTestStep") ?? ""),
               let target = Step(rawValue: raw) { step = target }
            if defaults.bool(forKey: "uiTestGenerate") { Task { await generate() } }
            #endif
        }
    }

    private func footer(_ game: GameView) -> some View {
        let attendance = workspace.attendance(for: gameId)
        let nobody = (attendance?.expected ?? 0) == 0

        return HStack(spacing: 12) {
            if step != .players {
                Button {
                    withAnimation(.snappy) { step = Step(rawValue: step.rawValue - 1) ?? .players }
                } label: {
                    Image(systemName: "chevron.left").font(.headline)
                }
                .buttonStyle(.secondary)
                .frame(width: 64)
                .accessibilityLabel("Back")
            }

            switch step {
            case .players:
                Button(nobody ? "Nobody is here" : "Looks right — \(attendance?.expected ?? 0) playing") {
                    workspace.mutateGame(gameId, "confirmAttendance", [.string(Workspace.nowISO)])
                    Haptics.tap()
                    withAnimation(.snappy) { step = .pitching }
                }
                .buttonStyle(.primary)
                .disabled(nobody)
            case .pitching, .style:
                Button("Continue") {
                    withAnimation(.snappy) { step = Step(rawValue: step.rawValue + 1) ?? .review }
                }
                .buttonStyle(.primary)
            case .review:
                Button {
                    Task { await generate() }
                } label: {
                    if generating {
                        HStack(spacing: 10) { ProgressView().tint(Theme.onLime); Text("Building…") }
                    } else {
                        Label("Generate lineup", systemImage: "sparkles")
                    }
                }
                .buttonStyle(.primary)
                .disabled(generating || nobody)
            }
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
    }

    private func generate() async {
        generating = true
        error = nil
        defer { generating = false }
        do {
            let result = try await workspace.generate(gameId: gameId)
            if result.ok {
                failure = nil
                Haptics.success()
                navigator.replaceTop(with: .game(gameId))
            } else {
                failure = result
                Haptics.warning()
            }
        } catch {
            self.error = "The lineup engine stopped: \(error.localizedDescription)"
        }
    }

    /// One of the engine's suggested fixes, applied to this game, then try again.
    private func apply(_ relaxation: Relaxation) {
        guard let raw = workspace.rawGame(gameId), let prepared = workspace.prepared,
              let action = relaxation.action else { return }
        let next = try? workspace.core.call("applyRelaxation", [
            raw, prepared.team, .array(prepared.formations), .object(["action": action]),
        ])
        guard let next, next != .null else { return }
        workspace.replaceGame(next)
        Haptics.tap()
        Task { await generate() }
    }
}

// MARK: - Step bar

struct StepBar: View {
    let current: BuildLineupView.Step
    var onSelect: (BuildLineupView.Step) -> Void

    var body: some View {
        HStack(spacing: 6) {
            ForEach(BuildLineupView.Step.allCases) { step in
                Button { onSelect(step) } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Capsule()
                            .fill(step.rawValue <= current.rawValue ? Theme.lime : Theme.strokeStrong)
                            .frame(height: 4)
                        Text(step.title)
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(step == current ? Theme.ink : Theme.inkFaint)
                            .lineLimit(1)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Step \(step.rawValue + 1) of 4: \(step.title)")
                .accessibilityAddTraits(step == current ? .isSelected : [])
            }
        }
    }
}

// MARK: - Players

struct PlayersStep: View {
    let gameId: String
    let game: GameView
    @Environment(Workspace.self) private var workspace
    @State private var note = ""

    var body: some View {
        let states = attendanceStates
        let attendance = workspace.attendance(for: gameId)
        let roster = workspace.activePlayers.filter { player in game.gamePlayers.contains { $0.playerId == player.id } }
        let hasPrevious = (try? workspace.core.call("previousGame", [workspace.rawGame(gameId) ?? .null, .array(workspace.prepared?.games ?? [])]))?.stringValue != nil

        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Who's here?").font(.display(32)).foregroundStyle(Theme.ink)
                    Text("Everyone starts marked here. Tap anyone who isn't.")
                        .font(.subheadline).foregroundStyle(Theme.inkMuted)
                }
                Spacer()
                if let attendance {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text("\(attendance.expected)").font(.display(40)).foregroundStyle(Theme.lime).monospacedDigit()
                            .contentTransition(.numericText())
                        Text("of \(attendance.total)").font(.caption).foregroundStyle(Theme.inkMuted)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(attendance.expected) of \(attendance.total) expected")
                }
            }

            HStack(spacing: 8) {
                quick("All here") { workspace.mutateGame(gameId, "setAllAttendance", [.string("PRESENT")]) }
                quick("All out") { workspace.mutateGame(gameId, "setAllAttendance", [.string("ABSENT")]) }
                if hasPrevious {
                    quick("Same as last game") {
                        workspace.mutateGame(gameId, "copyLastAttendance", [.array(workspace.prepared?.games ?? [])])
                    }
                }
            }

            VStack(spacing: 8) {
                ForEach(roster) { player in
                    AttendanceRow(
                        player: player,
                        name: workspace.fullName(player.id),
                        state: states[player.id] ?? .present,
                        gamePlayer: game.gamePlayers.first { $0.playerId == player.id },
                        innings: game.plannedInnings,
                        onState: { state in
                            workspace.mutateGame(gameId, "setAttendance", [.string(player.id), .string(state.rawValue)])
                            Haptics.tap()
                        },
                        onWindow: { field, value in
                            workspace.mutateGame(gameId, "setAttendanceWindow",
                                                 [.string(player.id), .string(field), value.map { .number(Double($0)) } ?? .null])
                        }
                    )
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                Eyebrow("Note for this game")
                TextField("Field 3, bring the catcher's gear…", text: $note, axis: .vertical)
                    .lineLimit(1...4)
                    .padding(12)
                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .onSubmit(saveNote)
                    .onChange(of: note) { _, _ in saveNoteSoon() }
            }
        }
        .onAppear { note = game.note ?? "" }
    }

    private var attendanceStates: [String: AttendanceState] {
        guard let raw = workspace.rawGame(gameId),
              let value = try? workspace.core.call("attendanceStates", [raw]).decode([String: AttendanceState].self)
        else { return [:] }
        return value
    }

    @State private var noteTask: Task<Void, Never>?

    /* Typing should not queue a save per keystroke. */
    private func saveNoteSoon() {
        noteTask?.cancel()
        noteTask = Task {
            try? await Task.sleep(for: .milliseconds(600))
            if !Task.isCancelled { saveNote() }
        }
    }

    private func saveNote() {
        guard note != (game.note ?? "") else { return }
        workspace.mutateGame(gameId, "setGameNote", [.string(note)])
    }

    private func quick(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title) { action(); Haptics.tap() }
            .font(.footnote.weight(.semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.surfaceRaised, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.strokeStrong))
            .foregroundStyle(Theme.ink)
    }
}

struct AttendanceRow: View {
    let player: PlayerView
    let name: String
    let state: AttendanceState
    let gamePlayer: GamePlayerView?
    let innings: Int
    var onState: (AttendanceState) -> Void
    var onWindow: (String, Int?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                PlayerAvatar(player: player, size: 38)
                    .opacity(state == .absent ? 0.4 : 1)
                Text(name).font(.headline)
                    .foregroundStyle(state == .absent ? Theme.inkFaint : Theme.ink)
                    .strikethrough(state == .absent, color: Theme.inkFaint)
                Spacer()
                HStack(spacing: 4) {
                    ForEach(AttendanceState.allCases, id: \.self) { option in
                        Button { onState(option) } label: {
                            Image(systemName: option.icon)
                                .font(.system(size: 14, weight: .heavy))
                                .frame(width: 40, height: 36)
                                .foregroundStyle(option == state ? Theme.onLime : Theme.inkMuted)
                                .background(option == state ? color(option) : Theme.surfaceRaised,
                                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(option.label)
                        .accessibilityAddTraits(option == state ? .isSelected : [])
                    }
                }
            }
            if state == .limited {
                HStack(spacing: 10) {
                    windowMenu(title: "Arrives",
                               current: gamePlayer?.arrivalInning,
                               none: "On time",
                               range: 2...max(2, innings),
                               label: { "Inning \($0)" }) { onWindow("arrivalInning", $0) }
                    windowMenu(title: "Leaves after",
                               current: gamePlayer?.departureInning,
                               none: "Stays all game",
                               range: 1...max(1, innings - 1),
                               label: { "Inning \($0)" }) { onWindow("departureInning", $0) }
                }
                .padding(.leading, 50)
            }
        }
        .card(padding: 12)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(name), \(state.label)")
    }

    private func color(_ state: AttendanceState) -> Color {
        switch state {
        case .present: return Theme.emerald
        case .limited: return Theme.amber
        case .absent: return Theme.danger
        }
    }

    private func windowMenu(title: String, current: Int?, none: String, range: ClosedRange<Int>,
                            label: @escaping (Int) -> String, set: @escaping (Int?) -> Void) -> some View {
        Menu {
            Button(none) { set(nil) }
            ForEach(Array(range), id: \.self) { inning in Button(label(inning)) { set(inning) } }
        } label: {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.caption2.weight(.bold)).foregroundStyle(Theme.inkFaint)
                HStack(spacing: 4) {
                    Text(current.map(label) ?? none).font(.footnote.weight(.semibold))
                    Image(systemName: "chevron.up.chevron.down").font(.caption2)
                }
                .foregroundStyle(Theme.amber)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Theme.amber.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }
}

// MARK: - Pitching

struct PitchingStep: View {
    let gameId: String
    let game: GameView
    @Environment(Workspace.self) private var workspace

    var body: some View {
        let available = Set(game.gamePlayers.filter(\.available).map(\.playerId))
        let pitchers = workspace.activePlayers.filter { $0.canPitch && available.contains($0.id) }
        let plan = game.pitchingPlan ?? [:]

        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Who pitches?").font(.display(32)).foregroundStyle(Theme.ink)
                Text("Pick a pitcher for any inning you've already decided. Leave the rest to InningGrid — it follows your pitch limits.")
                    .font(.subheadline).foregroundStyle(Theme.inkMuted)
            }

            if pitchers.isEmpty {
                EmptyCard(icon: "figure.baseball", title: "No pitchers here",
                          message: "Nobody available today is marked Can pitch. Turn it on from a player's profile.")
            } else {
                VStack(spacing: 8) {
                    ForEach(1...max(1, game.plannedInnings), id: \.self) { inning in
                        let chosen = plan[String(inning)]
                        HStack {
                            Text("Inning \(inning)").font(.headline).foregroundStyle(Theme.ink)
                            Spacer()
                            Menu {
                                Button("InningGrid chooses") { set(inning, nil) }
                                Divider()
                                ForEach(pitchers) { pitcher in
                                    Button(workspace.fullName(pitcher.id)) { set(inning, pitcher.id) }
                                }
                            } label: {
                                HStack(spacing: 6) {
                                    Text(chosen.map(workspace.name) ?? "InningGrid chooses")
                                        .font(.subheadline.weight(.semibold))
                                    Image(systemName: "chevron.up.chevron.down").font(.caption)
                                }
                                .foregroundStyle(chosen == nil ? Theme.inkMuted : Theme.battery)
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .background((chosen == nil ? Theme.surfaceRaised : Theme.battery.opacity(0.14)), in: Capsule())
                            }
                            .accessibilityLabel("Inning \(inning) pitcher: \(chosen.map(workspace.fullName) ?? "InningGrid chooses")")
                        }
                        .card(padding: 12)
                    }
                }
                Text("\(pitchers.count) available: \(pitchers.map { workspace.name($0.id) }.joined(separator: ", "))")
                    .font(.footnote).foregroundStyle(Theme.inkFaint)
            }
        }
    }

    private func set(_ inning: Int, _ playerId: String?) {
        workspace.mutateGame(gameId, "setPitchingPlan", [.number(Double(inning)), playerId.map(JSONValue.string) ?? .null])
        Haptics.tap()
    }
}

// MARK: - Game style

struct StyleStep: View {
    let gameId: String
    let game: GameView
    @Environment(Workspace.self) private var workspace
    @State private var advanced = false

    var body: some View {
        let current = game.settingsSnapshot.philosophy

        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("How do you want to coach?").font(.display(32)).foregroundStyle(Theme.ink)
                Text("Pick one and you're done. Everything under it is optional.")
                    .font(.subheadline).foregroundStyle(Theme.inkMuted)
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 10)], spacing: 10) {
                ForEach(workspace.philosophies) { card in
                    PhilosophyTile(card: card, selected: card.philosophy == current) {
                        workspace.mutateGame(gameId, "setPhilosophy", [.string(card.philosophy)])
                        Haptics.tap()
                    }
                }
            }
            if current == "CUSTOM" {
                Label("You've changed things by hand, so no preset is selected. Tap one to start over from it.",
                      systemImage: "slider.horizontal.3")
                    .font(.footnote).foregroundStyle(Theme.inkMuted)
            }

            ForEach(sections(advanced: false)) { section in
                RuleSectionCard(gameId: gameId, section: section)
            }

            DisclosureGroup(isExpanded: $advanced) {
                VStack(spacing: 12) {
                    ForEach(sections(advanced: true)) { section in
                        RuleSectionCard(gameId: gameId, section: section)
                    }
                }
                .padding(.top, 10)
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Advanced rules").font(.headline).foregroundStyle(Theme.ink)
                        Text("Position limits, outfield caps, continuity, spread.").font(.caption).foregroundStyle(Theme.inkMuted)
                    }
                    Spacer()
                    let changed = changedCount
                    if changed > 0 { Tag(text: "\(changed) changed", color: Theme.lime) }
                }
            }
            .card()
        }
    }

    private func sections(advanced: Bool) -> [RuleSectionView] {
        guard let raw = workspace.rawGame(gameId) else { return [] }
        return (try? workspace.core.call("ruleSections", [raw, .bool(advanced)]).decode([RuleSectionView].self)) ?? []
    }

    private var changedCount: Int {
        guard let raw = workspace.rawGame(gameId) else { return 0 }
        return (try? workspace.core.call("changedRuleCount", [raw]).decode(Int.self)) ?? 0
    }
}

struct PhilosophyTile: View {
    let card: PhilosophyCard
    let selected: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: icon).font(.title3.weight(.bold))
                        .foregroundStyle(selected ? Theme.onLime : Theme.lime)
                    Spacer()
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selected ? Theme.onLime : Theme.inkFaint)
                }
                Text(card.label.uppercased()).font(.display(20)).foregroundStyle(selected ? Theme.onLime : Theme.ink)
                Text(card.blurb).font(.caption).foregroundStyle(selected ? Theme.onLime.opacity(0.8) : Theme.inkMuted)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
            .background(selected ? Theme.lime : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .strokeBorder(selected ? Theme.lime : Theme.stroke))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(card.label). \(card.blurb)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var icon: String {
        switch card.philosophy {
        case "EQUAL_PLAYING_TIME": return "person.3.fill"
        case "BALANCED": return "scale.3d"
        case "DEVELOPMENT": return "arrow.triangle.2.circlepath"
        case "COMPETITIVE": return "trophy.fill"
        default: return "slider.horizontal.3"
        }
    }
}

struct RuleSectionCard: View {
    let gameId: String
    let section: RuleSectionView
    @Environment(Workspace.self) private var workspace

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Eyebrow(section.label).padding(.bottom, 8)
            ForEach(Array(section.rules.enumerated()), id: \.element.id) { index, rule in
                if index > 0 { Divider().overlay(Theme.stroke) }
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(rule.label).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        Text(rule.help).font(.caption).foregroundStyle(Theme.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    control(rule)
                }
                .padding(.vertical, 10)
            }
        }
        .card()
    }

    @ViewBuilder
    private func control(_ rule: RuleControlView) -> some View {
        switch rule.kind {
        case .toggle:
            Toggle(rule.label, isOn: Binding(
                get: { rule.value == "true" },
                set: { set(rule, .bool($0)) }
            ))
            .labelsHidden()
            .tint(Theme.lime)
        case .choice:
            Menu {
                ForEach(rule.options, id: \.value) { option in
                    Button {
                        set(rule, .string(option.value))
                    } label: {
                        if option.value == rule.value { Label(option.label, systemImage: "checkmark") }
                        else { Text(option.label) }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(rule.selectedLabel).font(.footnote.weight(.semibold)).lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down").font(.caption2)
                }
                .foregroundStyle(Theme.lime)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(Theme.lime.opacity(0.1), in: Capsule())
            }
            .accessibilityLabel("\(rule.label): \(rule.selectedLabel)")
        }
    }

    private func set(_ rule: RuleControlView, _ value: JSONValue) {
        workspace.mutateGame(gameId, "setRule", [.string(rule.key), value])
        Haptics.tap()
    }
}

// MARK: - Review

struct ReviewStep: View {
    let gameId: String
    let game: GameView
    let failure: GenerationResult?
    var onApply: (Relaxation) -> Void
    @Environment(Workspace.self) private var workspace

    var body: some View {
        let attendance = workspace.attendance(for: gameId)
        let plan = (game.pitchingPlan ?? [:]).sorted { Int($0.key) ?? 0 < Int($1.key) ?? 0 }
        let style = workspace.philosophies.first { $0.philosophy == game.settingsSnapshot.philosophy }?.label ?? "Custom"

        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Ready to build").font(.display(32)).foregroundStyle(Theme.ink)
                Text("Last look — this is the moment a mistake is cheap.")
                    .font(.subheadline).foregroundStyle(Theme.inkMuted)
            }

            if let failure { FailureCard(result: failure, onApply: onApply) }

            VStack(spacing: 0) {
                row("Players", attendance.map { "\($0.expected) expected" + ($0.limited > 0 ? " · \($0.limited) part" : "") + ($0.absent > 0 ? " · \($0.absent) out" : "") } ?? "—")
                Divider().overlay(Theme.stroke)
                row("Innings", "\(game.plannedInnings)")
                Divider().overlay(Theme.stroke)
                row("On defense", "\(game.formationSnapshot.positions.count) positions")
                Divider().overlay(Theme.stroke)
                row("Pitching", plan.isEmpty ? "InningGrid chooses"
                    : plan.map { "\($0.key): \(workspace.name($0.value))" }.joined(separator: " · "))
                Divider().overlay(Theme.stroke)
                row("Game style", style)
            }
            .card(padding: 4)

            if let attendance, attendance.expected < game.formationSnapshot.positions.count {
                Label("Only \(attendance.expected) players for \(game.formationSnapshot.positions.count) positions. The engine will suggest a smaller formation.",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote).foregroundStyle(Theme.amber)
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.subheadline).foregroundStyle(Theme.inkMuted)
            Spacer(minLength: 16)
            Text(value).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }
}

/// Why the engine couldn't build it, and the fixes it suggests.
struct FailureCard: View {
    let result: GenerationResult
    var onApply: (Relaxation) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Couldn't build a lineup that fits every rule", systemImage: "exclamationmark.octagon.fill")
                .font(.headline).foregroundStyle(Theme.danger)
            ForEach(result.conflicts, id: \.self) { conflict in
                Text("• \(conflict.message)").font(.subheadline).foregroundStyle(Theme.ink)
            }
            if !result.relaxations.isEmpty {
                Eyebrow("Any one of these would work")
                ForEach(result.relaxations.sorted { $0.impact < $1.impact }, id: \.self) { relaxation in
                    HStack {
                        Text(relaxation.message).font(.subheadline).foregroundStyle(Theme.ink)
                        Spacer()
                        if relaxation.action != nil {
                            Button("Apply") { onApply(relaxation) }
                                .font(.footnote.weight(.bold))
                                .buttonStyle(.borderedProminent)
                                .tint(Theme.lime)
                                .foregroundStyle(Theme.onLime)
                        }
                    }
                }
            }
        }
        .card(highlighted: true)
    }
}
