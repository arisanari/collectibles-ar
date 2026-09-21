# Twinfold Vision

visionOS 2向けのSwiftUI + RealityKitプロトタイプです。Crypto World's Fair 2026のMVPでは**Hero／secondary client（P1）**であり、Primary ClientはiPhone AR（`apps/ios`、SwiftUI + RealityKit + ARKit）です。両者は `packages/TwinfoldCore` を共有します。iOSの必須E2Eを遅らせない範囲で、同じAssetを表示するHero Demo録画とfallbackに使います。

役割は [Technical Architecture](../../docs/architecture.md) と [Build Order](../../docs/build-order.md) を正とします。

目標とするコアインタラクションは共通です。

- `Place`: 所有Assetを自分の空間へ配置する
- `Unfold`: Ownership・Provenance・Evidence・Physicalの層を展開する
- `Pull the provenance`: Assetからmint・transfer等の履歴を引き出す
- `Appear / Disappear`: 取得・transfer・redeemを出現・失効として体験する

購入、売却、redeem申請、配送先入力、ウォレット秘密鍵の保存は行いません。これらはWebへ集約します。Webで署名認証したセッションを一回限りの連携コードで受け取り、表示権をAPI経由で確認する設計を目指します。

## 現在の実装

固定データ（DEMO DATA）を使った空間ギャラリーです。ウォレット、Solana Asset、Provenance Event、表示権失効は未接続です。fixtureは初期プロトタイプ時のアニメ原画・トレカのデモデータのままで、共通Package（TwinfoldCore）の浮世絵1点（主役、額装カード）＋こけし1点（棚の拡張例、USDZ twin）への差し替えは共通モデル固定後に行います。

## Xcodeプロジェクトの生成

`project.yml` はXcodeGen用です。

```bash
brew install xcodegen
cd apps/visionos
xcodegen generate
open TwinfoldVision.xcodeproj
```

Apple Vision Pro Simulatorを選び、Runしてください。
