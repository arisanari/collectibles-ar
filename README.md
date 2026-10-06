# SlabAR

**SlabAR is the AR layer for real cards on Solana. Pull a pack, and the graded card appears life-size in the room you're in.**

SlabAR は、Solana上の実物カード資産（Collector Cryptなど）を、引いた瞬間にその場の現実空間へ実寸で呼び出すARコレクション層です。ガチャはCollector Cryptの台をアプリ内でホストし、SlabARは「出す・並べる・撮る」を担います。収益はホストした台の手数料です。

> Solanaは所有の移転を解いた（発送せずに売買できる）。SlabARは「発送せずに見せびらかす」を解く。

引いた瞬間に、その場に出る。現物はCollector CryptのVaultのまま。売り戻せば空間から消える。

> 2026-10-06に、浮世絵のARコレクション（OshiPin）からカードのAR層（SlabAR）へプロダクトを転換しました。詳細は「事前開発と転換の開示」を参照してください。

## 提出先

Crypto World's Fair 2026（Colosseum）。開催期間 2026-09-14〜2026-10-12。

## 何が動くか

- **devnet**: Collector Cryptの台（既定は `pokemon_25`）をWebで表示 → Pull（Phantomで署名）→ 開封 → My Collection（`DEVNET`）→ link済みiPhoneのARに鑑定ホルダー実寸でAppear → Placeで並べる → Passport → 買取でDisappear
- **mainnet（read-only）**: 自分のwalletにある本物のカードを `MAINNET (read-only)` で表示し、同じARに出す。アプリ内でmainnetのPull・買取・送金はしません
- **署名はWeb（Phantom）だけ**。結果はlink済みのiPhoneに出ます。iPhoneは鍵を持ちません

> 現在の実装状況は進行中です。上は2026-10-06に定めたP0の目標で、どこまで通っているかは完了報告とE2E証拠で区別します（`実データで完了`／`fixtureで完了`／`未実装`／`blocked`）。

## 表示の区別

| 表示 | 意味 |
|---|---|
| `DEMO DATA` | fixture（自作のダミーカード）。実在のカード画像は使いません |
| `DEVNET` | Solana devnetの実接続。devnetのPullは売上ではありません |
| `MAINNET (read-only)` | mainnetの読み取り専用表示 |

## 使用技術

- Solana（devnet／mainnet read-only）、Metaplex（Core／pNFT／cNFT資産の取得）、Helius RPC／DAS
- Collector Crypt Gacha API（台、Pull、開封、買取、VRF検証）
- SwiftUI、RealityKit、ARKit（iPhone AR、Apple Vision Proは同じSwift Packageを使うsecondary）
- Next.js 16、React 19、TypeScript、Phantom

## Clients

| Client | 役割 | 優先度 |
|---|---|---|
| iPhone AR（SwiftUI + RealityKit + ARKit） | Appear、Place、Passport、Disappear | P0 |
| Web（Next.js） | wallet接続・署名、台の表示、Pull・開封、My Collection、買取 | P0 |
| Apple Vision Pro（SwiftUI + RealityKit） | 同じAssetを表示するHero Demo | P1 |

## Collector Cryptへの依存と責任分界

- 在庫、Vault保管、発送、買取、法務はCollector Cryptが担います。SlabARは現物を持ちません
- 台の価格、確率、EV、在庫、買取率はCollector Cryptの `/api/machines` の値をそのまま表示します。SlabARは計算・加工せず、保証もしません
- 買取はCollector Cryptが行います（72時間以内、台ごとの率）
- PSAのグレード、`Authenticated`、Insured Value、Vault記録はCollector Cryptまたは鑑定機関の主張で、SlabARが検証したものではありません
- Passportは、onchain fact（owner、mint、transfer）、第三者の主張、SlabAR interpretationを分けて表示します。blockchain、NFT、PassportはカードのAuthenticityや配送後の現物状態を保証しません
- 収益線は、Collector Cryptの `can_adopt` による自分の台コード（既存台に1パックあたり最大10%の手数料）の仕様に基づく計画です。API keyと `can_adopt` の有効化は申請中で、承認前は未承認です。payoutはCollector Cryptが行います
- Collector CryptのAPI keyが無くても、台の表示・Pull・開封は動きます（keyはサーバー側envの `COLLECTOR_CRYPT_API_KEY` で、公開しません）

## 免責

ガチャの確率、EV、在庫、買取率はCollector Cryptの公表値で、SlabARが保証するものではありません。投資・利益・当選を約束するものではありません。devnetのPullは売上ではありません。mainnet、本番決済、実配送はアプリ内で行いません。

## 再現手順

### Web

```bash
cd apps/web
npm install
npm run dev
```

`http://localhost:3000` を開きます。Helius接続時は `apps/web/.env.example` を `.env.local` にコピーして実値を入れます。devnetのPullには、devnet SOLと、devnet USDC（[faucet](https://spl-token-faucet.com/?token-name=USDC-Dev)、mint `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr`）を入れたPhantom walletが要ります。API keyが無くても動きます。

検証: `npm run build`、`npm run lint`。

### iPhone AR

```bash
cd apps/ios
xcodegen generate
```

Xcodeで `TwinfoldAR.xcodeproj` を開き、実機で起動します（署名は個人Team）。手順は `.claude/skills/ios-realitykit-ar/SKILL.md` を参照してください。

### 共通Swift Package

```bash
cd packages/TwinfoldCore
swift build
```

### Vision Pro

起動方法は [apps/visionos/README.md](apps/visionos/README.md) を参照してください。

## 実装順序

[Build Order](docs/build-order.md) を参照してください（Phase 0 正本の書き換え 10/06、Phase 1 GachaProvider devnetとWeb 10/07、Phase 2 iPhone ARとmainnet read-only 10/08、Phase 3 発表資料と検証 10/09、Phase 4 動画 10/10、Phase 5 提出 10/11〜12）。詳細は [MVP Acceptance Criteria](docs/mvp.md)、[Technical Architecture](docs/architecture.md) を参照してください。戦略、スケジュール、[PRD](https://example.invalid/internal)、[GTM実行計画](https://example.invalid/internal)は[Notion](https://example.invalid/internal)で管理しています（2026-10-06の転換を反映するまでは古い部分があります）。

## ディレクトリ

```text
apps/
  web/       Next.js Web（台、Pull、My Collection、買取、端末連携）
  visionos/  SwiftUI + RealityKitプロトタイプ（P1）
  ios/       SwiftUI + RealityKit + ARKit iPhone AR（P0）
packages/
  TwinfoldCore/  iOSとvisionOSで共有する共通モデルとSpatial Entity
docs/        MVP判定基準、実装順、技術構成（実装側の正本）
AGENTS.md    AIエージェント共通ガイド（CLAUDE.mdはsymlink）
```

秘密鍵、APIキー、個人情報、権利未確認の画像（実在のカード画像を含む）をリポジトリへ保存しません。カード画像はmetadataのURLから実行時に読みます。

リポジトリ名・コード内部名（TwinfoldCore、TwinfoldAsset、APIパス、fixtureのidなど）は Twinfold のままです。

## 事前開発と転換の開示

Crypto World's Fair開幕（2026-09-14）以前に、事業文書、Web UIプロトタイプ、visionOSプロトタイプを作成しています。開幕後の2026-09-21から2026-10-06までは、壁に掛ける浮世絵・版画のARコレクション（2026-10-05にOshiPinへ改名）を作っていました。2026-10-06に、プロダクトをCollector Cryptの実物カードをARで出すSlabARへ転換しました。浮世絵・こけしのfixtureと、iPhone link、wallet署名、AR Placeの実装は、コードに残し（浮世絵とこけしは休眠）、転換後の製品で再利用します。開幕前のcommit、転換前の作業、転換後の作業はgit履歴で区別でき、提出時に開示します。

## 検証済み

- Web: `npm run build`
- visionOS: visionOS SDKを使ったSwift型チェック
