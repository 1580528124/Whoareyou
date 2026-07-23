import { NextResponse } from "next/server";
import { callBailianChat, type BailianMessage } from "../../../../lib/bailian";
import { buildGameSetupPrompt, buildJudgementPrompt } from "../../../../lib/prompts";

type DescriptionSeed = {
  side: string;
  text: string;
};

type GenerateSetupRequest = {
  task: "generateSetup";
  count: number;
  recentWords?: string[];
};

type JudgePlayerRequest = {
  task: "judgePlayer";
  word: string;
  aiNames: string[];
  aiDescriptions: {
    playerName: string;
    text: string;
  }[];
  playerGuess: string;
  playerSpeech: string;
};

type GameAiRequest = GenerateSetupRequest | JudgePlayerRequest;

type Judgement = {
  aiName: string;
  isSame: boolean;
  confidence: number;
  directionScore?: number;
  clueScore?: number;
  naturalScore?: number;
  suspicionScore?: number;
  reason?: string;
};

const BANNED_EASY_WORDS = new Set([
  "面包",
  "雨伞",
  "手机",
  "牛奶",
  "西瓜",
  "苹果",
  "杯子",
  "椅子",
  "书包",
  "电脑",
  "电视",
  "筷子",
  "口罩",
  "牙刷",
  "衣服",
  "鞋子",
]);

function baseSystemPrompt(): BailianMessage {
  return {
    role: "system",
    content:
      "你必须严格输出JSON，不要输出Markdown，不要输出解释。所有中文短句都要自然、简洁、低信息密度。",
  };
}

function parseJsonObject<T>(content: string): T {
  const trimmed = content.trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : trimmed) as T;
}

function normalizeText(text: string) {
  return text.replace(/[，。！？、,.!?；;：“”"'\s]/g, "").trim();
}

function validateWord(word: string, recentWords: string[]) {
  return (
    word.length >= 2 &&
    word.length <= 5 &&
    !recentWords.includes(word) &&
    !BANNED_EASY_WORDS.has(word) &&
    /^[\u4e00-\u9fa5]+$/.test(word)
  );
}

function validateDescriptions(word: string, seeds: DescriptionSeed[], descriptions: string[]) {
  const seedTexts = new Set(seeds.map((seed) => normalizeText(seed.text)));
  const seen = new Set<string>();

  return descriptions.filter((description) => {
    const normalized = normalizeText(description);
    if (normalized.length < 4 || normalized.length > 10) return false;
    if (normalized.includes(word)) return false;
    if (seedTexts.has(normalized)) return false;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function clampScore(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;
}

function isLowInformationSpeech(text: string) {
  const normalized = normalizeText(text);
  if (normalized.length <= 4) return true;

  const genericPatterns = [
    /能吃|可以吃|能用|可以用|好吃|好用|常见|很常见|大家都知道/,
    /是个东西|一种东西|一个东西|这个东西|那个东西/,
    /还不错|挺不错|挺好的|很普通|很一般/,
    /废话|谁不知道|都知道/,
  ];

  return genericPatterns.some((pattern) => pattern.test(normalized));
}

function adjustLowInformationJudgement(judgement: Judgement): Judgement {
  return {
    ...judgement,
    isSame: false,
    confidence: Math.max(judgement.confidence, 0.7),
    directionScore: Math.min(judgement.directionScore ?? 40, 55),
    clueScore: Math.min(judgement.clueScore ?? 35, 45),
    naturalScore: Math.min(judgement.naturalScore ?? 55, 65),
    suspicionScore: Math.max(judgement.suspicionScore ?? 65, 65),
    reason: "信息太水，像拿常识糊弄门卫",
  };
}

function fallbackSetup(count: number) {
  const setup = {
    word: "剧本杀",
    seeds: [
      { side: "场景侧面", text: "朋友约局会想到" },
      { side: "操作侧面", text: "会先拿到身份" },
      { side: "状态侧面", text: "过程里常要推理" },
    ],
    descriptions: ["朋友约局会想到", "会先拿到身份", "过程里常要推理", "复盘时容易争起来"],
  };

  return {
    ...setup,
    descriptions: setup.descriptions.slice(0, count),
  };
}

async function generateSetup(body: GenerateSetupRequest) {
  const count = Math.max(2, Math.min(4, Number.isFinite(body.count) ? body.count : 3));
  const recentWords = (body.recentWords ?? []).map(normalizeText).filter(Boolean).slice(0, 30);
  const messages = [
    baseSystemPrompt(),
    {
      role: "user" as const,
      content: buildGameSetupPrompt({
        count,
        recentWords,
      }),
    },
  ];
  const model = process.env.BAILIAN_DESCRIPTION_MODEL ?? process.env.BAILIAN_SPEECH_MODEL;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await callBailianChat(messages, { model, maxTokens: 700 });
    try {
      const parsed = parseJsonObject<{
        word?: string;
        seeds?: DescriptionSeed[];
        descriptions?: string[];
      }>(result.content);
      const word = normalizeText(parsed.word ?? "");
      const seeds = (parsed.seeds ?? []).slice(0, 3).filter((seed) => {
        return Boolean(seed.side) && validateDescriptions(word, [], [seed.text]).length === 1;
      });
      const descriptions = validateDescriptions(word, seeds, parsed.descriptions ?? []);

      if (validateWord(word, recentWords) && seeds.length === 3 && descriptions.length === count) {
        return {
          word,
          seeds,
          descriptions,
          usage: result.usage,
          model: result.model,
          raw: result.content,
        };
      }
    } catch {
      // Try one more model response, then use a local fallback so the game can still start.
    }
  }

  const fallback = fallbackSetup(count);
  return {
    word: fallback.word,
    seeds: fallback.seeds,
    descriptions: fallback.descriptions,
    usage: undefined,
    model: model ?? process.env.BAILIAN_MODEL ?? "fallback",
    raw: "fallback-setup",
  };
}

async function judgePlayer(body: JudgePlayerRequest) {
  const messages = [
    baseSystemPrompt(),
    {
      role: "user" as const,
      content: buildJudgementPrompt(body),
    },
  ];
  const model = process.env.BAILIAN_JUDGE_MODEL ?? process.env.BAILIAN_VOTE_MODEL;
  let result: Awaited<ReturnType<typeof callBailianChat>> | null = null;
  let returnedJudgements: Judgement[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = await callBailianChat(messages, { model, maxTokens: 700 });
    try {
      const parsed = parseJsonObject<{ judgements?: Judgement[] }>(result.content);
      returnedJudgements = parsed.judgements ?? [];
      if (returnedJudgements.length > 0) break;
    } catch {
      returnedJudgements = [];
    }
  }

  const usedIndexes = new Set<number>();
  const lowInformationSpeech = isLowInformationSpeech(body.playerSpeech);
  const judgements = body.aiNames.map((aiName, index) => {
    const namedIndex = returnedJudgements.findIndex((judgement, candidateIndex) => {
      return !usedIndexes.has(candidateIndex) && judgement.aiName === aiName;
    });
    const fallbackIndex = !usedIndexes.has(index) ? index : -1;
    const judgement =
      returnedJudgements[namedIndex >= 0 ? namedIndex : fallbackIndex] ?? undefined;

    if (namedIndex >= 0) {
      usedIndexes.add(namedIndex);
    } else if (fallbackIndex >= 0) {
      usedIndexes.add(fallbackIndex);
    }

    if (!judgement) {
      const fallbackJudgement = {
        aiName,
        isSame: true,
        confidence: 0.62,
        directionScore: 60,
        clueScore: 55,
        naturalScore: 60,
        suspicionScore: 45,
        reason: "模型未返回该评审",
      };
      return lowInformationSpeech ? adjustLowInformationJudgement(fallbackJudgement) : fallbackJudgement;
    }

    const isSame = Boolean(judgement.isSame);
    const reason =
      typeof judgement.reason === "string" && judgement.reason.trim()
        ? judgement.reason.trim().slice(0, 40)
        : isSame
          ? "发言方向比较接近"
          : "发言方向关联较弱";
    const normalizedJudgement = {
      aiName,
      isSame,
      confidence:
        typeof judgement.confidence === "number"
          ? Math.max(0, Math.min(1, judgement.confidence))
          : 0.68,
      directionScore: clampScore(judgement.directionScore, isSame ? 70 : 40),
      clueScore: clampScore(judgement.clueScore, isSame ? 68 : 42),
      naturalScore: clampScore(judgement.naturalScore, isSame ? 72 : 55),
      suspicionScore: clampScore(judgement.suspicionScore, isSame ? 30 : 72),
      reason,
    };
    return lowInformationSpeech
      ? adjustLowInformationJudgement(normalizedJudgement)
      : normalizedJudgement;
  });

  return {
    judgements,
    usage: result?.usage,
    model: result?.model ?? model ?? process.env.BAILIAN_MODEL ?? "unknown",
    raw: result?.content ?? "fallback-judgements",
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GameAiRequest;

    if (body.task === "generateSetup") {
      return NextResponse.json(await generateSetup(body));
    }

    if (body.task === "judgePlayer") {
      return NextResponse.json(await judgePlayer(body));
    }

    return NextResponse.json({ error: "Unknown AI task." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown AI error" },
      { status: 500 },
    );
  }
}
