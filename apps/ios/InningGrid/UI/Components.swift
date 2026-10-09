import SwiftUI

// MARK: - Cards

struct CardModifier: ViewModifier {
    var padding: CGFloat = 16
    var highlighted = false

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .strokeBorder(highlighted ? Theme.lime.opacity(0.45) : Theme.stroke, lineWidth: 1)
            )
    }
}

extension View {
    func card(padding: CGFloat = 16, highlighted: Bool = false) -> some View {
        modifier(CardModifier(padding: padding, highlighted: highlighted))
    }

    /// The app background, edge to edge.
    func screenBackground() -> some View {
        background(Theme.background.ignoresSafeArea())
    }
}

/// The small spaced-out label that starts a section.
struct Eyebrow: View {
    let text: String
    var color: Color = Theme.inkMuted

    init(_ text: String, color: Color = Theme.inkMuted) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text.uppercased())
            .font(.eyebrow)
            .tracking(1.2)
            .foregroundStyle(color)
            .accessibilityAddTraits(.isHeader)
    }
}

struct SectionHeader<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: Trailing

    init(_ title: String, @ViewBuilder trailing: () -> Trailing = { EmptyView() }) {
        self.title = title
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Eyebrow(title)
            Spacer()
            trailing
        }
    }
}

// MARK: - Buttons

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .heavy).width(.condensed))
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Theme.onLime)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(Theme.lime.opacity(isEnabled ? 1 : 0.35), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.strokeStrong))
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var primary: PrimaryButtonStyle { PrimaryButtonStyle() }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var secondary: SecondaryButtonStyle { SecondaryButtonStyle() }
}

// MARK: - Tags and badges

struct Tag: View {
    let text: String
    var color: Color = Theme.inkMuted
    var filled = false

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .bold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .foregroundStyle(filled ? Theme.onLime : color)
            .background(filled ? color : color.opacity(0.14), in: Capsule())
    }
}

/// Whether what the coach sees is what the server has.
struct SyncBadge: View {
    let state: TeamStore.SyncState

    var body: some View {
        HStack(spacing: 6) {
            if case .syncing = state {
                ProgressView().controlSize(.mini).tint(Theme.inkMuted)
            } else {
                Image(systemName: icon).font(.system(size: 11, weight: .bold))
            }
            Text(state.label).font(.system(size: 12, weight: .semibold))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(color.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Sync: \(state.label)")
    }

    private var icon: String {
        switch state {
        case .idle: return "checkmark.icloud"
        case .syncing: return "arrow.triangle.2.circlepath"
        case .pending: return "icloud.and.arrow.up"
        case .offline: return "icloud.slash"
        case .conflict: return "exclamationmark.triangle"
        case .failed: return "exclamationmark.icloud"
        }
    }

    private var color: Color {
        switch state {
        case .idle: return Theme.emerald
        case .syncing, .pending: return Theme.inkMuted
        case .offline: return Theme.amber
        case .conflict, .failed: return Theme.danger
        }
    }
}

/// A player's chip: jersey number when there is one, otherwise initials.
struct PlayerAvatar: View {
    let player: PlayerView?
    var size: CGFloat = 40
    var ring: Color? = nil

    var body: some View {
        ZStack {
            Circle().fill(Theme.surfaceRaised)
            Text(label)
                .font(.display(size * 0.42))
                .foregroundStyle(Theme.ink)
                .minimumScaleFactor(0.6)
        }
        .frame(width: size, height: size)
        .overlay(Circle().strokeBorder(ring ?? Theme.strokeStrong, lineWidth: ring == nil ? 1 : 2))
        .accessibilityHidden(true)
    }

    private var label: String {
        if let number = player?.jerseyNumber, !number.isEmpty { return number }
        let first = player?.firstName.first.map(String.init) ?? "?"
        return first + (player?.lastInitial ?? "")
    }
}

/// One big number with a label under it.
struct StatTile: View {
    let value: String
    let label: String
    var color: Color = Theme.ink

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.display(34))
                .foregroundStyle(color)
                .monospacedDigit()
                .contentTransition(.numericText())
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.inkMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct StandingTag: View {
    let standing: Standing?

    var body: some View {
        if let standing {
            Tag(text: standing.label, color: Theme.color(standing))
        }
    }
}

// MARK: - Empty and loading

struct EmptyCard: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 30, weight: .semibold)).foregroundStyle(Theme.lime)
            Text(title).font(.display(22)).foregroundStyle(Theme.ink)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Theme.inkMuted)
                .multilineTextAlignment(.center)
        }
        .padding(.vertical, 28)
        .card()
    }
}

// MARK: - Haptics

enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
}

// MARK: - Dates

enum GameDate {
    private static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate(format)
        return formatter
    }

    private static let short = formatter("EEEMMMd")
    private static let long = formatter("EEEEMMMMd")
    private static let month = formatter("MMM")
    private static let dayNumber = formatter("d")
    private static let weekday = formatter("EEE")

    static func short(_ game: GameView) -> String { game.day.map(short.string) ?? game.date }
    static func long(_ game: GameView) -> String { game.day.map(long.string) ?? game.date }
    static func month(_ game: GameView) -> String { game.day.map(month.string)?.uppercased() ?? "" }
    static func dayNumber(_ game: GameView) -> String { game.day.map(dayNumber.string) ?? "" }
    static func weekday(_ game: GameView) -> String { game.day.map(weekday.string)?.uppercased() ?? "" }

    /// "Today", "Tomorrow", "In 5 days", "3 days ago".
    static func relative(_ game: GameView) -> String {
        guard let day = game.day else { return "" }
        let calendar = Calendar.current
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: Date()), to: calendar.startOfDay(for: day)).day ?? 0
        switch days {
        case 0: return "Today"
        case 1: return "Tomorrow"
        case -1: return "Yesterday"
        case 2...: return "In \(days) days"
        default: return "\(-days) days ago"
        }
    }
}

/// The calendar block on a game row.
struct DateBlock: View {
    let game: GameView
    var accent = false

    var body: some View {
        VStack(spacing: 0) {
            Text(GameDate.month(game)).font(.system(size: 11, weight: .bold)).foregroundStyle(accent ? Theme.onLime : Theme.inkMuted)
            Text(GameDate.dayNumber(game)).font(.display(26)).foregroundStyle(accent ? Theme.onLime : Theme.ink)
        }
        .frame(width: 52, height: 56)
        .background(accent ? Theme.lime : Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityHidden(true)
    }
}
