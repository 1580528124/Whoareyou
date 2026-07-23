import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type SaveGamePlayer = {
  id: number;
  name: string;
  isHuman: boolean;
  role: string;
  word: string;
  alive: boolean;
};

type SaveGameSpeech = {
  round: number;
  playerId: number;
  playerName: string;
  text: string;
};

type SaveGameVote = {
  round: number;
  voterId: number;
  voterName: string;
  targetId: number;
  targetName: string;
  raw?: string;
};

type SaveGameRound = {
  round: number;
  speeches: SaveGameSpeech[];
  votes: SaveGameVote[];
  voteCounts: Record<string, number>;
  eliminatedId: number | null;
  eliminatedName: string | null;
  tied: boolean;
};

type SaveGameTokenCall = {
  round: number;
  task: string;
  playerId: number;
  playerName: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  output: string;
};

type SaveGamePayload = {
  game: {
    phase: string;
    round: number;
    maxRounds: number;
    civilianWord: string;
    undercoverWord: string;
    players: SaveGamePlayer[];
    speechOrder: number[];
    speeches: SaveGameSpeech[];
    votes: SaveGameVote[];
    records: SaveGameRound[];
    winner: string | null;
    endedReason: string;
    tokenCalls: SaveGameTokenCall[];
    usage: {
      calls: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  };
};

export async function POST(request: Request) {
  try {
    const { game } = (await request.json()) as SaveGamePayload;

    if (!game || game.phase !== "result" || !game.winner) {
      return NextResponse.json(
        { error: "Only completed games can be saved." },
        { status: 400 },
      );
    }

    const saved = await prisma.$transaction(async (tx) => {
      const createdGame = await tx.game.create({
        data: {
          status: "completed",
          endedAt: new Date(),
          civilianWord: game.civilianWord,
          undercoverWord: game.undercoverWord,
          winner: game.winner,
          endedReason: game.endedReason,
          maxRounds: game.maxRounds,
          totalCalls: game.usage.calls,
          promptTokens: game.usage.prompt_tokens,
          completionTokens: game.usage.completion_tokens,
          totalTokens: game.usage.total_tokens,
          snapshotJson: game,
        },
      });

      const playerIdMap = new Map<number, string>();
      for (const player of game.players) {
        const eliminatedRound = game.records.find(
          (record) => record.eliminatedId === player.id,
        )?.round;
        const createdPlayer = await tx.player.create({
          data: {
            gameId: createdGame.id,
            playerIndex: player.id,
            name: player.name,
            isHuman: player.isHuman,
            role: player.role,
            word: player.word,
            alive: player.alive,
            eliminatedRound,
          },
        });
        playerIdMap.set(player.id, createdPlayer.id);
      }

      const roundIdMap = new Map<number, string>();
      for (const record of game.records) {
        const createdRound = await tx.round.create({
          data: {
            gameId: createdGame.id,
            roundNumber: record.round,
            speechOrderJson: record.speeches.map((speech) => speech.playerId),
            status: "completed",
            tied: record.tied,
            eliminatedPlayerId:
              record.eliminatedId === null ? null : playerIdMap.get(record.eliminatedId),
            voteCountsJson: record.voteCounts,
          },
        });
        roundIdMap.set(record.round, createdRound.id);
      }

      for (const speech of game.speeches) {
        const roundId = roundIdMap.get(speech.round);
        const playerId = playerIdMap.get(speech.playerId);
        if (!roundId || !playerId) continue;

        const roundSpeeches = game.speeches.filter((item) => item.round === speech.round);
        await tx.speech.create({
          data: {
            gameId: createdGame.id,
            roundId,
            roundNumber: speech.round,
            playerId,
            playerName: speech.playerName,
            position: roundSpeeches.findIndex((item) => item === speech) + 1,
            text: speech.text,
          },
        });
      }

      for (const vote of game.votes) {
        const roundId = roundIdMap.get(vote.round);
        const voterPlayerId = playerIdMap.get(vote.voterId);
        const targetPlayerId = playerIdMap.get(vote.targetId);
        if (!roundId || !voterPlayerId || !targetPlayerId) continue;

        await tx.vote.create({
          data: {
            gameId: createdGame.id,
            roundId,
            roundNumber: vote.round,
            voterPlayerId,
            voterName: vote.voterName,
            targetPlayerId,
            targetName: vote.targetName,
            rawOutput: vote.raw,
          },
        });
      }

      for (const call of game.tokenCalls) {
        const roundId = roundIdMap.get(call.round);
        const playerId = playerIdMap.get(call.playerId);
        if (!playerId) continue;

        await tx.aiCall.create({
          data: {
            gameId: createdGame.id,
            roundId,
            roundNumber: call.round,
            task: call.task,
            playerId,
            playerName: call.playerName,
            model: call.model,
            promptTokens: call.prompt_tokens,
            completionTokens: call.completion_tokens,
            totalTokens: call.total_tokens,
            output: call.output,
          },
        });
      }

      return createdGame;
    });

    return NextResponse.json({
      id: saved.id,
      createdAt: saved.createdAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save game." },
      { status: 500 },
    );
  }
}
