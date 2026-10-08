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
                    Button("閉じる", action: onClose)
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
                Text("Collector Cryptが発行したカードかどうかを確認できていません（メタデータの形だけで一覧に出しています）。")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    // MARK: (a) Onchain fact

    private var onchainFact: some View {
        block(title: "Onchain fact", subtitle: "チェーン上の事実", tint: .blue) {
            row("Mint address", asset.address, mono: true, link: PassportLinks.explorerAddress(asset.address, network: asset.network), linkTitle: "Solana Explorer")
            row("Owner", asset.owner.map(Self.shortAddress) ?? "—")
            if let event = asset.acquisitionEvent, let signature = event.transaction {
                row(
                    "取得のtransaction署名 (\(event.status.rawValue))",
                    Self.shortAddress(signature),
                    mono: true,
                    link: PassportLinks.explorerTransaction(signature, network: asset.network),
                    linkTitle: "Solana Explorer"
                )
            } else {
                row("取得のtransaction署名", "記録なし")
            }
            row("Network", asset.network == "mainnet" ? "mainnet (read-only)" : asset.network)
            if asset.isDemoChainData {
                note("DEMO DATA：架空の値です。実際のチェーン上の記録ではありません（Explorerリンクはありません）。")
            }
        }
    }

    // MARK: (b) Third-party claims

    private var thirdPartyClaims: some View {
        block(title: "Third-party claims", subtitle: "第三者の主張（Collectibles ARは検証していません）", tint: .orange) {
            Text("鑑定会社の主張").font(.subheadline.bold())
            row("会社", asset.gradingCompany ?? "—")
            row("グレード", asset.grade ?? "—")
            row(
                "鑑定番号",
                asset.gradingId ?? "—",
                mono: true,
                link: PassportLinks.psaCert(company: asset.gradingCompany, gradingId: asset.gradingId),
                linkTitle: "PSA cert verify"
            )
            Divider()
            Text("Collector Cryptの主張").font(.subheadline.bold())
            row("保険価値 (Insured Value)", asset.insuredValueDisplay ?? "—")
            row("Vault", asset.vault ?? "—")
            row("Vault ID", asset.vaultId ?? "—", mono: true)
            note("現物の保管・配送・買取の責任はCollector Cryptにあります。")
        }
    }

    // MARK: (c) Collectibles AR interpretation

    private var interpretation: some View {
        block(title: "Collectibles AR interpretation", subtitle: "Collectibles ARの整形", tint: .gray) {
            let lines = GradedSlabDimensions.labelLines(for: asset, maxNameLength: 60)
            row("表示用ラベル", [lines.headline, lines.name].filter { !$0.isEmpty }.joined(separator: " / "))
            row("取得日時", fetchedAt.map(Self.timestamp) ?? "—")
            if let memo = asset.gachaMemo {
                row(
                    "Pull memo",
                    memo,
                    mono: true,
                    link: asset.isDemoChainData ? nil : PassportLinks.vrfVerify(memo: memo),
                    linkTitle: "VRF verify (Collector Crypt)"
                )
                note(asset.isDemoChainData
                     ? "DEMO DATA：架空のPullです。検証ページはありません。"
                     : "選出の検証はCollector Cryptのページで行います。")
            }
            Text("Collectibles ARはこれらを検証していません。上の表示は、チェーンとCollector Cryptのデータの写しです。")
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
