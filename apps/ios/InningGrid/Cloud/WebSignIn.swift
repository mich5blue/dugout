import AuthenticationServices
import UIKit

/// Signs in with the website's own Google sign-in, in a Safari sheet.
///
/// Google blocks OAuth inside an app's web view, and native Google Sign-In
/// needs an iOS client registered in the Firebase console. An
/// `ASWebAuthenticationSession` is neither: it is Safari, so Google allows it,
/// and only this app receives its callback — which is what makes handing a
/// token back through a URL safe here when a plain `openURL` would not be.
///
/// The page it opens is `/native-auth` (src/app/native-auth). It returns a
/// short-lived Google ID token, which `AuthService` exchanges for a Firebase
/// session with the same uid the coach has on the web.
@MainActor
final class WebSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func googleIDToken(webOrigin: URL) async throws -> String {
        /* Generated here and checked on return, so a sign-in this app did not
           start — a crafted inninggrid:// link — is refused. */
        let state = UUID().uuidString + "-" + UUID().uuidString
        var components = URLComponents(url: webOrigin.appendingPathComponent("native-auth"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "redirect", value: "inninggrid://auth"),
        ]

        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: components.url!,
                callbackURLScheme: "inninggrid"
            ) { url, error in
                if let url { continuation.resume(returning: url) }
                else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: AuthService.AuthError.cancelled)
                } else {
                    continuation.resume(throwing: error ?? AuthService.AuthError.server("NO_CALLBACK"))
                }
            }
            session.presentationContextProvider = self
            /* Not ephemeral: Google remembers which account the coach used, so
               signing back in after a sign-out is one tap, not a password. */
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }

        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == state else {
            throw AuthService.AuthError.stateMismatch
        }
        guard let token = items.first(where: { $0.name == "idToken" })?.value, !token.isEmpty else {
            throw AuthService.AuthError.server("NO_TOKEN")
        }
        return token
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}
