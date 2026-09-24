import SwiftUI
import TwinfoldCore

/// Bottom tray: horizontal-scrolling thumbnails of every asset the active
/// wallet owns, each with a status dot (gray = unplaced, green = placed).
/// Tapping a thumbnail starts a holding preview (unplaced) or selects the
/// already-placed asset (same as tapping it in the AR scene). The heading
/// opens the full list sheet (`CollectionView`).
///
/// `isOpen` is a separate, user-controlled open/close (handle pill only
/// when closed, for a clean screenshot of the room), on top of the
/// existing auto-collapse to just the header row while the operation card
/// or transfer toast is on screen.
struct AssetTrayView: View {
    let controller: RoomController
    @Binding var showsFullList: Bool
    @Binding var isOpen: Bool

    /// Collapses the thumbnail row to just the header while the operation
    /// card or the transfer toast is on screen, so the two don't pile up
    /// at the bottom of the screen.
    private var isCollapsed: Bool {
        controller.selectedAssetId != nil || controller.toast != nil
    }

    var body: some View {
        // Closed: only the capsule handle floats over the camera feed (no
        // full-width material band), so the room can be screenshotted clean.
        if isOpen {
            openTray
                .frame(maxWidth: .infinity)
                .background(.ultraThinMaterial)
        } else {
            closedHandle
                .frame(maxWidth: .infinity)
        }
    }

    private var openTray: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button {
                    showsFullList = true
                } label: {
                    HStack {
                        Text("コレクション \(controller.ownedAssets.count)点・未配置 \(controller.unplacedCount)")
                            .font(.footnote.bold())
                        Image(systemName: "chevron.up")
                            .font(.caption2)
                    }
                    .foregroundStyle(.white)
                }

                Spacer()

                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isOpen = false
                    }
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .padding(6)
                }
            }
            .padding(.horizontal, 16)

            if !isCollapsed {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(controller.ownedAssets) { asset in
                            thumbnail(for: asset)
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Small bottom-center handle shown when the tray is closed, so the
    /// rest of the AR view is free (e.g. for a screenshot).
    private var closedHandle: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                isOpen = true
            }
        } label: {
            HStack(spacing: 4) {
                Text("コレクション")
                    .font(.caption.bold())
                Image(systemName: "chevron.up")
                    .font(.caption2)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(Color.black.opacity(0.4), in: Capsule())
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
    }

    private func thumbnail(for asset: TwinfoldAsset) -> some View {
        let isHolding = controller.holdingAssetId == asset.id
        let isSelected = controller.selectedAssetId == asset.id
        return Button {
            controller.trayTap(assetId: asset.id)
        } label: {
            VStack(spacing: 4) {
                ZStack(alignment: .topTrailing) {
                    artworkImage(for: asset)
                        .frame(width: 56, height: 56)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(isHolding || isSelected ? Color.accentColor : Color.clear, lineWidth: 2)
                        )
                    Circle()
                        .fill(controller.isPlaced(asset.id) ? Color.green : Color.gray)
                        .frame(width: 10, height: 10)
                        .offset(x: 4, y: -4)
                }
                Text(asset.title)
                    .font(.caption2)
                    .lineLimit(1)
                    .frame(width: 60)
                    .foregroundStyle(.white)
            }
        }
    }

    @ViewBuilder
    private func artworkImage(for asset: TwinfoldAsset) -> some View {
        if let url = TwinfoldCoreResources.artworkURL(forImageUrl: asset.display.imageUrl),
           let data = try? Data(contentsOf: url),
           let uiImage = UIImage(data: data) {
            Image(uiImage: uiImage)
                .resizable()
                .aspectRatio(contentMode: .fill)
        } else {
            Rectangle()
                .fill(Color.gray.opacity(0.3))
                .overlay(Text(String(asset.title.prefix(1))).foregroundStyle(.white))
        }
    }
}
