import Foundation
import CoreGraphics

// Deliberately conservative: a continuous, dense back-and-forth gesture.
// Recognition only proposes an erase; the controller also requires a hit on old ink.
enum ScribbleEraser {
    static func recognizes(_ points: [CGPoint], zoom: CGFloat = 1, duration: TimeInterval = 1) -> Bool {
        guard points.count >= 12, duration <= 6, zoom > 0 else { return false }
        let scale = max(0.2, min(4, zoom))
        let center = points.reduce(CGPoint.zero) { CGPoint(x: $0.x + $1.x, y: $0.y + $1.y) }
        let mean = CGPoint(x: center.x / CGFloat(points.count), y: center.y / CGFloat(points.count))
        var xx: CGFloat = 0, yy: CGFloat = 0, xy: CGFloat = 0, length: CGFloat = 0
        for (index, point) in points.enumerated() {
            let x = point.x - mean.x, y = point.y - mean.y
            xx += x * x; yy += y * y; xy += x * y
            if index > 0 { length += hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) }
        }
        let angle = atan2(2 * xy, xx - yy) / 2
        let along = points.map { ($0.x - mean.x) * cos(angle) + ($0.y - mean.y) * sin(angle) }
        let across = points.map { -($0.x - mean.x) * sin(angle) + ($0.y - mean.y) * cos(angle) }
        let span = (along.max() ?? 0) - (along.min() ?? 0)
        let thickness = (across.max() ?? 0) - (across.min() ?? 0)
        guard span * scale >= 28, span * scale <= 600, thickness <= max(36 / scale, span * 0.65), length >= span * 4.5 else { return false }
        let threshold = max(10 / scale, span * 0.14)
        var direction = 0, extreme = along[0], turns = 0
        for value in along.dropFirst() {
            if direction == 0 {
                if abs(value - extreme) >= threshold { direction = value > extreme ? 1 : -1; extreme = value }
            } else if direction > 0 {
                if value > extreme { extreme = value }
                else if extreme - value >= threshold { turns += 1; direction = -1; extreme = value }
            } else {
                if value < extreme { extreme = value }
                else if value - extreme >= threshold { turns += 1; direction = 1; extreme = value }
            }
        }
        return turns >= 5
    }

    static func bounds(_ points: [CGPoint]) -> CGRect {
        guard let first = points.first else { return .null }
        return points.dropFirst().reduce(CGRect(origin: first, size: .zero)) { rect, point in
            CGRect(x: min(rect.minX, point.x), y: min(rect.minY, point.y), width: max(rect.maxX, point.x) - min(rect.minX, point.x), height: max(rect.maxY, point.y) - min(rect.minY, point.y))
        }
    }

    static func touches(_ gesture: [CGPoint], ink: [CGPoint], radius: CGFloat) -> Bool {
        guard !gesture.isEmpty, !ink.isEmpty,
              bounds(gesture).insetBy(dx: -radius, dy: -radius).intersects(bounds(ink).insetBy(dx: -0.5, dy: -0.5)) else { return false }
        let a = gesture.count == 1 ? [gesture[0], gesture[0]] : gesture
        let b = ink.count == 1 ? [ink[0], ink[0]] : ink
        for i in 1..<a.count {
            let region = bounds([a[i - 1], a[i]]).insetBy(dx: -radius, dy: -radius)
            for j in 1..<b.count where region.intersects(bounds([b[j - 1], b[j]]).insetBy(dx: -0.5, dy: -0.5)) {
                if segmentDistance(a[i - 1], a[i], b[j - 1], b[j]) <= radius { return true }
            }
        }
        return false
    }

    private static func pointDistance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
        let dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
        let t = length > 0 ? max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0
        return hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
    }
    private static func segmentDistance(_ a: CGPoint, _ b: CGPoint, _ c: CGPoint, _ d: CGPoint) -> CGFloat {
        func cross(_ p: CGPoint, _ q: CGPoint, _ r: CGPoint) -> CGFloat { (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) }
        if cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0 { return 0 }
        return min(pointDistance(a, c, d), pointDistance(b, c, d), pointDistance(c, a, b), pointDistance(d, a, b))
    }
}
