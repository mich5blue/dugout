import SwiftUI

struct RosterView: View {
    @Environment(Workspace.self) private var workspace
    @Environment(TeamStore.self) private var store
    @State private var adding = false
    @State private var showInactive = false

    var body: some View {
        let players = workspace.prepared?.playerViews ?? []
        let active = players.filter(\.active)
        let inactive = players.filter { !$0.active }
        let season = workspace.season

        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 0) {
                    StatTile(value: "\(active.count)", label: "Active players")
                    StatTile(value: "\(active.filter(\.canPitch).count)", label: "Can pitch", color: Theme.battery)
                    StatTile(value: "\(active.filter(\.canCatch).count)", label: "Can catch", color: Theme.battery)
                }
                .card()

                if players.isEmpty {
                    EmptyCard(icon: "person.badge.plus", title: "No players yet",
                              message: workspace.can("roster:add") ? "Tap + to add your first player." : "Your head coach hasn't added players yet.")
                }

                ForEach(active) { player in
                    NavigationLink(value: Route.player(player.id)) {
                        PlayerRow(player: player, standing: season?.standingByPlayer[player.id].flatMap(Standing.init),
                                  innings: season?.usage[player.id]?.defensiveInnings)
                    }
                    .buttonStyle(.plain)
                }

                if !inactive.isEmpty {
                    DisclosureGroup(isExpanded: $showInactive) {
                        VStack(spacing: 10) {
                            ForEach(inactive) { player in
                                NavigationLink(value: Route.player(player.id)) {
                                    PlayerRow(player: player, standing: nil, innings: nil).opacity(0.6)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.top, 8)
                    } label: {
                        Eyebrow("Inactive · \(inactive.count)")
                    }
                    .padding(.top, 8)
                }
            }
            .padding(Theme.gutter)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .refreshable { await store.refresh() }
        .screenBackground()
        .navigationTitle("Roster")
        .toolbar {
            TeamToolbar()
            if workspace.can("roster:add") {
                ToolbarItem(placement: .primaryAction) {
                    Button { adding = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Add player")
                }
            }
        }
        .sheet(isPresented: $adding) { AddPlayerSheet() }
        .appRoutes()
    }
}

struct PlayerRow: View {
    let player: PlayerView
    let standing: Standing?
    let innings: Int?
    @Environment(Workspace.self) private var workspace

    var body: some View {
        HStack(spacing: 12) {
            PlayerAvatar(player: player, size: 44, ring: player.overallTier == .core ? Theme.lime : nil)
            VStack(alignment: .leading, spacing: 3) {
                Text(workspace.fullName(player.id)).font(.headline).foregroundStyle(Theme.ink)
                HStack(spacing: 6) {
                    if player.canPitch { Tag(text: "P", color: Theme.battery) }
                    if player.canCatch { Tag(text: "C", color: Theme.battery) }
                    Text(player.overallTier.label).font(.caption).foregroundStyle(Theme.inkMuted)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                StandingTag(standing: standing)
                if let innings {
                    Text("\(innings) inn").font(.caption.monospacedDigit()).foregroundStyle(Theme.inkFaint)
                }
            }
            Image(systemName: "chevron.right").font(.footnote.weight(.bold)).foregroundStyle(Theme.inkFaint)
        }
        .card(padding: 12)
        .accessibilityElement(children: .combine)
    }
}

struct AddPlayerSheet: View {
    @Environment(Workspace.self) private var workspace
    @Environment(\.dismiss) private var dismiss
    @State private var firstName = ""
    @State private var lastInitial = ""
    @State private var jersey = ""
    @State private var added: [String] = []
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("First name", text: $firstName)
                        .textInputAutocapitalization(.words)
                        .focused($focused)
                    TextField("Last initial", text: $lastInitial)
                        .textInputAutocapitalization(.characters)
                    TextField("Jersey number", text: $jersey)
                        .keyboardType(.numberPad)
                } footer: {
                    Text("First name and a last initial only — nothing that identifies a child beyond the team.")
                }
                Section {
                    Button("Add and add another") { add(another: true) }
                        .disabled(firstName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if !added.isEmpty {
                    Section("Added") { ForEach(added, id: \.self) { Text($0) } }
                }
            }
            .scrollContentBackground(.hidden)
            .screenBackground()
            .navigationTitle("Add player")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { add(another: false) }
                        .fontWeight(.bold)
                        .disabled(firstName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear { focused = true }
        }
    }

    private func add(another: Bool) {
        try? workspace.newPlayer(firstName: firstName, lastInitial: lastInitial, jerseyNumber: jersey)
        Haptics.success()
        added.append(firstName)
        firstName = ""; lastInitial = ""; jersey = ""
        if another { focused = true } else { dismiss() }
    }
}
