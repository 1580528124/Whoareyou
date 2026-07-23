"use client";

import { useEffect, useMemo, useState } from "react";

type Phase = "setup" | "listen" | "speak" | "judging" | "result";
type Winner = "player" | "ai";

type DescriptionSeed = {
  side: string;
  text: string;
};

type WordSeed = {
  word: string;
  seeds: DescriptionSeed[];
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
  task: "description" | "judge";
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
  tokenCalls: TokenCall[];
  usage: {
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type GenerateDescriptionsResponse = {
  descriptions?: string[];
  usage?: Usage;
  model?: string;
  error?: string;
};

type JudgePlayerResponse = {
  judgements?: Judgement[];
  usage?: Usage;
  model?: string;
  error?: string;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

const AI_NAMES = ["林舟", "许墨", "阿澈"];
const AI_DESCRIPTION_DELAY_MS = 1700;

const WORD_SEEDS: WordSeed[] = [
  { word: "西瓜", seeds: [{ side: "操作侧面", text: "买前会敲两下" }, { side: "时间侧面", text: "夏天更常见" }, { side: "后果侧面", text: "切开常分着吃" }] },
  { word: "牛奶", seeds: [{ side: "时间侧面", text: "早餐常会出现" }, { side: "操作侧面", text: "有人睡前热一下" }, { side: "场景侧面", text: "冰箱里常备着" }] },
  { word: "手机", seeds: [{ side: "操作侧面", text: "出门前会确认" }, { side: "状态侧面", text: "没电会有点慌" }, { side: "场景侧面", text: "等车时常会看" }] },
  { word: "面包", seeds: [{ side: "时间侧面", text: "早上常顺手拿" }, { side: "场景侧面", text: "便利店经常见" }, { side: "操作侧面", text: "有时会烤一下" }] },
  { word: "唇膏", seeds: [{ side: "操作侧面", text: "出门前会涂" }, { side: "时间侧面", text: "天干时常找它" }, { side: "场景侧面", text: "包里常备一个" }] },
  { word: "高铁", seeds: [{ side: "操作侧面", text: "进站要刷证件" }, { side: "时间侧面", text: "出远门会查班次" }, { side: "状态侧面", text: "路上比较安静" }] },
  { word: "水煮鱼", seeds: [{ side: "操作侧面", text: "上桌会先夹鱼片" }, { side: "场景侧面", text: "点菜会问能否吃辣" }, { side: "后果侧面", text: "吃完还想加菜" }] },
  { word: "鱼香肉丝", seeds: [{ side: "场景侧面", text: "点外卖常看见" }, { side: "后果侧面", text: "下饭时容易想到" }, { side: "操作侧面", text: "菜单上常顺手点" }] },
  { word: "火锅", seeds: [{ side: "现象侧面", text: "会冒热气" }, { side: "操作侧面", text: "配料可以自己选" }, { side: "场景侧面", text: "人多吃着热闹" }] },
  { word: "勇往直前", seeds: [{ side: "场景侧面", text: "比赛前常用来打气" }, { side: "状态侧面", text: "听着很有冲劲" }, { side: "操作侧面", text: "遇到难事会想起" }] },
  { word: "福尔摩斯", seeds: [{ side: "场景侧面", text: "提到侦探会想到" }, { side: "操作侧面", text: "看线索就开始推理" }, { side: "状态侧面", text: "案件里总很冷静" }] },
  { word: "包青天", seeds: [{ side: "场景侧面", text: "冤案里常被提起" }, { side: "状态侧面", text: "说到公正会想到" }, { side: "操作侧面", text: "断案时很有威严" }] },
  { word: "甄嬛传", seeds: [{ side: "场景侧面", text: "宫斗时常被提起" }, { side: "后果侧面", text: "重刷会发现细节" }, { side: "状态侧面", text: "很多台词很熟" }] },
  { word: "十面埋伏", seeds: [{ side: "状态侧面", text: "局势让人紧张" }, { side: "场景侧面", text: "被围困时会想到" }, { side: "后果侧面", text: "退路像被堵住" }] },
  { word: "董永", seeds: [{ side: "场景侧面", text: "民间故事会提起" }, { side: "状态侧面", text: "故事有点苦情" }, { side: "关联侧面", text: "天仙配会想到" }] },
];

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function pickWordSeed() {
  return WORD_SEEDS[Math.floor(Math.random() * WORD_SEEDS.length)];
}

function randomDescriptionCount() {
  const roll = Math.random();
  if (roll < 0.1) return 1;
  if (roll < 0.55) return 2;
  return 3;
}

function createGame(): GameState {
  const wordSeed = pickWordSeed();
  const descriptionTargetCount = randomDescriptionCount();
  const players: Player[] = [
    { id: 0, name: "你", isHuman: true, role: "undercover", word: "", alive: true },
    ...AI_NAMES.map((name, index) => ({
      id: index + 1,
      name,
      isHuman: false,
      role: "civilian" as const,
      word: wordSeed.word,
      alive: true,
    })),
  ];

  return {
    mode: "i_am_undercover",
    phase: "setup",
    round: 1,
    maxRounds: 1,
    secretWord: wordSeed.word,
    civilianWord: wordSeed.word,
    undercoverWord: "无词",
    seeds: wordSeed.seeds,
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

async function requestDescriptions(game: GameState) {
  const response = await fetch("/api/ai/game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "generateDescriptions",
      word: game.secretWord,
      seeds: game.seeds,
      count: game.descriptionTargetCount,
    }),
  });
  const data = (await response.json()) as GenerateDescriptionsResponse;
  if (!response.ok || data.error) throw new Error(data.error ?? "生成描述失败");
  return data;
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
  const winner: Winner = sameCount >= 2 ? "player" : "ai";
  const endedReason =
    winner === "player"
      ? sameCount === 3
        ? "3个AI都认为你是同类"
        : "你成功混入，但有1个AI产生了怀疑"
      : differentCount === 3
        ? "3个AI都识破了你的伪装"
        : "2个AI认为你是异类";
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

  const visibleSpeeches = useMemo(
    () => game.speeches.filter((speech) => speech.playerId !== 0),
    [game.speeches],
  );
  const canSpeak = playerSpeech.trim().length >= 4 && !isBusy;

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
      const data = await requestDescriptions(game);
      const descriptions = (data.descriptions ?? game.seeds.map((seed) => seed.text)).slice(
        0,
        game.descriptionTargetCount,
      );
      const nextGame = addTokenCall(
        {
          ...game,
          phase: "listen",
          generatedDescriptions: descriptions,
        },
        {
          round: 1,
          task: "description",
          playerId: 1,
          playerName: "系统",
          model: data.model ?? "unknown",
          usage: data.usage,
          output: descriptions.join(" / "),
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
      const withToken = addTokenCall(gameWithSpeech, {
        round: 1,
        task: "judge",
        playerId: 1,
        playerName: "AI评审",
        model: data.model ?? "unknown",
        usage: data.usage,
        output: JSON.stringify(judgements),
      });

      setGame({
        ...withToken,
        phase: "result",
        votes: result.votes,
        records: [result.record],
        judgements,
        winner: result.winner,
        endedReason: result.endedReason,
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

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">WhoAreYou</p>
          <h1>我是白板</h1>
        </div>
        <div className="roundBadge">单局伪装挑战</div>
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
              <p>你没有词。AI们知道同一个核心词，你要通过它们的描述感知方向，并伪装成同类。</p>
              <button disabled={isBusy} onClick={startGame}>
                {isBusy ? "准备中..." : "开始聆听"}
              </button>
            </div>
          )}

          {game.phase === "listen" && (
            <div className="stage">
              <p>AI会陆续发言。你不知道一共有几条，可以随时结束聆听。</p>
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
              <p>根据已经听到的方向，写一句像同类会说的话。</p>
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
              <h2>{game.winner === "player" ? "你成功融入了" : "你被识破了"}</h2>
              <p>{game.endedReason}</p>
              <p>AI们在说的是：{game.secretWord}</p>
              <p>你的猜测：{game.playerGuess || "未填写"}</p>
              <p>你的发言：{game.playerSpeech}</p>
              <p>
                {saveStatus === "saving" && "正在保存本局..."}
                {saveStatus === "saved" && `本局已保存：${savedGameId}`}
                {saveStatus === "error" && `保存失败：${saveError}`}
              </p>
              <button onClick={resetGame}>再来一局</button>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">AI判断</p>
              <h2>审判席</h2>
            </div>
          </div>
          <div className="players">
            {game.players.map((player) => (
              <article className={player.alive ? "player" : "player eliminated"} key={player.id}>
                <strong>{player.name}</strong>
                <p>
                  {game.phase === "result"
                    ? player.id === 0
                      ? player.alive
                        ? "存活"
                        : "被识破"
                      : "同词AI"
                    : player.id === 0
                      ? "白板"
                      : "观察中"}
                </p>
              </article>
            ))}
          </div>

          <div className="usageBox">
            <p className="eyebrow">Token</p>
            <strong>{game.usage.total_tokens}</strong>
            <span>
              调用 {game.usage.calls} 次 · 输入 {game.usage.prompt_tokens} · 输出{" "}
              {game.usage.completion_tokens}
            </span>
          </div>

          <div className="tokenList">
            <p className="eyebrow">调用明细</p>
            {game.tokenCalls.length === 0 && <span className="empty">AI调用后会记录在这里。</span>}
            {game.tokenCalls.map((call) => (
              <article className="tokenCall" key={call.id}>
                <div>
                  <strong>{call.task === "description" ? "生成描述" : "批量判断"}</strong>
                  <span>{call.model}</span>
                </div>
                <p>{call.output}</p>
                <small>
                  输入 {call.prompt_tokens} · 输出 {call.completion_tokens} · 总计 {call.total_tokens}
                </small>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="timeline compactTimeline">
        <div className="panel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">线索</p>
              <h2>已出现发言</h2>
            </div>
          </div>
          <div className="logs">
            {game.speeches.length === 0 && <p className="empty">AI发言会显示在这里。</p>}
            {game.speeches.map((speech, index) => (
              <article key={`${speech.playerId}-${index}`} className="log">
                <span>{speech.playerName}</span>
                <p>{speech.text}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
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
                <p>{judgement.isSame ? "认为你是同类" : "认为你是异类"}</p>
                <small>置信度 {Math.round(judgement.confidence * 100)}%</small>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
