import SwiftUI

@main
struct TwinfoldVisionApp: App {
    @State private var gallery = GalleryModel()

    var body: some Scene {
        WindowGroup(id: GalleryModel.collectionWindowID) {
            CollectionView()
                .environment(gallery)
        }
        .windowStyle(.plain)
        .defaultSize(width: 980, height: 680)

        ImmersiveSpace(id: GalleryModel.immersiveSpaceID) {
            ImmersiveGalleryView()
                .environment(gallery)
        }
        .immersionStyle(selection: .constant(.mixed), in: .mixed)
    }
}
