import Foundation
import RealityKit

/// Appear / Disappear motion for a placed entity. Never touches `scale` (a slab keeps its real-world size): it fades
/// the whole entity in or out (`OpacityComponent`, iOS 18 / visionOS 2 / macOS 15; on older systems there is no
/// fade) and moves it a few centimetres along its parent's up axis.
@MainActor
public enum PresenceAnimation {
    public static let appearDuration: TimeInterval = 0.8
    public static let disappearDuration: TimeInterval = 0.6

    /// Fades `entity` from 0 to 1 while it rises `rise` meters into its current position (parent's +y).
    public static func appear(_ entity: Entity, rise: Float = 0.04, duration: TimeInterval = appearDuration) async {
        let target = entity.position
        setOpacity(0, on: entity)
        entity.position = target - SIMD3<Float>(0, rise, 0)
        await animate(duration: duration) { t in
            let eased = easeOut(t)
            setOpacity(eased, on: entity)
            entity.position = target - SIMD3<Float>(0, rise * (1 - eased), 0)
        }
        setOpacity(1, on: entity)
        entity.position = target
    }

    /// Fades `entity` from its current opacity to 0 while it drifts `drift` meters up. Leaves it invisible; the caller
    /// removes the anchor afterwards.
    public static func disappear(_ entity: Entity, drift: Float = 0.02, duration: TimeInterval = disappearDuration) async {
        let start = entity.position
        await animate(duration: duration) { t in
            setOpacity(1 - t, on: entity)
            entity.position = start + SIMD3<Float>(0, drift * t, 0)
        }
        setOpacity(0, on: entity)
    }

    private static func setOpacity(_ value: Float, on entity: Entity) {
        if #available(iOS 18.0, visionOS 2.0, macOS 15.0, *) {
            entity.components.set(OpacityComponent(opacity: max(0, min(1, value))))
        }
    }

    private static func easeOut(_ t: Float) -> Float { 1 - (1 - t) * (1 - t) }

    private static func animate(duration: TimeInterval, step: (Float) -> Void) async {
        let clock = ContinuousClock()
        let start = clock.now
        while true {
            let elapsed = start.duration(to: clock.now)
            let seconds = Double(elapsed.components.seconds) + Double(elapsed.components.attoseconds) / 1e18
            let t = Float(min(1, seconds / duration))
            step(t)
            if t >= 1 { return }
            try? await Task.sleep(nanoseconds: 16_000_000)
            if Task.isCancelled { return }
        }
    }
}
