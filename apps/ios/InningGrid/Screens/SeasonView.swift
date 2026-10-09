import Charts
import SwiftUI

struct SeasonView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(TeamStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let season = workspace.season, season.standings.total > 0 {
                    FairnessCard(season: season)
                    alerts(season)
                    PlayingTimeChart(season: season)
                    PositionGrid(season: season)
                } else {
                    EmptyCard(icon: "chart.bar.xaxis", title: "No season yet",
                              message: "Once a game is marked complete, playing time, fairness and positions show up here.")
                }
            }
            .padding(Theme.gutter)
            .frame(maxWidth: 900)
            .frame(maxWidth: .infinity)
        }
        .refreshable { await store.refresh() }
        .screenBackground()
        .navigationTitle("Season")
        .toolbar { TeamToolbar() }
        .appRoutes()
    }

    @ViewBuilder
    private func alerts(_ season: SeasonSummaryView) -> some View {
        let alerts = season.fairness.alerts.prefix(4)
        if !alerts.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader("Worth a look")
                ForEach(Array(alerts)) { alert in
                    NavigationLink(value: Route.player(alert.playerId)) {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.amber)
                            Text(alert.message).font(.subheadline).foregroundStyle(Theme.ink)
                                .multilineTextAlignment(.leading)
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Theme.inkFaint)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .card()
        }
    }
}

/// Field vs bench innings per player, against the team average.
struct PlayingTimeChart: View {
    let season: SeasonSummaryView
    @Environment(Workspace.self) private var workspace

    private struct Bar: Identifiable {
        let id: String, name: String, kind: String, innings: Int
    }

    var body: some View {
        let players = workspace.activePlayers
        let bars = players.flatMap { player -> [Bar] in
            let usage = season.usage[player.id]
            return [
                Bar(id: player.id + "f", name: workspace.name(player.id), kind: "Field", innings: usage?.defensiveInnings ?? 0),
                Bar(id: player.id + "b", name: workspace.name(player.id), kind: "Bench", innings: usage?.benchInnings ?? 0),
            ]
        }

        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Playing time")
            Chart {
                ForEach(bars) { bar in
                    BarMark(x: .value("Innings", bar.innings), y: .value("Player", bar.name))
                        .foregroundStyle(by: .value("Where", bar.kind))
                        .cornerRadius(3)
                }
                RuleMark(x: .value("Team average", season.fairness.averageDefensiveInnings))
                    .foregroundStyle(Theme.lime.opacity(0.7))
                    .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                    .annotation(position: .top, alignment: .leading) {
                        Text("avg \(season.fairness.averageDefensiveInnings, specifier: "%.1f")")
                            .font(.caption2.weight(.bold)).foregroundStyle(Theme.lime)
                    }
            }
            .chartForegroundStyleScale(["Field": Theme.emerald, "Bench": Theme.bench])
            .chartLegend(position: .bottom, alignment: .leading)
            .chartXAxis { AxisMarks { _ in AxisGridLine().foregroundStyle(Theme.stroke); AxisValueLabel() } }
            .frame(height: CGFloat(max(players.count, 1)) * 30 + 50)
        }
        .card()
    }
}

/// Every player × every position, shaded by innings played there.
struct PositionGrid: View {
    let season: SeasonSummaryView
    @Environment(Workspace.self) private var workspace

    var body: some View {
        let codes = season.positionCodes
        let players = workspace.activePlayers
        let maxValue = max(1, season.positionsByPlayer.values.flatMap(\.values).max() ?? 1)

        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Position breakdown")
            ScrollView(.horizontal, showsIndicators: false) {
                Grid(horizontalSpacing: 4, verticalSpacing: 4) {
                    GridRow {
                        Text("").frame(width: 84)
                        ForEach(codes) { code in
                            Text(code.code).font(.system(size: 11, weight: .heavy)).foregroundStyle(Theme.color(code.group))
                                .frame(width: 34)
                        }
                    }
                    ForEach(players) { player in
                        GridRow {
                            NavigationLink(value: Route.player(player.id)) {
                                Text(workspace.name(player.id)).font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink)
                                    .lineLimit(1).frame(width: 84, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                            ForEach(codes) { code in
                                let value = season.positionsByPlayer[player.id]?[code.code] ?? 0
                                cell(value, max: maxValue, color: Theme.color(code.group))
                                    .accessibilityLabel("\(workspace.name(player.id)), \(code.displayName): \(value) innings")
                            }
                        }
                    }
                }
            }
        }
        .card()
    }

    private func cell(_ value: Int, max: Int, color: Color) -> some View {
        /* Banded rather than a straight ramp, so one player with lots of
           innings at a spot does not wash out every other cell. */
        let share = Double(value) / Double(max)
        let opacity = value == 0 ? 0.04 : share < 0.25 ? 0.25 : share < 0.5 ? 0.45 : share < 0.75 ? 0.7 : 0.95
        return Text(value == 0 ? "" : "\(value)")
            .font(.system(size: 12, weight: .bold).monospacedDigit())
            .foregroundStyle(opacity > 0.6 ? Theme.onLime : Theme.ink)
            .frame(width: 34, height: 30)
            .background(color.opacity(opacity), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}
