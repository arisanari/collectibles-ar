import SwiftUI
import TwinfoldCore

/// AR screen chrome above the tray: DEMO DATA/DEVNET badge, the active
/// wallet chip, overflow menu (wallet switch, simulate-failure, reset), a
/// 1-line hint describing the current state, the holding-preview cancel
/// control, the selected-asset operation card, and the post-transfer
/// toast. Contains no ARKit/RealityKit calls; only reads `RoomController`
/// state.
struct RoomOverlayView: View {
    let controller: RoomController
    /// Whether the bottom tray is open. When closed, the plain hint line
    /// is hidden too (for a clean screenshot); the operation card and
    /// transfer toast still show regardless, since those reflect an
    /// explicit selection/action rather than idle guidance.
    let isTrayOpen: Bool

    var body: some View {
        VStack {
            HStack {
                demoDataBadge
                walletButton
                if controller.dataMode == .devnet,
                   controller.activeWallet.id != controller.linkedSession?.wallet {
                    walletChip
                }
                Spacer()
                overflowMenu
            }
            .padding()

            if controller.linkNotice != nil {
                linkNoticeBanner
            }

            Spacer()

            VStack(spacing: 10) {
                if let message = controller.redeemToast {
                    VStack(spacing: 8) {
                        Text(message).font(.footnote).multilineTextAlignment(.center).foregroundStyle(.white)
                        Button("Close") { controller.dismissRedeemToast() }.buttonStyle(.bordered)
                    }
                    .padding(12)
                    .background(Color.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal, 16)
                } else if let toast = controller.toast {
                    toastView(toast)
                } else if controller.holdingAssetId != nil {
                    hintBar
                    Button("Cancel") { controller.cancelHolding() }
                        .buttonStyle(.bordered)
                } else if let selectedAssetId = controller.selectedAssetId,
                          let asset = controller.ownedAssets.first(where: { $0.id == selectedAssetId }) {
                    // No separate hint bar while the operation card is
                    // showing — the card's own title/buttons already say
                    // what's selected and what can be done, and a hint
                    // line above it just piles up / repeats that.
                    operationCard(for: asset)
                } else if isTrayOpen {
                    // Idle guidance only — hidden with the tray so a
                    // closed tray gives a clean, uncluttered screenshot.
                    hintBar
                }
            }
            .padding(.bottom, 16)
        }
        .sheet(isPresented: buybackSheetBinding) {
            buybackOfferSheet
        }
        .sheet(isPresented: redeemSheetBinding) {
            redeemSheet
        }
        .sheet(isPresented: acquisitionSheetBinding) {
            acquisitionSheet
        }
        .sheet(isPresented: linkSheetBinding) {
            LinkWalletSheet(controller: controller)
        }
        .sheet(isPresented: passportSheetBinding) {
            if let asset = controller.passportAsset {
                PassportPanelView(
                    asset: asset,
                    networkBadge: asset.network == "mainnet" ? DataMode.mainnet.badge : controller.networkBadge,
                    fetchedAt: controller.lastFetchedAt,
                    onClose: { controller.dismissPassport() }
                )
                // Keep the AR view live behind the half-height sheet.
                .presentationDetents([.medium, .large])
                .presentationBackgroundInteraction(.enabled(upThrough: .medium))
            }
        }
    }

    private var passportSheetBinding: Binding<Bool> {
        Binding(
            get: { controller.passportAsset != nil },
            set: { isPresented in if !isPresented { controller.dismissPassport() } }
        )
    }

    private var linkSheetBinding: Binding<Bool> {
        Binding(
            get: { controller.showsLinkSheet },
            set: { controller.showsLinkSheet = $0 }
        )
    }

    private var linkNoticeBanner: some View {
        HStack(spacing: 8) {
            Text(controller.linkNotice ?? "")
                .font(.footnote.bold())
                .foregroundStyle(.white)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 4)
            Button("Close") { controller.dismissLinkNotice() }
                .font(.footnote)
                .buttonStyle(.bordered)
                .tint(.white)
        }
        .padding(10)
        .background(Color.red.opacity(0.75), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
    }

    private var buybackSheetBinding: Binding<Bool> {
        Binding(
            get: { controller.buybackAssetId != nil },
            set: { isPresented in if !isPresented { controller.dismissBuybackOffer() } }
        )
    }

    @ViewBuilder
    private var buybackOfferSheet: some View {
        let asset = controller.ownedAssets.first(where: { $0.id == controller.buybackAssetId })
        NavigationStack {
            VStack(spacing: 16) {
                if controller.buybackQuoteLoading {
                    ProgressView("Fetching offer…")
                } else if let error = controller.buybackQuoteError {
                    Text(error).foregroundStyle(.red).multilineTextAlignment(.center)
                } else if let quote = controller.buybackQuote {
                    Text((asset?.displayTitle() ?? "") + (asset?.rehearsal == true ? " [REHEARSAL]" : ""))
                        .font(.headline)
                        .multilineTextAlignment(.center)
                    Text(controller.provider.isDemoData ? "DEMO DATA" : "DEVNET — a real transfer on devnet. No payment")
                        .font(.caption.bold())
                        .foregroundStyle(.orange)
                    if quote.eligible {
                        VStack(spacing: 4) {
                            Text("\(Int(quote.rate * 100))% of Twinfold list price")
                                .font(.subheadline)
                            Text("\(Int(quote.offerAmount).formatted(.number.grouping(.automatic))) \(quote.currency)")
                                .font(.system(size: 34, weight: .bold))
                            Text("\(Int(quote.rate * 100))% of Twinfold list price \(Int(quote.basis.amount).formatted(.number.grouping(.automatic))) \(quote.basis.currency) (Twinfold buyback offer, display only)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                        Button("Sell to Twinfold") { controller.confirmBuyback() }
                            .buttonStyle(.borderedProminent)
                    } else {
                        Text(quote.reason)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                }
                Spacer()
            }
            .padding()
            .navigationTitle("Sell to Twinfold (legacy demo)")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { controller.dismissBuybackOffer() }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private var redeemSheetBinding: Binding<Bool> {
        Binding(
            get: { controller.redeemAssetId != nil },
            set: { isPresented in if !isPresented { controller.dismissRedeem() } }
        )
    }

    /// 「現物を引き取る」 explanation sheet (dry run). No delivery address is asked for or stored.
    @ViewBuilder
    private var redeemSheet: some View {
        let asset = controller.ownedAssets.first(where: { $0.id == controller.redeemAssetId })
        NavigationStack {
            VStack(spacing: 14) {
                Text((asset?.displayTitle() ?? "") + (asset?.rehearsal == true ? " [REHEARSAL]" : ""))
                    .font(.headline)
                    .multilineTextAlignment(.center)
                Text("DEVNET · DRY RUN")
                    .font(.caption.bold())
                    .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 6) {
                    Text("• The circulating Asset is stopped. Once you approve on the Web it disappears from your wall, and the Asset is retired after you confirm receipt.")
                    Text("• Re-circulating it requires re-verification and a re-vault into the Twinfold (legacy demo) Vault.")
                    Text("• This demo does not ship anything and does not record a delivery address.")
                    Text("• Approval and receipt confirmation are done in My collection on the Web (the Passport is also viewed on the Web).")
                }
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)
                if let error = controller.redeemError {
                    Text(error).font(.subheadline).foregroundStyle(.red).multilineTextAlignment(.center)
                }
                if controller.redeemWorking {
                    ProgressView("Submitting…")
                } else {
                    Button("Submit request (dry run)") { controller.confirmRedeem() }
                        .buttonStyle(.borderedProminent)
                }
                Spacer()
            }
            .padding()
            .navigationTitle("Redeem physical item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { controller.dismissRedeem() }.disabled(controller.redeemWorking)
                }
            }
        }
        .presentationDetents([.medium])
        .interactiveDismissDisabled(controller.redeemWorking)
    }

    private var acquisitionSheetBinding: Binding<Bool> {
        Binding(
            get: { controller.acquisitionAssetId != nil },
            set: { isPresented in if !isPresented { controller.dismissAcquisition() } }
        )
    }

    /// 「Twinfoldから取得」 sheet: title, display price, the three statements, DEVNET, then 取得する.
    @ViewBuilder
    private var acquisitionSheet: some View {
        let asset = controller.acquisitionAsset
        let working = controller.isAcquisitionWorking
        NavigationStack {
            VStack(spacing: 14) {
                Text((asset?.displayTitle() ?? "") + (asset?.rehearsal == true ? " [REHEARSAL]" : ""))
                    .font(.headline)
                    .multilineTextAlignment(.center)
                Text("DEVNET")
                    .font(.caption.bold())
                    .foregroundStyle(.orange)
                if let price = asset?.commerce?.twinfoldPrice {
                    Text("\(Int(price.amount).formatted(.number.grouping(.automatic))) \(price.currency)")
                        .font(.system(size: 30, weight: .bold))
                    Text("List price (Twinfold display value, placeholder for the demo)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("• This is an acquisition on devnet; no payment is made.")
                    Text("• The price is for display only (placeholder for the demo).")
                    Text("• The physical item stays in the Twinfold Vault.")
                }
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)

                switch controller.acquisitionPhase {
                case .idle:
                    Button("Acquire") { controller.confirmAcquisition() }
                        .buttonStyle(.borderedProminent)
                case .working(let message):
                    ProgressView(message)
                case .done:
                    Text("Acquired. It was added to your collection. Pick it from the tray to place it on a wall")
                        .font(.subheadline.bold())
                        .multilineTextAlignment(.center)
                    Button("Close") { controller.dismissAcquisition() }
                        .buttonStyle(.borderedProminent)
                case .failed(let message):
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                    if controller.isAcquisitionLinked {
                        Button("Acquire again") { controller.confirmAcquisition() }
                            .buttonStyle(.bordered)
                    } else {
                        Button("Link wallet from Web") {
                            controller.dismissAcquisition()
                            controller.showsLinkSheet = true
                        }
                        .buttonStyle(.bordered)
                    }
                }
                Spacer()
            }
            .padding()
            .navigationTitle("Acquire from Twinfold (legacy demo)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { controller.dismissAcquisition() }
                        .disabled(working)
                }
            }
        }
        .presentationDetents([.medium])
        .interactiveDismissDisabled(working)
    }

    private var hintBar: some View {
        Text(controller.hintText)
            .font(.subheadline.bold())
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)
    }

    private var demoDataBadge: some View {
        Text(controller.networkBadge)
            .font(.caption.bold())
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background((controller.dataMode == .mainnet ? Color.purple : Color.orange).opacity(0.9))
            .foregroundStyle(.white)
            .clipShape(Capsule())
    }

    /// Always-visible label for which demo wallet's room is currently
    /// shown — otherwise there's no on-screen way to tell Owner A's room
    /// from Owner B's after switching.
    private var walletChip: some View {
        Text("Room: \(controller.activeWallet.label)")
            .font(.caption.bold())
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Color.black.opacity(0.55))
            .foregroundStyle(.white)
            .clipShape(Capsule())
    }

    /// Always-visible entry point for wallet linking (every data mode).
    /// Unlinked: prominent 「walletを連携」 button. Linked: a checkmark chip
    /// with the short address; tapping opens the same sheet, which shows
    /// the linked state and 「連携を解除」.
    @ViewBuilder
    private var walletButton: some View {
        if let linked = controller.linkedSession {
            let short = DemoWallet(id: linked.wallet, label: "").shortAddress
            Button {
                controller.showsLinkSheet = true
            } label: {
                Label(short, systemImage: "checkmark.circle.fill")
                    .font(.caption.bold())
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color.black.opacity(0.55))
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        } else {
            Button {
                controller.showsLinkSheet = true
            } label: {
                Label("Link wallet", systemImage: "link")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        }
    }

    private var overflowMenu: some View {
        Menu {
            Menu("View: \(controller.dataMode.label)") {
                ForEach(DataMode.allCases) { mode in
                    Button(mode.label) { controller.switchDataMode(to: mode) }
                }
            }

            if controller.walletOptions.count > 1 || controller.dataMode == .demo {
                Menu("Demo / Test") {
                    if controller.walletOptions.count > 1 {
                        Menu("Wallet: \(controller.activeWallet.label)") {
                            ForEach(controller.walletOptions) { wallet in
                                Button(wallet.label) { controller.switchWallet(to: wallet) }
                            }
                        }
                    }

                    if controller.dataMode == .demo {
                        Button("Simulate pull (DEMO DATA)") {
                            controller.simulatePull()
                        }
                        Button("Simulate buyback (DEMO DATA)") {
                            controller.simulateBuybackForSelected()
                        }
                        .disabled(controller.selectedAssetId == nil)
                        Button("Simulate failure (demo)") {
                            controller.simulateFailureForSelected()
                        }
                        .disabled(controller.selectedAssetId == nil || controller.transferState(for: controller.selectedAssetId ?? "") == .pending)
                    }
                }
            }

            if controller.linkedSession != nil {
                Button("Unlink", role: .destructive) { controller.unlink() }
            }

            Button("Reset") {
                controller.reset()
            }
            .disabled(controller.transferStatesContainPending)
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.title2)
                .padding(8)
                .background(.ultraThinMaterial, in: Circle())
        }
    }

    private func operationCard(for asset: TwinfoldAsset) -> some View {
        let state = controller.transferState(for: asset.id)
        return VStack(spacing: 8) {
            VStack(spacing: 2) {
                Text(asset.displayTitle() + (asset.rehearsal == true ? " [REHEARSAL]" : ""))
                    .font(.headline)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                if let physical = asset.physical {
                    Text("custody: \(physical.custody.status) / \(physical.custody.vault)")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.75))
                }
                HStack(spacing: 6) {
                    Text(asset.network == "mainnet" ? DataMode.mainnet.badge : controller.networkBadge)
                        .font(.caption2.bold())
                        .foregroundStyle(asset.network == "mainnet" ? Color.purple : Color.orange)
                    if asset.sourceVerified == false {
                        Text("UNVERIFIED SOURCE")
                            .font(.caption2.bold())
                            .foregroundStyle(.red)
                    }
                }
                if asset.sourceVerified == false {
                    Text("Not confirmed as issued by Collector Crypt")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.8))
                }
            }

            switch state {
            case .idle where asset.isGradedCard:
                // Graded card: Passport, 来歴, 外す only. Pull, sell-back, send and redeem are not offered here
                // (sell-back is Collector Crypt's, on the Web; Mainnet is read-only).
                HStack(spacing: 8) {
                    Button("Passport") { controller.presentPassportForSelected() }
                        .buttonStyle(.borderedProminent)
                    Button("Provenance") { controller.pullProvenanceForSelected() }
                        .buttonStyle(.bordered)
                    Button(controller.isCardOnly(asset.id) ? "Put back in case" : "Take out of case") { controller.toggleCardOnlyForSelected() }
                        .buttonStyle(.bordered)
                    Button("Remove") { controller.removeSelected() }
                        .buttonStyle(.bordered)
                }
                Text(controller.isReadOnlyMode
                     ? "Mainnet (read-only): display and placement only. Actions are not performed in this app"
                     : "Selling back is done through Collector Crypt buyback (within 72 hours, rate varies by machine). Use the Web app")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.8))
                    .multilineTextAlignment(.center)
            case .idle:
                HStack(spacing: 8) {
                    Button("Provenance") { controller.pullProvenanceForSelected() }
                        .buttonStyle(.bordered)
                    Button("Remove") { controller.removeSelected() }
                        .buttonStyle(.bordered)
                    Spacer(minLength: 8)
                    // "送る"/"Twinfoldに売る" live in this secondary menu
                    // (not a primary button) so neither is the first thing
                    // tapped by accident, but they're still inside the
                    // card — not only in the top-right overflow — so a
                    // first-time user still finds them while looking at the
                    // selected asset. Both work the same in Demo and
                    // Devnet mode now (Issue #29).
                    Menu {
                        Button(controller.provider.isDemoData
                               ? "Send to \(controller.destinationLabelForSelected) (demo)"
                               : "Send to \(controller.destinationLabelForSelected) (devnet)") {
                            controller.sendSelected()
                        }
                        .disabled(!controller.canOperateOnActiveWallet || controller.isInRedemption(asset))
                        Button("Sell to Twinfold (legacy demo)") {
                            controller.presentBuybackOffer()
                        }
                        .disabled(!controller.canOperateOnActiveWallet || controller.isInRedemption(asset))
                        if !controller.provider.isDemoData {
                            Button("Redeem physical item") {
                                controller.presentRedeem()
                            }
                            .disabled(!controller.isLinkedRoom || controller.isInRedemption(asset) || asset.physical?.custody.status != "vaulted")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(.title3)
                            .foregroundStyle(.white)
                            .padding(6)
                    }
                }
                if controller.isInRedemption(asset) {
                    Text(RoomController.redeemPendingMessage)
                        .font(.footnote.bold())
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                }
                if !controller.canOperateOnActiveWallet {
                    Text("\(RoomController.linkRequiredMessage) (Send and Sell work only in the linked \"Your wallet\" room. Owner A / B are view-only)")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.8))
                        .multilineTextAlignment(.center)
                }
            case .pending:
                if let approval = controller.approvalMessages[asset.id] {
                    Text(approval)
                        .font(.footnote.bold())
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                }
                Button(controller.approvalMessages[asset.id] == nil ? "Sending…" : "Awaiting approval on Web") {}
                    .buttonStyle(.borderedProminent)
                    .disabled(true)
            case .failed:
                Button("Retry") { controller.retrySelected() }
                    .buttonStyle(.borderedProminent)
            case .confirmed:
                EmptyView()
            }
        }
        .padding(12)
        // Explicit dark background (not `.ultraThinMaterial`, which
        // follows the system light/dark setting and paired badly with
        // `.primary`-colored text): guarantees the white text above stays
        // readable over the live camera feed regardless of the device's
        // appearance setting.
        .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal, 16)
    }

    private func toastMessage(_ toast: TransferToast) -> String {
        guard toast.isVaultDestination else {
            return "Sent (confirmed). \"\(toast.assetTitle)\" now appears in the \(toast.destinationLabel) room. Your other items are unchanged"
        }
        let offer = toast.buybackOfferText.map { "Offer \($0). " } ?? ""
        let note = controller.provider.isDemoData ? "DEMO DATA: no payment" : "DEVNET: no payment"
        return "Sold (confirmed). \"\(toast.assetTitle)\" was sold to Twinfold (legacy demo). \(offer)The physical item stays in the Vault and has disappeared from your wall (\(note))"
    }

    private func toastView(_ toast: TransferToast) -> some View {
        VStack(spacing: 8) {
            Text(toastMessage(toast))
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(.white)
            HStack(spacing: 12) {
                if !toast.isVaultDestination {
                    Button("View \(toast.destinationLabel) room") { controller.viewDestinationRoom() }
                        .buttonStyle(.borderedProminent)
                }
                Button("Close") { controller.dismissToast() }
                    .buttonStyle(.bordered)
            }
        }
        .padding(12)
        .background(Color.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal, 16)
    }
}
