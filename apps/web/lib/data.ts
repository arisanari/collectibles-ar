export type Collectible = {
  id: string;
  title: string;
  work: string;
  studio: string;
  year: number;
  category: "原画" | "セル画" | "トレカ" | "フィギュア";
  price: number;
  status: "販売中" | "所蔵中";
  accent: string;
  image: string;
  certificate: string;
  vaultId: string;
  token: string;
  description: string;
};

export const collectibles: Collectible[] = [
  {
    id: "tf-001",
    title: "Rei Character Genga",
    work: "EVANGELION STORE 原画集特典",
    studio: "khara",
    year: 2026,
    category: "原画",
    price: 4.8,
    status: "販売中",
    accent: "#d97c5d",
    image: "/collection/rei-genga.jpg",
    certificate: "DEMO-A-02841",
    vaultId: "TYO-01-A184",
    token: "9Yg2…kR7p",
    description: "キャラクターの線や色指定を高精細で鑑賞するための原画コレクション。画像と証明情報はプロトタイプ用です。",
  },
  {
    id: "tf-002",
    title: "Asuka Character Genga",
    work: "EVANGELION STORE 原画集特典",
    studio: "khara",
    year: 2026,
    category: "原画",
    price: 3.2,
    status: "販売中",
    accent: "#8097b8",
    image: "/collection/asuka-genga.jpg",
    certificate: "DEMO-A-01933",
    vaultId: "TYO-01-C052",
    token: "4Da8…wP2m",
    description: "横顔の表情と色指定が残るキャラクター原画。画像と証明情報はプロトタイプ用です。",
  },
  {
    id: "tf-003",
    title: "Blastoise Expedition 1st Edition",
    work: "Pokémon Card e-Series",
    studio: "Pokémon",
    year: 2001,
    category: "トレカ",
    price: 5.6,
    status: "所蔵中",
    accent: "#8eaa83",
    image: "/collection/blastoise-card.jpeg",
    certificate: "PSA 78836948",
    vaultId: "TYO-02-B107",
    token: "7Fn3…aQ9x",
    description: "PSA GEM MT 10の日本語版カメックス。NFT所有権とVault内の鑑定済みカードを紐づけるデモアイテムです。",
  },
  {
    id: "tf-004",
    title: "Flareon VMAX Promo",
    work: "Pokémon Card Sword & Shield Promo",
    studio: "Pokémon",
    year: 2021,
    category: "トレカ",
    price: 1.9,
    status: "販売中",
    accent: "#d4a93e",
    image: "/collection/flareon-card.jpg",
    certificate: "PSA DEMO-186",
    vaultId: "TYO-03-T221",
    token: "3Hs9…vM4c",
    description: "日本語版プロモカードの鑑定スラブ。証明番号と価格はプロトタイプ用の仮データです。",
  },
  {
    id: "tf-005",
    title: "Aquarius Figure",
    work: "Japanese Character Figure",
    studio: "Licensed Collectible",
    year: 2025,
    category: "フィギュア",
    price: 6.4,
    status: "所蔵中",
    accent: "#b6a0c9",
    image: "/collection/aquarius-figure.webp",
    certificate: "DEMO-F-00419",
    vaultId: "TYO-04-F036",
    token: "8Lb1…tN6e",
    description: "水瓶と透明素材の造形を含むキャラクターフィギュア。360度表示と空間配置を想定したデモアイテムです。",
  },
  {
    id: "tf-006",
    title: "Crystal Chair Figure",
    work: "Japanese Character Figure",
    studio: "Licensed Collectible",
    year: 2025,
    category: "フィギュア",
    price: 2.8,
    status: "販売中",
    accent: "#80d8de",
    image: "/collection/chair-figure.jpg",
    certificate: "DEMO-F-00512",
    vaultId: "TYO-04-F051",
    token: "5Cx7…pL2a",
    description: "椅子とクリスタルパーツを含むキャラクターフィギュア。商品情報はプロトタイプ用の仮データです。",
  },
  {
    id: "tf-007",
    title: "Blue Rose Figure",
    work: "Japanese Character Figure",
    studio: "Licensed Collectible",
    year: 2025,
    category: "フィギュア",
    price: 7.1,
    status: "販売中",
    accent: "#536ba8",
    image: "/collection/blue-rose-figure.webp",
    certificate: "DEMO-F-00587",
    vaultId: "TYO-04-F068",
    token: "2Vn8…sJ5r",
    description: "椅子や装飾まで含めて展示する大型キャラクターフィギュア。商品情報はプロトタイプ用の仮データです。",
  },
];
