import Foundation

/// Which Firebase project the app talks to, and how to reach it.
///
/// **Debug builds use the local emulators** unless explicitly told otherwise.
/// Everything run during development — by hand, by a test, by an agent — lands
/// in `demo-inninggrid`, which cannot reach any real project, so it cannot
/// write to a coach's actual team.
///
/// To run a Debug build against the real project on your own phone, set the
/// scheme environment variable `INNINGGRID_ENV=production` (Product → Scheme →
/// Edit Scheme → Run → Arguments). It is off in the committed scheme, on
/// purpose. Release builds always use production.
struct AppConfig: Sendable {
    enum Environment: String, Sendable { case emulator, production }

    let environment: Environment
    let projectId: String
    let apiKey: String
    /// Where `/native-auth` lives: the sign-in bridge to existing web accounts.
    let webOrigin: URL
    /// For the emulators, e.g. 127.0.0.1. Nil in production.
    let emulatorHost: String?

    var firestoreBase: URL {
        if let host = emulatorHost {
            return URL(string: "http://\(host):8089/v1/projects/\(projectId)/databases/(default)/documents")!
        }
        return URL(string: "https://firestore.googleapis.com/v1/projects/\(projectId)/databases/(default)/documents")!
    }

    /// The parent for `:runQuery` and `:commit`, without the trailing collection.
    var databasePath: String { "projects/\(projectId)/databases/(default)" }

    var firestoreRoot: URL {
        if let host = emulatorHost {
            return URL(string: "http://\(host):8089/v1/\(databasePath)")!
        }
        return URL(string: "https://firestore.googleapis.com/v1/\(databasePath)")!
    }

    func identityToolkit(_ method: String) -> URL {
        let base = emulatorHost.map { "http://\($0):9099/identitytoolkit.googleapis.com" }
            ?? "https://identitytoolkit.googleapis.com"
        return URL(string: "\(base)/v1/\(method)?key=\(apiKey)")!
    }

    var secureTokenURL: URL {
        let base = emulatorHost.map { "http://\($0):9099/securetoken.googleapis.com" }
            ?? "https://securetoken.googleapis.com"
        return URL(string: "\(base)/v1/token?key=\(apiKey)")!
    }

    static let current: AppConfig = load()

    private struct File: Decodable {
        struct Project: Decodable { let apiKey: String; let projectId: String }
        struct Emulator: Decodable { let projectId: String; let apiKey: String; let host: String }
        let webOrigin: String
        let production: Project?
        let emulator: Emulator
    }

    private static func load() -> AppConfig {
        let file = Bundle.main.url(forResource: "Config", withExtension: "json")
            .flatMap { try? Data(contentsOf: $0) }
            .flatMap { try? JSONDecoder().decode(File.self, from: $0) }

        let origin = URL(string: file?.webOrigin ?? "https://dugout-lineups.netlify.app")!
        let emulator = file?.emulator

        #if DEBUG
        if ProcessInfo.processInfo.environment["INNINGGRID_ENV"] == "production",
           let production = file?.production {
            return AppConfig(
                environment: .production,
                projectId: production.projectId,
                apiKey: production.apiKey,
                webOrigin: origin,
                emulatorHost: nil
            )
        }
        return AppConfig(
            environment: .emulator,
            projectId: emulator?.projectId ?? "demo-inninggrid",
            apiKey: emulator?.apiKey ?? "emulator-key",
            webOrigin: origin,
            emulatorHost: emulator?.host ?? "127.0.0.1"
        )
        #else
        guard let production = file?.production else {
            fatalError("Config.json has no production Firebase project. Run `node scripts/ios_config.mjs` before archiving.")
        }
        return AppConfig(
            environment: .production,
            projectId: production.projectId,
            apiKey: production.apiKey,
            webOrigin: origin,
            emulatorHost: nil
        )
        #endif
    }
}
