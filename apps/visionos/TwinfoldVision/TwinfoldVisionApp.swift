import SwiftUI
import TwinfoldCore

@main
struct TwinfoldVisionApp: App {
    @State private var gallery: GalleryModel?
    @State private var loadError: String?

    var body: some Scene {
        WindowGroup(id: GalleryModel.collectionWindowID) {
            Group {
                if let gallery {
                    CollectionView()
                        .environment(gallery)
                } else if let loadError {
                    Text("fixtureの読み込みに失敗しました: \(loadError)")
                        .multilineTextAlignment(.center)
                        .padding()
                } else {
                    ProgressView()
                }
            }
            .task {
                guard gallery == nil else { return }
                do {
                    let provider = try MockAssetProvider()
                    let model = GalleryModel(provider: provider)
                    await model.loadAssets()
                    gallery = model
                } catch {
                    loadError = String(describing: error)
                }
            }
        }
        .windowStyle(.plain)
        .defaultSize(width: 980, height: 680)

        ImmersiveSpace(id: GalleryModel.immersiveSpaceID) {
            if let gallery {
                ImmersiveGalleryView()
                    .environment(gallery)
            }
        }
        .immersionStyle(selection: .constant(.mixed), in: .mixed)
    }
}
