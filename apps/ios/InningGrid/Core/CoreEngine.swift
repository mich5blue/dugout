import Foundation
import JavaScriptCore
import os

/// Runs InningGrid's shared TypeScript core inside JavaScriptCore.
///
/// This is the whole reason a lineup built on the iPhone matches one built on
/// the web: it is the *same code* — `src/core/api.ts`, bundled by
/// `scripts/build_core.mjs` — not a Swift port of it. `scripts/check_parity.mjs`
/// proves the bundle prints byte-identical lineups on V8 and on JavaScriptCore.
///
/// A `JSContext` is not thread-safe, so every call is serialised on one queue.
/// Generation can take a second or two; that happens on the queue, never on
/// the main thread.
final class CoreEngine: @unchecked Sendable {
    enum CoreError: LocalizedError {
        case bundleMissing
        case versionMismatch(found: Int, expected: Int)
        case script(String)
        case badResult(String)

        var errorDescription: String? {
            switch self {
            case .bundleMissing:
                return "The lineup engine is missing from the app. Reinstall InningGrid."
            case .versionMismatch(let found, let expected):
                return "The lineup engine is version \(found) but the app expects \(expected). Update InningGrid."
            case .script(let message):
                return "The lineup engine hit an error: \(message)"
            case .badResult(let name):
                return "The lineup engine returned something unexpected from \(name)."
            }
        }
    }

    /// Bump with `CORE_VERSION` in src/core/api.ts when a function's contract changes.
    static let expectedVersion = 1

    static let shared: CoreEngine = {
        do { return try CoreEngine() } catch { fatalError("\(error.localizedDescription)") }
    }()

    private let context: JSContext
    private let queue = DispatchQueue(label: "app.inninggrid.core", qos: .userInitiated)
    private let log = Logger(subsystem: "app.inninggrid", category: "core")
    private var lastException: String?

    /// The bundle's content hash, logged with every lineup so a web/iOS
    /// disagreement can be traced to the exact engine build.
    let bundleHash: String

    init(bundle: Bundle = .main) throws {
        guard
            let url = bundle.url(forResource: "inninggrid-core", withExtension: "js"),
            let source = try? String(contentsOf: url, encoding: .utf8)
        else { throw CoreError.bundleMissing }

        bundleHash = source.split(separator: "\n").first.map(String.init)?
            .components(separatedBy: " ").dropFirst(2).first ?? "unknown"

        guard let context = JSContext() else { throw CoreError.script("could not create a JavaScript context") }
        self.context = context
        context.name = "InningGrid core"

        context.exceptionHandler = { [weak self] _, exception in
            let message = exception?.objectForKeyedSubscript("stack")?.toString()
                ?? exception?.toString() ?? "unknown error"
            self?.lastException = message
        }

        /*
          The two platform calls the core can reach. A real UUID source rather
          than createId's Math.random fallback, and a console that lands in the
          system log instead of nowhere.
        */
        let randomUUID: @convention(block) () -> String = { UUID().uuidString.lowercased() }
        let crypto = JSValue(newObjectIn: context)
        crypto?.setObject(randomUUID, forKeyedSubscript: "randomUUID" as NSString)
        context.setObject(crypto, forKeyedSubscript: "crypto" as NSString)

        let consoleLog: @convention(block) (String) -> Void = { [log] message in
            log.debug("\(message, privacy: .public)")
        }
        let console = JSValue(newObjectIn: context)
        console?.setObject(consoleLog, forKeyedSubscript: "log" as NSString)
        console?.setObject(consoleLog, forKeyedSubscript: "warn" as NSString)
        console?.setObject(consoleLog, forKeyedSubscript: "error" as NSString)
        context.setObject(console, forKeyedSubscript: "console" as NSString)

        context.evaluateScript(source, withSourceURL: url)
        if let error = lastException { throw CoreError.script(error) }

        /*
          JSON text across the boundary, both ways. JSValue's own conversion
          turns undefined into null, loses integer/float distinctions and
          mangles nested dates; JSON.parse/stringify keep every document
          exactly as the web serialises it.
        */
        context.evaluateScript("""
            globalThis.__igCall = function (name, args) {
              var fn = InningGridCore[name];
              if (typeof fn !== 'function') throw new Error('No core function named ' + name);
              var out = fn.apply(null, JSON.parse(args));
              return JSON.stringify(out === undefined ? null : out);
            };
            """)

        let version = context.evaluateScript("InningGridCore.version")?.toInt32() ?? -1
        guard version == Self.expectedVersion else {
            throw CoreError.versionMismatch(found: Int(version), expected: Self.expectedVersion)
        }
        log.info("core \(self.bundleHash, privacy: .public) loaded")
    }

    // MARK: - Calls

    /// Call a synchronous core function with JSON-encodable arguments.
    func call(_ name: String, _ arguments: [JSONValue] = []) throws -> JSONValue {
        try queue.sync { try invoke(name, arguments) }
    }

    /// The same, off the caller's thread.
    func run(_ name: String, _ arguments: [JSONValue] = []) async throws -> JSONValue {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                do { continuation.resume(returning: try self.invoke(name, arguments)) }
                catch { continuation.resume(throwing: error) }
            }
        }
    }

    /*
      There is deliberately no promise-based call. JavaScriptCore does not run
      promise callbacks when control returns to Swift, so an awaited core
      function never settles — that is how the first build of this bridge hung
      on `generate`. Every core function is synchronous; `run` moves the work
      off the caller's thread instead.
    */

    private func invoke(_ name: String, _ arguments: [JSONValue]) throws -> JSONValue {
        lastException = nil
        let argumentText = String(decoding: try JSONValue.array(arguments).jsonData(), as: UTF8.self)
        let result = context.objectForKeyedSubscript("__igCall")?
            .call(withArguments: [name, argumentText])
        if let error = lastException { throw CoreError.script(error) }
        guard let text = result?.toString(), let data = text.data(using: .utf8) else {
            throw CoreError.badResult(name)
        }
        return try JSONValue.parse(data)
    }
}
