import Foundation
import Observation
import os

/// The signed-in coach.
struct AuthSession: Codable, Sendable, Equatable {
    let uid: String
    let email: String?
    let displayName: String?
    var idToken: String
    var refreshToken: String
    var expiresAt: Date

    var initials: String {
        let source = displayName ?? email ?? "?"
        let parts = source.split(whereSeparator: { $0 == " " || $0 == "." || $0 == "@" })
        return parts.prefix(2).compactMap { $0.first.map { String($0).uppercased() } }.joined()
    }
}

/// Firebase Auth over its REST API.
///
/// Same Firebase project, same providers as the website — so the account a
/// coach signs into here has the same uid as on the web, and every team they
/// coach is visible the moment they arrive. No new account, no migration.
///
/// The REST API rather than the Firebase iOS SDK: the SDK will not start
/// without a GoogleService-Info.plist from the console, and nothing it does
/// here is worth that dependency. See docs/ios/architecture.md.
@MainActor
@Observable
final class AuthService {
    enum AuthError: LocalizedError {
        case server(String)
        case cancelled
        case stateMismatch

        var errorDescription: String? {
            switch self {
            case .server(let message): return AuthService.friendly(message)
            case .cancelled: return nil
            case .stateMismatch: return "That sign-in didn't come from this app. Try again."
            }
        }
    }

    private(set) var session: AuthSession?
    private let config: AppConfig
    private let log = Logger(subsystem: "app.inninggrid", category: "auth")
    private static let keychainAccount = "session"
    private var refreshing: Task<AuthSession, Error>?

    init(config: AppConfig = .current) {
        self.config = config
        if let data = Keychain.load(account: Self.keychainAccount),
           let stored = try? JSONDecoder().decode(AuthSession.self, from: data) {
            session = stored
        }
    }

    var isSignedIn: Bool { session != nil }

    // MARK: Sign-in

    /// Exchange a Google ID token for a Firebase session (`signInWithIdp`).
    ///
    /// The token comes from the website's own Google sign-in, run in a Safari
    /// sheet by `WebSignIn` — the one place Google allows OAuth on iOS without
    /// a separately registered iOS client.
    func signIn(googleIDToken: String) async throws {
        let response = try await post(config.identityToolkit("accounts:signInWithIdp"), json: [
            "postBody": "id_token=\(googleIDToken)&providerId=google.com",
            "requestUri": config.webOrigin.absoluteString,
            "returnSecureToken": true,
            "returnIdpCredential": true,
        ])
        try store(response)
    }

    /// Start an email-link sign-in; the link lands back in the app.
    func sendEmailLink(to email: String) async throws {
        _ = try await post(config.identityToolkit("accounts:sendOobCode"), json: [
            "requestType": "EMAIL_SIGNIN",
            "email": email.lowercased(),
            "continueUrl": "\(config.webOrigin.absoluteString)/native-auth/email",
            "canHandleCodeInApp": true,
        ])
        UserDefaults.standard.set(email.lowercased(), forKey: "pendingEmail")
    }

    /// Finish an email-link sign-in with the link's one-time code.
    func signIn(email: String, oobCode: String) async throws {
        let response = try await post(config.identityToolkit("accounts:signInWithEmailLink"), json: [
            "email": email.lowercased(),
            "oobCode": oobCode,
        ])
        try store(response)
        UserDefaults.standard.removeObject(forKey: "pendingEmail")
    }

    var pendingEmail: String? { UserDefaults.standard.string(forKey: "pendingEmail") }

    #if DEBUG
    /// Emulator only: sign in as a named test coach without a real Google account.
    ///
    /// The Auth emulator accepts an unsigned credential, so this exercises the
    /// exact `signInWithIdp` path a real coach takes. It cannot exist in a
    /// release build, and it cannot reach production: the emulator config has
    /// no route to a real project.
    func signInAsTestCoach(email: String, name: String) async throws {
        precondition(config.environment == .emulator, "Test sign-in is emulator-only")
        let claims = #"{"sub":"\#(email)","email":"\#(email)","email_verified":true,"name":"\#(name)"}"#
        try await signIn(googleIDToken: claims)
    }

    /// Tests only: be signed in as someone, without a server or the Keychain.
    func useTestSession(_ session: AuthSession) { self.session = session }
    #endif

    func signOut() {
        session = nil
        Keychain.delete(account: Self.keychainAccount)
    }

    // MARK: Tokens

    /// A valid ID token, refreshing a few minutes before it expires.
    ///
    /// Refreshes are shared: ten requests that all find an expired token start
    /// one refresh, not ten — Firebase rate-limits the token endpoint.
    func idToken() async throws -> String {
        guard let current = session else { throw FirestoreClient.FirestoreError.unauthenticated }
        if current.expiresAt.timeIntervalSinceNow > 300 { return current.idToken }

        if let refreshing { return try await refreshing.value.idToken }
        let task = Task { try await refresh(current) }
        refreshing = task
        defer { refreshing = nil }
        return try await task.value.idToken
    }

    private func refresh(_ current: AuthSession) async throws -> AuthSession {
        var request = URLRequest(url: config.secureTokenURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = "grant_type=refresh_token&refresh_token=\(current.refreshToken)"
            .data(using: .utf8)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch is URLError {
            /* No signal is not a refused token: stay signed in, work from the
               cache, and refresh when the phone finds a network. */
            throw FirestoreClient.FirestoreError.offline
        }
        let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]

        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let idToken = json["id_token"] as? String,
              let refreshToken = json["refresh_token"] as? String
        else {
            /* A refused refresh token means the account was disabled or the
               token revoked — the only honest response is to sign out. */
            log.error("token refresh refused; signing out")
            signOut()
            throw FirestoreClient.FirestoreError.unauthenticated
        }

        var next = current
        next.idToken = idToken
        next.refreshToken = refreshToken
        next.expiresAt = Date().addingTimeInterval(Double(json["expires_in"] as? String ?? "3600") ?? 3600)
        persist(next)
        return next
    }

    // MARK: Plumbing

    private func store(_ json: [String: Any]) throws {
        guard let uid = json["localId"] as? String,
              let idToken = json["idToken"] as? String,
              let refreshToken = json["refreshToken"] as? String
        else { throw AuthError.server("INVALID_RESPONSE") }
        let next = AuthSession(
            uid: uid,
            email: json["email"] as? String,
            displayName: json["displayName"] as? String ?? json["fullName"] as? String,
            idToken: idToken,
            refreshToken: refreshToken,
            expiresAt: Date().addingTimeInterval(Double(json["expiresIn"] as? String ?? "3600") ?? 3600)
        )
        persist(next)
        log.info("signed in")
    }

    private func persist(_ next: AuthSession) {
        session = next
        if let data = try? JSONEncoder().encode(next) {
            Keychain.save(data, account: Self.keychainAccount)
        }
    }

    private func post(_ url: URL, json body: [String: Any]) async throws -> [String: Any] {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            let message = ((json["error"] as? [String: Any])?["message"] as? String) ?? "UNKNOWN"
            throw AuthError.server(message)
        }
        return json
    }

    /// Firebase's error codes, in words a coach can act on.
    nonisolated static func friendly(_ code: String) -> String {
        switch code {
        case let c where c.hasPrefix("INVALID_OOB_CODE"), let c where c.hasPrefix("EXPIRED_OOB_CODE"):
            return "That sign-in link has expired or was already used. Send a new one."
        case let c where c.hasPrefix("INVALID_EMAIL"):
            return "That doesn't look like an email address."
        case let c where c.hasPrefix("USER_DISABLED"):
            return "This account has been disabled."
        case let c where c.hasPrefix("TOO_MANY_ATTEMPTS"):
            return "Too many attempts. Wait a minute and try again."
        default:
            return "Sign-in didn't work (\(code)). Try again."
        }
    }
}
