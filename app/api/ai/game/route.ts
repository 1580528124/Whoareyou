import { NextResponse } from "next/server";
import { callBailianChat, type BailianMessage } from "../../../../lib/bailian";
import { buildFollowupPrompt, buildGameSetupPrompt, buildJudgementPrompt } from "../../../../lib/prompts";

type DescriptionSeed = {
  side: string;
  text: string;
};

type IntelOption = {
  type: string;
  title: string;
  text: string;
};

type WordTopic = {
  name: string;
  description: string;
  examples: string[];
  minDifficulty?: number;
};

type DifficultyProfile = {
  level: number;
  name: string;
  maxWordLength: number;
  wordRule: string;
  clueRule: string;
  clueLengthRule: string;
};

type GenerateSetupRequest = {
  task: "generateSetup";
  count: number;
  recentWords?: string[];
  survivalStreak?: number;
};

type GenerateFollowupRequest = {
  task: "generateFollowup";
  word: string;
  aiDescriptions: {
    playerName: string;
    text: string;
  }[];
  selectedIntel?: IntelOption;
  persona?: string;
  playerSpeech: string;
};

type JudgePlayerRequest = {
  task: "judgePlayer";
  word: string;
  aiNames: string[];
  aiDescriptions: {
    playerName: string;
    text: string;
  }[];
  selectedIntel?: IntelOption;
  persona?: string;
  playerGuess: string;
  playerSpeech: string;
  followupQuestion?: string;
  followupAnswer?: string;
};

type GameAiRequest = GenerateSetupRequest | GenerateFollowupRequest | JudgePlayerRequest;

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

const WORD_TOPICS: WordTopic[] = [
  {
    name: "校园生活",
    description: "学生时代常见但不一定第一时间猜中的场景、物品、关系或活动",
    examples: ["晚自习", "班主任", "社团招新", "运动会", "小卖部"],
  },
  {
    name: "打工人日常",
    description: "上班、通勤、会议、摸鱼、加班、同事关系里的具体词",
    examples: ["周报", "绩效面谈", "工位", "茶水间", "团建"],
  },
  {
    name: "亲密关系",
    description: "朋友、恋人、家人相处里会出现的具体行为、身份或场景",
    examples: ["冷战", "见家长", "闺蜜", "相亲局", "纪念日"],
    minDifficulty: 2,
  },
  {
    name: "网络黑话",
    description: "短视频、弹幕、评论区、聊天软件里常见的中文表达或现象",
    examples: ["破防", "电子榨菜", "显眼包", "种草", "嘴替"],
    minDifficulty: 2,
  },
  {
    name: "县城生活",
    description: "小城、街边、熟人社会、地方消费里常见的具体事物",
    examples: ["夜市", "彩票站", "熟人介绍", "修鞋摊", "广场舞"],
  },
  {
    name: "旅行场景",
    description: "出门旅行、住宿、交通、景点、游客行为里的具体词",
    examples: ["民宿", "跟团游", "登机牌", "特产店", "行李寄存"],
  },
  {
    name: "童年回忆",
    description: "小时候玩过、吃过、看过或经历过的具体事物",
    examples: ["跳皮筋", "小霸王", "辣条", "课间操", "涂改液"],
  },
  {
    name: "社交尴尬",
    description: "聚会、聊天、饭局、群聊里让人微妙尴尬的具体场景",
    examples: ["冷场", "劝酒", "群发祝福", "抢着买单", "自我介绍"],
    minDifficulty: 2,
  },
  {
    name: "娱乐消费",
    description: "年轻人休闲娱乐、线下消费、线上娱乐里的具体项目",
    examples: ["剧本杀", "脱口秀", "演唱会", "密室逃脱", "抓娃娃"],
  },
  {
    name: "城市服务",
    description: "城市里常见但有相近干扰项的服务、设施或店铺",
    examples: ["干洗店", "代驾", "共享充电宝", "自助洗衣", "打印店"],
  },
];

const DIFFICULTY_PROFILES: DifficultyProfile[] = [
  {
    level: 1,
    name: "普通审查",
    maxWordLength: 5,
    wordRule: "生成常见、日常可见、玩家容易理解的具体事物或场景，例如食物、店铺、公共设施、生活服务、娱乐项目、校园物品；不要生成抽象概念或网络黑话。",
    clueRule: "线索可以给出较清晰的日常方向，让玩家能在2到3条线索后大致猜到范围，但不要直接说出答案。",
    clueLengthRule: "每条去除标点后必须是4到10个汉字",
  },
  {
    level: 2,
    name: "进阶审查",
    maxWordLength: 5,
    wordRule: "生成稍有辨识门槛的词，减少普通店铺、机器、饮品、基础活动；优先使用有相近干扰项的社交、职场、网络、校园或娱乐词。",
    clueRule: "线索要更侧面，避免直接描述用途或典型功能，让玩家需要拼接2条以上才有方向。",
    clueLengthRule: "每条去除标点后必须是4到9个汉字",
  },
  {
    level: 3,
    name: "困难审查",
    maxWordLength: 6,
    wordRule: "生成不那么平常但仍能被日常玩家理解的词，可以是社交心理、网络文化、亚文化活动、职场隐性场景、复合生活现象；不要生成常见具体商品或普通公共设施。",
    clueRule: "线索必须模糊，只能描述外围场景、情绪后果、出现时机或旁观者反应，不能说核心用途、组成或招牌动作。",
    clueLengthRule: "每条去除标点后必须是4到8个汉字",
  },
  {
    level: 4,
    name: "高压审查",
    maxWordLength: 6,
    wordRule: "生成有明显辨识门槛的生活概念或文化现象，不要是平常一眼能想到的东西；适合被误猜成多个近义或相邻概念。",
    clueRule: "线索非常克制，只给边缘感受和非唯一场景；单条线索应至少能误导到3个相近答案。",
    clueLengthRule: "每条去除标点后必须是4到7个汉字",
  },
];

function getDifficultyProfile(survivalStreak: number) {
  if (survivalStreak >= 7) return DIFFICULTY_PROFILES[3];
  if (survivalStreak >= 4) return DIFFICULTY_PROFILES[2];
  if (survivalStreak >= 2) return DIFFICULTY_PROFILES[1];
  return DIFFICULTY_PROFILES[0];
}

function pickWordTopic(difficulty: DifficultyProfile) {
  const candidates = WORD_TOPICS.filter((topic) => (topic.minDifficulty ?? 1) <= difficulty.level);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? WORD_TOPICS[0];
}

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

function validateWord(word: string, recentWords: string[], difficulty: DifficultyProfile) {
  return (
    word.length >= 2 &&
    word.length <= difficulty.maxWordLength &&
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

function validateIntelOptions(word: string, options: IntelOption[]) {
  const seen = new Set<string>();

  return options.filter((option) => {
    const type = String(option.type ?? "").trim();
    const title = String(option.title ?? "").trim().slice(0, 12);
    const text = String(option.text ?? "").trim().slice(0, 32);
    const normalized = normalizeText(text);
    if (!type || !title || !normalized) return false;
    if (normalized.length < 6 || normalized.length > 22) return false;
    if (normalized.includes(word)) return false;
    if (seen.has(type)) return false;
    seen.add(type);
    option.type = type;
    option.title = title;
    option.text = text;
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

function hasPlausibleAssociation(word: string, speech: string) {
  const normalizedWord = normalizeText(word);
  const normalizedSpeech = normalizeText(speech);
  const associationRules = [
    {
      words: ["便利店", "超市", "药店", "奶茶店", "咖啡店", "书店", "快餐店"],
      patterns: [/连锁店|连锁|门店|店面|到处都有|很多家|楼下|街边|二十四小时|24小时/],
    },
    {
      words: ["自动售货机", "便利店", "超市", "小卖部"],
      patterns: [/饮料|零食|扫码|投币|货架|买东西|临时买/],
    },
    {
      words: ["剧本杀", "密室逃脱", "狼人杀"],
      patterns: [/约局|身份|推理|复盘|朋友|线索|凶手/],
    },
    {
      words: ["奶茶"],
      patterns: [/奶|茶|饮品|甜度|加冰|冰块|珍珠|椰果|外卖|杯装|吸管/],
    },
  ];

  return associationRules.some((rule) => {
    return rule.words.includes(normalizedWord) && rule.patterns.some((pattern) => pattern.test(normalizedSpeech));
  });
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

function softenPlausibleAssociationJudgement(judgement: Judgement, index: number): Judgement {
  if (index > 1 || judgement.isSame) return judgement;

  return {
    ...judgement,
    isSame: true,
    confidence: Math.min(Math.max(judgement.confidence, 0.6), 0.72),
    directionScore: Math.max(judgement.directionScore ?? 0, 58),
    clueScore: Math.max(judgement.clueScore ?? 0, 50),
    naturalScore: Math.max(judgement.naturalScore ?? 0, 58),
    suspicionScore: Math.min(judgement.suspicionScore ?? 100, 58),
    reason: "有点泛，但确实蹭到答案边上",
  };
}

function strengthenComponentHitJudgement(word: string, speech: string, judgement: Judgement): Judgement {
  const normalizedWord = normalizeText(word);
  const normalizedSpeech = normalizeText(speech);
  const componentHit =
    normalizedWord === "奶茶" && /奶/.test(normalizedSpeech) && /茶/.test(normalizedSpeech);

  if (!componentHit) return judgement;

  return {
    ...judgement,
    isSame: true,
    confidence: Math.max(judgement.confidence, 0.78),
    directionScore: Math.max(judgement.directionScore ?? 0, 82),
    clueScore: Math.max(judgement.clueScore ?? 0, 62),
    naturalScore: Math.max(judgement.naturalScore ?? 0, 68),
    suspicionScore: Math.max(Math.min(judgement.suspicionScore ?? 45, 55), 38),
    reason: "奶和茶都点名了，太像自己人",
  };
}

function strengthenExactWordHitJudgement(word: string, speech: string, judgement: Judgement): Judgement {
  const normalizedWord = normalizeText(word);
  const normalizedSpeech = normalizeText(speech);
  if (!normalizedWord || !normalizedSpeech.includes(normalizedWord)) return judgement;

  return {
    ...judgement,
    isSame: true,
    confidence: Math.max(judgement.confidence, 0.9),
    directionScore: Math.max(judgement.directionScore ?? 0, 95),
    clueScore: Math.max(judgement.clueScore ?? 0, 86),
    naturalScore: Math.max(judgement.naturalScore ?? 0, 70),
    suspicionScore: Math.min(judgement.suspicionScore ?? 35, 40),
    reason: "答案都说出口了，门禁直接开",
  };
}


function fallbackSetup(count: number, difficulty: DifficultyProfile) {
  const setups = [
    {
      word: "剧本杀",
      seeds: [
        { side: "场景侧面", text: "朋友约局会想到" },
        { side: "操作侧面", text: "会先拿到身份" },
        { side: "状态侧面", text: "过程里常要推理" },
      ],
      descriptions: ["朋友约局会想到", "会先拿到身份", "过程里常要推理", "复盘时容易争起来"],
      intelOptions: [
        { type: "场景情报", title: "约局场景", text: "朋友聚会时容易出现" },
        { type: "行为情报", title: "先拿东西", text: "开始前常会先分身份" },
        { type: "危险情报", title: "别太直白", text: "别提凶手剧本和推理" },
      ],
    },
    {
      word: "情绪价值",
      seeds: [
        { side: "后果侧面", text: "听完会舒服些" },
        { side: "场景侧面", text: "聊天里很加分" },
        { side: "关联侧面", text: "不一定解决事" },
      ],
      descriptions: ["听完会舒服些", "聊天里很加分", "不一定解决事", "有人特别吃这套"],
      intelOptions: [
        { type: "感受情报", title: "听完反应", text: "对方会觉得被接住" },
        { type: "场景情报", title: "聊天场景", text: "亲密聊天里很常见" },
        { type: "危险情报", title: "别太直白", text: "别提安慰情绪和陪伴" },
      ],
    },
    {
      word: "职场潜规则",
      seeds: [
        { side: "状态侧面", text: "没人明着说" },
        { side: "场景侧面", text: "新人容易踩到" },
        { side: "后果侧面", text: "懂了会少碰壁" },
      ],
      descriptions: ["没人明着说", "新人容易踩到", "懂了会少碰壁", "老员工都默认"],
      intelOptions: [
        { type: "场景情报", title: "新人阶段", text: "刚进去时最容易碰到" },
        { type: "感受情报", title: "懂了以后", text: "明白后会少吃暗亏" },
        { type: "危险情报", title: "别太直白", text: "别提公司规矩和潜规则" },
      ],
    },
    {
      word: "社交货币",
      seeds: [
        { side: "场景侧面", text: "聊天时能派上" },
        { side: "后果侧面", text: "知道多会加分" },
        { side: "状态侧面", text: "过期就不好用了" },
      ],
      descriptions: ["聊天时能派上", "知道多会加分", "过期就不好用了", "别人会接得上"],
      intelOptions: [
        { type: "场景情报", title: "聊天入口", text: "聊天冷场时能用上" },
        { type: "感受情报", title: "别人反应", text: "懂的人会马上接住" },
        { type: "危险情报", title: "别太直白", text: "别提谈资热点和梗" },
      ],
    },
  ];
  const setup = setups[Math.min(difficulty.level - 1, setups.length - 1)];

  return {
    ...setup,
    descriptions: setup.descriptions.slice(0, count),
    intelOptions: setup.intelOptions,
  };
}

async function generateSetup(body: GenerateSetupRequest) {
  const count = Math.max(2, Math.min(4, Number.isFinite(body.count) ? body.count : 3));
  const recentWords = (body.recentWords ?? []).map(normalizeText).filter(Boolean).slice(0, 30);
  const survivalStreak = Number.isFinite(body.survivalStreak) ? Math.max(0, Math.floor(body.survivalStreak ?? 0)) : 0;
  const difficulty = getDifficultyProfile(survivalStreak);
  const topic = pickWordTopic(difficulty);
  const messages = [
    baseSystemPrompt(),
    {
      role: "user" as const,
      content: buildGameSetupPrompt({
        count,
        recentWords,
        topic,
        difficulty,
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
        intelOptions?: IntelOption[];
      }>(result.content);
      const word = normalizeText(parsed.word ?? "");
      const seeds = (parsed.seeds ?? []).slice(0, 3).filter((seed) => {
        return Boolean(seed.side) && validateDescriptions(word, [], [seed.text]).length === 1;
      });
      const descriptions = validateDescriptions(word, seeds, parsed.descriptions ?? []);
      const intelOptions = validateIntelOptions(word, parsed.intelOptions ?? []);

      if (
        validateWord(word, recentWords, difficulty) &&
        seeds.length === 3 &&
        descriptions.length === count &&
        intelOptions.length >= 3
      ) {
        return {
          word,
          seeds,
          descriptions,
          intelOptions: intelOptions.slice(0, 3),
          topic: topic.name,
          difficulty: difficulty.name,
          difficultyLevel: difficulty.level,
          usage: result.usage,
          model: result.model,
          raw: result.content,
        };
      }
    } catch {
      // Try one more model response, then use a local fallback so the game can still start.
    }
  }

  const fallback = fallbackSetup(count, difficulty);
  return {
    word: fallback.word,
    seeds: fallback.seeds,
    descriptions: fallback.descriptions,
    intelOptions: fallback.intelOptions,
    topic: topic.name,
    difficulty: difficulty.name,
    difficultyLevel: difficulty.level,
    usage: undefined,
    model: model ?? process.env.BAILIAN_MODEL ?? "fallback",
    raw: "fallback-setup",
  };
}

async function generateFollowup(body: GenerateFollowupRequest) {
  const messages = [
    baseSystemPrompt(),
    {
      role: "user" as const,
      content: buildFollowupPrompt(body),
    },
  ];
  const model = process.env.BAILIAN_JUDGE_MODEL ?? process.env.BAILIAN_VOTE_MODEL;
  const fallbackQuestion = "你刚才这句怎么接上";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await callBailianChat(messages, { model, maxTokens: 120 });
    try {
      const parsed = parseJsonObject<{ question?: string }>(result.content);
      const question = String(parsed.question ?? "").trim().slice(0, 24);
      if (question && !normalizeText(question).includes(normalizeText(body.word))) {
        return {
          question,
          usage: result.usage,
          model: result.model,
          raw: result.content,
        };
      }
    } catch {
      // Retry once, then fallback.
    }
  }

  return {
    question: fallbackQuestion,
    usage: undefined,
    model: model ?? process.env.BAILIAN_MODEL ?? "fallback",
    raw: "fallback-followup",
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
  const plausibleAssociation = hasPlausibleAssociation(body.word, body.playerSpeech);
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
      if (lowInformationSpeech) return adjustLowInformationJudgement(fallbackJudgement);
      const associatedJudgement = plausibleAssociation
        ? softenPlausibleAssociationJudgement(fallbackJudgement, index)
        : fallbackJudgement;
      return strengthenExactWordHitJudgement(
        body.word,
        body.playerSpeech,
        strengthenComponentHitJudgement(body.word, body.playerSpeech, associatedJudgement),
      );
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
    if (lowInformationSpeech) return adjustLowInformationJudgement(normalizedJudgement);
    const associatedJudgement = plausibleAssociation
      ? softenPlausibleAssociationJudgement(normalizedJudgement, index)
      : normalizedJudgement;
    return strengthenExactWordHitJudgement(
      body.word,
      body.playerSpeech,
      strengthenComponentHitJudgement(body.word, body.playerSpeech, associatedJudgement),
    );
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

    if (body.task === "generateFollowup") {
      return NextResponse.json(await generateFollowup(body));
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
