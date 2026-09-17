import SwiftUI

struct ArtworkView: View {
    let piece: GalleryPiece
    var compact = false

    var body: some View {
        ZStack {
            LinearGradient(colors: piece.palette, startPoint: .topLeading, endPoint: .bottomTrailing)

            Circle()
                .fill(.white.opacity(0.32))
                .frame(width: compact ? 72 : 150)
                .offset(x: compact ? 38 : 80, y: compact ? -55 : -110)

            VStack(spacing: compact ? 6 : 12) {
                Spacer()
                Image(systemName: symbolName)
                    .font(.system(size: compact ? 48 : 110, weight: .thin))
                    .foregroundStyle(.black.opacity(0.72))
                Rectangle()
                    .fill(.black.opacity(0.45))
                    .frame(height: compact ? 22 : 46)
            }
        }
        .aspectRatio(0.78, contentMode: .fit)
        .overlay(alignment: .topLeading) {
            Text(piece.id.uppercased())
                .font(.system(size: compact ? 7 : 12, design: .monospaced))
                .foregroundStyle(.white.opacity(0.8))
                .padding(compact ? 8 : 16)
        }
        .clipped()
    }

    private var symbolName: String {
        switch piece.id {
        case "tf-002": "moon.stars.fill"
        case "tf-004": "sparkles.rectangle.stack.fill"
        case "tf-005": "hare.fill"
        default: "figure.walk"
        }
    }
}
