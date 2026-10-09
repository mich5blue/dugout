import SwiftUI

struct GameDetailView: View {
    let gameId: String
    @Environment(Workspace.self) private var workspace
    @State private var section: Section = .defense
    @State private var cellTarget: CellTarget?
    @State private var openTarget: OpenTarget?
    @State private var rebuilding = false
    @State private var rebuildFailure: GenerationResult?

    enum Section: String, CaseIterable, Identifiable {
        case batting = "Batting", defense = "Defense", summary = "Summary"
        var id: String { rawValue }
    }

    var body: some View {
        if let game = workspace.game(gameId) {
            content(game, lineup: workspace.lineup(for: gameId))
        } else {
            EmptyCard(icon: "calendar.badge.exclamationmark", title: "Game not found", message: "It may have been deleted.")
                .padding().screenBackground()
        }
    }

    private func content(_ game: GameView, lineup: LineupView?) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                GameHeader(game: game)

                if let lineup, lineup.hasLineup {
                    Picker("Section", selection: $section) {
                        ForEach(Section.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    if let rebuildFailure {
                        FailureCard(result: rebuildFailure) { _ in }
                    }

                    switch section {
                    case .batting:
                        if workspace.canEdit { BattingEditor(gameId: gameId, lineup: lineup) }
                        else { BattingList(gameId: gameId, lineup: lineup) }
                    case .defense:
                        DefenseView(
                            gameId: gameId, game: game, lineup: lineup,
                            onPlayer: workspace.canEdit ? { cellTarget = CellTarget(playerId: $0, inning: $1) } : nil,
                            onOpen: workspace.canEdit ? { openTarget = $0 } : nil
                        )
                    case .summary: LineupSummary(lineup: lineup)
                    }
                } else {
                    EmptyCard(icon: "sparkles", title: "No lineup yet",
                              message: workspace.can("game:generate")
                                ? "Mark who's here, pick how you want to coach, and generate."
                                : "Your head coach hasn't built this lineup yet.")
                    if workspace.can("game:generate") {
                        NavigationLink(value: Route.build(gameId)) { Text("Build lineup") }
                            .buttonStyle(.primary)
                    }
                }
            }
            .padding(Theme.gutter)
            .frame(maxWidth: 1100)
            .frame(maxWidth: .infinity)
        }
        .screenBackground()
        .navigationTitle("vs \(game.opponentLabel)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar(game, lineup: lineup) }
        .sheet(item: $cellTarget) { MovePlayerSheet(gameId: gameId, target: $0) }
        #if DEBUG
        .onAppear {
            /* `-uiTestSection batting`, `-uiTestCell <playerId>:<inning>` */
            let defaults = UserDefaults.standard
            if let name = defaults.string(forKey: "uiTestSection"),
               let target = Section.allCases.first(where: { $0.rawValue.lowercased() == name }) { section = target }
            if let cell = defaults.string(forKey: "uiTestCell")?.split(separator: ":"), cell.count == 2, let inning = Int(cell[1]) {
                cellTarget = CellTarget(playerId: String(cell[0]), inning: inning)
            }
        }
        #endif
        .sheet(item: $openTarget) { FillPositionSheet(gameId: gameId, target: $0) }
    }

    @ToolbarContentBuilder
    private func toolbar(_ game: GameView, lineup: LineupView?) -> some ToolbarContent {
        if workspace.canEdit, lineup?.hasLineup == true {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    workspace.undo(gameId)
                    Haptics.tap()
                } label: { Image(systemName: "arrow.uturn.backward") }
                .disabled(!workspace.canUndo(gameId))
                .accessibilityLabel("Undo")
            }
        }
        if lineup?.hasLineup == true {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if let share = workspace.shareItems(gameId) {
                        if let url = share.url {
                            ShareLink(item: url, subject: Text("Lineup vs \(game.opponentLabel)")) {
                                Label("Share link", systemImage: "link")
                            }
                        }
                        ShareLink(item: share.text) { Label("Share as text", systemImage: "text.bubble") }
                    }
                    if workspace.canEdit, game.status != .completed {
                        Divider()
                        Button {
                            Task { await tryAnother() }
                        } label: { Label("Try another lineup", systemImage: "dice") }
                        .disabled(rebuilding)
                    }
                } label: {
                    if rebuilding { ProgressView() } else { Image(systemName: "ellipsis.circle") }
                }
                .accessibilityLabel("More actions")
            }
        }
    }

    /// Same rules, locks and pitching plan; a different seed.
    private func tryAnother() async {
        rebuilding = true
        defer { rebuilding = false }
        let seed = Int.random(in: 1...99_999)
        if let result = try? await workspace.generate(gameId: gameId, seed: seed) {
            rebuildFailure = result.ok ? nil : result
            result.ok ? Haptics.success() : Haptics.warning()
        }
    }
}

struct GameHeader: View {
    let game: GameView
    @Environment(Workspace.self) private var workspace
    @State private var recording = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                DateBlock(game: game, accent: game.status != .completed)
                VStack(alignment: .leading, spacing: 2) {
                    Text("vs \(game.opponentLabel)").font(.display(30)).foregroundStyle(Theme.ink)
                        .lineLimit(1).minimumScaleFactor(0.7)
                    Text("\(GameDate.long(game)) · \(game.actualInnings ?? game.plannedInnings) innings · \(game.availableCount) players")
                        .font(.subheadline).foregroundStyle(Theme.inkMuted)
                }
            }
            if let note = game.note, !note.isEmpty {
                Text(note).font(.subheadline).foregroundStyle(Theme.inkMuted)
            }
            if workspace.canEdit, game.hasLineup {
                if game.status == .completed {
                    /* A played game is corrected in place — each edit records
                       what actually happened — never rebuilt from scratch. */
                    Label("Final. Tap anyone on the field or grid to correct what actually happened.",
                          systemImage: "pencil")
                        .font(.footnote).foregroundStyle(Theme.inkMuted)
                } else {
                    /* The date has passed and it was never finished on game
                       day — the same list Home's "How did it go?" card uses. */
                    if workspace.awaitingResults.contains(where: { $0.id == game.id }) {
                        Button { recording = true } label: { Label("Record result", systemImage: "flag.checkered") }
                            .buttonStyle(.primary)
                            .sheet(isPresented: $recording) {
                                FinishSheet(innings: game.plannedInnings) { count in
                                    workspace.edit(game.id, "finishGame", [.number(Double(count))])
                                    Haptics.success()
                                    recording = false
                                }
                            }
                    }
                    HStack(spacing: 10) {
                        if !workspace.awaitingResults.contains(where: { $0.id == game.id }) {
                            NavigationLink(value: Route.live(game.id)) {
                                Label(game.status == .inProgress ? "Resume game day" : "Start game day", systemImage: "play.fill")
                            }
                            .buttonStyle(.primary)
                        }
                        NavigationLink(value: Route.build(game.id)) {
                            Label("Rebuild", systemImage: "slider.horizontal.3")
                        }
                        .buttonStyle(.secondary)
                        .frame(maxWidth: 140)
                    }
                }
            }
        }
    }
}

// MARK: - Batting

struct BattingList: View {
    let gameId: String
    let lineup: LineupView
    @Environment(Workspace.self) private var workspace

    var body: some View {
        VStack(spacing: 8) {
            ForEach(lineup.battingOrder) { entry in
                HStack(spacing: 12) {
                    Text("\(entry.slot)")
                        .font(.display(24)).monospacedDigit()
                        .foregroundStyle(entry.slot <= 3 ? Theme.lime : Theme.inkMuted)
                        .frame(width: 34)
                    PlayerAvatar(player: workspace.player(entry.playerId), size: 36)
                    Text(lineup.names[entry.playerId]?.full ?? "Player").font(.headline).foregroundStyle(Theme.ink)
                    Spacer()
                    if entry.locked {
                        Image(systemName: "lock.fill").foregroundStyle(Theme.lime).accessibilityLabel("Locked")
                    }
                }
                .card(padding: 10)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Batting \(entry.slot): \(lineup.names[entry.playerId]?.full ?? "Player")\(entry.locked ? ", locked" : "")")
            }
        }
    }
}

// MARK: - Defense

struct DefenseView: View {
    let gameId: String
    let game: GameView
    let lineup: LineupView
    var onPlayer: ((String, Int) -> Void)? = nil
    var onOpen: ((OpenTarget) -> Void)? = nil
    @State private var mode: Mode = .field
    @State private var inning = 1
    @Environment(\.horizontalSizeClass) private var sizeClass

    enum Mode: String, CaseIterable, Identifiable {
        case field = "Field", grid = "Grid"
        var id: String { rawValue }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if sizeClass == .regular {
                /* iPad: both at once — the inning on the field, the game in the grid. */
                HStack(alignment: .top, spacing: 16) {
                    field.frame(maxWidth: 520)
                    LineupGrid(lineup: lineup, onTap: onPlayer)
                }
            } else {
                Picker("View", selection: $mode) {
                    ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 240)

                switch mode {
                case .field: field
                case .grid: LineupGrid(lineup: lineup, onTap: onPlayer)
                }
            }
        }
        .onAppear {
            if let live = game.liveState, game.status == .inProgress { inning = live.inning }
        }
    }

    private var field: some View {
        VStack(alignment: .leading, spacing: 12) {
            InningPicker(innings: lineup.innings, selection: $inning)
            if onPlayer != nil {
                Text("Tap anyone to move them. Tap an empty spot to fill it.")
                    .font(.footnote).foregroundStyle(Theme.inkFaint)
            }
            FieldDiagram(positions: lineup.positions) { position in
                let cell = lineup.cell(inning, position.id)
                PositionChip(code: position.code, name: cell.map { lineup.short($0.playerId) },
                             group: position.group, locked: cell?.locked ?? false)
                    .onTapGesture {
                        if let cell { onPlayer?(cell.playerId, inning) }
                        else { onOpen?(OpenTarget(positionId: position.id, code: position.code, inning: inning)) }
                    }
                    .accessibilityAddTraits(onPlayer == nil ? [] : .isButton)
            }
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
            let bench = lineup.benchAt(inning)
            if !bench.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Bench · inning \(inning)")
                    FlowRow(items: bench) { playerId in
                        Tag(text: lineup.short(playerId), color: Theme.inkMuted)
                            .onTapGesture { onPlayer?(playerId, inning) }
                    }
                }
                .card(padding: 12)
            }
        }
    }
}

struct InningPicker: View {
    let innings: [Int]
    @Binding var selection: Int

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(innings, id: \.self) { inning in
                    Button {
                        selection = inning
                        Haptics.tap()
                    } label: {
                        Text("\(inning)")
                            .font(.display(20))
                            .frame(width: 44, height: 44)
                            .foregroundStyle(selection == inning ? Theme.onLime : Theme.ink)
                            .background(selection == inning ? Theme.lime : Theme.surfaceRaised, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Inning \(inning)")
                    .accessibilityAddTraits(selection == inning ? .isSelected : [])
                }
            }
        }
    }
}

/// A player's name at a spot on the field.
struct PositionChip: View {
    let code: String
    let name: String?
    let group: PositionGroup
    var locked = false
    var highlighted = false

    var body: some View {
        VStack(spacing: 2) {
            Text(code).font(.system(size: 10, weight: .heavy)).foregroundStyle(Theme.color(group))
            HStack(spacing: 3) {
                if locked { Image(systemName: "lock.fill").font(.system(size: 8, weight: .bold)) }
                Text(name ?? "—").font(.system(size: 13, weight: .bold)).lineLimit(1)
            }
            .foregroundStyle(name == nil ? Theme.danger : Theme.ink)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .frame(minWidth: 62)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
            .strokeBorder(highlighted ? Theme.lime : Theme.color(group).opacity(0.7), lineWidth: highlighted ? 2 : 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(code): \(name ?? "empty")\(locked ? ", locked" : "")")
    }
}

/// Players down the side, innings across: the whole game at a glance.
struct LineupGrid: View {
    let lineup: LineupView
    var onTap: ((String, Int) -> Void)? = nil

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(horizontalSpacing: 4, verticalSpacing: 4) {
                GridRow {
                    Text("").frame(width: 92)
                    ForEach(lineup.innings, id: \.self) { inning in
                        Text("\(inning)").font(.system(size: 12, weight: .heavy)).foregroundStyle(Theme.inkMuted).frame(width: 40)
                    }
                    Text("FLD").font(.system(size: 11, weight: .heavy)).foregroundStyle(Theme.inkFaint).frame(width: 36)
                }
                ForEach(lineup.playerIds, id: \.self) { playerId in
                    GridRow {
                        Text(lineup.short(playerId)).font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink)
                            .lineLimit(1).frame(width: 92, alignment: .leading)
                        ForEach(lineup.innings, id: \.self) { inning in
                            cell(lineup.slot(playerId, inning))
                                .onTapGesture { onTap?(playerId, inning) }
                        }
                        Text("\(lineup.defensiveInnings[playerId] ?? 0)")
                            .font(.footnote.weight(.bold).monospacedDigit()).foregroundStyle(Theme.inkMuted).frame(width: 36)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(12)
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).strokeBorder(Theme.stroke))
    }

    @ViewBuilder
    private func cell(_ slot: SlotView?) -> some View {
        let color: Color = slot?.state == .field ? Theme.color(slot?.group) : Theme.bench
        let label: String = {
            switch slot?.state {
            case .field: return slot?.code ?? "?"
            case .rest: return "BN"
            case .out, .none: return "—"
            }
        }()
        Text(label)
            .font(.system(size: 12, weight: .heavy))
            .foregroundStyle(slot?.state == .field ? Theme.onLime : Theme.inkMuted)
            .frame(width: 40, height: 32)
            .background(color.opacity(slot?.state == .field ? 0.9 : 0.18), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay(alignment: .topTrailing) {
                if slot?.locked == true {
                    Image(systemName: "lock.fill").font(.system(size: 7, weight: .bold)).foregroundStyle(Theme.onLime).padding(3)
                }
            }
    }
}

// MARK: - Summary

struct LineupSummary: View {
    let lineup: LineupView
    @Environment(Workspace.self) private var workspace

    var body: some View {
        let field = lineup.playerIds.map { lineup.defensiveInnings[$0] ?? 0 }
        let spread = (field.max() ?? 0) - (field.min() ?? 0)

        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 0) {
                StatTile(value: "\(lineup.playerIds.count)", label: "Players")
                StatTile(value: "\(lineup.innings.count)", label: "Innings")
                StatTile(value: spread <= 1 ? "Even" : "±\(spread)", label: "Field-time spread",
                         color: spread <= 1 ? Theme.emerald : Theme.amber)
            }
            .card()

            if !lineup.pitchingPlan.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    SectionHeader("Pitching plan")
                    ForEach(lineup.innings, id: \.self) { inning in
                        if let pitcher = lineup.pitchingPlan[String(inning)] {
                            HStack {
                                Text("Inning \(inning)").foregroundStyle(Theme.inkMuted)
                                Spacer()
                                Text(lineup.short(pitcher)).fontWeight(.semibold).foregroundStyle(Theme.battery)
                            }
                            .font(.subheadline)
                        }
                    }
                }
                .card()
            }

            VStack(alignment: .leading, spacing: 8) {
                SectionHeader("Per player")
                ForEach(lineup.playerIds, id: \.self) { playerId in
                    let fieldInnings = lineup.defensiveInnings[playerId] ?? 0
                    let bench = lineup.benchInnings[playerId] ?? 0
                    HStack {
                        Text(lineup.names[playerId]?.full ?? "Player").font(.subheadline).foregroundStyle(Theme.ink)
                        Spacer()
                        Text("\(fieldInnings) field · \(bench) bench").font(.subheadline.monospacedDigit())
                            .foregroundStyle(bench > 1 ? Theme.amber : Theme.inkMuted)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .card()
        }
    }
}

// MARK: - Layout

/// Wraps chips onto as many lines as they need.
struct FlowRow<Item: Hashable, Content: View>: View {
    let items: [Item]
    @ViewBuilder var content: (Item) -> Content

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(items, id: \.self) { content($0) }
        }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(widest, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
