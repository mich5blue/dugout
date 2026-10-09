import SwiftUI

struct SignInView: View {
    @Environment(AuthService.self) private var auth
    @State private var email = ""
    @State private var busy = false
    @State private var error: String?
    @State private var sentTo: String?
    @State private var webSignIn = WebSignIn()

    private let config = AppConfig.current

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Spacer(minLength: 40)

                VStack(alignment: .leading, spacing: 10) {
                    Eyebrow("Youth baseball & softball", color: Theme.lime)
                    Text("Smart lineups,\nevery inning.")
                        .font(.display(52))
                        .foregroundStyle(Theme.ink)
                    Text("Same account, same teams as the website. Sign in and your season is already here.")
                        .font(.body)
                        .foregroundStyle(Theme.inkMuted)
                }

                VStack(spacing: 12) {
                    Button {
                        Task { await google() }
                    } label: {
                        Label("Continue with Google", systemImage: "g.circle.fill")
                    }
                    .buttonStyle(.primary)
                    .disabled(busy)

                    divider

                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 14)
                        .frame(minHeight: 50)
                        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.strokeStrong))
                        .submitLabel(.send)
                        .onSubmit { Task { await sendLink() } }

                    Button("Email me a sign-in link") { Task { await sendLink() } }
                        .buttonStyle(.secondary)
                        .disabled(busy || !email.contains("@"))

                    if let sentTo {
                        Label("Link sent to \(sentTo). Open it on this phone.", systemImage: "envelope.badge")
                            .font(.subheadline)
                            .foregroundStyle(Theme.emerald)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline)
                            .foregroundStyle(Theme.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                #if DEBUG
                if config.environment == .emulator { testCoaches }
                #endif

                if busy { ProgressView().frame(maxWidth: .infinity) }
            }
            .padding(Theme.gutter + 8)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .screenBackground()
    }

    private var divider: some View {
        HStack {
            Rectangle().fill(Theme.stroke).frame(height: 1)
            Text("or").font(.footnote).foregroundStyle(Theme.inkFaint)
            Rectangle().fill(Theme.stroke).frame(height: 1)
        }
        .padding(.vertical, 4)
    }

    #if DEBUG
    /// Emulator builds only: sign in as the seeded coaches without Google.
    private var testCoaches: some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow("Local emulator · test accounts", color: Theme.amber)
            Button("Sign in as test head coach") {
                Task { await run { try await auth.signInAsTestCoach(email: "coach@inninggrid.test", name: "Test Coach") } }
            }
            .buttonStyle(.secondary)
            Button("Sign in as test assistant") {
                Task { await run { try await auth.signInAsTestCoach(email: "assistant@inninggrid.test", name: "Test Assistant") } }
            }
            .buttonStyle(.secondary)
        }
        .card(highlighted: false)
    }
    #endif

    private func google() async {
        await run {
            let token = try await webSignIn.googleIDToken(webOrigin: config.webOrigin)
            try await auth.signIn(googleIDToken: token)
        }
    }

    private func sendLink() async {
        let address = email.trimmingCharacters(in: .whitespaces)
        guard address.contains("@") else { return }
        await run {
            try await auth.sendEmailLink(to: address)
            sentTo = address
        }
    }

    private func run(_ work: () async throws -> Void) async {
        busy = true
        error = nil
        defer { busy = false }
        do { try await work() }
        catch let failure as AuthService.AuthError { error = failure.errorDescription }
        catch { self.error = error.localizedDescription }
    }
}

/// Finishes an email-link sign-in when the link opens the app.
struct EmailLinkFinishView: View {
    let oobCode: String
    @Environment(AuthService.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Eyebrow("Finish signing in", color: Theme.lime)
            Text("Confirm your email").font(.display(30))
            Text("For safety, enter the address the link was sent to.")
                .foregroundStyle(Theme.inkMuted)
            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 14)
                .frame(minHeight: 50)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            Button("Sign in") { Task { await finish() } }
                .buttonStyle(.primary)
                .disabled(busy || !email.contains("@"))
            if let error {
                Text(error).font(.subheadline).foregroundStyle(Theme.danger)
            }
        }
        .padding(24)
        .screenBackground()
        .task {
            /* Same device that asked for the link: no need to ask again. */
            if let pending = auth.pendingEmail {
                email = pending
                await finish()
            }
        }
    }

    private func finish() async {
        busy = true
        defer { busy = false }
        do {
            try await auth.signIn(email: email, oobCode: oobCode)
            dismiss()
        } catch let failure as AuthService.AuthError {
            error = failure.errorDescription
        } catch {
            self.error = error.localizedDescription
        }
    }
}
