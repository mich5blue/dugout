import SwiftUI

/// A baseball field with something drawn at every position.
///
/// Positions are placed by the formation's own `diagramX`/`diagramY` (0–100,
/// home plate at the bottom) — the coordinates the website's field view uses —
/// so a custom formation lands in the same spots on both.
struct FieldDiagram<Marker: View>: View {
    let positions: [Position]
    @ViewBuilder var marker: (Position) -> Marker

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack {
                FieldShape().fill(
                    LinearGradient(colors: [Theme.grass.opacity(0.95), Theme.grass.opacity(0.55)],
                                   startPoint: .top, endPoint: .bottom)
                )
                FieldShape().stroke(Theme.emerald.opacity(0.25), lineWidth: 1)
                InfieldDirt().fill(Theme.dirt.opacity(0.55))
                Diamond().stroke(Color.white.opacity(0.35), lineWidth: 1.5)
                ForEach(Bases.points, id: \.x) { point in
                    Rectangle()
                        .fill(Color.white.opacity(0.8))
                        .frame(width: 7, height: 7)
                        .rotationEffect(.degrees(45))
                        .position(x: point.x / 100 * size.width, y: point.y / 100 * size.height)
                }

                ForEach(placed) { position in
                    marker(position)
                        .position(x: (position.diagramX ?? 50) / 100 * size.width,
                                  y: (position.diagramY ?? 50) / 100 * size.height)
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
        /* The outfield fan is drawn past the square on purpose, so the corners
           read as foul territory; the clip keeps it inside its card. */
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private var placed: [Position] { positions.filter { $0.diagramX != nil && $0.diagramY != nil } }
}

private enum Bases {
    static let home = CGPoint(x: 50, y: 90)
    static let first = CGPoint(x: 70, y: 66)
    static let second = CGPoint(x: 50, y: 44)
    static let third = CGPoint(x: 30, y: 66)
    static let points = [first, second, third]
}

private func scaled(_ point: CGPoint, _ rect: CGRect) -> CGPoint {
    CGPoint(x: rect.minX + point.x / 100 * rect.width, y: rect.minY + point.y / 100 * rect.height)
}

/// The fair-territory fan, from home plate out to the fence.
private struct FieldShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let home = scaled(Bases.home, rect)
        path.move(to: home)
        path.addArc(center: home, radius: rect.width * 0.86,
                    startAngle: .degrees(-135), endAngle: .degrees(-45), clockwise: false)
        path.closeSubpath()
        return path
    }
}

private struct InfieldDirt: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let home = scaled(Bases.home, rect)
        path.move(to: home)
        path.addArc(center: home, radius: rect.width * 0.5,
                    startAngle: .degrees(-135), endAngle: .degrees(-45), clockwise: false)
        path.closeSubpath()
        return path
    }
}

private struct Diamond: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: scaled(Bases.home, rect))
        path.addLine(to: scaled(Bases.first, rect))
        path.addLine(to: scaled(Bases.second, rect))
        path.addLine(to: scaled(Bases.third, rect))
        path.closeSubpath()
        return path
    }
}
