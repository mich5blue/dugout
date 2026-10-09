import SwiftUI

/// What a cell tap opens: one player, one inning.
struct CellTarget: Identifiable, Hashable {
    let playerId: String
    let inning: Int
    var id: String { "\(playerId)#\(inning)" }
}

/// An empty position someone needs to fill.
struct OpenTarget: Identifiable, Hashable {
    let positionId: String
    let code: String
    let inning: Int
    var id: String { "\(positionId)#\(inning)" }
}

struct PositionOptionsView: Decodable, Sendable {
    struct Option: Decodable, Sendable, Hashable, Identifiable {
        let positionId: String
        let code: String
        let displayName: String
        let group: PositionGroup
        let blocked: String?
        let occupantId: String?
        let current: Bool
        var id: String { positionId }
    }
    let state: SlotView.State
    let options: [Option]
}

struct WhyView: Decodable, Sendable {
    struct Reason: Decodable, Sendable, Hashable { let text: String; let coachSet: Bool? }
    let headline: String
    let reasons: [Reason]
}

/// "Move Brody": every position this inning, and what taking it would do.
///
/// Taking an occupied spot swaps the two players — that is what the core's
/// `movePlayer` does, and what a coach means by "put Brody at shortstop".
struct MovePlayerSheet: View {
    let gameId: String
    let target: CellTarget
    @Environment(Workspace.self) private var workspace
    @Environment(\.dismiss) private var dismiss
    @State private var showWhy = false

    var body: some View {
        let options = load()
        let lineup = workspace.lineup(for: gameId)
        let name = workspace.name(target.playerId)

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let why = loadWhy() {
                        VStack(alignment: .leading, spacing: 8) {
                            Button {
                                withAnimation(.snappy) { showWhy.toggle() }
                            } label: {
                                HStack(alignment: .top) {
                                    Text(why.headline).font(.subheadline).foregroundStyle(Theme.ink)
                                        .multilineTextAlignment(.leading)
                                    Spacer()
                                    Text(showWhy ? "Hide" : "Why?").font(.footnote.weight(.bold)).foregroundStyle(Theme.lime)
                                }
                            }
                            .buttonStyle(.plain)
                            if showWhy {
                                ForEach(why.reasons, id: \.self) { reason in
                                    HStack(alignment: .top, spacing: 8) {
                                        Circle().fill(reason.coachSet == true ? Theme.lime : Theme.strokeStrong)
                                            .frame(width: 6, height: 6).padding(.top, 6)
                                        (reason.coachSet == true ? Text("Your call: ").bold().foregroundColor(Theme.ink) : Text(""))
                                            + Text(reason.text).foregroundColor(Theme.inkMuted)
                                    }
                                    .font(.footnote)
                                }
                            }
                        }
                        .card(padding: 12)
                    }

                    if options?.state == .out {
                        Text("\(name) isn't available this inning. Change that in Who's here.")
                            .font(.subheadline).foregroundStyle(Theme.inkMuted)
                    } else if let options {
                        ForEach([PositionGroup.battery, .infield, .outfield], id: \.self) { group in
                            let inGroup = options.options.filter { $0.group == group }
                            if !inGroup.isEmpty {
                                VStack(alignment: .leading, spacing: 8) {
                                    Eyebrow(group == .battery ? "Pitcher & catcher" : group == .infield ? "Infield" : "Outfield",
                                            color: Theme.color(group))
                                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 8)], spacing: 8) {
                                        ForEach(inGroup) { option in
                                            optionButton(option, lineup: lineup)
                                        }
                                    }
                                }
                            }
                        }

                        Button(options.state == .rest ? "Already resting" : "Rest this inning") {
                            workspace.edit(gameId, "restPlayer", [.array(workspace.prepared?.players ?? []), .string(target.playerId), .number(Double(target.inning))])
                            Haptics.tap()
                            dismiss()
                        }
                        .buttonStyle(.secondary)
                        .disabled(options.state == .rest)

                        if let current = options.options.first(where: \.current) {
                            let locked = lineup?.cell(target.inning, current.positionId)?.locked ?? false
                            Button {
                                workspace.edit(gameId, "toggleLock", [.number(Double(target.inning)), .string(current.positionId)])
                                Haptics.tap()
                            } label: {
                                Label(locked ? "Unlock \(current.code)" : "Lock \(name) at \(current.code)",
                                      systemImage: locked ? "lock.open" : "lock.fill")
                            }
                            .buttonStyle(.secondary)
                            Text("Locked spots stay put when you rebuild the lineup.")
                                .font(.footnote).foregroundStyle(Theme.inkFaint)
                        }
                    }
                }
                .padding(Theme.gutter)
            }
            .screenBackground()
            .navigationTitle("\(name) · inning \(target.inning)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func optionButton(_ option: PositionOptionsView.Option, lineup: LineupView?) -> some View {
        let subtitle: String = {
            if option.blocked != nil { return "Not eligible" }
            if option.current { return "Here now" }
            if let occupant = option.occupantId { return "Swap with \(lineup?.short(occupant) ?? workspace.name(occupant))" }
            return "Open"
        }()
        return Button {
            workspace.edit(gameId, "movePlayer", [.string(target.playerId), .number(Double(target.inning)), .string(option.positionId)])
            Haptics.tap()
            dismiss()
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(option.code).font(.display(20)).foregroundStyle(Theme.color(option.group))
                Text(subtitle).font(.caption).foregroundStyle(Theme.inkMuted).lineLimit(1)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(option.current ? Theme.color(option.group).opacity(0.18) : Theme.surfaceRaised,
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(option.current ? Theme.lime : Theme.stroke))
            .opacity(option.blocked != nil ? 0.45 : 1)
        }
        .buttonStyle(.plain)
        .disabled(option.blocked != nil || option.current)
        .accessibilityLabel("\(option.displayName). \(option.blocked ?? subtitle)")
    }

    private func load() -> PositionOptionsView? {
        guard let raw = workspace.rawGame(gameId), let players = workspace.prepared?.players else { return nil }
        return try? workspace.core.call("positionOptions", [raw, .array(players), .string(target.playerId), .number(Double(target.inning))])
            .decode(PositionOptionsView.self)
    }

    private func loadWhy() -> WhyView? {
        guard let raw = workspace.rawGame(gameId), let prepared = workspace.prepared else { return nil }
        return try? workspace.core.call("whyAssignment", [raw, .array(prepared.players), .string(target.playerId),
                                                         .number(Double(target.inning)), .array(prepared.games)])
            .decode(WhyView.self)
    }
}

/// An empty position: pick who to put there from whoever is resting.
struct FillPositionSheet: View {
    let gameId: String
    let target: OpenTarget
    @Environment(Workspace.self) private var workspace
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let resting = workspace.lineup(for: gameId)?.benchAt(target.inning) ?? []
        NavigationStack {
            List {
                if resting.isEmpty {
                    Text("Nobody is resting this inning. Move someone from another position instead.")
                        .foregroundStyle(Theme.inkMuted)
                }
                ForEach(resting, id: \.self) { playerId in
                    Button {
                        workspace.edit(gameId, "movePlayer", [.string(playerId), .number(Double(target.inning)), .string(target.positionId)])
                        Haptics.tap()
                        dismiss()
                    } label: {
                        HStack {
                            PlayerAvatar(player: workspace.player(playerId), size: 32)
                            Text(workspace.fullName(playerId)).foregroundStyle(Theme.ink)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .screenBackground()
            .navigationTitle("\(target.code) · inning \(target.inning)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}

/// The batting order, editable: drag to reorder, lock a slot, rotate, rebuild.
struct BattingEditor: View {
    let gameId: String
    let lineup: LineupView
    @Environment(Workspace.self) private var workspace

    var body: some View {
        let canRotate = (try? workspace.core.call("canRotateBatting", [workspace.rawGame(gameId) ?? .null, .array(workspace.prepared?.games ?? [])]))?.boolValue ?? false

        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Button {
                    workspace.regenerateBattingOrder(gameId)
                    Haptics.tap()
                } label: { Label("New order", systemImage: "sparkles") }
                    .buttonStyle(.secondary)
                if canRotate {
                    Menu {
                        ForEach(1...3, id: \.self) { offset in
                            Button("Everyone moves up \(offset)") {
                                workspace.edit(gameId, "rotateBattingFromPrevious",
                                               [.array(workspace.prepared?.games ?? []), .array(workspace.prepared?.players ?? []), .number(Double(offset))])
                                Haptics.tap()
                            }
                        }
                    } label: {
                        Label("Rotate from last game", systemImage: "arrow.up.arrow.down")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Theme.ink)
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.strokeStrong))
                    }
                }
            }

            List {
                ForEach(lineup.battingOrder) { entry in
                    HStack(spacing: 12) {
                        Text("\(entry.slot)").font(.display(22)).monospacedDigit()
                            .foregroundStyle(entry.slot <= 3 ? Theme.lime : Theme.inkMuted)
                            .frame(width: 30)
                        PlayerAvatar(player: workspace.player(entry.playerId), size: 32)
                        Text(lineup.names[entry.playerId]?.full ?? "Player").font(.headline).foregroundStyle(Theme.ink)
                        Spacer()
                        Button {
                            workspace.edit(gameId, "setBattingSlotLocked", [.string(entry.playerId), .bool(!entry.locked)])
                            Haptics.tap()
                        } label: {
                            Image(systemName: entry.locked ? "lock.fill" : "lock.open")
                                .foregroundStyle(entry.locked ? Theme.lime : Theme.inkFaint)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(entry.locked ? "Unlock batting slot" : "Lock batting slot")
                    }
                    .listRowBackground(Theme.surface)
                }
                .onMove { from, to in
                    var ids = lineup.battingOrder.map(\.playerId)
                    ids.move(fromOffsets: from, toOffset: to)
                    workspace.edit(gameId, "reorderBatting", [.array(ids.map(JSONValue.string))])
                    Haptics.tap()
                }
            }
            .environment(\.editMode, .constant(.active))
            .listStyle(.plain)
            .scrollDisabled(true)
            .frame(height: CGFloat(lineup.battingOrder.count) * 58)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))

            Text("Drag to reorder. Locked hitters keep their spot when you ask for a new order.")
                .font(.footnote).foregroundStyle(Theme.inkFaint)
        }
    }
}

extension Workspace {
    /// The /s/ link the website renders, and the group-chat text.
    func shareItems(_ gameId: String) -> (url: URL?, text: String)? {
        guard let raw = rawGame(gameId), let prepared else { return nil }
        let text = (try? core.call("shareText", [prepared.team, raw, .array(prepared.players)]).stringValue) ?? ""
        var url: URL?
        if let json = try? core.call("sharePayloadJson", [prepared.team, raw, .array(prepared.players)]).stringValue,
           let data = json.data(using: .utf8) {
            /* `u` + base64url: the uncompressed token decodeShare accepts. */
            let token = "u" + data.base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
            url = AppConfig.current.webOrigin.appendingPathComponent("s").appendingPathComponent(token)
        }
        return (url, text)
    }
}
