# サジェスト・レーダー（Suggest Radar）

日本語検索に最適化した、**リアルタイム SEO キーワード探索ツール**。
ラッコキーワードのようなサジェスト網羅取得を、Netlify（静的ホスティング + Functions）だけで動く構成で実装しています。

- 依存パッケージ **ゼロ**（フロントは素の ES Modules、サーバは Node 標準の `fetch` のみ）
- API キー不要・アカウント不要・データベース不要
- 8 媒体のサジェストを並列取得し、到着したそばから画面へ流し込む
- 五十音／アルファベット／疑問語／購買語などで自動掛け合わせ（全モードで約 220 クエリ）

---

## 1. できること

| 機能 | 概要 |
| --- | --- |
| マルチエンジン取得 | Google / YouTube / Bing / DuckDuckGo / Amazon.co.jp / Google ニュース / Google 画像 / Yahoo! JAPAN(β) |
| 掛け合わせ探索 | 基本・五十音・濁音、半濁音・アルファベット・数字/年号・疑問/悩み・比較/購買・ハウツー・属性/地域 の 9 モード |
| リアルタイム表示 | バッチ単位で並列リクエスト。結果は届いた順に集計・再描画（進捗バー・件数・経過秒） |
| 独自スコア | 出現クエリ数・媒体数・最高表示順位から 0〜100 で算出（詳細は §6） |
| グループ表示 | 元キーワードの直後に来る語で自動分類 |
| 共起語抽出 | 文字種の切り替わりで語を切り出し、頻出語をクラウド表示（クリックで絞り込み） |
| 深掘り | 任意のキーワードを起点に再探索（⤵ または `D` キー） |
| 語の背景 | 日本語版 Wikipedia の要約・関連項目を右ペインに表示 |
| 急上昇ワード | Google トレンド（日本）のデイリー／リアルタイムを取得 |
| 書き出し | CSV（Excel 用 BOM 付き）・JSON・クリップボード一括コピー |
| 保存 | お気に入り・調査履歴を localStorage に保持。URL にも状態を反映（共有可能） |
| UI | ダーク/ライト、キーボード操作、モバイル対応、`prefers-reduced-motion` 対応 |

---

## 2. Netlify へのデプロイ

### 2-1. GitHub 連携（推奨）

1. このリポジトリを GitHub に push
2. Netlify → **Add new site → Import an existing project** → 対象リポジトリを選択
3. ビルド設定は `netlify.toml` が持っているため、そのまま **Deploy**
   - Build command: `node scripts/build.mjs`
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
4. デプロイ完了後、`https://<your-site>.netlify.app/api/health` を開いて提供元の疎通を確認

環境変数の設定は不要です（API キーを使わない設計）。

### 2-2. CLI から

```bash
npm i -g netlify-cli
netlify login
netlify init      # 既存サイトに繋ぐ場合は netlify link
netlify deploy --build --prod
```

### 2-3. デプロイ後の確認

```bash
curl -s https://<your-site>.netlify.app/api/health | jq
```

`engines[].ok` が `true` の媒体が実際に使えます。`false` の媒体は提供元側の制限・仕様変更が原因で、
UI 側では自動的にその媒体だけスキップされます（他媒体の結果には影響しません）。

---

## 3. ローカル開発

```bash
# 1) 外部 API に接続せず、疑似データで UI を動かす（オフラインでも可）
npm run serve:mock          # http://localhost:8888

# 2) 実データで動かす（外部サジェスト API へ接続）
npm run serve

# 3) Netlify CLI を使う場合（本番と同じルーティング）
npm run dev
```

`scripts/devserver.mjs` は `public/` を静的配信し、`/api/<name>` を
`netlify/functions/<name>.mjs` に橋渡しする最小サーバです（netlify-cli 不要）。

### テスト

```bash
npm test          # 44 件のユニットテスト（node:test、外部通信なし）
```

ブラウザ操作のスモークテスト（任意）:

```bash
npm i -D playwright-core
npm run serve:mock &
npm run uicheck               # 探索〜表示切替〜モバイル幅まで 15 項目
```

---

## 4. API リファレンス

すべて `/api/*`（実体は Netlify Functions）。CORS 許可済みで外部からも利用できます。

### `POST /api/suggest`

クライアントが掛け合わせクエリをバッチ分割して叩く本経路。

```jsonc
// リクエスト
{ "queries": ["転職 あ", "転職 い"], "engines": ["google", "bing"] }

// レスポンス
{
  "ok": true,
  "engines": ["google", "bing"],
  "queryCount": 2,
  "elapsedMs": 412,
  "stats": { "google": { "ok": 2, "failed": 0, "cached": 0 } },
  "failures": [],
  "results": [{ "engine": "google", "query": "転職 あ", "suggestions": ["転職 あきらめる", "..."] }]
}
```

- `queries` は 1 リクエストあたり最大 60 件
- 一部が失敗しても 200 を返し、`stats` / `failures` に内訳が入る（部分成功方式）

### `GET /api/suggest`

サーバ側で掛け合わせを展開する簡易版。

```
/api/suggest?q=転職&modes=base,gojuon,question&engines=google,youtube
```

`modes` に指定できる値: `base` `gojuon` `dakuon` `alphabet` `number` `question` `commercial` `howto` `attribute`

### `GET /api/trends`

Google トレンド（日本）の急上昇ワード。デイリー → リアルタイムの順にフォールバック。

### `GET /api/related?q=<keyword>`

日本語版 Wikipedia の候補・要約・関連項目。

### `GET /api/health[?q=<probe>]`

全媒体へテストクエリを投げ、`ok` / 件数 / レイテンシ / エラーを返す診断用。

---

## 5. 構成

```
.
├── netlify.toml              # ビルド・リダイレクト・ヘッダ設定
├── public/                   # 静的配信されるすべて
│   ├── index.html
│   ├── assets/
│   │   ├── app.css           # 単一スタイルシート（ダーク/ライト）
│   │   ├── app.js            # エントリ（状態・イベント・描画の接続）
│   │   └── lib/
│   │       ├── api.js        # バッチ分割と並列リクエスト
│   │       ├── store.js      # 状態管理と集計（DOM 非依存）
│   │       └── views.js      # DOM 描画
│   └── shared/               # ブラウザと Functions が共有する純粋モジュール
│       ├── expand.js         # 掛け合わせクエリ生成
│       ├── text.js           # 正規化・トークン化・スコアリング
│       └── engines-meta.js   # 媒体の表示メタ情報（単一の情報源）
├── netlify/
│   ├── functions/            # suggest / trends / related / health
│   └── lib/                  # engines.js（取得・パース）, http.js（並列・キャッシュ・制限）
├── scripts/                  # build / devserver / uicheck
└── test/                     # node:test（外部通信をスタブ化）
```

設計上のポイント:

- **共有モジュールは `public/shared/` に置く。** ブラウザからは静的配信で、Functions からは
  相対 import（esbuild がバンドル）で同じファイルを読む。掛け合わせ語の定義が二重化しない。
- **失敗は握りつぶさず、部分成功で返す。** 1 媒体・1 クエリの失敗が探索全体を止めない。
- **キャッシュと流量制御。** Function インスタンス内に TTL 付き LRU（10 分）と
  IP 単位のトークンバケットを持ち、同一クエリの再取得と濫用を抑える。

---

## 6. スコアの定義（重要）

表示される 0〜100 の数値は **サジェスト上の露出の強さ** を表す独自指標で、
**検索ボリュームではありません**。内訳は次のとおりです。

| 要素 | 重み | 意味 |
| --- | --- | --- |
| 出現クエリ数（対数正規化） | 45% | 多くの掛け合わせで顔を出す語ほど需要の裾野が広い |
| 出現媒体数 | 25% | 媒体を跨いで現れる語ほど普遍的 |
| 最高表示順位 | 30% | サジェスト上位ほどユーザーの入力が多い |

実装は `public/shared/text.js` の `scoreOf()`。重みを変えたい場合はここだけ触れば全体に反映されます。
実ボリュームが必要な場合は Google キーワードプランナーや Search Console の実データと突き合わせてください。

---

## 7. カスタマイズ

**掛け合わせ語を業種に合わせる** — `public/shared/expand.js` の各配列
（`COMMERCIAL_SUFFIX` / `HOWTO_SUFFIX` / `ATTRIBUTE_PREFIX` など）を編集します。
`MODES` に項目を足せば UI のチップも自動で増えます。

**媒体を追加する** — `netlify/lib/engines.js` に `urls` と `parse` を書き、
`public/shared/engines-meta.js` に表示メタ情報を足すだけです。

**配色・ブランド** — `public/assets/app.css` 冒頭の CSS カスタムプロパティ（`--accent` など）と
`public/favicon.svg` / `public/assets/ogp.svg` を差し替えます。

**サイト URL** — `public/index.html` の `canonical` / OGP、`public/robots.txt` の Sitemap 行を
自分のドメインに変更してください（`sitemap.xml` はビルド時に `URL` 環境変数から自動生成されます）。

---

## 8. 制限と注意

- 取得元は各社の**公開サジェストエンドポイント**です。仕様変更・地域制限・レート制限により
  一部媒体が停止することがあります（`/api/health` で確認、UI は自動でスキップ）。
- 媒体数 × 掛け合わせ数だけ提供元へアクセスします。UI の推定表示が黄色になる規模
  （約 900 アクセス超）では、掛け合わせか媒体を減らすと安定します。
- Netlify Functions の実行時間上限（無料枠 10 秒）に収まるよう、1 リクエストあたりの
  クエリ数を 60、同時取得を 12 に制限しています。
- 取得したキーワードの利用は自己責任で、各サービスの利用規約に従ってください。

---

## 9. ライセンス

MIT

<!-- ecosystem:begin (自動生成: gentaron/infocollect の ecosystem/registry.json から。手で直さない) -->

## つながり

gentaron のリポジトリ群のうち **発信パイプライン** の一つ。Suggest Radar — 日本語検索のキーワード探索。

- **同じ島**: [IDEAZ](https://github.com/gentaron/IDEAZ)、[genesisvault](https://github.com/gentaron/genesisvault)、[Gentarog](https://github.com/gentaron/Gentarog)、[VAIZ](https://github.com/gentaron/VAIZ)、[SAIZ](https://github.com/gentaron/SAIZ)、[genimage](https://github.com/gentaron/genimage)

全体の地図 → [ecosystem](https://github.com/gentaron/infocollect/blob/HEAD/ecosystem/README.md)

<!-- ecosystem:end -->
