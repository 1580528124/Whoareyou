import { NextResponse } from "next/server";
import { callBailianChat, type BailianMessage } from "@/lib/bailian";
import { buildDescriptionPrompt, buildJudgementPrompt } from "@/lib/prompts";

type DescriptionSeed = {
  side: string;
  text: string;
};

type GenerateDescriptionsRequest = {
  task: "generateDescriptions";
  word: string;
  seeds: DescriptionSeed[];
  count: number;
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

type GameAiRequest = GenerateDescriptionsRequest | JudgePlayerRequest;

type Judgement = {
  aiName: string;
  isSame: boolean;
  confidence: number;
};

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

function fallbackDescriptions(seeds: DescriptionSeed[], count: number) {
  return seeds.slice(0, count).map((seed) => seed.text);
}

async function generateDescriptions(body: GenerateDescriptionsRequest) {
  const count = Math.max(1, Math.min(3, Number.isFinite(body.count) ? body.count : 3));
  const messages = [
    baseSystemPrompt(),
    {
      role: "user" as const,
      content: buildDescriptionPrompt({
        word: body.word,
        seeds: body.seeds,
        count,
      }),
    },
  ];
  const model = process.env.BAILIAN_DESCRIPTION_MODEL ?? process.env.BAILIAN_SPEECH_MODEL;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await callBailianChat(messages, { model });
    try {
      const parsed = parseJsonObject<{ descriptions?: string[] }>(result.content);
      const descriptions = validateDescriptions(body.word, body.seeds, parsed.descriptions ?? []);

      if (descriptions.length === count) {
        return {
          descriptions,
          usage: result.usage,
          model: result.model,
          raw: result.content,
        };
      }
    } catch {
      // Try one more model response, then fall back to curated seeds.
    }
  }

  return {
    descriptions: fallbackDescriptions(body.seeds, count),
    usage: undefined,
    model: model ?? process.env.BAILIAN_MODEL ?? "fallback",
    raw: "fallback-to-seeds",
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
  const result = await callBailianChat(messages, { model });
  const parsed = parseJsonObject<{ judgements?: Judgement[] }>(result.content);
  const returnedJudgements = parsed.judgements ?? [];
  const usedIndexes = new Set<number>();
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
      return {
        aiName,
        isSame: true,
        confidence: 0.5,
      };
    }

    const isSame = Boolean(judgement.isSame);
    return {
      aiName,
      isSame,
      confidence:
        typeof judgement.confidence === "number"
          ? Math.max(0, Math.min(1, judgement.confidence))
          : isSame
            ? 0.55
            : 0.55,
    };
  });

  return {
    judgements,
    usage: result.usage,
    model: result.model,
    raw: result.content,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GameAiRequest;

    if (body.task === "generateDescriptions") {
      return NextResponse.json(await generateDescriptions(body));
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
