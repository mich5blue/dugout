import JavaScriptCore
import XCTest
@testable import InningGrid

/// The shared engine, as the phone runs it.
final class EngineTests: XCTestCase {
    private var repo: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    }

    /// iOS's JavaScriptCore builds exactly the lineup V8 builds.
    ///
    /// `npm run check:parity` compares V8 with macOS's jsc shell and writes
    /// V8's output to parity/expected.json. This runs the same harness in the
    /// JavaScriptCore framework inside the app — the engine on the phone.
    func testBuildsTheSameLineupAsTheWebsite() throws {
        let bundle = try XCTUnwrap(Bundle.main.url(forResource: "inninggrid-core", withExtension: "js"))
        let context = try XCTUnwrap(JSContext())
        var output = ""
        let print: @convention(block) (String) -> Void = { output += $0 }
        context.setObject(print, forKeyedSubscript: "print" as NSString)
        context.exceptionHandler = { _, exception in XCTFail("JS: \(exception?.toString() ?? "?")") }

        context.evaluateScript(try String(contentsOf: bundle, encoding: .utf8))
        context.evaluateScript(try String(contentsOf: repo.appendingPathComponent("parity/harness.js"), encoding: .utf8))

        let expected = try String(contentsOf: repo.appendingPathComponent("parity/expected.json"), encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertFalse(output.hasPrefix("ERROR"), output)
        XCTAssertEqual(output, expected, "iOS JavaScriptCore and V8 built different lineups — run npm run check:parity")
    }

    func testCoreRoundTripsJSON() throws {
        let core = CoreEngine.shared
        let initial = try core.call("toLastInitial", [.string("borek")])
        XCTAssertEqual(initial, .string("B"))
        let settings = try core.call("defaultTeamSettings")
        XCTAssertEqual(settings["philosophy"], .string("BALANCED"))
    }

    func testCoreReportsScriptErrors() {
        XCTAssertThrowsError(try CoreEngine.shared.call("noSuchFunction"))
    }

    func testPermissionsMatchTheWebTable() throws {
        let assistant = try CoreEngine.shared.call("permissions", [.string("ASSISTANT")]).arrayValue?.compactMap(\.stringValue) ?? []
        XCTAssertTrue(assistant.contains("player:editEligibility"))
        XCTAssertFalse(assistant.contains("game:edit"))
        let fields = try CoreEngine.shared.call("editablePlayerFields", [.string("ASSISTANT")]).arrayValue?.compactMap(\.stringValue)
        XCTAssertEqual(Set(fields ?? []), ["positionRatings", "overallTier", "canPitch", "canCatch"])
        XCTAssertEqual(try CoreEngine.shared.call("editablePlayerFields", [.string("HEAD_COACH")]), .null)
    }
}
