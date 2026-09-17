import RealityKit
import SwiftUI
import TwinfoldCore
import TwinfoldSpatial

struct ImmersiveGalleryView: View {
    @Environment(GalleryModel.self) private var gallery
    @Environment(\.dismissImmersiveSpace) private var dismissImmersiveSpace
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        RealityView { content, attachments in
            let floor = ModelEntity(
                mesh: .generatePlane(width: 8, depth: 8),
                materials: [SimpleMaterial(color: .init(white: 0.12, alpha: 0.92), roughness: 0.85, isMetallic: false)]
            )
            floor.position = [0, -1.45, -2.6]
            content.add(floor)

            let positions = layoutPositions(count: gallery.assets.count)

            for (index, asset) in gallery.assets.enumerated() {
                let anchor = Entity()
                anchor.position = positions[index]
                content.add(anchor)

                if let artwork = attachments.entity(for: asset.id) {
                    artwork.position = [0, 0.15, 0]
                    artwork.scale = [0.00165, 0.00165, 0.00165]
                    artwork.components.set(HoverEffectComponent())
                    anchor.addChild(artwork)
                }

                // Interactive TwinfoldSpatial card: the actual Place/Pull
                // target, positioned just below the decorative artwork.
                let card = AssetCardEntity.make(asset: asset)
                card.position = [0, -0.58, 0.02]
                anchor.addChild(card)
                gallery.registerCard(card, for: asset.id)
            }

            if let controls = attachments.entity(for: "controls") {
                controls.position = [0, -1.15, -1.35]
                controls.scale = [0.00125, 0.00125, 0.00125]
                content.add(controls)
            }
        } attachments: {
            ForEach(gallery.assets) { asset in
                Attachment(id: asset.id) {
                    VStack(spacing: 0) {
                        ArtworkView(asset: asset)
                            .frame(width: 360, height: 460)
                        if gallery.showInformation {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(asset.title).font(.title2.weight(.medium))
                                Text(asset.address).foregroundStyle(.secondary)
                                Label(
                                    gallery.provider.isDemoData ? "DEMO DATA" : "DEVNET",
                                    systemImage: "checkmark.seal.fill"
                                )
                                .font(.caption.monospaced()).foregroundStyle(.orange)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(20)
                            .background(.black.opacity(0.86))
                        }
                    }
                    .frame(width: 360)
                    .background(.black)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .shadow(color: .black.opacity(0.6), radius: 35, y: 20)
                }
            }

            Attachment(id: "controls") {
                @Bindable var gallery = gallery
                VStack(spacing: 10) {
                    Text(gallery.statusMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: 480)

                    HStack(spacing: 12) {
                        Toggle(isOn: $gallery.showInformation) {
                            Label("作品情報", systemImage: "info.circle")
                        }
                        .toggleStyle(.button)

                        Button("Reset") {
                            if let asset = gallery.selectedAsset {
                                gallery.reset(for: asset)
                            }
                        }

                        transferControls

                        Button {
                            Task {
                                await dismissImmersiveSpace()
                                gallery.isImmersive = false
                                openWindow(id: GalleryModel.collectionWindowID)
                            }
                        } label: {
                            Label("コレクションへ戻る", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    }
                }
                .padding(12)
                .glassBackgroundEffect()
            }
        }
        .gesture(
            SpatialTapGesture()
                .targetedToAnyEntity()
                .onEnded { value in
                    gallery.handleTap(on: value.entity)
                }
        )
    }

    @ViewBuilder
    private var transferControls: some View {
        switch gallery.selectedTransferState {
        case .idle:
            Button("Transfer (demo)") {
                if let asset = gallery.selectedAsset {
                    gallery.simulateTransfer(for: asset, outcome: .confirmed)
                }
            }
            Button("Transfer fail (demo)") {
                if let asset = gallery.selectedAsset {
                    gallery.simulateTransfer(for: asset, outcome: .failed)
                }
            }
        case .pending:
            Button("Pending…") {}
                .disabled(true)
        case .failed:
            Button("Retry") {
                if let asset = gallery.selectedAsset {
                    gallery.simulateTransfer(for: asset, outcome: .confirmed)
                }
            }
        case .confirmed:
            Button("Confirmed") {}
                .disabled(true)
        }
    }

    /// Distributes card anchors evenly along a horizontal arc, matching the
    /// fixed 5-position layout used before the fixture was reduced to a
    /// single stamp Reference Asset.
    private func layoutPositions(count: Int) -> [SIMD3<Float>] {
        guard count > 0 else { return [] }
        guard count > 1 else { return [[0, 0.15, -2.1]] }

        let spread: Float = 2.7
        return (0..<count).map { index in
            let t = Float(index) / Float(count - 1)
            let x = -spread / 2 + spread * t
            return SIMD3<Float>(x, 0.15, -2.1)
        }
    }
}
