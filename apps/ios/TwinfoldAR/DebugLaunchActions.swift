#if DEBUG
import Foundation

/// Debug-only launch arguments so a simulator run can reach a state without tapping (simulators cannot be tapped from
/// a script). Compiled out of Release builds.
///
///   -twinfold-mode devnet|mainnet     switch the data source at launch
///   -twinfold-auto-pulls 2            run "Simulate pull (DEMO DATA)" N times (Demo mode)
///   -twinfold-auto-passport 1         then select the first card and open its Passport
@MainActor
enum DebugLaunchActions {
    static func run(_ controller: RoomController) async {
        let defaults = UserDefaults.standard
        if let raw = defaults.string(forKey: "twinfold-mode"), let mode = DataMode(rawValue: raw) {
            controller.switchDataMode(to: mode)
            return
        }
        let pulls = defaults.integer(forKey: "twinfold-auto-pulls")
        guard pulls > 0 else { return }
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        for _ in 0..<pulls {
            controller.simulatePull()
            try? await Task.sleep(nanoseconds: 2_500_000_000)
        }
        if defaults.bool(forKey: "twinfold-auto-passport"), let id = controller.ownedAssets.first(where: { controller.isPlaced($0.id) })?.id {
            controller.select(id)
            controller.presentPassportForSelected()
        }
    }
}
#endif
