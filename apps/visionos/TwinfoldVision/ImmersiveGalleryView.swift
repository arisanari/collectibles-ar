import RealityKit
import SwiftUI

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

            let positions: [SIMD3<Float>] = [
                [-1.35, 0.15, -1.9],
                [-0.68, 0.22, -2.05],
                [0, 0.26, -2.1],
                [0.68, 0.22, -2.05],
                [1.35, 0.15, -1.9],
            ]

            for (index, piece) in gallery.pieces.enumerated() {
                if let artwork = attachments.entity(for: piece.id) {
                    artwork.position = positions[index]
                    artwork.scale = [0.00165, 0.00165, 0.00165]
                    artwork.components.set(HoverEffectComponent())
                    content.add(artwork)
                }
            }

            if let controls = attachments.entity(for: "controls") {
                controls.position = [0, -0.72, -1.35]
                controls.scale = [0.00125, 0.00125, 0.00125]
                content.add(controls)
            }
        } attachments: {
            ForEach(gallery.pieces) { piece in
                Attachment(id: piece.id) {
                    VStack(spacing: 0) {
                        ArtworkView(piece: piece)
                            .frame(width: 360, height: 460)
                        if gallery.showInformation {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(piece.title).font(.title2.weight(.medium))
                                Text("\(piece.studio) · \(String(piece.year))").foregroundStyle(.secondary)
                                Label(piece.certificate, systemImage: "checkmark.seal.fill")
                                    .font(.caption.monospaced()).foregroundStyle(.green)
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
                HStack(spacing: 12) {
                    Toggle(isOn: $gallery.showInformation) {
                        Label("作品情報", systemImage: "info.circle")
                    }
                    .toggleStyle(.button)

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
                .padding(12)
                .glassBackgroundEffect()
            }
        }
    }
}
