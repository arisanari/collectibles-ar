import SwiftUI
import TwinfoldCore

/// 「Webのwalletと連携」: types in (or receives via `twinfold://link?code=`)
/// the one-time code shown on the Web /collection page. Only the short-lived
/// code is entered here; no key, seed phrase or address-only login exists on
/// this device (Issue #45). Contains no ARKit/RealityKit calls.
/// QR scanning inside the app is intentionally not offered: the AR session
/// owns the camera, so scan the Web QR with the iPhone Camera app instead,
/// which opens this app with the code prefilled.
struct LinkWalletSheet: View {
    let controller: RoomController
    @Environment(\.openURL) private var openURL
    @State private var code = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                if let linked = controller.linkedSession {
                    linkedSection(wallet: linked.wallet)
                } else {
                    entrySection
                }
                Spacer()
            }
            .padding()
            .navigationTitle("Link wallet from Web")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { controller.showsLinkSheet = false }
                }
            }
            .onAppear { consumePendingCode() }
            .onChange(of: controller.pendingLinkCode) { _, _ in consumePendingCode() }
        }
        .presentationDetents([.medium, .large])
    }

    private var entrySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Enter the 8-character code shown in the Web app under My collection > Link iPhone. The code expires in 2 minutes and can be used only once.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text("Private keys and seed phrases never enter this iPhone. Linking a wallet address alone does not allow sending or selling.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            Button {
                if let url = Self.phantomBrowseURL(web: controller.webBaseURL) { openURL(url) }
            } label: {
                Text("Link with Phantom")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(Self.phantomBrowseURL(web: controller.webBaseURL) == nil)
            Text("The Web app opens in the browser inside Phantom. After you sign in, you return here with the code filled in. If you do not return, enter the 8 characters shown on screen below.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            TextField("XXXX-XXXX", text: $code)
                .font(.system(size: 28, weight: .semibold, design: .monospaced))
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .focused($focused)
                .textFieldStyle(.roundedBorder)
                .onChange(of: code) { _, newValue in
                    let formatted = Self.format(newValue)
                    if formatted != newValue { code = formatted }
                }
                .onSubmit { submit() }

            if let message = controller.linkErrorMessage {
                Text(message).font(.footnote).foregroundStyle(.red)
            }

            Button {
                submit()
            } label: {
                if controller.isLinking {
                    ProgressView()
                } else {
                    Text("Link")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(SessionLinkClient.normalizeCode(code).count != 8 || controller.isLinking)

            Text("If you scan the QR code with the iPhone camera, this app opens with the code filled in.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func linkedSection(wallet: String) -> some View {
        let short = wallet.count > 10 ? "\(wallet.prefix(4))...\(wallet.suffix(4))" : wallet
        return VStack(alignment: .leading, spacing: 12) {
            Text("Linked: \(short)")
                .font(.headline)
            Text("DEVNET. Send and Sell to Twinfold (legacy demo) work only in the \"Your wallet\" room. The Owner A / Owner B rooms are view-only.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button("Unlink", role: .destructive) {
                controller.unlink()
            }
            .buttonStyle(.bordered)
            Text("This unlinks this device only. Use Unlink in the Web app to invalidate every issued device.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func submit() {
        guard SessionLinkClient.normalizeCode(code).count == 8 else { return }
        Task { await controller.linkWithCode(code) }
    }

    private func consumePendingCode() {
        guard let pending = controller.pendingLinkCode else { return }
        code = Self.format(pending)
        controller.pendingLinkCode = nil
    }

    /// Phantom browse deeplink: opens `<web>/link` inside Phantom's in-app
    /// browser (the only place `window.phantom` is injected on iPhone).
    /// `ref` is the origin of `web`. Both are percent-encoded as URL components.
    private static func phantomBrowseURL(web: URL) -> URL? {
        guard var parts = URLComponents(url: web, resolvingAgainstBaseURL: false),
              let scheme = parts.scheme, parts.host != nil else { return nil }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        guard let origin = parts.string else { return nil }
        let target = origin + "/link"
        guard scheme == "https" || scheme == "http",
              let encodedURL = target.addingPercentEncoding(withAllowedCharacters: allowed),
              let encodedRef = origin.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        return URL(string: "https://phantom.app/ul/browse/\(encodedURL)?ref=\(encodedRef)")
    }

    /// Accepts input with or without the dash, any case; shows XXXX-XXXX (max 8 characters).
    static func format(_ raw: String) -> String {
        let cleaned = String(SessionLinkClient.normalizeCode(raw).filter { $0.isASCII && ($0.isLetter || $0.isNumber) }.prefix(8))
        guard cleaned.count > 4 else { return cleaned }
        return "\(cleaned.prefix(4))-\(cleaned.dropFirst(4))"
    }
}
