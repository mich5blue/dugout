import SwiftUI

@main
struct InningGridApp: App {
    @State private var auth: AuthService
    @State private var store: TeamStore
    @State private var workspace: Workspace

    init() {
        let auth = AuthService()
        #if DEBUG
        /* A test run asking for a different test coach starts signed out. */
        if let wanted = UserDefaults.standard.string(forKey: "uiTestSignIn"),
           let current = auth.session?.email, current != wanted {
            auth.signOut()
        }
        #endif
        let store = TeamStore(auth: auth)
        _auth = State(initialValue: auth)
        _store = State(initialValue: store)
        _workspace = State(initialValue: Workspace(store: store, auth: auth))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(store)
                .environment(workspace)
                .preferredColorScheme(.dark)
                .tint(Theme.lime)
        }
    }
}

/// Signed out → sign-in. Signed in → the tabs.
struct RootView: View {
    @Environment(AuthService.self) private var auth
    @Environment(TeamStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var emailLink: EmailLink?

    struct EmailLink: Identifiable { let oobCode: String; var id: String { oobCode } }

    var body: some View {
        Group {
            if auth.isSignedIn {
                MainTabs()
                    .task(id: auth.session?.uid) {
                        store.loadFromDisk()
                        await store.refresh()
                        await store.flush()
                    }
            } else {
                SignInView()
                    #if DEBUG
                    .task {
                        /* `-uiTestSignIn coach@inninggrid.test`: emulator only. */
                        if AppConfig.current.environment == .emulator,
                           let email = UserDefaults.standard.string(forKey: "uiTestSignIn") {
                            try? await auth.signInAsTestCoach(email: email, name: email.hasPrefix("assistant") ? "Test Assistant" : "Test Coach")
                        }
                    }
                    #endif
            }
        }
        .onOpenURL(perform: open)
        .onChange(of: scenePhase) { _, phase in
            /* Coming back to the app is when another coach's edits are most
               likely to be waiting, and when queued edits can finally go up. */
            guard phase == .active, auth.isSignedIn else { return }
            Task {
                await store.flush()
                await store.refresh()
            }
        }
        .sheet(item: $emailLink) { link in
            EmailLinkFinishView(oobCode: link.oobCode)
                .presentationDetents([.medium])
        }
    }

    /// `inninggrid://auth/email?oobCode=…` — an email sign-in link, forwarded
    /// by the website's /native-auth/email page.
    private func open(_ url: URL) {
        guard url.scheme == "inninggrid", url.host == "auth", url.path == "/email" else { return }
        let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "oobCode" }?.value
        if let code, !code.isEmpty { emailLink = EmailLink(oobCode: code) }
    }
}

/// Which tab is showing and what each tab has pushed.
@MainActor
@Observable
final class Navigator {
    var tab: MainTabs.Tab = .home
    var paths: [MainTabs.Tab: [Route]] = [:]

    func push(_ route: Route) { paths[tab, default: []].append(route) }

    /// Swap the screen on top for another — the builder becomes the lineup it built.
    func replaceTop(with route: Route) {
        var path = paths[tab] ?? []
        if !path.isEmpty { path.removeLast() }
        path.append(route)
        paths[tab] = path
    }

    func pop() { if paths[tab]?.isEmpty == false { paths[tab]?.removeLast() } }
}

struct MainTabs: View {
    enum Tab: String, Hashable { case home, schedule, roster, season, more }
    @State private var navigator = Navigator()

    var body: some View {
        @Bindable var navigator = navigator
        TabView(selection: $navigator.tab) {
            stack(.home) { HomeView(tab: $navigator.tab) }
                .tabItem { Label("Home", systemImage: "house.fill") }
                .tag(Tab.home)
            stack(.schedule) { ScheduleView() }
                .tabItem { Label("Schedule", systemImage: "calendar") }
                .tag(Tab.schedule)
            stack(.roster) { RosterView() }
                .tabItem { Label("Roster", systemImage: "person.3.fill") }
                .tag(Tab.roster)
            stack(.season) { SeasonView() }
                .tabItem { Label("Season", systemImage: "chart.bar.xaxis") }
                .tag(Tab.season)
            stack(.more) { MoreView() }
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
                .tag(Tab.more)
        }
        .environment(navigator)
        .overlay(alignment: .top) { RejectionBanner() }
        #if DEBUG
        .onAppear(perform: applyTestLaunchArguments)
        #endif
    }

    private func stack<Content: View>(_ tab: Tab, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack(path: Binding(get: { navigator.paths[tab] ?? [] }, set: { navigator.paths[tab] = $0 })) {
            content()
        }
    }

    #if DEBUG
    /// `-uiTestTab season`, `-uiTestRoute game:<id>` — for headless screenshots and UI tests.
    private func applyTestLaunchArguments() {
        let defaults = UserDefaults.standard
        if let name = defaults.string(forKey: "uiTestTab"), let target = Tab(rawValue: name) { navigator.tab = target }
        guard let route = defaults.string(forKey: "uiTestRoute") else { return }
        let parts = route.split(separator: ":", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { return }
        let destination: Route? = switch parts[0] {
        case "game": .game(parts[1])
        case "build": .build(parts[1])
        case "live": .live(parts[1])
        case "player": .player(parts[1])
        default: nil
        }
        if let destination { navigator.push(destination) }
    }
    #endif
}

/// The server refused an edit: say so once, plainly, then get out of the way.
struct RejectionBanner: View {
    @Environment(TeamStore.self) private var store

    var body: some View {
        if let message = store.rejection {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "hand.raised.fill").foregroundStyle(Theme.amber)
                Text(message).font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink)
                Spacer()
                Button { store.rejection = nil } label: { Image(systemName: "xmark").font(.caption.weight(.bold)) }
                    .foregroundStyle(Theme.inkMuted)
                    .accessibilityLabel("Dismiss")
            }
            .padding(12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.amber.opacity(0.5)))
            .padding(.horizontal, Theme.gutter)
            .padding(.top, 4)
            .transition(.move(edge: .top).combined(with: .opacity))
            .task {
                try? await Task.sleep(for: .seconds(8))
                store.rejection = nil
            }
        }
    }
}
