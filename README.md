# Undercurrent（アンダーカレント）

**世界のニッチ潮流＆ネットスラング大全。**
SNS やコミュニティを 3 時間ごとに自動で巡回して、「半日経ったら全部入れ替わっている」レベルの話題や新語を拾い出し、フィード形式で流します。拾った語は自動で台帳に蓄積され、そのまま **ネットスラング大全** になります。

- **全部無料**：Netlify 無料プラン（Functions／Scheduled Functions／Blobs）だけで動き、使う API もすべてキー不要
- **依存はほぼゼロ**：フロントは素の ES Modules、サーバ側は `@netlify/blobs` だけ
- **検索しなくても全部見える**：Google トレンドのように、開いた瞬間に「いま伸びているもの」が一覧で並ぶ（キーワード入力は不要）

---

## 1. 何を観測しているか（14 ソース・すべて無料）

| 媒体 | 取り方 | 役割 |
| --- | --- | --- |
| 🦋 Bluesky | 公開 AppView の `getTrends` / `getTrendingTopics` | 英語圏 SNS のトレンド |
| 🐘 Mastodon | mastodon.social / mstdn.jp / fosstodon / mas.to の `trends/tags`（7 日分の利用履歴つき） | 連合 SNS のタグの伸び |
| 🥑 Misskey.io | `hashtags/trend`（直近のチャートつき） | 日本語圏ネット文化の震源 |
| 👽 Reddit | OutOfTheLoop・GenZ・copypasta など 16 サブレの *rising* | 英語スラングの発生源 |
| 📕 Urban Dictionary | `words_of_the_day` | 英語スラングの一次ソース |
| 🧌 Know Your Meme | RSS | ミームの台帳 |
| 📺 ニコニコ動画 | 毎時ランキング RSS | 日本のネットミーム |
| 🔖 はてなブックマーク | 人気＋新着 RSS | 日本語圏で読まれている話題 |
| 🟧 Hacker News | Algolia API（front page＋伸びている Show HN） | 技術系のニッチ |
| 🦞 Lobsters | `hottest.json` | 濃いめの技術コミュニティ |
| 🐙 GitHub | 直近 48 時間に作られて星を集めているリポジトリ | 技術系の新語・新ツール |
| 🐭 Lemmy | lemmy.world の *Active* | Reddit の代わりになる連合コミュニティ |
| 📈 Google Trends | 日本・米国の RSS | **主流の基準**（ここにしか出ない語は減点） |
| 📚 Wikipedia | ja/en の閲覧数上位 | **主流の基準** |

1 つのソースが落ちても全体は止まりません。「観測網」タブと `/api/health` で各ソースの状態を確認できます。

### 画面

- **トレンド一覧**（最初の画面）：Google トレンド風の表。地域（全世界／日本／英語圏）・期間（4h／24h／48h）・カテゴリ・並び順で絞り込み、行をクリックで詳細
- **潮流フィード**：同じデータを SNS のタイムライン風に表示
- **スラング大全**／**生データ**／**ネタ帳**／**観測網**

## 2. 仕組み

```
[Scheduled Function: collect]  3 時間ごと（cron 0 */3 * * *）
   │
   ├─ sources.js   14 ソースを並列取得（制限時間を超えたソースは切り捨て）
   ├─ mine.js      語の候補を掘り出す
   │                 ・ソースが示しているトピック名やハッシュタグ
   │                 ・本文：「」『』【】で囲まれた語／日本語は Intl.Segmenter で分かち書きして複合語を組み直す
   │                   （推し|活 → 推し活、ヤバ|み → ヤバみ）／英語は固有名詞の連続と 1〜3 語の組み合わせ
   │                 ・表記ゆれをまとめる（aura farming = #aurafarming = aura-farming）
   │                 ・長い語の一部としてしか出てこない短い語は外す（skibidi toilet があれば toilet は消す）
   ├─ score.js     採点し、台帳を更新
   └─ Netlify Blobs  latest（最新スナップショット）／lexicon（大全）／meta（履歴）
                   │
[フロント] ── /api/feed ・ /api/term ・ /api/lexicon ・ /api/rss ・ /api/history
```

### スコアの中身

| 指標 | 意味 |
| --- | --- |
| 熱量 | ソースの重み × そのソース内での反応の順位 × 新しさ × ソース自身が示す勢い。1 つのソースで何度出ても上限で頭打ち |
| 拡散 | いくつのソースにまたがって出ているか（3 つ以上で 🌊） |
| 伸び率 | 台帳に記録した過去の平均（指数移動平均）に比べて、今回どれだけ伸びたか（0.8 以上で 🔥） |
| 新しさ | 初めて観測してからの経過時間で減る（12 時間以内は 🌱） |
| スラング度 | 造語っぽい形（〜構文／〜界隈／〜沼／-maxxing／-core／-pilled など）と、スラング系ソースに出ているかで推定 |
| 主流ネタの減点 | Google Trends や Wikipedia の上位**にしか**出ていない語は ×0.45 |

状態の判定：🌱 誕生（初観測から 12 時間以内）／🔥 急騰／🌊 拡散／🧟 再燃（1 日以上消えたあと再び出現）／🥀 失速。
大全では、3 日間観測されなかった語に 💀 死語 が付きます。

> 立ち上げ直後の数回（半日ほど）は過去データがないので、ほぼ全部が 🌱 になります。観測を重ねるほど「いつも出ている語」が自然に沈み、本当に新しい語が浮かぶようになります。

## 3. Netlify へのデプロイ

1. このリポジトリを Netlify に繋ぐ（**Add new site → Import an existing project**）
2. ビルド設定は `netlify.toml` に書いてあるので、そのまま **Deploy**
3. 環境変数は不要。Blobs も設定なしで使えます
4. 開いてみる：最初のアクセスで 1 回観測が走ります（10 秒以内で終わるよう制限時間付き）。以降は 3 時間ごとに Scheduled Function が自動で更新します

```bash
# CLI で入れる場合
npm i -g netlify-cli
netlify login
netlify init
netlify deploy --build --prod
```

- Scheduled Functions が動くのは**本番デプロイ（Published deploy）だけ**です。プレビューでは動きません
- 無料枠の消費は「1 日 8 回の定期観測＋閲覧」なので、Functions の月間上限にはまず届きません
- 観測の間隔を変えるときは、`netlify/functions/collect.mjs` の `schedule` と `netlify/lib/score.js` の `RUN_INTERVAL_H` を揃えてください

## 4. API

| エンドポイント | 内容 |
| --- | --- |
| `GET /api/feed?lang=ja\|en&status=new\|surge\|spread\|cool\|revival&limit=` | 最新スナップショット（語・スコア・推移・用例・ソースの状態・各ソースの生データ） |
| `GET /api/term?k=<語>` | 語の詳細（推移・用例・出たソース＋Urban Dictionary／Wikipedia の意味） |
| `GET /api/lexicon?q=&lang=&stage=newborn\|alive\|fading\|dead&sort=recent\|peak\|first\|slang\|runs\|alpha&page=` | ネットスラング大全。`format=csv` を付けると CSV（Excel 用 BOM 付き）で出力 |
| `GET /api/rss?lang=&min=` | 最新の潮流を RSS 2.0 で配信 |
| `GET /api/history` | 観測ごとの上位語の履歴 |
| `POST /api/refresh` | 手動で観測（クールダウン 15 分・全ユーザー共通） |
| `GET /api/health?src=reddit,misskey` | 各ソースへの接続確認（結果は保存しない） |

## 5. ローカル開発

```bash
npm install
npm run serve:mock   # 疑似データで UI を確認（オフラインで動く。24 時間ぶんの観測を先に流し込む）
npm run serve        # 実際のソースに接続（結果は .netlify/local-blobs/ に保存）
npm run observe      # ターミナルで 1 回観測して上位を表示（-- --mock / -- --json）
npm test             # 単体テスト・Function テスト（ネットワーク不要）
npm run uicheck      # Playwright による UI の動作確認（serve:mock を起動した状態で）
```

## 6. 構成

```
netlify/
  functions/  collect（定期観測）· feed · term · lexicon · rss · history · refresh · health
  lib/        sources（14 ソースの取得処理）· mine（語の掘り出し）· score（採点と台帳）
              pipeline（観測 1 回分の処理）· store（Blobs／ファイル／メモリ）· text · feedparse · http
public/       index.html · assets/app.js · assets/app.css（フィード／大全／生データ／ネタ帳／観測網）
scripts/      build · devserver · mock-web（疑似データ）· observe · uicheck
test/         node:test
```

## 7. 注意

- 各ソースの公開情報をもとにした**推定**です。仕様の変更やアクセス制限（特に Reddit は、クラウドからのアクセスを弾くことがあります）で一部のソースが止まることがあります。止まったソースはそのまま飛ばされ、「観測網」タブに理由が出ます
- 公開 API に接続するときは、正直な User-Agent（`UndercurrentBot/1.0`）を名乗ります
- ネタ帳はブラウザの localStorage にだけ保存されます

## 8. ライセンス

MIT
