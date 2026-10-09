import SwiftUI

/// Every screen a tab can push. One list, so any tab can open any game.
enum Route: Hashable {
    case game(String)
    case build(String)
    case live(String)
    case player(String)

    /// Where the core's next action for a game goes.
    static func next(_ action: NextActionView, gameId: String) -> Route {
        switch action.kind {
        case "CONFIRM_ATTENDANCE", "GENERATE": return .build(gameId)
        case "START_GAME": return .live(gameId)
        default: return .game(gameId)
        }
    }
}

extension View {
    func appRoutes() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .game(let id): GameDetailView(gameId: id)
            case .build(let id): BuildLineupView(gameId: id)
            case .live(let id): GameDayView(gameId: id)
            case .player(let id): PlayerProfileView(playerId: id)
            }
        }
    }
}

/// The team switcher and sync status, on every tab's top bar.
struct TeamToolbar: ToolbarContent {
    @Environment(TeamStore.self) private var store

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            if store.teams.count > 1 {
                Menu {
                    ForEach(store.teams) { team in
                        Button {
                            store.activeTeamId = team.id
                            Haptics.tap()
                        } label: {
                            if team.id == store.activeTeam?.id { Label(team.name, systemImage: "checkmark") }
                            else { Text(team.name) }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(store.activeTeam?.name ?? "Team").font(.headline)
                        Image(systemName: "chevron.down").font(.caption.weight(.bold))
                    }
                    .foregroundStyle(Theme.ink)
                }
                .accessibilityLabel("Switch team, current \(store.activeTeam?.name ?? "none")")
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            SyncBadge(state: store.syncState)
        }
    }
}
