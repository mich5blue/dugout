import SwiftUI
import UIKit

/// The InningGrid look: night-game dark, one electric accent, and a colour per
/// part of the field that means the same thing on every screen.
enum Theme {
    // MARK: Surfaces
    static let background = Color(hex: 0x070B0A)
    static let surface = Color(hex: 0x0E1513)
    static let surfaceRaised = Color(hex: 0x151E1B)
    static let stroke = Color.white.opacity(0.08)
    static let strokeStrong = Color.white.opacity(0.16)

    // MARK: Ink
    static let ink = Color(hex: 0xF2F5F3)
    static let inkMuted = Color(hex: 0xF2F5F3).opacity(0.62)
    static let inkFaint = Color(hex: 0xF2F5F3).opacity(0.38)

    // MARK: Accent and status
    static let lime = Color(hex: 0xD4FF3D)
    static let onLime = Color(hex: 0x0A0F05)
    static let emerald = Color(hex: 0x2BD98A)
    static let amber = Color(hex: 0xFFB547)
    static let danger = Color(hex: 0xFF5A5A)

    // MARK: The field
    static let battery = Color(hex: 0xFF5C8F)
    static let infield = Color(hex: 0x4FE8E8)
    static let outfield = Color(hex: 0xAB82FF)
    static let bench = Color(hex: 0x5B6461)
    static let grass = Color(hex: 0x0F2A1C)
    static let dirt = Color(hex: 0x3A2A1C)

    static func color(_ group: PositionGroup?) -> Color {
        switch group {
        case .battery: return battery
        case .infield: return infield
        case .outfield: return outfield
        case .bench, .none: return bench
        }
    }

    static func color(_ standing: Standing?) -> Color {
        switch standing {
        case .owed: return amber
        case .onTarget: return emerald
        case .ahead: return infield
        case .none: return inkFaint
        }
    }

    // MARK: Shape
    static let radius: CGFloat = 18
    static let radiusSmall: CGFloat = 12
    static let gutter: CGFloat = 16
}

extension Font {
    /// Big condensed numerals and headlines — the scoreboard voice.
    ///
    /// Scaled with the coach's text size like every system style, but capped:
    /// a 76-point inning number at the largest accessibility size would no
    /// longer fit on the screen it is there to be read from.
    static func display(_ size: CGFloat, weight: Font.Weight = .heavy) -> Font {
        let scaled = UIFontMetrics(forTextStyle: .title1).scaledValue(for: size)
        return .system(size: min(scaled, size * 1.5), weight: weight).width(.condensed)
    }

    /// Small caps-style label above a section.
    static var eyebrow: Font {
        .system(size: min(UIFontMetrics(forTextStyle: .caption1).scaledValue(for: 12), 20), weight: .bold).width(.expanded)
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}
