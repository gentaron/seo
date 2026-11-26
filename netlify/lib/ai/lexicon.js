/**
 * ai/lexicon.js — AI / テック領域のエンティティ辞書と抽出器
 *
 * 3 層で「いま話題の固有名詞」を拾う：
 *   1) FAMILIES : バージョン付きモデル名（GPT-5.1 / Claude Opus 4.5 / Gemini 3 Pro / Qwen3 …）を
 *                 正規表現で “家族＋版” として正規化する。新しい版が出た瞬間に自動で別エンティティになる
 *   2) ENTITIES : 企業・製品・ツール・概念の辞書（別名・表記ゆれ・日本語表記つき）
 *   3) 動的発見 : engine.js 側で、辞書に無い固有名詞が複数の媒体系統にまたがった時だけ昇格させる
 *
 * あいまいな一般語（Cursor / Grok / Runway / Gemini / Llama …）は大文字小文字を区別し、
 * AI 文脈のシグナルに対してだけ照合する（engine.js の isAiContext で判定）。
 * 純関数のみ。
 */

/** カテゴリ（UI のセグメントと一致） */
export const CATS = {
  model: 'モデル',
  agent: 'エージェント・開発',
  product: 'プロダクト',
  company: '企業',
  research: '研究',
  infra: 'インフラ・半導体',
  opensource: 'オープンソース',
  policy: '規制・社会',
  concept: '概念・手法',
};

/** テーマ（“いま何の話が熱いか” をまとめる単位） */
export const THEMES = {
  agents: { label: 'AIエージェント', icon: '◎', re: /\b(agents?|agentic|autonomous|computer[- ]use|browser[- ]use|MCP|A2A|workflow automation)\b|エージェント|自律型/i },
  coding: { label: 'コーディングAI', icon: '⌘', re: /\b(coding|code (?:assistant|agent|review|generation)|vibe[- ]?coding|IDE|copilot|devtools?|programming|SWE-bench|pull requests?)\b|コーディング|バイブコーディング|プログラミング/i },
  frontier: { label: 'フロンティアモデル', icon: '✦', re: /\b(frontier model|state[- ]of[- ]the[- ]art|SOTA|benchmark|reasoning model|flagship model|new model|launch(?:es|ed)? .{0,20}model)\b|最新モデル|新モデル/i },
  open: { label: 'オープンモデル', icon: '◇', re: /\b(open[- ]?(?:weights?|source|model)s?|local(?:ly)? (?:llm|model)s?|gguf|quantiz\w+|self[- ]host\w*|on[- ]device|run locally)\b|オープンモデル|ローカルLLM|オープンソース/i },
  media: { label: '画像・動画・音声', icon: '▶', re: /\b(image generation|video generation|text[- ]to[- ](?:image|video|speech|music)|diffusion|voice (?:clone|cloning|model)|TTS|music generation|generative video)\b|画像生成|動画生成|音声合成|音楽生成/i },
  robotics: { label: 'ロボット・フィジカルAI', icon: '◈', re: /\b(robots?|robotics|humanoids?|embodied|physical ai|self[- ]driving|autonomous (?:vehicle|driving)|robotaxi|world models?)\b|ロボット|ヒューマノイド|自動運転|フィジカルAI/i },
  infra: { label: '半導体・データセンター', icon: '▣', re: /\b(GPUs?|TPUs?|chips?|semiconductors?|data ?cent(?:er|re)s?|compute|inference cost|HBM|accelerators?|power grid|gigawatts?)\b|半導体|データセンター|GPU/i },
  money: { label: '資金調達・ビジネス', icon: '¥', re: /\b(raises?|raised|funding|valuation|series [a-f]|IPO|acqui(?:re|res|red|sition)|revenue|billion|investors?|layoffs?)\b|資金調達|評価額|買収|上場|提携/i },
  policy: { label: '規制・安全性', icon: '⚖', re: /\b(regulat\w+|AI Act|lawsuits?|sued|copyright|safety|alignment|ban(?:s|ned)?|executive order|antitrust|privacy|deepfakes?|guardrails?|jailbreak\w*)\b|規制|著作権|訴訟|安全性|ディープフェイク/i },
  research: { label: '研究・論文', icon: '∑', re: /\b(paper|arxiv|research(?:ers)?|study|preprint|NeurIPS|ICML|ICLR|CVPR|ACL|state space|mixture[- ]of[- ]experts|MoE|RLHF|RL|distillation|scaling laws?)\b|論文|研究/i },
};

/* =====================================================================
 * 1) バージョン付きモデル “家族”
 *    name(m) で正規化した表示名を作る。org は所属（UI の補足表示用）
 * =================================================================== */
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '');
const ver = (s) => String(s || '').replace(/[-_]/g, '.').replace(/\.+$/, '');

export const FAMILIES = [
  {
    id: 'gpt',
    org: 'OpenAI',
    cat: 'model',
    re: /\bGPT[-‑ ]?(\d(?:\.\d{1,2})?)(?:[-‑ ](mini|nano|pro|codex|turbo|max|thinking|instant|oss))?\b/gi,
    name: (m) => `GPT-${ver(m[1])}${m[2] ? ` ${m[2].toLowerCase() === 'oss' ? 'OSS' : cap(m[2])}` : ''}`,
  },
  {
    id: 'openai-o',
    org: 'OpenAI',
    cat: 'model',
    re: /\b(?:OpenAI(?:'s)?\s+)(o[1-9])(?:[-‑ ](mini|pro))?\b|\b(o[3-9])[-‑](mini|pro)\b/g,
    name: (m) => `${m[1] || m[3]}${m[2] || m[4] ? `-${(m[2] || m[4]).toLowerCase()}` : ''}`,
  },
  {
    id: 'claude',
    org: 'Anthropic',
    cat: 'model',
    re: /\bClaude[-‑ ]?(?:(Opus|Sonnet|Haiku)[-‑ ]?(\d(?:[.\-]\d)?)|(\d(?:\.\d)?)[-‑ ]?(Opus|Sonnet|Haiku)?)\b|\b(Opus|Sonnet|Haiku)[-‑ ](\d(?:\.\d)?)\b/g,
    name: (m) => {
      const tier = m[1] || m[4] || m[5];
      const v = ver(m[2] || m[3] || m[6]);
      return tier ? `Claude ${cap(tier)} ${v}` : `Claude ${v}`;
    },
  },
  {
    id: 'gemini',
    org: 'Google',
    cat: 'model',
    re: /\bGemini[-‑ ](\d(?:\.\d)?)(?:[-‑ ](Pro|Flash|Ultra|Nano|Flash[-‑ ]Lite|Deep Think))?\b/g,
    name: (m) => `Gemini ${ver(m[1])}${m[2] ? ` ${m[2].replace(/[-‑]/g, ' ')}` : ''}`,
  },
  {
    id: 'gemma',
    org: 'Google',
    cat: 'model',
    re: /\bGemma[-‑ ]?(\d(?:\.\d)?)n?\b/g,
    name: (m) => `Gemma ${ver(m[1])}`,
  },
  {
    id: 'llama',
    org: 'Meta',
    cat: 'model',
    re: /\bLlama[-‑ ]?(\d(?:\.\d)?)(?:[-‑ ](Scout|Maverick|Behemoth))?\b/g,
    name: (m) => `Llama ${ver(m[1])}`, // Scout/Maverick は同じ世代
  },
  {
    id: 'grok',
    org: 'xAI',
    cat: 'model',
    re: /\bGrok[-‑ ]?(\d(?:\.\d)?)(?:[-‑ ](Heavy|Fast|mini|Code))?\b/g,
    name: (m) => `Grok ${ver(m[1])}${m[2] && /code/i.test(m[2]) ? ' Code' : ''}`, // Heavy/Fast は同じ版
  },
  {
    id: 'deepseek',
    org: 'DeepSeek',
    cat: 'model',
    re: /\bDeepSeek[-‑ ]?((?:V|R)\d(?:\.\d{1,2})?)(?:[-‑ ](Exp|Terminus|Speciale|Prover|OCR))?\b/gi,
    // Exp / Terminus / Speciale は同じ版の派生 → 版に寄せる（Prover / OCR は別製品）
    name: (m) => `DeepSeek-${m[1].toUpperCase()}${m[2] && /^(prover|ocr)$/i.test(m[2]) ? `-${m[2].length <= 3 ? m[2].toUpperCase() : cap(m[2])}` : ''}`,
  },
  {
    id: 'qwen',
    org: 'Alibaba',
    cat: 'model',
    re: /\bQwen[-‑ ]?(\d(?:\.\d)?)(?:[-‑ ](Coder|VL|Max|Omni|Next|Image|TTS|Embedding))?\b/gi,
    name: (m) => `Qwen${ver(m[1])}${m[2] ? `-${m[2].length <= 2 ? m[2].toUpperCase() : cap(m[2])}` : ''}`,
  },
  {
    id: 'kimi',
    org: 'Moonshot AI',
    cat: 'model',
    re: /\bKimi[-‑ ]?(K\d(?:\.\d)?)(?:[-‑ ](Thinking))?\b/gi,
    name: (m) => `Kimi ${m[1].toUpperCase()}${m[2] ? ' Thinking' : ''}`,
  },
  {
    id: 'glm',
    org: 'Zhipu AI',
    cat: 'model',
    re: /\bGLM[-‑ ]?(\d(?:\.\d)?)(V)?\b/g,
    name: (m) => `GLM-${ver(m[1])}${m[2] || ''}`,
  },
  {
    id: 'minimax',
    org: 'MiniMax',
    cat: 'model',
    re: /\bMiniMax[-‑ ]?(M\d(?:\.\d)?)\b/gi,
    name: (m) => `MiniMax-${m[1].toUpperCase()}`,
  },
  {
    id: 'mistral',
    org: 'Mistral AI',
    cat: 'model',
    re: /\b(Mistral|Magistral|Devstral|Codestral|Ministral)[-‑ ](Large|Medium|Small)?[-‑ ]?(\d(?:\.\d)?)\b/g,
    name: (m) => `${m[1]}${m[2] ? ` ${m[2]}` : ''} ${ver(m[3])}`,
  },
  {
    id: 'phi',
    org: 'Microsoft',
    cat: 'model',
    re: /\bPhi[-‑](\d(?:\.\d)?)\b/g,
    name: (m) => `Phi-${ver(m[1])}`,
  },
  {
    id: 'sora',
    org: 'OpenAI',
    cat: 'model',
    re: /\bSora[-‑ ](\d)\b/g,
    name: (m) => `Sora ${m[1]}`,
  },
  {
    id: 'veo',
    org: 'Google',
    cat: 'model',
    re: /\bVeo[-‑ ]?(\d(?:\.\d)?)\b/g,
    name: (m) => `Veo ${ver(m[1])}`,
  },
  {
    id: 'kling',
    org: 'Kuaishou',
    cat: 'model',
    re: /\bKling[-‑ ]?(?:AI[-‑ ])?(\d(?:\.\d)?)\b/g,
    name: (m) => `Kling ${ver(m[1])}`,
  },
  {
    id: 'flux',
    org: 'Black Forest Labs',
    cat: 'model',
    re: /\bFLUX[.\-‑ ]?(\d(?:\.\d)?)(?:[-‑ ](Kontext|Pro|Dev|Schnell))?\b/gi,
    name: (m) => `FLUX.${ver(m[1])}${m[2] && /kontext/i.test(m[2]) ? ' Kontext' : ''}`, // Pro/Dev/Schnell は同じ版
  },
  {
    id: 'nemotron',
    org: 'NVIDIA',
    cat: 'model',
    re: /\bNemotron[-‑ ]?(\d|Nano|Super|Ultra)?\b/g,
    name: (m) => `Nemotron${m[1] ? ` ${cap(m[1])}` : ''}`,
  },
];

/* =====================================================================
 * 2) 固定エンティティ
 *    a: 別名（正規表現の断片）。cs: true なら大文字小文字を区別（一般語との衝突回避）
 *    ctx: true なら AI 文脈のシグナルでのみ照合
 * =================================================================== */
const E = (id, name, cat, a, o = {}) => ({ id, name, cat, a, ...o });

export const ENTITIES = [
  // ---- 企業・研究所
  E('openai', 'OpenAI', 'company', ['OpenAI', 'オープンAI']),
  E('anthropic', 'Anthropic', 'company', ['Anthropic', 'アンソロピック']),
  E('google-deepmind', 'Google DeepMind', 'company', ['DeepMind', 'Google DeepMind']),
  E('meta-ai', 'Meta AI', 'company', ['Meta AI', 'Meta Superintelligence(?: Labs)?', 'MSL', 'FAIR'], { cs: true, ctx: true }),
  E('xai', 'xAI', 'company', ['xAI'], { cs: true }),
  E('mistral-ai', 'Mistral AI', 'company', ['Mistral AI', 'Mistral'], { cs: true, ctx: true }),
  E('deepseek', 'DeepSeek', 'company', ['DeepSeek']),
  E('alibaba-qwen', 'Qwen', 'model', ['Qwen', '通義千問']),
  E('moonshot', 'Moonshot AI', 'company', ['Moonshot AI', 'Kimi'], { cs: true }),
  E('zhipu', 'Zhipu AI (Z.ai)', 'company', ['Zhipu', 'Z\\.ai']),
  E('nvidia', 'NVIDIA', 'infra', ['NVIDIA', 'Nvidia', 'エヌビディア'], { cs: true }),
  E('amd', 'AMD', 'infra', ['AMD'], { cs: true, ctx: true }),
  E('microsoft-ai', 'Microsoft AI', 'company', ['Microsoft AI', 'Azure AI', 'Azure OpenAI', 'Microsoft Foundry']),
  E('apple-intelligence', 'Apple Intelligence', 'product', ['Apple Intelligence', 'Siri'], { cs: true }),
  E('amazon-ai', 'Amazon AI (Bedrock / Nova)', 'company', ['Amazon Bedrock', 'Amazon Nova', 'Bedrock', 'Alexa\\+', 'AWS Trainium', 'Trainium'], { cs: true }),
  E('huggingface', 'Hugging Face', 'company', ['Hugging ?Face']),
  E('perplexity', 'Perplexity', 'product', ['Perplexity(?: AI)?', 'Comet browser'], { cs: true }),
  E('safe-superintelligence', 'Safe Superintelligence', 'company', ['Safe Superintelligence', 'SSI Inc']),
  E('thinking-machines', 'Thinking Machines Lab', 'company', ['Thinking Machines(?: Lab)?']),
  E('scale-ai', 'Scale AI', 'company', ['Scale AI']),
  E('cohere', 'Cohere', 'company', ['Cohere'], { cs: true }),
  E('sakana', 'Sakana AI', 'company', ['Sakana AI', 'サカナAI']),
  E('preferred-networks', 'Preferred Networks', 'company', ['Preferred Networks', 'PFN', 'PLaMo'], { cs: true }),
  E('elevenlabs', 'ElevenLabs', 'product', ['ElevenLabs', 'Eleven Labs']),
  E('midjourney', 'Midjourney', 'product', ['Midjourney']),
  E('runway', 'Runway', 'product', ['Runway(?:ML)?(?= (?:Gen|AI|Aleph|ML|video))', 'RunwayML', 'Runway Gen-\\d']),
  E('suno', 'Suno', 'product', ['Suno'], { cs: true, ctx: true }),
  E('stability', 'Stability AI', 'company', ['Stability AI', 'Stable Diffusion']),
  E('black-forest-labs', 'Black Forest Labs', 'company', ['Black Forest Labs', 'FLUX'], { cs: true }),
  E('figure', 'Figure AI', 'company', ['Figure AI', 'Figure 0\\d'], { cs: true }),
  E('tesla-optimus', 'Tesla Optimus', 'product', ['Optimus'], { cs: true, ctx: true }),
  E('unitree', 'Unitree', 'company', ['Unitree']),
  E('waymo', 'Waymo', 'company', ['Waymo']),
  E('tsmc', 'TSMC', 'infra', ['TSMC'], { cs: true }),
  E('cerebras', 'Cerebras', 'infra', ['Cerebras']),
  E('groq', 'Groq', 'infra', ['Groq'], { cs: true }),
  E('softbank', 'SoftBank', 'company', ['SoftBank', 'ソフトバンク'], { ctx: true }),

  // ---- プロダクト
  E('chatgpt', 'ChatGPT', 'product', ['ChatGPT', 'チャットGPT']),
  E('chatgpt-atlas', 'ChatGPT Atlas', 'product', ['ChatGPT Atlas', 'Atlas browser']),
  E('codex', 'OpenAI Codex', 'agent', ['Codex(?: CLI)?'], { cs: true, ctx: true, sa: ['Codex CLI', 'OpenAI Codex'] }),
  E('sora', 'Sora', 'product', ['Sora'], { cs: true, ctx: true }),
  E('claude', 'Claude', 'product', ['Claude'], { cs: true }),
  E('claude-code', 'Claude Code', 'agent', ['Claude Code']),
  E('gemini', 'Gemini', 'product', ['Gemini'], { cs: true, ctx: true }),
  E('gemini-cli', 'Gemini CLI', 'agent', ['Gemini CLI']),
  E('antigravity', 'Google Antigravity', 'agent', ['Antigravity'], { cs: true, ctx: true }),
  E('nano-banana', 'Nano Banana', 'model', ['Nano Banana(?: Pro)?', 'ナノバナナ']),
  E('notebooklm', 'NotebookLM', 'product', ['NotebookLM']),
  E('grok', 'Grok', 'product', ['Grok'], { cs: true, ctx: true }),
  E('copilot', 'GitHub Copilot', 'agent', ['GitHub Copilot', 'Copilot(?: Agent| coding agent| Workspace)'], { cs: true }),
  E('ms-copilot', 'Microsoft Copilot', 'product', ['Microsoft Copilot', 'Copilot\\+ PC', 'M365 Copilot', 'Microsoft 365 Copilot'], { cs: true }),
  E('cursor', 'Cursor', 'agent', ['Cursor'], { cs: true, ctx: true, sa: ['Cursor (?:IDE|AI|editor|agent|Composer|\\d(?:\\.\\d)?)'] }),
  E('windsurf', 'Windsurf', 'agent', ['Windsurf'], { cs: true, ctx: true }),
  E('kiro', 'Kiro', 'agent', ['Kiro'], { cs: true, ctx: true }),
  E('devin', 'Devin', 'agent', ['Devin', 'Cognition AI', 'Cognition Labs'], { cs: true, ctx: true }),
  E('replit', 'Replit Agent', 'agent', ['Replit']),
  E('lovable', 'Lovable', 'agent', ['Lovable'], { cs: true, ctx: true }),
  E('v0', 'v0', 'agent', ['v0(?:\\.dev| by Vercel)'], { cs: true }),
  E('bolt', 'Bolt.new', 'agent', ['Bolt\\.new']),
  E('cline', 'Cline', 'agent', ['Cline'], { cs: true, ctx: true }),
  E('aider', 'Aider', 'agent', ['Aider'], { cs: true, ctx: true }),
  E('opencode', 'OpenCode', 'agent', ['OpenCode', 'opencode'], { cs: true }),
  E('openhands', 'OpenHands', 'agent', ['OpenHands']),
  E('manus', 'Manus', 'agent', ['Manus'], { cs: true, ctx: true }),
  E('genspark', 'Genspark', 'agent', ['Genspark']),
  E('n8n', 'n8n', 'agent', ['n8n']),
  E('dify', 'Dify', 'agent', ['Dify'], { cs: true }),
  E('comfyui', 'ComfyUI', 'opensource', ['ComfyUI']),
  E('ollama', 'Ollama', 'opensource', ['Ollama']),
  E('llamacpp', 'llama.cpp', 'opensource', ['llama\\.cpp']),
  E('vllm', 'vLLM', 'opensource', ['vLLM'], { cs: true }),
  E('sglang', 'SGLang', 'opensource', ['SGLang']),
  E('lmstudio', 'LM Studio', 'opensource', ['LM Studio']),
  E('mlx', 'MLX', 'opensource', ['MLX'], { cs: true, ctx: true }),
  E('pytorch', 'PyTorch', 'opensource', ['PyTorch']),
  E('langchain', 'LangChain / LangGraph', 'opensource', ['LangChain', 'LangGraph']),
  E('llamaindex', 'LlamaIndex', 'opensource', ['LlamaIndex']),
  E('crewai', 'CrewAI', 'opensource', ['CrewAI']),
  E('openrouter', 'OpenRouter', 'infra', ['OpenRouter']),
  E('gpt-oss', 'gpt-oss', 'model', ['gpt-oss']),
  E('llama', 'Llama', 'model', ['Llama'], { cs: true, ctx: true }),
  E('stable-diffusion', 'Stable Diffusion', 'model', ['Stable Diffusion', 'SDXL', 'SD3']),
  E('whisper', 'Whisper', 'model', ['Whisper'], { cs: true, ctx: true }),

  // ---- インフラ・半導体
  E('blackwell', 'NVIDIA Blackwell', 'infra', ['(?:NVIDIA|Nvidia)(?:\'s)? Blackwell', 'Blackwell', 'GB200', 'GB300', 'B200', 'B300'], { cs: true }),
  E('rubin', 'NVIDIA Rubin', 'infra', ['(?:NVIDIA|Nvidia)(?:\'s)? (?:Vera )?Rubin', 'Vera Rubin', 'Rubin (?:GPU|CPX)'], { cs: true }),
  E('h100', 'H100 / H200', 'infra', ['H100s?', 'H200s?', 'H20'], { cs: true }),
  E('tpu', 'Google TPU', 'infra', ['TPUs?', 'Ironwood'], { cs: true }),
  E('stargate', 'Stargate', 'infra', ['Stargate'], { cs: true, ctx: true }),
  E('hbm', 'HBM', 'infra', ['HBM\\d?e?'], { cs: true }),

  // ---- 概念・手法（“いまの言葉”）
  E('mcp', 'MCP (Model Context Protocol)', 'concept', ['Model Context Protocol', 'MCP(?: servers?| server)?'], { cs: true, ctx: true }),
  E('a2a', 'A2A プロトコル', 'concept', ['A2A(?: protocol)?', 'Agent2Agent'], { cs: true }),
  E('agent-skills', 'Agent Skills', 'concept', ['Agent Skills', 'Claude Skills', 'SKILL\\.md'], { cs: true }),
  E('ai-agents', 'AIエージェント', 'concept', ['AI agents?', 'agentic AI', 'AIエージェント', 'エージェント型AI']),
  E('vibe-coding', 'バイブコーディング', 'concept', ['vibe[- ]?coding', 'vibe[- ]?coded', 'バイブコーディング']),
  E('context-engineering', 'コンテキストエンジニアリング', 'concept', ['context engineering', 'コンテキストエンジニアリング']),
  E('computer-use', 'Computer Use / ブラウザエージェント', 'concept', ['computer[- ]use', 'browser agents?', 'agentic browsers?', 'AIブラウザ']),
  E('rag', 'RAG', 'concept', ['RAG', 'retrieval[- ]augmented'], { cs: true }),
  E('reasoning', '推論モデル', 'concept', ['reasoning models?', 'test[- ]time compute', 'chain[- ]of[- ]thought', '推論モデル']),
  E('world-models', 'ワールドモデル', 'concept', ['world models?', 'Genie \\d', 'ワールドモデル']),
  E('diffusion-llm', '拡散言語モデル', 'concept', ['diffusion (?:language models?|LLMs?)', 'dLLMs?']),
  E('small-models', '小型モデル (SLM)', 'concept', ['small language models?', 'SLMs?', 'on[- ]device (?:AI|models?|LLM)'], { cs: false }),
  E('moe', 'MoE', 'concept', ['mixture[- ]of[- ]experts', 'MoE'], { cs: true }),
  E('rl', '強化学習 (RL)', 'concept', ['reinforcement learning', 'RLHF', 'RLVR', 'GRPO', '強化学習']),
  E('distillation', '蒸留', 'concept', ['distillation', 'distilled model']),
  E('quantization', '量子化', 'concept', ['quantiz(?:ation|ed)', 'GGUF', '量子化']),
  E('synthetic-data', '合成データ', 'concept', ['synthetic data', '合成データ']),
  E('agi', 'AGI / 超知能', 'concept', ['AGI', 'superintelligence', 'ASI', '汎用人工知能', '超知能'], { cs: true }),
  E('ai-safety', 'AI安全性・アラインメント', 'policy', ['AI safety', 'alignment research', 'misalignment', 'interpretability', 'AI安全']),
  E('ai-act', 'EU AI Act', 'policy', ['EU AI Act', 'AI Act', 'AI法', 'AI新法']),
  E('ai-copyright', 'AIと著作権', 'policy', ['copyright', 'fair use', '著作権'], { ctx: true }),
  E('deepfake', 'ディープフェイク', 'policy', ['deepfakes?', 'ディープフェイク']),
  E('ai-bubble', 'AIバブル論', 'policy', ['AI bubble', 'AIバブル']),
  E('ai-data-centers', 'AIデータセンター', 'infra', ['AI data ?cent(?:er|re)s?', 'AIデータセンター', 'gigawatt']),
  E('humanoid', 'ヒューマノイド', 'concept', ['humanoid robots?', 'humanoids', 'ヒューマノイド']),
  E('physical-ai', 'フィジカルAI', 'concept', ['physical AI', 'embodied AI', 'フィジカルAI']),
  E('ai-glasses', 'AIグラス', 'product', ['AI glasses', 'smart glasses', 'Ray-Ban Meta', 'Meta Ray-Ban', 'AIグラス', 'スマートグラス']),
  E('genai-jp', '生成AI', 'concept', ['生成AI']),
];

/* =====================================================================
 * 照合器のコンパイル（モジュール読み込み時に 1 回だけ）
 * =================================================================== */
// 英数字の境界だけを見る（日本語は前後に文字が続くのが普通なので境界にしない）
const B = '(?<![A-Za-z0-9_])';
const A = '(?![A-Za-z0-9_])';

const COMPILED = ENTITIES.map((e) => ({
  ...e,
  rx: new RegExp(`${B}(?:${e.a.join('|')})${A}`, e.cs ? 'gu' : 'giu'),
  // sa: AI 文脈の判定なしでも確実にその製品だと言える強い表記
  rxs: e.sa ? new RegExp(`${B}(?:${e.sa.join('|')})${A}`, 'gu') : null,
}));

export const ENTITY_MAP = Object.fromEntries(ENTITIES.map((e) => [e.id, e]));

/** 家族→親エンティティ（Claude Opus 4.5 → Claude、GPT-5 → ChatGPT/OpenAI などの補足表示用） */
export const FAMILY_PARENT = {
  gpt: 'openai', 'openai-o': 'openai', claude: 'anthropic', gemini: 'google-deepmind', gemma: 'google-deepmind',
  llama: 'meta-ai', grok: 'xai', deepseek: 'deepseek', qwen: 'alibaba-qwen', kimi: 'moonshot', glm: 'zhipu',
  minimax: null, mistral: 'mistral-ai', phi: null, sora: 'openai', veo: 'google-deepmind', kling: null,
  flux: 'black-forest-labs', nemotron: 'nvidia',
};

/** 照合キー（ID 用）：小文字・英数字と一部記号だけ */
export function slug(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.+]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/* ---------------------------------------------------------------------
 * AI 文脈の判定：汎用媒体（HN・はてブ・Reddit 全般・ニュース）の記事が AI の話かどうか
 * ------------------------------------------------------------------- */
const AI_CTX_EN =
  /\b(AI|A\.I\.|AGI|LLMs?|GenAI|GPT|chatbots?|machine learning|deep learning|neural (?:net|network)s?|transformers?|inference|fine[- ]?tun\w+|agentic|AI agents?|embeddings?|RAG|prompt(?:s|ing)?|open[- ]weights?|foundation models?|language models?|multimodal|diffusion models?|text[- ]to[- ]\w+|vision[- ]language|copilot|tokens?\/s|benchmarks?|MCP)\b/;
const AI_CTX_JA = /(生成AI|人工知能|機械学習|深層学習|ディープラーニング|大規模言語モデル|LLM|AI|エージェント|チャットボット|画像生成|動画生成|プロンプト|推論モデル)/;
const STRONG_IDS = new Set(
  ENTITIES.filter((e) => !e.ctx).map((e) => e.id),
);

// 単独では AI の話と言い切れない語（半導体・投資・著作権の一般ニュースなど）
const NOT_AI_BY_ITSELF = new Set(['nvidia', 'tsmc', 'softbank', 'waymo', 'h100', 'hbm', 'pytorch', 'deepfake', 'ai-copyright', 'humanoid', 'unitree', 'figure']);

export function isAiContext(text) {
  const t = String(text ?? '');
  if (AI_CTX_EN.test(t) || AI_CTX_JA.test(t)) return true;
  for (const f of FAMILIES) {
    f.re.lastIndex = 0;
    if (f.re.test(t)) return true;
  }
  for (const e of COMPILED) {
    if (e.rxs) {
      e.rxs.lastIndex = 0;
      if (e.rxs.test(t)) return true;
    }
    if (!STRONG_IDS.has(e.id) || NOT_AI_BY_ITSELF.has(e.id)) continue;
    e.rx.lastIndex = 0;
    if (e.rx.test(t)) return true;
  }
  return false;
}

/**
 * テキストからエンティティを抽出する
 * @param {string} text
 * @param {{aiContext?:boolean}} [o]
 * @returns {Array<{id:string, name:string, cat:string, family?:string, org?:string, parent?:string}>}
 */
export function extractEntities(text, { aiContext = true } = {}) {
  const t = String(text ?? '');
  if (!t) return [];
  // すべての一致を範囲つきで集め、長い一致の内側に収まる短い一致は捨てる
  // （“Claude Opus 4.5” の中の “Claude”、“NVIDIA Blackwell” の中の “NVIDIA”、“Claude Code” の中の “Claude”）
  const spans = [];
  for (const f of FAMILIES) {
    f.re.lastIndex = 0;
    let m;
    while ((m = f.re.exec(t))) {
      let name;
      try {
        name = f.name(m);
      } catch {
        continue;
      }
      if (!name || /undefined|NaN/.test(name)) continue;
      spans.push({ s: m.index, e: m.index + m[0].length, fam: true, ent: { id: `${f.id}:${slug(name)}`, name, cat: f.cat, family: f.id, org: f.org, parent: FAMILY_PARENT[f.id] || undefined } });
    }
  }
  for (const e of COMPILED) {
    const rx = e.ctx && !aiContext ? e.rxs : e.rx;
    if (!rx) continue;
    rx.lastIndex = 0;
    let m;
    let k = 0;
    while ((m = rx.exec(t)) && k < 6) {
      k += 1;
      if (!m[0]) {
        rx.lastIndex += 1;
        continue;
      }
      spans.push({ s: m.index, e: m.index + m[0].length, ent: { id: e.id, name: e.name, cat: e.cat } });
    }
  }
  // 長い順（同じ長さなら家族を優先）に採用
  spans.sort((a, b) => b.e - b.s - (a.e - a.s) || (b.fam ? 1 : 0) - (a.fam ? 1 : 0));
  const accepted = [];
  const found = new Map();
  for (const sp of spans) {
    if (accepted.some((a) => sp.s >= a.s && sp.e <= a.e && !(sp.s === a.s && sp.e === a.e && sp.ent.id === a.ent.id) && (sp.e - sp.s < a.e - a.s || a.fam))) continue;
    accepted.push(sp);
    if (!found.has(sp.ent.id)) found.set(sp.ent.id, sp.ent);
  }
  return [...found.values()];
}

/** UI 表示用のカテゴリ名 */
export function catLabel(cat) {
  return CATS[cat] || 'その他';
}

/** テーマ判定（複数可） */
export function detectThemes(text) {
  const t = String(text ?? '');
  return Object.entries(THEMES)
    .filter(([, th]) => th.re.test(t))
    .map(([id]) => id);
}
