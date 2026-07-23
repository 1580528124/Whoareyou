"use client";

import { useEffect, useMemo, useState } from "react";

type Phase = "setup" | "listen" | "speak" | "judging" | "result";
type Winner = "player" | "ai";

type DescriptionSeed = {
  side: string;
  text: string;
};

type Player = {
  id: number;
  name: string;
  isHuman: boolean;
  role: "civilian" | "undercover";
  word: string;
  alive: boolean;
};

type Speech = {
  round: number;
  playerId: number;
  playerName: string;
  text: string;
};

type Vote = {
  round: number;
  voterId: number;
  voterName: string;
  targetId: number;
  targetName: string;
  raw?: string;
};

type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

type TokenCall = {
  id: string;
  round: number;
  task: "setup" | "judge";
  playerId: number;
  playerName: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  output: string;
};

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

type RoundRecord = {
  round: number;
  speeches: Speech[];
  votes: Vote[];
  voteCounts: Record<string, number>;
  eliminatedId: number | null;
  eliminatedName: string | null;
  tied: boolean;
};

type GameState = {
  mode: "i_am_undercover";
  phase: Phase;
  round: number;
  maxRounds: number;
  secretWord: string;
  civilianWord: string;
  undercoverWord: string;
  seeds: DescriptionSeed[];
  generatedDescriptions: string[];
  descriptionTargetCount: number;
  visibleDescriptionCount: number;
  players: Player[];
  speeches: Speech[];
  votes: Vote[];
  records: RoundRecord[];
  playerGuess: string;
  playerSpeech: string;
  judgements: Judgement[];
  winner: Winner | null;
  endedReason: string;
  disguiseScore: number;
  resultTitle: string;
  resultTags: string[];
  listenedCount: number;
  riskMultiplier: number;
  tokenCalls: TokenCall[];
  usage: {
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type GenerateSetupResponse = {
  word?: string;
  seeds?: DescriptionSeed[];
  descriptions?: string[];
  usage?: Usage;
  model?: string;
  error?: string;
};

type CompleteGameSetup = GenerateSetupResponse & {
  word: string;
  seeds: DescriptionSeed[];
  descriptions: string[];
};

type JudgePlayerResponse = {
  judgements?: Judgement[];
  usage?: Usage;
  model?: string;
  error?: string;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

const AI_NAMES = ["林舟", "许墨", "阿澈"];
const AI_ROLES: Record<string, string> = {
  林舟: "内容审查员",
  许墨: "闭环审查员",
  阿澈: "自然度审查员",
};
const AI_DESCRIPTION_DELAY_MS = 1700;
const RECENT_WORDS_KEY = "whoareyou_recent_words";
const SURVIVAL_STREAK_KEY = "whoareyou_survival_streak";

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function randomDescriptionCount() {
  const roll = Math.random();
  if (roll < 0.3) return 2;
  if (roll < 0.75) return 3;
  return 4;
}

function readRecentWords() {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_WORDS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((word): word is string => typeof word === "string").slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

function rememberRecentWord(word: string) {
  if (typeof window === "undefined" || !word) return;

  const recentWords = readRecentWords().filter((item) => item !== word);
  window.localStorage.setItem(RECENT_WORDS_KEY, JSON.stringify([word, ...recentWords].slice(0, 30)));
}

function readSurvivalStreak() {
  if (typeof window === "undefined") return 0;

  const value = Number(window.localStorage.getItem(SURVIVAL_STREAK_KEY) ?? "0");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function writeSurvivalStreak(value: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SURVIVAL_STREAK_KEY, String(Math.max(0, Math.floor(value))));
}

function getRiskMultiplier(listenedCount: number) {
  if (listenedCount <= 2) return 1.15;
  if (listenedCount === 3) return 1;
  return 0.85;
}

function getAverageScore(judgements: Judgement[], key: keyof Judgement) {
  if (judgements.length === 0) return 0;
  const total = judgements.reduce((sum, judgement) => {
    const value = judgement[key];
    return sum + (typeof value === "number" ? value : 0);
  }, 0);
  return total / judgements.length;
}

function calculateDisguiseScore(game: GameState, judgements: Judgement[], winner: Winner) {
  const sameCount = judgements.filter((judgement) => judgement.isSame).length;
  const listenedCount = Math.max(1, game.speeches.filter((speech) => speech.playerId !== 0).length);
  const riskMultiplier = getRiskMultiplier(listenedCount);
  const guessedRight =
    game.playerGuess.trim() === game.secretWord ||
    game.playerSpeech.includes(game.secretWord);

  const directionScore = getAverageScore(judgements, "directionScore");
  const clueScore = getAverageScore(judgements, "clueScore");
  const naturalScore = getAverageScore(judgements, "naturalScore");
  const suspicionScore = getAverageScore(judgements, "suspicionScore");
  const passScore = (sameCount / Math.max(1, judgements.length)) * 34;
  const qualityScore = directionScore * 0.18 + clueScore * 0.16 + naturalScore * 0.18;
  const suspicionPenalty = suspicionScore * 0.2;
  const wrongGuessBonus = winner === "player" && game.playerGuess.trim() && !guessedRight ? 5 : 0;
  const resultBonus = winner === "player" ? 8 : 0;
  const rawScore = (passScore + qualityScore - suspicionPenalty + resultBonus) * riskMultiplier + wrongGuessBonus;
  const score = Math.round(Math.max(0, Math.min(98, rawScore)));

  return {
    score,
    listenedCount,
    riskMultiplier,
  };
}

function getResultTitle(game: GameState, judgements: Judgement[], winner: Winner, score: number) {
  const sameCount = judgements.filter((judgement) => judgement.isSame).length;
  const listenedCount = Math.max(1, game.speeches.filter((speech) => speech.playerId !== 0).length);
  const guessedRight =
    game.playerGuess.trim() === game.secretWord ||
    game.playerSpeech.includes(game.secretWord);
  const hasGuess = Boolean(game.playerGuess.trim());

  if (winner === "ai" && sameCount === 0) return "一句话自爆";
  if (winner === "ai" && listenedCount >= 3) return "全程露馅";
  if (winner === "ai") return "差点混进去";
  if (guessedRight && score >= 85) return "精准破局";
  if (listenedCount === 1 && score >= 80) return "盲狙成功";
  if (hasGuess && !guessedRight) return "误打误撞大师";
  if (guessedRight && score >= 80) return "精准潜伏者";
  if (sameCount === 3) return "天衣无缝";
  if (score >= 75) return "语言烟雾弹大师";
  return "强行混入";
}

function getResultTags(game: GameState, judgements: Judgement[], winner: Winner, score: number) {
  const sameCount = judgements.filter((judgement) => judgement.isSame).length;
  const suspectedCount = judgements.length - sameCount;
  const listenedCount = Math.max(1, game.speeches.filter((speech) => speech.playerId !== 0).length);
  const guessedRight =
    game.playerGuess.trim() === game.secretWord ||
    game.playerSpeech.includes(game.secretWord);
  const hasGuess = Boolean(game.playerGuess.trim());
  const naturalScore = getAverageScore(judgements, "naturalScore");
  const suspicionScore = getAverageScore(judgements, "suspicionScore");
  const clueScore = getAverageScore(judgements, "clueScore");
  const tags: string[] = [];

  if (winner === "player") tags.push("全员放行");
  if (winner === "ai" && suspectedCount === 1) tags.push("差一票过关");
  if (winner === "ai" && suspectedCount === 3) tags.push("全员警报");
  if (listenedCount <= 2) tags.push("少线索出手");
  if (listenedCount >= 4) tags.push("情报吃满");
  if (guessedRight) tags.push("猜词命中");
  if (hasGuess && !guessedRight && winner === "player") tags.push("猜错也能装");
  if (naturalScore >= 78) tags.push("演技在线");
  if (clueScore >= 75) tags.push("线索缝合怪");
  if (suspicionScore <= 30 && winner === "player") tags.push("低可疑体质");
  if (suspicionScore >= 70) tags.push("可疑气味超标");
  if (score >= 90) tags.push("高分伪装");
  if (score < 45) tags.push("当场露馅");

  return Array.from(new Set(tags)).slice(0, 5);
}

function createGame(): GameState {
  const descriptionTargetCount = randomDescriptionCount();
  const players: Player[] = [
    { id: 0, name: "你", isHuman: true, role: "undercover", word: "", alive: true },
    ...AI_NAMES.map((name, index) => ({
      id: index + 1,
      name,
      isHuman: false,
      role: "civilian" as const,
      word: "",
      alive: true,
    })),
  ];

  return {
    mode: "i_am_undercover",
    phase: "setup",
    round: 1,
    maxRounds: 1,
    secretWord: "",
    civilianWord: "",
    undercoverWord: "",
    seeds: [],
    generatedDescriptions: [],
    descriptionTargetCount,
    visibleDescriptionCount: 0,
    players,
    speeches: [],
    votes: [],
    records: [],
    playerGuess: "",
    playerSpeech: "",
    judgements: [],
    winner: null,
    endedReason: "",
    disguiseScore: 0,
    resultTitle: "",
    resultTags: [],
    listenedCount: 0,
    riskMultiplier: 1,
    tokenCalls: [],
    usage: {
      calls: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

function addTokenCall(
  game: GameState,
  call: Omit<TokenCall, "id" | "prompt_tokens" | "completion_tokens" | "total_tokens"> & {
    usage?: Usage;
  },
): GameState {
  if (!call.usage) return game;

  const tokenCall: TokenCall = {
    id: `${call.round}-${call.task}-${call.playerId}-${game.tokenCalls.length}`,
    round: call.round,
    task: call.task,
    playerId: call.playerId,
    playerName: call.playerName,
    model: call.model,
    prompt_tokens: call.usage.prompt_tokens,
    completion_tokens: call.usage.completion_tokens,
    total_tokens: call.usage.total_tokens,
    output: call.output,
  };

  return {
    ...game,
    tokenCalls: [...game.tokenCalls, tokenCall],
    usage: {
      calls: game.usage.calls + 1,
      prompt_tokens: game.usage.prompt_tokens + call.usage.prompt_tokens,
      completion_tokens: game.usage.completion_tokens + call.usage.completion_tokens,
      total_tokens: game.usage.total_tokens + call.usage.total_tokens,
    },
  };
}

async function requestSetup(game: GameState): Promise<CompleteGameSetup> {
  const response = await fetch("/api/ai/game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "generateSetup",
      count: game.descriptionTargetCount,
      recentWords: readRecentWords(),
    }),
  });
  const data = (await response.json()) as GenerateSetupResponse;
  if (!response.ok || data.error) throw new Error(data.error ?? "生成开局失败");
  if (!data.word || !data.descriptions || !data.seeds) {
    throw new Error("开局数据不完整");
  }
  return data as CompleteGameSetup;
}

async function requestJudgement(game: GameState) {
  const response = await fetch("/api/ai/game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "judgePlayer",
      word: game.secretWord,
      aiNames: AI_NAMES,
      aiDescriptions: game.speeches
        .filter((speech) => speech.playerId !== 0)
        .map((speech) => ({
          playerName: speech.playerName,
          text: speech.text,
        })),
      playerGuess: game.playerGuess,
      playerSpeech: game.playerSpeech,
    }),
  });
  const data = (await response.json()) as JudgePlayerResponse;
  if (!response.ok || data.error) throw new Error(data.error ?? "AI判断失败");
  return data;
}

function buildResult(game: GameState, judgements: Judgement[]) {
  const sameCount = judgements.filter((judgement) => judgement.isSame).length;
  const differentCount = judgements.length - sameCount;
  const winner: Winner = differentCount === 0 ? "player" : "ai";
  const scoreResult = calculateDisguiseScore(game, judgements, winner);
  const resultTitle = getResultTitle(game, judgements, winner, scoreResult.score);
  const resultTags = getResultTags(game, judgements, winner, scoreResult.score);
  const endedReason =
    winner === "player"
      ? "3个AI都认为你是同类"
      : differentCount === 3
        ? "3个AI都识破了你的伪装"
        : `${differentCount}个AI产生了怀疑，你被识破了`;
  const votes: Vote[] = judgements.map((judgement) => {
    const voter = game.players.find((player) => player.name === judgement.aiName) ?? game.players[1];
    const target = judgement.isSame ? voter : game.players[0];
    return {
      round: 1,
      voterId: voter.id,
      voterName: voter.name,
      targetId: target.id,
      targetName: target.name,
      raw: JSON.stringify(judgement),
    };
  });

  return {
    winner,
    endedReason,
    disguiseScore: scoreResult.score,
    resultTitle,
    resultTags,
    listenedCount: scoreResult.listenedCount,
    riskMultiplier: scoreResult.riskMultiplier,
    votes,
    record: {
      round: 1,
      speeches: game.speeches,
      votes,
      voteCounts: {
        same: sameCount,
        different: differentCount,
      },
      eliminatedId: winner === "ai" ? 0 : null,
      eliminatedName: winner === "ai" ? "你" : null,
      tied: false,
    },
  };
}

export default function Home() {
  const [game, setGame] = useState<GameState>(() => createGame());
  const [guess, setGuess] = useState("");
  const [playerSpeech, setPlayerSpeech] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savedGameId, setSavedGameId] = useState("");
  const [saveError, setSaveError] = useState("");
  const [survivalStreak, setSurvivalStreak] = useState(0);

  const visibleSpeeches = useMemo(
    () => game.speeches.filter((speech) => speech.playerId !== 0),
    [game.speeches],
  );
  const canSpeak = playerSpeech.trim().length >= 4 && !isBusy;

  useEffect(() => {
    setSurvivalStreak(readSurvivalStreak());
  }, []);

  useEffect(() => {
    if (game.phase !== "result" || saveStatus !== "idle") return;

    async function saveGame() {
      setSaveStatus("saving");
      setSaveError("");

      try {
        const response = await fetch("/api/games", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ game }),
        });
        const data = (await response.json()) as { id?: string; error?: string };

        if (!response.ok || data.error) {
          throw new Error(data.error ?? "保存本局失败");
        }

        setSavedGameId(data.id ?? "");
        setSaveStatus("saved");
      } catch (caught) {
        setSaveError(caught instanceof Error ? caught.message : "保存本局失败");
        setSaveStatus("error");
      }
    }

    void saveGame();
  }, [game, saveStatus]);

  async function revealNextDescription(sourceGame = game) {
    if (sourceGame.visibleDescriptionCount >= sourceGame.generatedDescriptions.length) {
      setGame((current) => ({ ...current, phase: "speak" }));
      return;
    }

    setIsBusy(true);
    setProgress("AI正在发言");
    await sleep(AI_DESCRIPTION_DELAY_MS);

    const nextIndex = sourceGame.visibleDescriptionCount;
    const aiPlayer = sourceGame.players[(nextIndex % AI_NAMES.length) + 1];
    const speech: Speech = {
      round: 1,
      playerId: aiPlayer.id,
      playerName: aiPlayer.name,
      text: sourceGame.generatedDescriptions[nextIndex],
    };

    setGame((current) => ({
      ...current,
      phase: "listen",
      visibleDescriptionCount: current.visibleDescriptionCount + 1,
      speeches: [...current.speeches, speech],
    }));
    setProgress("");
    setIsBusy(false);
  }

  async function startGame() {
    setIsBusy(true);
    setError("");
    setProgress("正在生成本局线索");

    try {
      const data = await requestSetup(game);
      const descriptions = data.descriptions.slice(0, game.descriptionTargetCount);
      rememberRecentWord(data.word);
      const nextGame = addTokenCall(
        {
          ...game,
          phase: "listen",
          secretWord: data.word,
          civilianWord: data.word,
          seeds: data.seeds,
          generatedDescriptions: descriptions,
          players: game.players.map((player) =>
            player.isHuman ? player : { ...player, word: data.word },
          ),
        },
        {
          round: 1,
          task: "setup",
          playerId: 1,
          playerName: "系统",
          model: data.model ?? "unknown",
          usage: data.usage,
          output: `${data.word}：${descriptions.join(" / ")}`,
        },
      );
      setGame(nextGame);
      await revealNextDescription(nextGame);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "开局失败");
    } finally {
      setProgress("");
      setIsBusy(false);
    }
  }

  function enterSpeakPhase() {
    if (visibleSpeeches.length === 0 || isBusy) return;
    setGame((current) => ({ ...current, phase: "speak" }));
  }

  async function submitPlayerSpeech() {
    if (!canSpeak) return;
    setIsBusy(true);
    setError("");
    setProgress("AI正在判断你是否属于它们");

    try {
      const speech: Speech = {
        round: 1,
        playerId: 0,
        playerName: "你",
        text: playerSpeech.trim(),
      };
      const gameWithSpeech = {
        ...game,
        phase: "judging" as const,
        playerGuess: guess.trim(),
        playerSpeech: playerSpeech.trim(),
        speeches: [...game.speeches, speech],
      };
      const data = await requestJudgement(gameWithSpeech);
      const judgements = data.judgements ?? [];
      const result = buildResult(gameWithSpeech, judgements);
      const nextSurvivalStreak = result.winner === "player" ? survivalStreak + 1 : 0;
      const withToken = addTokenCall(gameWithSpeech, {
        round: 1,
        task: "judge",
        playerId: 1,
        playerName: "AI评审",
        model: data.model ?? "unknown",
        usage: data.usage,
        output: JSON.stringify(judgements),
      });
      writeSurvivalStreak(nextSurvivalStreak);
      setSurvivalStreak(nextSurvivalStreak);

      setGame({
        ...withToken,
        phase: "result",
        votes: result.votes,
        records: [result.record],
        judgements,
        winner: result.winner,
        endedReason: result.endedReason,
        disguiseScore: result.disguiseScore,
        resultTitle: result.resultTitle,
        resultTags: result.resultTags,
        listenedCount: result.listenedCount,
        riskMultiplier: result.riskMultiplier,
        players: withToken.players.map((player) =>
          player.id === 0 ? { ...player, alive: result.winner === "player" } : player,
        ),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI判断失败");
    } finally {
      setProgress("");
      setIsBusy(false);
    }
  }

  function resetGame() {
    setGame(createGame());
    setGuess("");
    setPlayerSpeech("");
    setIsBusy(false);
    setError("");
    setProgress("");
    setSaveStatus("idle");
    setSavedGameId("");
    setSaveError("");
  }

  const aiJudgementPanel = (
    <>
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">结果</p>
          <h2>AI判断</h2>
        </div>
      </div>
      <div className="logs">
        {game.judgements.length === 0 && <p className="empty">结算后会显示AI判断。</p>}
        {game.judgements.map((judgement) => (
          <article key={judgement.aiName} className="log">
            <span>{judgement.aiName}</span>
            <small>{AI_ROLES[judgement.aiName]}</small>
            <p>{judgement.isSame ? "认为你是同类" : "认为你是异类"}</p>
            {judgement.reason && <p>{judgement.reason}</p>}
            <div className="scoreGrid">
              <span>方向 {judgement.directionScore ?? 0}</span>
              <span>闭环 {judgement.clueScore ?? 0}</span>
              <span>自然 {judgement.naturalScore ?? 0}</span>
              <span>可疑 {judgement.suspicionScore ?? 0}</span>
            </div>
            <small>置信度 {Math.round(judgement.confidence * 100)}%</small>
          </article>
        ))}
      </div>
    </>
  );

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">WhoAreYou</p>
          <h1>你能骗过AI吗</h1>
        </div>
        <div className="topStats">
          <div className="roundBadge">已成功骗过AI {survivalStreak} 轮</div>
          <div className="tokenBadge">
            Token {game.usage.total_tokens} · 调用 {game.usage.calls} 次 · 输入{" "}
            {game.usage.prompt_tokens} · 输出 {game.usage.completion_tokens}
          </div>
        </div>
      </section>

      <section className="board">
        <div className="panel primary">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">你的信息</p>
              <h2>词语未知</h2>
            </div>
            <span>{game.phase === "result" ? "核心词已揭晓" : "AI的词保密中"}</span>
          </div>

          {error && <p className="errorText">{error}</p>}
          {progress && <p className="progressText">{progress}</p>}

          {game.phase === "setup" && (
            <div className="stage">
              <p>AI知道答案，你不知道。听几条线索后，用一句话假装你也知道。</p>
              <button disabled={isBusy} onClick={startGame}>
                {isBusy ? "准备中..." : "开始挑战"}
              </button>
            </div>
          )}

          {game.phase === "listen" && (
            <div className="stage">
              <p>线索越少，骗过AI后的分数越高。你不知道一共有几条，可以随时出手。</p>
              <div className="roundSpeeches">
                {visibleSpeeches.map((speech) => (
                  <article className="roundSpeech" key={`${speech.playerId}-${speech.text}`}>
                    <span>{speech.playerName}</span>
                    <p>{speech.text}</p>
                  </article>
                ))}
              </div>
              <div className="voteGrid">
                <button disabled={isBusy} onClick={() => void revealNextDescription()}>
                  继续听
                </button>
                <button disabled={isBusy || visibleSpeeches.length === 0} onClick={enterSpeakPhase}>
                  写答案
                </button>
              </div>
            </div>
          )}

          {game.phase === "speak" && (
            <div className="stage">
              <p>写一句像知道答案的人会说的话。猜词可填可不填，猜错但骗过AI更有意思。</p>
              <div className="roundSpeeches">
                {visibleSpeeches.map((speech) => (
                  <article className="roundSpeech" key={`${speech.playerId}-${speech.text}`}>
                    <span>{speech.playerName}</span>
                    <p>{speech.text}</p>
                  </article>
                ))}
              </div>
              <input
                className="textInput"
                value={guess}
                onChange={(event) => setGuess(event.target.value)}
                placeholder="你猜的词，可不填"
              />
              <textarea
                value={playerSpeech}
                onChange={(event) => setPlayerSpeech(event.target.value)}
                placeholder="输入10-20字伪装发言"
              />
              <button className="actionButton" disabled={!canSpeak} onClick={submitPlayerSpeech}>
                提交发言并接受判断
              </button>
            </div>
          )}

          {game.phase === "judging" && (
            <div className="stage">
              <p>AI正在判断你的发言是否属于它们的方向。</p>
            </div>
          )}

          {game.phase === "result" && (
            <div className="stage result">
              <h2>{game.resultTitle}</h2>
              {game.resultTags.length > 0 && (
                <div className="tagList">
                  {game.resultTags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              )}
              <div className="scoreBoard">
                <strong>{game.disguiseScore}</strong>
                <span>伪装分</span>
              </div>
              <p>{game.endedReason}</p>
              <p>
                通过审查 {game.judgements.filter((judgement) => judgement.isSame).length}/
                {AI_NAMES.length} · 被怀疑{" "}
                {game.judgements.filter((judgement) => !judgement.isSame).length}
              </p>
              <p>
                听了 {game.listenedCount} 条线索 · 倍率 x{game.riskMultiplier.toFixed(2)}
              </p>
              <p>本局答案：{game.secretWord}</p>
              <p>你的猜测：{game.playerGuess || "未填写"}</p>
              <p>伪装句：{game.playerSpeech}</p>
              <p>
                {saveStatus === "saving" && "正在保存本局..."}
                {saveStatus === "saved" && `本局已保存：${savedGameId}`}
                {saveStatus === "error" && `保存失败：${saveError}`}
              </p>
              <button onClick={resetGame}>再来一局</button>
            </div>
          )}
        </div>

        <div className="panel judgementPanel">{aiJudgementPanel}</div>
      </section>
    </main>
  );
}
