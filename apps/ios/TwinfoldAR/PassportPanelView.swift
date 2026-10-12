import SwiftUI
import TwinfoldCore

/// Passport for a graded card: three separate blocks that are never mixed.
///
/// 1. Onchain fact: what the chain itself says (mint, owner, the transaction that brought the card here).
/// 2. Third-party claims: what the grading company and Collector Crypt say about the card. Collectibles AR copies them.
/// 3. Collectibles AR interpretation: Collectibles AR's own formatting, when it read the data, and the Pull memo with its VRF link.
///    Collectibles AR has not verified any of the claims in block 2.
///
/// Links open in Safari via `UIApplication.open`. Fixture (DEMO DATA) addresses never link out.
struct PassportPanelView: View {
    let asset: TwinfoldAsset
    /// `DEMO DATA`, `DEVNET` or `MAINNET (read-only)`.
    let networkBadge: String
    /// When the owned list this card came from was read.
    let fetchedAt: Date?
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header
                    onchainFact
                    thirdPartyClaims
                    interpretation
                }
                .padding()
            }
            .navigationTitle("Passport")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", action: onClose)
                }
            }
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(asset.displayTitle()).font(.headline)
            HStack(spacing: 6) {
                badge(networkBadge, color: networkBadge.hasPrefix("MAINNET") ? .purple : .orange)
                if asset.sourceVerified == false {
                    badge("UNVERIFIED SOURCE", color: .red)
                }
            }
            if asset.sourceVerified == false {
                Text("Not confirmed as issued by Collector Crypt. It is listed only because its metadata has the shape of a graded card.")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    // MARK: (a) Onchain fact

    private var onchainFact: some View {
        block(title: "Onchain fact", subtitle: "Facts read from the chain", tint: .blue) {
            row("Mint address", asset.address, mono: true, link: PassportLinks.explorerAddress(asset.address, network: asset.network), linkTitle: "Solana Explorer")
            row("Owner", asset.owner.map(Self.shortAddress) ?? "—")
            if let event = asset.acquisitionEvent, let signature = event.transaction {
                row(
                    "Acquisition transaction signature (\(event.status.rawValue))",
                    Self.shortAddress(signature),
                    mono: true,
                    link: PassportLinks.explorerTransaction(signature, network: asset.network),
                    linkTitle: "Solana Explorer"
                )
            } else {
                row("Acquisition transaction signature", "No record")
            }
            row("Network", asset.network == "mainnet" ? "mainnet (read-only)" : asset.network)
            if asset.isDemoChainData {
                note("DEMO DATA: fictional values. This is not a real onchain record (there is no Explorer link).")
            }
        }
    }

    // MARK: (b) Third-party claims

    private var thirdPartyClaims: some View {
        block(title: "Third-party claims", subtitle: "Third-party claims (not verified by Collectibles AR)", tint: .orange) {
            Text("Grading company claims").font(.subheadline.bold())
            row("Company", asset.gradingCompany ?? "—")
            row("Grade", asset.grade ?? "—")
            row(
                "Cert number",
                asset.gradingId ?? "—",
                mono: true,
                link: PassportLinks.psaCert(company: asset.gradingCompany, gradingId: asset.gradingId),
                linkTitle: "PSA cert verify"
            )
            Divider()
            Text("Collector Crypt claims").font(.subheadline.bold())
            row("Insured value", asset.insuredValueDisplay ?? "—")
            row("Vault", asset.vault ?? "—")
            row("Vault ID", asset.vaultId ?? "—", mono: true)
            note("Custody, shipping, and buyback of the physical card are Collector Crypt's responsibility.")
        }
    }

    // MARK: (c) Collectibles AR interpretation

    private var interpretation: some View {
        block(title: "Collectibles AR interpretation", subtitle: "Formatted by Collectibles AR", tint: .gray) {
            let lines = GradedSlabDimensions.labelLines(for: asset, maxNameLength: 60)
            row("Display label", [lines.headline, lines.name].filter { !$0.isEmpty }.joined(separator: " / "))
            row("Fetched at", fetchedAt.map(Self.timestamp) ?? "—")
            if let memo = asset.gachaMemo {
                row(
                    "Pull memo",
                    memo,
                    mono: true,
                    link: asset.isDemoChainData ? nil : PassportLinks.vrfVerify(memo: memo),
                    linkTitle: "VRF verify (Collector Crypt)"
                )
                note(asset.isDemoChainData
                     ? "DEMO DATA: fictional pull. There is no verification page."
                     : "Verify the selection on Collector Crypt's page.")
            }
            Text("Collectibles AR does not verify these. The above is a copy of data from the chain and Collector Crypt.")
                .font(.footnote.bold())
        }
    }

    // MARK: Pieces

    private func block<Content: View>(title: String, subtitle: String, tint: Color, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 2).fill(tint).frame(width: 4, height: 18)
                Text(title).font(.headline)
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            content()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private func row(_ label: String, _ value: String, mono: Bool = false, link: URL? = nil, linkTitle: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value)
                .font(mono ? .system(.footnote, design: .monospaced) : .footnote)
                .textSelection(.enabled)
            if let link, let linkTitle {
                Button {
                    UIApplication.shared.open(link)
                } label: {
                    Label(linkTitle, systemImage: "arrow.up.right.square")
                        .font(.caption.bold())
                }
            }
        }
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(.secondary)
    }

    private func badge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.bold())
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.9))
            .foregroundStyle(.white)
            .clipShape(Capsule())
    }

    static func shortAddress(_ value: String) -> String {
        value.count > 14 ? "\(value.prefix(6))...\(value.suffix(6))" : value
    }

    static func timestamp(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .standard)
    }
}
