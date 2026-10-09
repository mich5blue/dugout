import SwiftUI

struct ScheduleView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(TeamStore.self) private var store
    @State private var filter: Filter = .upcoming
    @State private var adding = false

    enum Filter: String, CaseIterable, Identifiable {
        case upcoming = "Upcoming", completed = "Completed", all = "All"
        var id: String { rawValue }
    }

    private var games: [GameView] {
        switch filter {
        case .upcoming: return workspace.upcoming
        /* Most recent first: the last game played is the one worth reopening. */
        case .completed: return workspace.orderedGames.filter { $0.status == .completed }.reversed()
        case .all: return workspace.orderedGames
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                Picker("Show", selection: $filter) {
                    ForEach(Filter.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.bottom, 6)

                if games.isEmpty {
                    EmptyCard(
                        icon: filter == .completed ? "flag.checkered" : "calendar.badge.plus",
                        title: filter == .completed ? "No games played yet" : "Nothing scheduled",
                        message: workspace.can("game:create")
                            ? "Tap + to add a game. A lineup is one tap after that."
                            : "Games your head coach adds show up here."
                    )
                } else {
                    ForEach(games) { game in
                        NavigationLink(value: Route.game(game.id)) { GameRow(game: game) }
                            .buttonStyle(.plain)
                    }
                }
            }
            .padding(Theme.gutter)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .refreshable { await store.refresh() }
        .screenBackground()
        .navigationTitle("Schedule")
        .toolbar {
            TeamToolbar()
            if workspace.can("game:create") {
                ToolbarItem(placement: .primaryAction) {
                    Button { adding = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Add game")
                }
            }
        }
        .sheet(isPresented: $adding) { AddGameSheet() }
        .appRoutes()
    }
}

struct AddGameSheet: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.dismiss) private var dismiss
    @State private var opponent = ""
    @State private var date = Date()
    @State private var innings = 6
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Opponent", text: $opponent)
                        .textInputAutocapitalization(.words)
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    Stepper("\(innings) innings", value: $innings, in: 1...12)
                } footer: {
                    Text("Everyone on the active roster starts as available. You'll mark who's out next.")
                }
                if let error {
                    Section { Text(error).foregroundStyle(Theme.danger) }
                }
            }
            .scrollContentBackground(.hidden)
            .screenBackground()
            .navigationTitle("New game")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { add() }.fontWeight(.bold)
                }
            }
        }
        .onAppear { innings = workspace.store.activeTeam?.defaultInnings ?? 6 }
        .presentationDetents([.medium, .large])
    }

    private func add() {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        do {
            _ = try workspace.newGame(opponent: opponent, date: formatter.string(from: date), innings: innings)
            Haptics.success()
            dismiss()
        } catch {
            self.error = "Couldn't create the game. \(error.localizedDescription)"
        }
    }
}
