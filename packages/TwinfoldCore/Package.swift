// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "TwinfoldCore",
    platforms: [
        .iOS(.v17),
        .visionOS(.v2),
        .macOS(.v15),
    ],
    products: [
        .library(name: "TwinfoldCore", targets: ["TwinfoldCore"]),
        .library(name: "TwinfoldSpatial", targets: ["TwinfoldSpatial"]),
    ],
    targets: [
        .target(
            name: "TwinfoldCore",
            resources: [
                .copy("Resources/fixtures"),
                // USDZ twins for `SpatialRepresentation.model`. See
                // Sources/TwinfoldCore/Resources/models/.gitkeep and
                // Sources/TwinfoldSpatial/AssetRepresentationEntity.swift.
                .copy("Resources/models"),
            ]
        ),
        .target(
            name: "TwinfoldSpatial",
            dependencies: ["TwinfoldCore"]
        ),
        .testTarget(
            name: "TwinfoldCoreTests",
            dependencies: ["TwinfoldCore"]
        ),
    ]
)
