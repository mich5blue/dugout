import SwiftUI

struct MoreView: View {
    @Environment(AuthService.self) private var auth
    @Environment(TeamStore.self) private var store
    @Environment(Workspace.self) private var workspace
    @Environment(\.openURL) private var openURL

    private let config = AppConfig.current

    var body: some View {
        List {
            Section("Account") {
                LabeledContent("Signed in as", value: auth.session?.email ?? auth.session?.displayName ?? "—")
                if let team = store.activeTeam {
                    LabeledContent("Role on \(team.name)", value: workspace.role == "HEAD_COACH" ? "Head coach" : "Assistant coach")
                }
            }

            Section {
                HStack {
                    Text("Status")
                    Spacer()
                    SyncBadge(state: store.syncState)
                }
                if let last = store.lastSync {
                    LabeledContent("Last synced", value: last.formatted(.relative(presentation: .named)))
                }
                Button("Sync now") {
                    Task {
                        await store.flush()
                        await store.refresh()
                    }
                }
                ForEach(store.conflicts) { item in
                    ConflictRow(item: item)
                }
            } header: {
                Text("Sync")
            } footer: {
                Text("Changes save on this phone first and upload when there's signal. If another coach changed the same thing, you choose which to keep — nothing is overwritten silently.")
            }

            Section("Help") {
                Button("How InningGrid works") { openURL(config.webOrigin.appendingPathComponent("guide")) }
                Button("Send feedback") { openURL(config.webOrigin.appendingPathComponent("feedback")) }
                Button("Open the website") { openURL(config.webOrigin) }
            }

            Section {
                Button("Sign out", role: .destructive) {
                    store.signedOut()
                    auth.signOut()
                }
            } footer: {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Lineup engine \(CoreEngine.shared.bundleHash)")
                    if config.environment == .emulator { Text("Local emulator — test data only") }
                }
                .font(.caption2.monospaced())
            }
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("More")
        .toolbar { TeamToolbar() }
    }
}

/// A change that hit a newer server version: the coach picks.
struct ConflictRow: View {
    let item: TeamStore.OutboxItem
    @Environment(TeamStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Another coach changed this too", systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.amber)
            Text(description).font(.footnote).foregroundStyle(Theme.inkMuted)
            HStack {
                Button("Keep mine") { Task { await store.keepMine(item.path) } }
                    .buttonStyle(.bordered)
                Button("Use theirs") { Task { await store.takeTheirs(item.path) } }
                    .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, 4)
    }

    private var description: String {
        let parts = item.path.split(separator: "/")
        let kind = parts.count >= 3 ? String(parts[2]) : "item"
        let name = item.object?["opponent"]?.stringValue.map { "vs \($0)" }
            ?? item.object?["firstName"]?.stringValue
            ?? item.object?["name"]?.stringValue
            ?? ""
        return "\(kind.capitalized.dropLast()) \(name) · edited \(item.queuedAt.formatted(.relative(presentation: .named)))"
    }
}
