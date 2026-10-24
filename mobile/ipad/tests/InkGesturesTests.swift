import Foundation
import CoreGraphics

@main struct InkGesturesTests {
    static func main() {
        var checks = 0
        func check(_ value: Bool, _ message: String) { precondition(value, message); checks += 1 }
        var zigzag = [CGPoint]()
        for sweep in 0..<9 { for n in 0...20 {
            let x = sweep % 2 == 0 ? n * 5 : 100 - n * 5
            zigzag.append(CGPoint(x: x, y: 40 + sweep * 2))
        } }
        check(ScribbleEraser.recognizes(zigzag), "Repeated back-and-forth should erase")
        check(ScribbleEraser.recognizes(zigzag.map { CGPoint(x: $0.x * 2, y: $0.y * 2) }, zoom: 0.5), "Zoom should preserve recognition")
        check(!ScribbleEraser.recognizes((0..<60).map { CGPoint(x: $0 * 4, y: 40) }), "A straight line must remain ink")
        let circle = (0...100).map { n in CGPoint(x: 100 + 50 * cos(Double(n) * .pi / 50), y: 100 + 50 * sin(Double(n) * .pi / 50)) }
        check(!ScribbleEraser.recognizes(circle), "A normal circle must remain ink")
        check(!ScribbleEraser.recognizes(zigzag.map { CGPoint(x: $0.x / 10, y: $0.y / 10) }), "Small handwriting must remain ink")
        check(!ScribbleEraser.recognizes(zigzag, duration: 9), "Long deliberate hatching should not trigger")
        check(!ScribbleEraser.recognizes([]), "Empty input")
        check(ScribbleEraser.touches([CGPoint(x: 0, y: 0), CGPoint(x: 100, y: 100)], ink: [CGPoint(x: 0, y: 100), CGPoint(x: 100, y: 0)], radius: 2), "Crossing segments hit without coincident samples")
        check(!ScribbleEraser.touches([CGPoint(x: 0, y: 0), CGPoint(x: 100, y: 0)], ink: [CGPoint(x: 0, y: 30), CGPoint(x: 100, y: 30)], radius: 6), "Nearby untouched ink must survive")
        check(ScribbleEraser.touches(zigzag, ink: [CGPoint(x: 50, y: 20), CGPoint(x: 50, y: 100)], radius: 6), "Scribble intersects old text")
        check(!ScribbleEraser.touches(zigzag, ink: [CGPoint(x: 200, y: 20), CGPoint(x: 200, y: 100)], radius: 6), "Outside ink must survive")
        print("Ink gesture checks passed: \(checks)")
    }
}
