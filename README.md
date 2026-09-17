# Twinfold

**The ownership layer for real-world collectibles, starting with vintage Japanese postage stamps.**

Twinfoldは、保管された現物コレクティブルを、検証可能なオンチェーン所有権、来歴、空間体験、現物受取へ接続します。

> **Twinfold turns vaulted collectibles into transferable onchain ownership you can experience in space and redeem physically.**

Solanaが「Assetに何が起きたか」を記録し、Twinfoldが「それが所有者にとって何を意味するか」を空間の変化へ翻訳します。

## 提出先

Crypto World's Fair 2026（Colosseum）。開催期間 2026-09-14〜2026-10-12。

## プロダクト構造

| 層 | 役割 |
|---|---|
| Ownership Layer | 現物、証拠、保管、オンチェーンAsset、owner、redeemを接続する |
| Spatial Ownership Experience | 所有・来歴・移転をPlace、Pull、Appear／Disappearとして体験させる |
| Vintage Postage Stamp Vertical | 実物、顧客、供給者、運用、収益仮説を最初に検証する |

最初のReference Assetはクラシック切手、または著作権が消滅した図案の記念切手です。Twinfoldは「切手NFTサービス」ではなく、切手はreal-world collectibles全体へ展開するための最初の市場です。Twinfoldは鑑定機関を名乗らず、現物所有権と既存の鑑定機関が発行する鑑定書を分けて記録します。

## Core Experience

```text
実物と証拠を登録
→ Solana devnetにAssetをmint
→ walletがownershipを取得
→ My Collectionに現れる
→ iPhone ARで空間へPlace
→ AssetからprovenanceをPull
→ 別walletへtransferすると旧所有者からDisappear
→ Redeem Physicalを申請
→ 流通Assetをlock／retireしPassportを残す
```

Primary Aha momentは、**ownershipの変化が空間の変化になること**です。

- **Acquire → Appear**: 取得すると自分の空間に現れる
- **Transfer → Disappear**: 移転すると旧所有者の空間から消え、新所有者の空間に現れる
- **Redeem → Fold**: 現物を受け取ると流通Assetが失効し、来歴はRedeemed Provenance Passportへ残る

購入者は、現物をVaultに置いたままXR鑑賞とオンチェーン流通を続ける `Vaulted Ownership` と、現物を配送する `Physical Ownership` を選べます。Passportは配送後の現在所有者・現在状態・真正性を継続保証しません。

## Clients

| Client | 役割 | 優先度 |
|---|---|---|
| iPhone AR（Unity + AR Foundation + ARKit） | Place、Pull、Appear／Disappear。第三者テストと比較検証 | P0 |
| Web（Next.js） | wallet署名認証、My Collection、比較Timeline、transfer、redeem | P0 |
| Apple Vision Pro（SwiftUI + RealityKit） | 同じAssetを表示するHero Demo | P1 |

Meta Quest、AndroidはMVP後のAdapter展開先です。

## 現在の実装状況

現在はWebとvisionOSの**UIプロトタイプ**です。ウォレット、Solana、バックエンド、RWA Protocol、Vault、配送にはまだ接続していません。画面上の作品・証明番号・所有状態はすべて `DEMO DATA` で、fixtureは初期プロトタイプ時のアニメ原画・トレカのデモデータのままです。切手Reference Assetへの差し替えは共通モデル固定後に行います。Unity iPhone ARは未着手です。

### Web

Asset一覧・詳細、Phantom接続の疑似体験、所有コレクション、redeem申請の画面。

```bash
cd apps/web
npm install
npm run dev
```

`http://localhost:3000` を開きます。Helius接続時は `apps/web/.env.example` を `.env.local` にコピーして実値を入れます。

### Vision Pro

所有コレクション一覧、Immersive Space、Assetの空間配置、情報表示。起動方法は [apps/visionos/README.md](apps/visionos/README.md) を参照してください。

## 実装順序

1. 共通Asset／ProvenanceEvent／Entitlementモデルとfixtureを固定
2. Unity iOS ARの固定fixtureでPlace、Pull、Disappear
3. Web wallet署名認証、Metaplex Core devnet mint、Heliusからの履歴取得
4. 同じ実AssetをiOS ARへ表示し、実transfer後に旧ownerから失効
5. Reference AssetのTrust Gate、Physical情報、Vaulted／Physical Ownership
6. redeem dry run、Asset失効、Passport
7. Web／iOS AR比較ユーザーテスト、Pitch、提出

詳細は [MVP Acceptance Criteria](docs/mvp.md)、[Build Order](docs/build-order.md)、[Technical Architecture](docs/architecture.md) を参照してください。戦略、スケジュール、[PRD](https://example.invalid/internal)、[GTM実行計画](https://example.invalid/internal)は[Notion](https://example.invalid/internal)で管理しています。

## ディレクトリ

```text
apps/
  web/       Next.js Webプロトタイプ
  visionos/  SwiftUI + RealityKitプロトタイプ（P1）
  unity/     Unity iPhone AR（未作成、P0）
docs/        MVP判定基準、実装順、技術構成（実装側の正本）
AGENTS.md    AIエージェント共通ガイド（CLAUDE.mdはsymlink）
```

秘密鍵、APIキー、個人情報、権利未確認の高精細画像をリポジトリへ保存しません。

## 事前開発の開示

Crypto World's Fair開幕（2026-09-14）以前に、事業文書、Web UIプロトタイプ、visionOSプロトタイプを作成しています。開幕前のcommitと開幕後の作業はgit履歴で区別でき、提出時に開示します。

## 検証済み

- Web: `npm run build`
- visionOS: visionOS SDKを使ったSwift型チェック
