import SwiftUI

struct HomeView: View {
    @Binding var tab: MainTabs.Tab
    @Environment(Workspace.self) private var workspace
    @Environment(TeamStore.self) private var store
    @Environment(AuthService.self) private var auth

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let team = store.activeTeam {
                    header(team)
                    if let next = workspace.upcoming.first {
                        NextGameCard(game: next)
                    } else {
                        EmptyCard(icon: "calendar.badge.plus", title: "No games scheduled",
                                  message: "Add your next game from Schedule.")
                    }
                    ForEach(workspace.awaitingResults) { game in
                        AwaitingResultCard(game: game)
                    }
                    if let season = workspace.season {
                        FairnessCard(season: season, onOpen: { tab = .season })
                    }
                    laterGames
                    recentGames
                } else if case .syncing = store.syncState {
                    loading
                } else {
                    noTeam
                }
            }
            .padding(Theme.gutter)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .refreshable { await store.refresh() }
        .screenBackground()
        .toolbar { TeamToolbar() }
        .navigationBarTitleDisplayMode(.inline)
        .appRoutes()
    }

    private func header(_ team: TeamView) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow([team.seasonName, team.division].compactMap { $0 }.joined(separator: " · ").ifEmpty("Your team"),
                    color: Theme.lime)
            Text(team.name).font(.display(40)).foregroundStyle(Theme.ink).lineLimit(2)
            if let name = auth.session?.displayName, let first = name.split(separator: " ").first {
                Text("Welcome back, Coach \(first).").font(.subheadline).foregroundStyle(Theme.inkMuted)
            }
        }
        .padding(.top, 4)
    }

    @ViewBuilder private var laterGames: some View {
        let later = Array(workspace.upcoming.dropFirst().prefix(3))
        if !later.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader("Coming up") {
                    Button("All games") { tab = .schedule }.font(.footnote.weight(.semibold))
                }
                ForEach(later) { game in
                    NavigationLink(value: Route.game(game.id)) { GameRow(game: game) }
                        .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder private var recentGames: some View {
        let recent = workspace.orderedGames.filter { $0.status == .completed }.sorted { $0.date > $1.date }.prefix(3)
        if !recent.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader("Recent")
                ForEach(Array(recent)) { game in
                    NavigationLink(value: Route.game(game.id)) { GameRow(game: game) }
                        .buttonStyle(.plain)
                }
            }
        }
    }

    private var loading: some View {
        HStack(spacing: 12) {
            ProgressView()
            Text("Loading your teams…").foregroundStyle(Theme.inkMuted)
        }
        .frame(maxWidth: .infinity, minHeight: 300)
    }

    private var noTeam: some View {
        VStack(alignment: .leading, spacing: 16) {
            EmptyCard(icon: "person.3.sequence.fill", title: "No teams on this account",
                      message: "Teams you coach on the website show up here automatically. If a head coach invited you, check you signed in with the invited email.")
            if case .failed(let message) = store.syncState {
                Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.danger).font(.subheadline)
            }
            Button("Check again") { Task { await store.refresh() } }.buttonStyle(.secondary)
        }
    }
}

// MARK: - Next game

struct NextGameCard: View {
    let game: GameView
    @Environment(Workspace.self) private var workspace

    var body: some View {
        let action = workspace.nextAction(for: game.id)
        let attendance = workspace.attendance(for: game.id)

        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Eyebrow("Next game · \(GameDate.relative(game))", color: Theme.lime)
                Spacer()
                statusTag
            }

            HStack(alignment: .center, spacing: 14) {
                DateBlock(game: game, accent: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("vs \(game.opponentLabel)").font(.display(32)).foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.7)
                    Text("\(GameDate.long(game)) · \(game.plannedInnings) innings")
                        .font(.subheadline).foregroundStyle(Theme.inkMuted)
                }
            }

            if let attendance {
                HStack(spacing: 0) {
                    StatTile(value: "\(attendance.expected)", label: "Expected", color: Theme.emerald)
                    StatTile(value: "\(attendance.absent)", label: "Out", color: attendance.absent > 0 ? Theme.amber : Theme.inkFaint)
                    StatTile(value: "\(attendance.limited)", label: "Late / early", color: attendance.limited > 0 ? Theme.infield : Theme.inkFaint)
                }
            }

            if let action {
                NavigationLink(value: Route.next(action, gameId: game.id)) {
                    Text(action.label)
                }
                .buttonStyle(.primary)
                if let hint = action.hint {
                    Text(hint).font(.footnote).foregroundStyle(Theme.inkMuted)
                }
            }
            if game.hasLineup {
                NavigationLink(value: Route.game(game.id)) { Text("View lineup") }
                    .buttonStyle(.secondary)
            }
        }
        .card(padding: 18, highlighted: true)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var statusTag: some View {
        if game.status == .inProgress {
            Tag(text: "LIVE", color: Theme.danger, filled: true)
        } else if game.hasLineup {
            Tag(text: "Lineup ready", color: Theme.emerald)
        } else if game.attendanceConfirmedAt != nil {
            Tag(text: "Attendance in", color: Theme.infield)
        } else {
            Tag(text: "Needs lineup", color: Theme.amber)
        }
    }
}

struct AwaitingResultCard: View {
    let game: GameView

    var body: some View {
        NavigationLink(value: Route.game(game.id)) {
            HStack(spacing: 12) {
                Image(systemName: "checkmark.seal").font(.title2).foregroundStyle(Theme.amber)
                VStack(alignment: .leading, spacing: 2) {
                    Text("How did it go vs \(game.opponentLabel)?").font(.headline).foregroundStyle(Theme.ink)
                    Text("Record what actually happened so the season stays fair.")
                        .font(.footnote).foregroundStyle(Theme.inkMuted)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Theme.inkFaint)
            }
            .card()
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Fairness

struct FairnessCard: View {
    let season: SeasonSummaryView
    var onOpen: (() -> Void)? = nil

    var body: some View {
        let s = season.standings
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader("Season fairness") {
                if let onOpen { Button("Details", action: onOpen).font(.footnote.weight(.semibold)) }
            }
            if s.total == 0 {
                Text("Fairness starts counting after your first completed game.")
                    .font(.subheadline).foregroundStyle(Theme.inkMuted)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(Int((season.fairness.balanceScore * 100).rounded()))")
                        .font(.display(56)).foregroundStyle(Theme.lime).monospacedDigit()
                    Text("balance score").font(.subheadline).foregroundStyle(Theme.inkMuted)
                }
                StandingsBar(standings: s)
                HStack {
                    legend("Owed", s.owed, Theme.amber)
                    legend("On target", s.onTarget, Theme.emerald)
                    legend("Ahead", s.ahead, Theme.infield)
                }
                Text(season.outlook.headline).font(.subheadline).foregroundStyle(Theme.ink)
            }
        }
        .card()
    }

    private func legend(_ label: String, _ count: Int, _ color: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text("\(count) \(label)").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct StandingsBar: View {
    let standings: SeasonSummaryView.Standings

    var body: some View {
        GeometryReader { proxy in
            let total = max(standings.total, 1)
            HStack(spacing: 3) {
                segment(standings.owed, total, Theme.amber, proxy.size.width)
                segment(standings.onTarget, total, Theme.emerald, proxy.size.width)
                segment(standings.ahead, total, Theme.infield, proxy.size.width)
            }
        }
        .frame(height: 10)
        .accessibilityElement()
        .accessibilityLabel("\(standings.owed) owed, \(standings.onTarget) on target, \(standings.ahead) ahead")
    }

    @ViewBuilder
    private func segment(_ count: Int, _ total: Int, _ color: Color, _ width: CGFloat) -> some View {
        if count > 0 {
            Capsule().fill(color).frame(width: max(6, (width - 6) * CGFloat(count) / CGFloat(total)))
        }
    }
}

// MARK: - Game row

struct GameRow: View {
    let game: GameView

    var body: some View {
        HStack(spacing: 14) {
            DateBlock(game: game)
            VStack(alignment: .leading, spacing: 3) {
                Text("vs \(game.opponentLabel)").font(.headline).foregroundStyle(Theme.ink).lineLimit(1)
                Text("\(GameDate.weekday(game)) · \(game.actualInnings ?? game.plannedInnings) inn · \(game.availableCount) players")
                    .font(.footnote).foregroundStyle(Theme.inkMuted)
            }
            Spacer(minLength: 8)
            status
            Image(systemName: "chevron.right").font(.footnote.weight(.bold)).foregroundStyle(Theme.inkFaint)
        }
        .card(padding: 12)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var status: some View {
        switch game.status {
        case .completed: Tag(text: "Final", color: Theme.inkMuted)
        case .inProgress: Tag(text: "Live", color: Theme.danger, filled: true)
        case .planned: game.hasLineup ? Tag(text: "Ready", color: Theme.emerald) : Tag(text: "To do", color: Theme.amber)
        }
    }
}

extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}
