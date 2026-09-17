import Observation
import SwiftUI

struct GalleryPiece: Identifiable, Hashable {
    let id: String
    let title: String
    let studio: String
    let year: Int
    let certificate: String
    let palette: [Color]
}

@Observable
final class GalleryModel {
    static let collectionWindowID = "twinfold-collection"
    static let immersiveSpaceID = "twinfold-gallery"

    var selectedPieceID = "tf-003"
    var isImmersive = false
    var showInformation = true

    let pieces = [
        GalleryPiece(
            id: "tf-003",
            title: "Summer Platform",
            studio: "Aster Animation",
            year: 1999,
            certificate: "JAMAC-A-03117",
            palette: [.init(red: 0.53, green: 0.64, blue: 0.70), .init(red: 0.72, green: 0.76, blue: 0.59)]
        ),
        GalleryPiece(
            id: "tf-001",
            title: "Wind at Dawn",
            studio: "Aster Animation",
            year: 1997,
            certificate: "JAMAC-A-02841",
            palette: [.init(red: 0.42, green: 0.47, blue: 0.56), .init(red: 0.91, green: 0.63, blue: 0.47)]
        ),
        GalleryPiece(
            id: "tf-002",
            title: "The Quiet Orbit",
            studio: "Northstar Pictures",
            year: 2001,
            certificate: "JAMAC-C-01933",
            palette: [.init(red: 0.07, green: 0.10, blue: 0.16), .init(red: 0.49, green: 0.59, blue: 0.72)]
        ),
        GalleryPiece(
            id: "tf-004",
            title: "Solar Guardian No. 07",
            studio: "Helios Card Works · Trading Card",
            year: 2003,
            certificate: "JAMAC-T-00872",
            palette: [.init(red: 0.12, green: 0.08, blue: 0.20), .init(red: 0.84, green: 0.57, blue: 0.16)]
        ),
        GalleryPiece(
            id: "tf-005",
            title: "Moon Rabbit Prototype",
            studio: "Kite Toy Laboratory · Figure",
            year: 2005,
            certificate: "JAMAC-F-00419",
            palette: [.init(red: 0.84, green: 0.80, blue: 0.88), .init(red: 0.36, green: 0.29, blue: 0.46)]
        ),
    ]
}
