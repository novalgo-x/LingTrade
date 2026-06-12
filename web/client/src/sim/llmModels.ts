// 对模型列表做「像对话模型的程度」排序，用于挑选默认对话模型（Agent 角色分配等）。
// 列表按字母排序，排第一的往往是 embedding / 语音 / 图像等非对话模型，
// 直接拿 models[0] 当默认模型并不合适。

// 明显的非对话模型命名特征（embedding / rerank / 语音 / 图像 / 视频 / 审核等），排序时殿后
const NON_CHAT_PATTERNS = [
  /embed/, /bge-/, /rerank/, /moderation/, /guard/, /ocr/,
  /whisper/, /-tts/, /^tts/, /sovits/, /cosyvoice/, /voice/, /audio/, /speech/, /transcri/,
  /dall-?e/, /midjourney/, /diffusion/, /flux/, /image/, /img2/, /text2img/, /video/, /upscal/,
  /veo\d/, /seedance/, /seedream/, /sora/, /(480|720|1080)p/,
];

// 主流对话模型家族，命中者优先作为候选
const CHAT_HINTS = [
  /gpt/, /^o[134]/, /claude/, /gemini/, /deepseek/, /qwen/, /qwq/, /glm/,
  /kimi/, /moonshot/, /doubao/, /ernie/, /hunyuan/, /minimax/, /abab/, /yi-/, /spark/,
  /baichuan/, /llama/, /mistral/, /mixtral/, /grok/, /chat/, /instruct/,
];

function score(model: string): number {
  const m = model.toLowerCase();
  if (NON_CHAT_PATTERNS.some(re => re.test(m))) return 2;
  return CHAT_HINTS.some(re => re.test(m)) ? 0 : 1;
}

/** 按「像对话模型的程度」排序：对话特征优先、未知其次、明显非对话的殿后。max 不传时返回全部。 */
export function pickTestCandidates(models: string[], max?: number): string[] {
  const ranked = models
    .map((m, i) => ({ m, s: score(m), i }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map(r => r.m);
  return max ? ranked.slice(0, max) : ranked;
}

/** Agent 角色分配的默认模型：优先选对话模型，而非按字母排序的第一个。 */
export function pickDefaultChatModel(models: string[]): string | undefined {
  return pickTestCandidates(models, 1)[0];
}
