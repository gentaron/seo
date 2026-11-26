/**
 * ai/describe.js — キーワードに「文脈」を付ける
 *
 *   about : それは何か（辞書・家族名・成果物のメタデータから。1 文）
 *   why   : なぜいま話題か（根拠の見出しを “出来事の型” に分類し、どの層で広がっているかと合わせて文章化）
 *   angle : ひと言の切り口（ランキング行に出す短いラベル。例「新モデル発表」「性能比較で議論」）
 *
 * LLM は使わない。根拠の見出しから決定的に作るので、同じ入力からは必ず同じ説明になる。
 */

/* =====================================================================
 * 1) それは何か
 * =================================================================== */
export const ABOUT = {
  openai: 'ChatGPT や GPT シリーズを開発する米国の AI 企業。',
  anthropic: 'AI アシスタント「Claude」を開発する米国の AI 企業。安全性研究で知られる。',
  'google-deepmind': 'Google の AI 研究部門。Gemini・Veo・Gemma などを開発。',
  'meta-ai': 'Meta（旧 Facebook）の AI 部門。オープンなモデル「Llama」を公開している。',
  xai: 'イーロン・マスクが率いる AI 企業。チャット AI「Grok」を開発。',
  'mistral-ai': 'フランスの AI 企業。オープンなモデルと商用モデルの両方を出す欧州の旗手。',
  deepseek: '中国の AI 企業。高性能なモデルを低コストかつオープンに公開して世界を驚かせた。',
  'alibaba-qwen': 'アリババの AI モデル群。オープンに公開され、世界中の開発者に使われている。',
  moonshot: '中国の AI 企業。長文に強いチャット AI「Kimi」を開発。',
  zhipu: '中国の AI 企業（Z.ai）。オープンなモデル「GLM」シリーズを公開。',
  nvidia: 'AI の計算に使う GPU で圧倒的なシェアを持つ半導体メーカー。',
  amd: 'GPU・CPU メーカー。NVIDIA の対抗馬として AI 向けチップを強化中。',
  'microsoft-ai': 'Microsoft の AI 事業（Azure の AI 基盤や Copilot など）。OpenAI の最大の提携先。',
  'apple-intelligence': 'iPhone・Mac に組み込まれた Apple の AI 機能群（Siri の強化を含む）。',
  'amazon-ai': 'Amazon / AWS の AI 事業（Bedrock、独自モデル Nova、AI 専用チップ Trainium など）。',
  huggingface: 'AI モデルとデータセットの共有サイト。オープンな AI の “GitHub” 的存在。',
  perplexity: '回答に出典を付ける AI 検索サービス。AI ブラウザ「Comet」も展開。',
  'safe-superintelligence': 'OpenAI 共同創業者イリヤ・サツケバーが立ち上げた “安全な超知能” を目指す企業。',
  'thinking-machines': 'OpenAI 元 CTO ミラ・ムラティが創業した AI 研究企業。',
  'scale-ai': 'AI の学習データ作成を請け負う企業。Meta の大型出資で注目された。',
  cohere: '企業向けに特化した AI モデルを提供するカナダの企業。',
  sakana: '東京拠点の AI 研究企業。進化的手法などユニークなアプローチで知られる。',
  'preferred-networks': '日本の AI 企業。国産の大規模言語モデル「PLaMo」を開発。',
  elevenlabs: '人間そっくりの音声を生成する AI 音声サービス。',
  midjourney: '高品質な画像を生成する AI サービス。',
  runway: '動画を生成・編集する AI サービス。',
  suno: '歌詞と曲を丸ごと生成する AI 音楽サービス。',
  stability: '画像生成 AI「Stable Diffusion」を生んだ企業。',
  'black-forest-labs': 'Stable Diffusion の元開発者たちが作った画像生成 AI「FLUX」の開発元。',
  figure: '人型ロボット（ヒューマノイド）を開発する米国のスタートアップ。',
  'tesla-optimus': 'テスラが開発中の人型ロボット。',
  unitree: '安価な四足・人型ロボットで知られる中国のロボット企業。',
  waymo: 'Google 系の自動運転タクシー企業。',
  tsmc: 'NVIDIA などの AI チップを製造する台湾の半導体受託製造の最大手。',
  cerebras: 'ウェハーまるごと 1 枚の巨大チップで高速推論を売りにする半導体企業。',
  groq: 'AI の推論（応答生成）を高速化する専用チップの企業。xAI の Grok とは別物。',
  softbank: 'OpenAI への巨額出資や AI データセンター計画で AI 投資の中心にいる日本企業。',
  chatgpt: 'OpenAI の対話型 AI。世界で最も使われている AI アシスタント。',
  'chatgpt-atlas': 'ChatGPT を組み込んだ OpenAI の Web ブラウザ。',
  codex: 'OpenAI のコーディング用 AI エージェント。指示するとコードを書いて修正まで行う。',
  sora: 'OpenAI の動画生成 AI。文章から映像を作る。',
  claude: 'Anthropic の AI アシスタント。文章・コーディングの品質で開発者に人気。',
  'claude-code': 'ターミナルで動く Anthropic のコーディングエージェント。開発のやり方を変えたと話題の道具。',
  gemini: 'Google の AI アシスタント兼モデル群。検索や Android にも組み込まれている。',
  'gemini-cli': 'ターミナルで動く Google のコーディングエージェント（無料枠が大きい）。',
  antigravity: 'Google の “エージェント前提” の開発環境（IDE）。AI が自律的にコードを書く。',
  'nano-banana': 'Google の画像生成・編集モデルの愛称。写真を自然に加工できると SNS で大流行した。',
  notebooklm: '資料を読み込ませると要約や “ポッドキャスト風の解説音声” を作る Google の AI ノート。',
  grok: 'xAI のチャット AI。X（旧 Twitter）に組み込まれている。',
  copilot: 'GitHub のコーディング支援 AI。エディタ内で補完やエージェント作業を行う。',
  'ms-copilot': 'Windows や Office に組み込まれた Microsoft の AI アシスタント。',
  cursor: 'AI 前提で作られたコードエディタ。プログラマーの間で急速に普及した。',
  windsurf: 'AI 前提のコードエディタ。Cursor の競合。',
  kiro: 'Amazon（AWS）の AI コーディング環境。仕様書から開発を進める。',
  devin: '“AI ソフトウェアエンジニア” をうたう自律型コーディング AI（Cognition 社）。',
  replit: 'ブラウザ上で AI がアプリを丸ごと作る開発サービス。',
  lovable: '会話だけで Web アプリを作れる AI サービス。',
  v0: 'Vercel の UI 生成 AI。言葉で画面を作れる。',
  bolt: 'ブラウザで動く AI アプリ生成サービス。',
  cline: 'VS Code で動くオープンソースのコーディングエージェント。',
  aider: 'ターミナルで動くオープンソースのコーディング AI。',
  opencode: 'ターミナルで動くオープンソースのコーディングエージェント。',
  openhands: 'オープンソースの自律型コーディングエージェント。',
  manus: '調べ物や作業をまるごと代行する汎用 AI エージェント。',
  genspark: 'AI エージェント型の検索・資料作成サービス。',
  n8n: 'AI を組み込んだ業務自動化（ワークフロー）ツール。',
  dify: 'AI アプリをノーコードで組み立てられるオープンソース基盤。日本でも人気。',
  comfyui: 'ノードをつないで画像・動画生成を組み立てるオープンソースのツール。',
  ollama: '手元の PC で AI モデルを動かすためのツール。',
  llamacpp: 'AI モデルを普通の PC で高速に動かすオープンソースの実行エンジン。',
  vllm: 'AI モデルを高速に配信するためのオープンソースの推論サーバー。',
  sglang: '高速な AI 推論のためのオープンソースのエンジン。',
  lmstudio: '手元の PC で AI モデルを動かせるデスクトップアプリ。',
  mlx: 'Apple シリコン（Mac）で AI を動かすための Apple 製フレームワーク。',
  pytorch: 'AI 開発の標準的なオープンソースのフレームワーク。',
  langchain: 'AI アプリやエージェントを組み立てるためのオープンソースのライブラリ。',
  llamaindex: '自社データを AI に読ませる（RAG）ためのオープンソースのライブラリ。',
  crewai: '複数の AI エージェントを協働させるオープンソースの仕組み。',
  openrouter: '多数の AI モデルを 1 つの窓口で使い分けられるサービス。',
  'gpt-oss': 'OpenAI が公開した、誰でも手元で動かせるオープンなモデル。',
  llama: 'Meta が公開しているオープンな AI モデルのシリーズ。',
  'stable-diffusion': 'オープンな画像生成 AI の代表格。',
  whisper: 'OpenAI のオープンな音声認識モデル。文字起こしの定番。',
  blackwell: 'NVIDIA の現行世代の AI 向け GPU。データセンターの主力。',
  rubin: 'NVIDIA の次世代 AI 向け GPU。',
  h100: 'NVIDIA の AI 向け GPU（前世代）。AI 計算力の “通貨” のように語られる。',
  tpu: 'Google が自社設計した AI 専用チップ。NVIDIA 依存を減らす選択肢として注目。',
  stargate: 'OpenAI・ソフトバンクなどによる超大規模な AI データセンター計画。',
  hbm: 'AI チップに積む高速メモリ。供給不足が AI 業界のボトルネックになっている。',
  mcp: 'AI に外部ツールやデータをつなぐための共通規格（Anthropic 発）。各社が採用し “AI の USB” と呼ばれる。',
  a2a: 'AI エージェント同士が連携するための共通規格（Google 発）。',
  'agent-skills': 'AI エージェントに手順書と道具をまとめて渡す仕組み。フォルダ 1 つで能力を追加できる。',
  'ai-agents': '指示を受けて自分で考え、ツールを使いながら作業を完了させる AI。',
  'vibe-coding': 'コードを読まずに “ノリ（vibe）” で AI に指示してプログラムを作るスタイル。',
  'context-engineering': 'AI に渡す情報（文脈）を設計して精度を上げる技術。プロンプト設計の発展形。',
  'computer-use': 'AI が人間の代わりに画面やブラウザを操作する技術。',
  rag: 'AI に外部の文書を検索させてから答えさせる手法。社内データ活用の定番。',
  reasoning: '答える前に “考える時間” を使って難問を解く AI モデルの系統。',
  'world-models': '物理世界の動きをシミュレーションできる AI。ロボットやゲーム生成への応用で注目。',
  'diffusion-llm': '画像生成の手法（拡散）で文章を一気に生成する新型の言語モデル。',
  'small-models': 'スマホや PC 上で動く小型の AI モデル。',
  moe: '多数の “専門家” モデルを切り替えて使う構造。大型でも安く動かせる。',
  rl: '試行錯誤から学ぶ学習法。推論モデルの性能向上の鍵とされる。',
  distillation: '大きなモデルの知識を小さなモデルに移す手法。',
  quantization: 'モデルを軽量化して普通の PC でも動くようにする手法。',
  'synthetic-data': 'AI が作ったデータで AI を学習させる手法。',
  agi: '人間並み、あるいはそれ以上に何でもこなせる AI。到達時期をめぐる議論が絶えない。',
  'ai-safety': 'AI が意図どおりに安全に振る舞うようにする研究と議論。',
  'ai-act': 'EU の包括的な AI 規制法。世界の AI ルールの基準になると見られている。',
  'ai-copyright': '生成 AI の学習や出力と著作権をめぐる問題。訴訟が相次いでいる。',
  deepfake: 'AI で作られた本物そっくりの偽の映像・音声。',
  'ai-bubble': 'AI への投資が過熱しすぎているのではという議論。',
  'ai-data-centers': 'AI 専用の巨大データセンター。電力確保が新たな課題になっている。',
  humanoid: '人の形をしたロボット。AI の進歩で実用化が近づいたと注目されている。',
  'physical-ai': 'ロボットや自動運転など、現実世界で体を持って動く AI。',
  'ai-glasses': 'カメラやマイクを積んで AI と会話できるメガネ型デバイス。',
  'genai-jp': '文章・画像・音声などを生み出す AI の総称。',
};

const FAMILY_ABOUT = {
  gpt: (n) => `OpenAI の主力 AI モデル「GPT」シリーズの${/codex/i.test(n) ? 'コーディング特化版' : /mini|nano/i.test(n) ? '軽量版' : /pro/i.test(n) ? '高性能版' : '世代'}。ChatGPT の中身。`,
  'openai-o': () => 'OpenAI の “考えてから答える” 推論モデル。',
  claude: (n) => `Anthropic の AI モデル Claude の${/opus/i.test(n) ? '最上位版（Opus）' : /sonnet/i.test(n) ? '主力版（Sonnet）' : /haiku/i.test(n) ? '軽量・高速版（Haiku）' : '世代'}。`,
  gemini: (n) => `Google の主力 AI モデル Gemini の${/pro/i.test(n) ? '高性能版' : /flash/i.test(n) ? '高速・低価格版' : /deep think/i.test(n) ? '長考版' : '世代'}。`,
  gemma: () => 'Google が公開している、誰でも使えるオープンな軽量モデル。',
  llama: () => 'Meta が公開しているオープンな AI モデルの世代。',
  grok: () => 'xAI（イーロン・マスクの会社）の AI モデルの世代。',
  deepseek: (n) => `中国 DeepSeek のオープンなモデル。${/R\d/.test(n) ? '推論（考えてから答える）特化版。' : '低コストで高性能なことで知られる。'}`,
  qwen: (n) => `アリババのオープンなモデル Qwen の${/coder/i.test(n) ? 'コーディング特化版' : /vl/i.test(n) ? '画像も理解できる版' : /image/i.test(n) ? '画像生成版' : '世代'}。`,
  kimi: () => '中国 Moonshot AI のオープンな大型モデル。エージェント作業の強さで評価が高い。',
  glm: () => '中国 Zhipu AI（Z.ai）のオープンなモデル。コーディング性能で注目。',
  minimax: () => '中国 MiniMax のオープンなモデル。',
  mistral: () => 'フランス Mistral AI のモデル。',
  phi: () => 'Microsoft の小型でも賢いオープンなモデル。',
  sora: () => 'OpenAI の動画生成 AI の世代。',
  veo: () => 'Google の動画生成 AI の世代。音声付きの映像を作れる。',
  kling: () => '中国 Kuaishou（快手）の動画生成 AI。',
  flux: () => 'Black Forest Labs の画像生成モデル。オープン版もある。',
  nemotron: () => 'NVIDIA が公開しているオープンなモデル群。',
};

const PIPE = {
  'text-generation': '文章生成', 'image-text-to-text': '画像も読める言語', 'text-to-image': '画像生成', 'image-to-image': '画像編集',
  'text-to-video': '動画生成', 'image-to-video': '画像から動画を作る', 'text-to-speech': '音声合成', 'automatic-speech-recognition': '音声認識',
  'any-to-any': 'マルチモーダル', 'text-to-audio': '音声・音楽生成', 'feature-extraction': '埋め込み', 'sentence-similarity': '文の類似度',
  'image-segmentation': '画像の領域分割', 'object-detection': '物体検出', 'depth-estimation': '奥行き推定', 'text-to-3d': '3D 生成', 'image-to-3d': '画像から 3D を作る',
};

function clip(s, n = 90) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * @param {{id:string, name:string, kind:string, cat:string, family?:string}} e
 * @param {Array<object>} hits  [{s, w}]
 */
export function aboutOf(e, hits) {
  if (ABOUT[e.id]) return ABOUT[e.id];
  const fam = e.id.split(':')[0];
  if (FAMILY_ABOUT[fam]) return FAMILY_ABOUT[fam](e.name);
  const art = hits.map((h) => h.s).find((s) => s.art);
  if (e.kind === 'repo' && art) {
    const desc = art.text.split(' — ').slice(1).join(' — ');
    return desc ? `GitHub に公開されたばかりのオープンソース。「${clip(desc, 80)}」` : 'GitHub に公開されたばかりのオープンソースのプロジェクト。';
  }
  if (e.kind === 'model' && art) {
    const tag = (art.text.match(/\(([^)]+)\)\s*$/) || [])[1];
    const org = art.art?.org;
    return `Hugging Face で${org ? ` ${org} が` : ''}公開した${PIPE[tag] ? `${PIPE[tag]}の` : ''} AI モデル。`;
  }
  if (e.kind === 'space' && art) return `Hugging Face 上で誰でも試せる AI のデモ。${art.text.includes(' — ') ? `「${clip(art.text.split(' — ')[1], 60)}」` : ''}`;
  if (e.kind === 'paper' && art) return `研究者コミュニティで票を集めている論文。${art.desc ? `要旨：${clip(art.desc, 80)}` : ''}`;
  if (e.kind === 'product' && art) return `Product Hunt で紹介された新しい AI プロダクト。${art.text.includes(' — ') ? `「${clip(art.text.split(' — ')[1], 70)}」` : ''}`;
  if (e.kind === 'emerging') return '辞書にまだ無い新しい名前。複数の場所で同時に出始めたので自動で拾いました。中身は下の見出しを参照。';
  return '';
}

/* =====================================================================
 * 2) なぜいま話題か — 見出しを「出来事の型」に分類
 * =================================================================== */
export const EVENTS = [
  { id: 'launch', angle: '新登場・発表', phrase: '新たな発表・公開', re: /\b(launch(?:es|ed)?|releas(?:e|es|ed)|introduc(?:es|ed|ing)|unveil(?:s|ed)?|announc(?:es|ed)|now available|rolls? out|rolling out|debuts?|ships?|is (?:here|out)|available today|preview)\b|発表|公開|リリース|提供開始|登場|発売|ローンチ|お披露目/i },
  { id: 'bench', angle: '性能・比較で議論', phrase: '性能・ベンチマーク比較', re: /\b(benchmarks?|beats?|outperforms?|SOTA|state[- ]of[- ]the[- ]art|leaderboard|tops|vs\.?|versus|compared?|comparison|SWE-bench|ARC-AGI|evals?|score[sd]?)\b|性能|ベンチマーク|上回|比較|最強|最高性能/i },
  { id: 'open', angle: 'オープン公開', phrase: 'オープン公開（誰でも使える形での公開）', re: /\b(open[- ]?source[sd]?|open[- ]weights?|weights|apache 2\.0|MIT licen[sc]e|self[- ]host\w*|run(?:ning)? locally|local(?:ly)?|gguf)\b|オープンソース|オープンモデル|ローカルで|重みを公開/i },
  { id: 'try', angle: '使ってみた・解説', phrase: '使ってみた報告や解説', re: /\b(tried|trying|hands[- ]on|first impressions?|review(?:ed)?|I built|we built|how (?:I|we|to)|tutorial|guide|walkthrough|tips|lessons|my (?:setup|workflow)|experience|spent a (?:week|weekend|day))\b|使ってみた|試した|試してみた|触って|やってみた|解説|まとめ|入門|徹底|活用|導入|方法|手順/i },
  { id: 'money', angle: '資金・買収', phrase: '資金調達・買収などお金の動き', re: /\b(raises?|raised|funding|valuation|series [a-f]|IPO|acqui(?:re|res|red|sition)|invest(?:s|ed|ment)|billion|stake|revenue)\b|資金調達|評価額|買収|出資|上場|億ドル|兆円/i },
  { id: 'policy', angle: '規制・訴訟', phrase: '規制・訴訟の動き', re: /\b(lawsuits?|sues?|sued|court|judge|regulat\w+|ban(?:s|ned)?|copyright|antitrust|FTC|EU|Congress|senators?|law|executive order|probe|investigat\w+)\b|訴訟|提訴|規制|法案|著作権|当局|政府/i },
  { id: 'risk', angle: '不具合・安全性', phrase: '障害・安全性への懸念', re: /\b(outages?|down|bugs?|vulnerabilit\w+|exploit\w*|leak(?:s|ed)?|jailbreak\w*|security|hack(?:ed)?|breach|prompt injection|hallucinat\w+|unsafe|safety)\b|障害|脆弱性|流出|不具合|乗っ取|安全性|危険/i },
  { id: 'price', angle: '料金・提供条件', phrase: '料金・提供条件の変化', re: /\b(pric(?:e|es|ing)|free tier|for free|cheaper|cost[s]?|subscription|rate limits?|plans?|\$\d+)\b|料金|無料|値下げ|値上げ|プラン|制限/i },
  { id: 'debate', angle: '賛否・炎上', phrase: '賛否の分かれる議論', re: /\b(backlash|criticism|critics?|controvers\w+|concerns?|worr(?:y|ies|ied)|slop|hype|overhyped|disappoint\w*|problem|why .* (?:fails?|sucks?)|is (?:dead|over))\b|炎上|批判|懸念|物議|賛否|失望|やばい|問題/i },
  { id: 'deal', angle: '提携・組み込み', phrase: '提携・製品への組み込み', re: /\b(partner(?:s|ship)?|integrat(?:es|ed|ion)|teams up|deal with|coming to|adds?|brings?|powered by|built into)\b|提携|統合|搭載|連携|組み込/i },
  { id: 'people', angle: '人事・人の動き', phrase: '人事・移籍', re: /\b(hires?|hired|joins?|joined|leaves?|left|departs?|resigns?|steps down|CEO|poach\w*|talent)\b|退任|移籍|就任|引き抜/i },
  { id: 'research', angle: '研究成果', phrase: '新しい研究成果', re: /\b(paper|arxiv|research(?:ers)?|study|preprint|we propose|novel|method|architecture)\b|論文|研究/i },
];

const FAM_JA = {
  community: '開発者コミュニティ',
  code: 'GitHub',
  models: 'Hugging Face',
  research: '研究者',
  news: '海外メディア',
  japan: '日本',
  products: 'Product Hunt',
  search: '一般の検索',
};

/** シグナルに出来事の型を付ける（strength で重み付けして集計する） */
export function classifyEvents(hits) {
  const score = {};
  for (const { s, w } of hits) {
    const text = `${s.text} ${s.desc ? s.desc.slice(0, 160) : ''}`;
    for (const ev of EVENTS) {
      if (ev.re.test(text)) score[ev.id] = (score[ev.id] || 0) + (s.strength || 0.3) * w;
    }
  }
  const total = Object.values(score).reduce((a, b) => a + b, 0);
  return Object.entries(score)
    .sort((a, b) => b[1] - a[1])
    .filter(([, v], i) => i === 0 || v >= total * 0.18)
    .slice(0, 2)
    .map(([id, v]) => ({ ...EVENTS.find((e) => e.id === id), share: total ? v / total : 0 }));
}

/** 「どこで広がっているか」を自然な日本語に */
export function whereOf(famScore, facts) {
  const fams = Object.entries(famScore).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).map(([f]) => f);
  if (!fams.length) return '';
  const pubFact = facts.find((f) => f.fam === 'news' && /媒体/.test(f.label));
  const pubN = pubFact ? Number((pubFact.label.match(/(\d+)媒体/) || [])[1] || 0) : 0;
  const parts = fams.slice(0, 4).map((f) => (f === 'news' && pubN ? `海外メディア ${pubN} 社` : FAM_JA[f]));
  const tail = fams.length >= 4 ? `まで ${fams.length} つの層で同時に話題` : fams.length >= 2 ? 'で同時に話題' : 'を中心に話題';
  const head = parts.join('・');
  return `${head}${/[A-Za-z0-9]$/.test(head) ? ' ' : ''}${tail}`;
}

const STATUS_JA = {
  breakout: 'ここ 1 日で急に現れ、',
  surging: '普段の水準から一気に跳ね上がっていて、',
  rising: '勢いが増していて、',
  steady: '',
  cooling: 'ピークは過ぎつつあるものの、',
};

/**
 * @returns {{about:string, why:string, angle:string, quote:object|null, events:string[]}}
 */
export function describe(e, hits, { famScore, facts, status }) {
  const about = aboutOf(e, hits);
  const ev = classifyEvents(hits);
  const where = whereOf(famScore, facts);
  let why;
  if (ev.length) {
    const topic = ev.map((x) => `「${x.phrase}」`).join('と');
    why = `${STATUS_JA[status] || ''}話題の中心は${topic}。${where ? `${where}になっている。` : ''}`;
  } else {
    why = `${STATUS_JA[status] || ''}${where ? `${where}になっている。` : '複数の場所で言及が増えている。'}`;
  }
  if (e.kind === 'repo' && hits.some((h) => h.s.src === 'github')) {
    const gh = hits.find((h) => h.s.src === 'github')?.s;
    if (gh?.vel) why = `公開直後から 1 日あたり約 ${Math.round(gh.vel).toLocaleString('ja-JP')} 個のスターを集めている。${why}`;
  }
  if (e.kind === 'model' && hits.some((h) => h.s.src === 'hfmodels')) {
    const r = Math.min(...hits.filter((h) => h.s.src === 'hfmodels').map((h) => (h.s.rank ?? 99) + 1));
    why = `Hugging Face のトレンド ${r} 位。開発者が実際にダウンロードして試している。${why}`;
  }
  // 代表の見出し：名前だけの見出しは飛ばし、出来事の型に当たるものを優先
  const norm = (x) => String(x).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const cand = [...hits]
    .filter(({ s }) => norm(s.text) !== norm(e.name) && s.text.length >= 12 && !s.strict)
    .sort((a, b) => (b.s.strength * b.w) - (a.s.strength * a.w));
  const best = cand.find(({ s }) => ev[0]?.re.test(s.text)) || cand[0];
  const quote = best ? { t: clip(best.s.text, 120), src: best.s.src, pub: best.s.pub || '', u: best.s.url } : null;
  const angle = ev[0]?.angle || (e.kind === 'repo' ? '新リポジトリ' : e.kind === 'model' ? 'モデル公開' : e.kind === 'paper' ? '研究成果' : '言及が増加');
  return { about, why: why.replace(/。。/g, '。'), angle, quote, events: ev.map((x) => x.id) };
}
