import SwiftUI
import TwinfoldCore

/// Decorative SwiftUI representation of a `TwinfoldAsset`, layered as a
/// RealityKit `Attachment` next to the interactive `AssetCardEntity` in
/// `ImmersiveGalleryView`. Purely visual; Place/Pull/transfer state lives in
/// `GalleryModel` and `TwinfoldSpatial`.
struct ArtworkView: View {
    let asset: TwinfoldAsset
    var compact = false

    var body: some View {
        ZStack {
            LinearGradient(colors: palette, startPoint: .topLeading, endPoint: .bottomTrailing)

            Circle()
                .fill(.white.opacity(0.32))
                .frame(width: compact ? 72 : 150)
                .offset(x: compact ? 38 : 80, y: compact ? -55 : -110)

            VStack(spacing: compact ? 6 : 12) {
                Spacer()
                Image(systemName: "seal.fill")
                    .font(.system(size: compact ? 48 : 110, weight: .thin))
                    .foregroundStyle(.black.opacity(0.72))
                Rectangle()
                    .fill(.black.opacity(0.45))
                    .frame(height: compact ? 22 : 46)
            }
        }
        .aspectRatio(0.78, contentMode: .fit)
        .overlay(alignment: .topLeading) {
            Text(asset.address)
                .font(.system(size: compact ? 7 : 12, design: .monospaced))
                .foregroundStyle(.white.opacity(0.8))
                .padding(compact ? 8 : 16)
        }
        .clipped()
    }

    /// Fixed, vintage-postage-stamp palette. `TwinfoldAsset` carries no
    /// decorative color data, so this is not derived from asset fields.
    private var palette: [Color] {
        [
            Color(red: 0.62, green: 0.50, blue: 0.32),
            Color(red: 0.85, green: 0.74, blue: 0.52),
        ]
    }
}
