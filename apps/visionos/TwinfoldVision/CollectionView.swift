import SwiftUI
import TwinfoldCore

struct CollectionView: View {
    @Environment(GalleryModel.self) private var gallery
    @Environment(\.openImmersiveSpace) private var openImmersiveSpace
    @Environment(\.dismissImmersiveSpace) private var dismissImmersiveSpace
    @Environment(\.dismissWindow) private var dismissWindow

    var body: some View {
        @Bindable var gallery = gallery

        ZStack {
            Color.black.opacity(0.46)
            VStack(spacing: 0) {
                header
                Divider().opacity(0.25)
                HStack(spacing: 28) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("YOUR ARCHIVE")
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .tracking(2)
                            .foregroundStyle(.secondary)
                        Text("Spatial collection")
                            .font(.system(size: 48, weight: .medium))
                        Text("浮世絵Reference Assetを、あなたの空間に展示します。")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text("\(gallery.assets.count)").font(.system(size: 38, design: .monospaced))
                        Text("AUTHENTICATED WORKS").font(.caption2.monospaced()).foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 46)
                .padding(.vertical, 34)

                ScrollView(.horizontal) {
                    HStack(spacing: 22) {
                        ForEach(gallery.assets) { asset in
                            Button {
                                gallery.selectedAssetID = asset.id
                            } label: {
                                VStack(alignment: .leading, spacing: 13) {
                                    ArtworkView(asset: asset, compact: true)
                                        .frame(width: 210, height: 270)
                                        .clipShape(RoundedRectangle(cornerRadius: 3))
                                    Text(asset.title).font(.title3.weight(.medium))
                                    Text(asset.address)
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                .padding(13)
                                .background(gallery.selectedAssetID == asset.id ? .white.opacity(0.14) : .clear)
                                .clipShape(RoundedRectangle(cornerRadius: 18))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 46)
                    .padding(.bottom, 20)
                }
                .scrollIndicators(.hidden)

                Spacer(minLength: 10)
                Button {
                    Task {
                        if gallery.isImmersive {
                            await dismissImmersiveSpace()
                            gallery.isImmersive = false
                        } else {
                            let result = await openImmersiveSpace(id: GalleryModel.immersiveSpaceID)
                            gallery.isImmersive = result == .opened
                            if gallery.isImmersive {
                                dismissWindow(id: GalleryModel.collectionWindowID)
                            }
                        }
                    }
                } label: {
                    Label(gallery.isImmersive ? "ギャラリーを閉じる" : "空間ギャラリーを開く", systemImage: gallery.isImmersive ? "xmark" : "view.3d")
                        .font(.headline)
                        .padding(.horizontal, 24)
                }
                .buttonStyle(.borderedProminent)
                .tint(.white)
                .foregroundStyle(.black)
                .padding(.bottom, 30)
            }
        }
    }

    private var header: some View {
        HStack {
            Image(systemName: "rectangle.split.2x1.fill").rotationEffect(.degrees(-8))
            Text("TWINFOLD").font(.headline.monospaced()).tracking(1.5)
            Spacer()
            Text(gallery.provider.isDemoData ? "DEMO DATA" : "DEVNET")
                .font(.caption2.monospaced().weight(.semibold))
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color.orange.opacity(0.85))
                .foregroundStyle(.white)
                .clipShape(Capsule())
        }
        .padding(.horizontal, 36).frame(height: 68)
    }
}
