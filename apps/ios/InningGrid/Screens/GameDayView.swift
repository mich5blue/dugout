import SwiftUI

struct InningChangeView: Decodable, Sendable, Hashable, Identifiable {
    let playerId: String
    let playerName: String
    let from: String
    let to: String
    var id: String { playerId }
}

struct ExtraInningView: Decodable, Sendable {
    struct PlayerRef: Decodable, Sendable { let id: String }
    let inning: Int
    let nextInning: Int
    let pitcher: PlayerRef
    let summary: String
    let warning: String?
    let blocked: String?
}

/// Game day: one hand, bright sun, two seconds of attention between pitches.
///
/// Big type, no app chrome, nothing that needs a second tap to confirm
/// something harmless. Every change is saved on the phone first, so a dugout
/// with no signal loses nothing — it uploads when the phone finds a network.
struct GameDayView: View {
    let gameId: String
    @Environment(Workspace.self) private var workspace
    @Environment(TeamStore.self) private var store
    @Environment(Navigator.self) private var navigator
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var someoneOut = false
    @State private var finishing = false
    @State private var extraPreview: (plan: JSONValue, view: ExtraInningView)?
    @State private var busy = false

    var body: some View {
        if let game = workspace.game(gameId), let lineup = workspace.lineup(for: gameId), lineup.hasLineup {
            content(game, lineup: lineup)
        } else {
            EmptyCard(icon: "sparkles", title: "No lineup to play",
                      message: "Build the lineup first and this becomes the dugout view.")
                .padding().screenBackground()
        }
    }

    private func content(_ game: GameView, lineup: LineupView) -> some View {
        let inning = game.liveState?.inning ?? 1

        return ScrollView {
            Group {
                if sizeClass == .regular {
                    HStack(alignment: .top, spacing: 20) {
                        VStack(spacing: 16) {
                            InningStepper(gameId: gameId, inning: inning, of: game.plannedInnings)
                            field(lineup, inning: inning)
                        }
                        .frame(maxWidth: .infinity)
                        VStack(spacing: 16) { side(game, lineup: lineup, inning: inning) }
                            .frame(width: 360)
                    }
                } else {
                    VStack(spacing: 16) {
                        InningStepper(gameId: gameId, inning: inning, of: game.plannedInnings)
                        BatterCard(gameId: gameId)
                        field(lineup, inning: inning)
                        side(game, lineup: lineup, inning: inning, includeBatter: false)
                    }
                }
            }
            .padding(Theme.gutter)
            .frame(maxWidth: 1200)
            .frame(maxWidth: .infinity)
        }
        .screenBackground()
        .toolbar(.hidden, for: .tabBar)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 6) {
                    Circle().fill(Theme.danger).frame(width: 8, height: 8)
                    Text("LIVE · vs \(game.opponentLabel)").font(.system(size: 15, weight: .heavy).width(.condensed))
                }
                .accessibilityElement(children: .combine)
            }
            ToolbarItem(placement: .topBarTrailing) { SyncBadge(state: store.syncState) }
        }
        .onAppear {
            /* Arriving here begins the game, so a coach doesn't press Start
               again every time the phone locks. The screen stays on. */
            if game.liveState == nil, game.status != .completed {
                workspace.mutateGame(gameId, "startGame", [.string(Workspace.nowISO)])
            }
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
        .sheet(isPresented: $someoneOut) {
            SomeoneOutSheet(gameId: gameId, game: game, inning: inning) { playerId, lastInning in
                await takeOut(playerId, lastInning: lastInning)
            }
        }
        .sheet(isPresented: $finishing) {
            FinishSheet(innings: game.plannedInnings) { count in
                workspace.mutateGame(gameId, "finishGame", [.number(Double(count))])
                Haptics.success()
                finishing = false
                navigator.replaceTop(with: .game(gameId))
            }
        }
        .alert(extraPreview.map { "Keep \(workspace.name($0.view.pitcher.id)) pitching?" } ?? "",
               isPresented: Binding(get: { extraPreview != nil }, set: { if !$0 { extraPreview = nil } }),
               presenting: extraPreview) { preview in
            Button("Update the rotation") {
                workspace.edit(gameId, "keepPitching", [preview.plan])
                Haptics.success()
            }
            Button("Keep the original plan", role: .cancel) {}
        } message: { preview in
            Text(preview.view.summary + (preview.view.warning.map { "\n\nWorth knowing: \($0)" } ?? ""))
        }
    }

    private func field(_ lineup: LineupView, inning: Int) -> some View {
        VStack(spacing: 8) {
            FieldDiagram(positions: lineup.positions) { position in
                let cell = lineup.cell(inning, position.id)
                PositionChip(code: position.code, name: cell.map { lineup.short($0.playerId) }, group: position.group)
                    .scaleEffect(1.08)
            }
            let bench = lineup.benchAt(inning)
            if !bench.isEmpty {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Eyebrow("Bench")
                    Text(bench.map(lineup.short).joined(separator: " · "))
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.inkMuted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .card(padding: 10)
    }

    @ViewBuilder
    private func side(_ game: GameView, lineup: LineupView, inning: Int, includeBatter: Bool = true) -> some View {
        if includeBatter { BatterCard(gameId: gameId) }

        if inning < game.plannedInnings {
            let changes = loadChanges(from: inning, to: inning + 1)
            VStack(alignment: .leading, spacing: 10) {
                Eyebrow("Next inning (\(inning + 1)) · who moves")
                if changes.isEmpty {
                    Text("Nobody moves.").font(.subheadline).foregroundStyle(Theme.inkMuted)
                } else {
                    ForEach(changes.prefix(8)) { change in
                        HStack {
                            Text(change.playerName).font(.headline).foregroundStyle(Theme.ink)
                            Spacer()
                            Text(change.from).font(.display(18)).foregroundStyle(Theme.inkFaint)
                            Image(systemName: "arrow.right").font(.caption.weight(.bold)).foregroundStyle(Theme.inkFaint)
                            Text(change.to).font(.display(18)).foregroundStyle(Theme.lime)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(change.playerName): \(change.from) to \(change.to)")
                    }
                    if changes.count > 8 {
                        Text("and \(changes.count - 8) more").font(.caption).foregroundStyle(Theme.inkFaint)
                    }
                }
            }
            .card()
        }

        VStack(alignment: .leading, spacing: 10) {
            Eyebrow("Something changed")
            if let extra = loadExtra(inning) {
                action(title: "Keep \(workspace.name(extra.view.pitcher.id)) pitching",
                       hint: extra.view.blocked ?? "Into inning \(extra.view.nextInning). You'll see what it changes first.",
                       icon: "figure.baseball", disabled: extra.view.blocked != nil) {
                    extraPreview = extra
                }
            }
            action(title: "Someone has to come out", hint: "Records it and rebuilds the rest of the game around it.",
                   icon: "person.fill.xmark") { someoneOut = true }
            action(title: "Finish game", hint: "Record how many innings were actually played.",
                   icon: "flag.checkered") { finishing = true }
            if busy {
                HStack { ProgressView(); Text("Rebuilding the rest of the game…").font(.footnote) }
                    .foregroundStyle(Theme.inkMuted)
            }
        }
        .card()
    }

    private func action(title: String, hint: String, icon: String, disabled: Bool = false, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.title3.weight(.semibold)).foregroundStyle(Theme.lime).frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline).foregroundStyle(Theme.ink)
                    Text(hint).font(.caption).foregroundStyle(Theme.inkMuted).multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Theme.inkFaint)
            }
            .padding(12)
            .frame(minHeight: 60)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(disabled || busy)
        .opacity(disabled ? 0.5 : 1)
    }

    private func loadChanges(from: Int, to: Int) -> [InningChangeView] {
        guard let raw = workspace.rawGame(gameId), let players = workspace.prepared?.players else { return [] }
        return (try? workspace.core.call("inningChanges", [raw, .array(players), .number(Double(from)), .number(Double(to))])
            .decode([InningChangeView].self)) ?? []
    }

    private func loadExtra(_ inning: Int) -> (plan: JSONValue, view: ExtraInningView)? {
        guard let raw = workspace.rawGame(gameId), let players = workspace.prepared?.players,
              let plan = try? workspace.core.call("extraInning", [raw, .array(players), .number(Double(inning))]),
              plan != .null, let view = try? plan.decode(ExtraInningView.self) else { return nil }
        return (plan, view)
    }

    /// Record who left, then rebuild only the innings not yet played.
    private func takeOut(_ playerId: String, lastInning: Int) async {
        workspace.edit(gameId, "playerOut", [.string(playerId), .number(Double(lastInning))])
        busy = true
        defer { busy = false }
        let frozen = (try? workspace.core.call("frozenInningsFor", [.number(Double(lastInning))]).numberValue).map { Int($0) } ?? 0
        if let result = try? await workspace.generate(gameId: gameId, frozenInnings: frozen) {
            result.ok ? Haptics.success() : Haptics.warning()
        }
    }
}

// MARK: - Pieces

struct InningStepper: View {
    let gameId: String
    let inning: Int
    let of: Int
    @Environment(Workspace.self) private var workspace

    var body: some View {
        HStack {
            stepButton("minus", disabled: inning <= 1, label: "Previous inning") {
                workspace.mutateGame(gameId, "previousInning")
                Haptics.tap()
            }
            Spacer()
            VStack(spacing: 0) {
                Text("INNING").font(.eyebrow).tracking(2).foregroundStyle(Theme.inkMuted)
                Text("\(inning)").font(.display(76)).foregroundStyle(Theme.lime).monospacedDigit()
                    .contentTransition(.numericText(value: Double(inning)))
                Text("of \(of)").font(.caption).foregroundStyle(Theme.inkFaint)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Inning \(inning) of \(of)")
            Spacer()
            stepButton("plus", disabled: inning >= of, label: "Next inning") {
                workspace.mutateGame(gameId, "advanceInning")
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            }
        }
        .card(padding: 14)
        .animation(.snappy, value: inning)
    }

    private func stepButton(_ icon: String, disabled: Bool, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 30, weight: .heavy))
                .frame(width: 76, height: 76)
                .foregroundStyle(disabled ? Theme.inkFaint : Theme.onLime)
                .background(disabled ? Theme.surfaceRaised : Theme.lime, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(label)
    }
}

struct BatterCard: View {
    let gameId: String
    @Environment(Workspace.self) private var workspace

    var body: some View {
        let queue = loadQueue()
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow("At bat")
            if let first = queue.first {
                Text(workspace.name(first)).font(.display(46)).foregroundStyle(Theme.ink)
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .contentTransition(.opacity)
                    .accessibilityLabel("At bat: \(workspace.fullName(first))")
                if queue.count > 1 {
                    Divider().overlay(Theme.stroke)
                    row("On deck", queue[1], bright: true)
                }
                if queue.count > 2 { row("In the hole", queue[2], bright: false) }
                HStack(spacing: 10) {
                    Button {
                        workspace.mutateGame(gameId, "previousBatter")
                        Haptics.tap()
                    } label: { Image(systemName: "chevron.left").font(.headline) }
                        .buttonStyle(.secondary)
                        .frame(width: 70)
                        .accessibilityLabel("Previous batter")
                    Button {
                        workspace.mutateGame(gameId, "nextBatter")
                        Haptics.tap()
                    } label: { Label("Next batter", systemImage: "arrow.right") }
                        .buttonStyle(.primary)
                }
            } else {
                Text("No batting order for this game.").font(.subheadline).foregroundStyle(Theme.inkMuted)
            }
        }
        .card()
        .animation(.snappy, value: queue)
    }

    private func row(_ label: String, _ playerId: String, bright: Bool) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(Theme.inkFaint).frame(width: 84, alignment: .leading)
            Text(workspace.name(playerId)).font(.title3.weight(.semibold))
                .foregroundStyle(bright ? Theme.ink : Theme.inkMuted)
        }
        .accessibilityElement(children: .combine)
    }

    private func loadQueue() -> [String] {
        guard let raw = workspace.rawGame(gameId) else { return [] }
        return (try? workspace.core.call("batterQueue", [raw, .number(3)]).arrayValue?.compactMap(\.stringValue)) ?? []
    }
}

struct SomeoneOutSheet: View {
    let gameId: String
    let game: GameView
    let inning: Int
    var onApply: (String, Int) async -> Void
    @Environment(Workspace.self) private var workspace
    @Environment(\.dismiss) private var dismiss
    @State private var chosen: String?

    var body: some View {
        let available = workspace.activePlayers.filter { player in
            game.gamePlayers.contains { $0.playerId == player.id && $0.available }
        }
        /* "Done now" means they don't play the inning in progress. */
        let doneNow = max(0, inning - 1)

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let chosen {
                        Text("When is \(workspace.name(chosen)) done?").font(.display(28)).foregroundStyle(Theme.ink)
                        Button("Done now — sits out inning \(inning) on") {
                            apply(chosen, doneNow)
                        }
                        .buttonStyle(.primary)
                        if inning < game.plannedInnings {
                            Button("After this inning — plays \(inning), out from \(inning + 1)") {
                                apply(chosen, inning)
                            }
                            .buttonStyle(.secondary)
                        }
                        Text("Innings already played stay exactly as they were. Only the rest of the game is rebuilt.")
                            .font(.footnote).foregroundStyle(Theme.inkFaint)
                    } else {
                        Text("Who's coming out?").font(.display(28)).foregroundStyle(Theme.ink)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                            ForEach(available) { player in
                                Button { chosen = player.id } label: {
                                    HStack(spacing: 10) {
                                        PlayerAvatar(player: player, size: 34)
                                        Text(workspace.name(player.id)).font(.headline).foregroundStyle(Theme.ink)
                                        Spacer()
                                    }
                                    .padding(10)
                                    .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(Theme.gutter)
            }
            .screenBackground()
            .navigationTitle("Someone has to come out")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(chosen == nil ? "Cancel" : "Back") {
                        if chosen == nil { dismiss() } else { chosen = nil }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func apply(_ playerId: String, _ lastInning: Int) {
        dismiss()
        Task { await onApply(playerId, lastInning) }
    }
}

struct FinishSheet: View {
    let innings: Int
    var onFinish: (Int) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Only innings actually played count toward the season. Anything called off counts against nobody.")
                    .font(.subheadline).foregroundStyle(Theme.inkMuted)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                    ForEach((1...max(1, innings)).reversed(), id: \.self) { count in
                        Button { onFinish(count) } label: {
                            Text("\(count)").font(.display(34)).frame(maxWidth: .infinity, minHeight: 72)
                                .foregroundStyle(count == innings ? Theme.onLime : Theme.ink)
                                .background(count == innings ? Theme.lime : Theme.surfaceRaised,
                                            in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(count) innings played")
                    }
                }
                Text("You can correct this afterwards from the game page.").font(.footnote).foregroundStyle(Theme.inkFaint)
                Spacer()
            }
            .padding(Theme.gutter)
            .screenBackground()
            .navigationTitle("How many innings were played?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}
