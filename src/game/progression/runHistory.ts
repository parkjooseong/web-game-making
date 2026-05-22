import type { ActiveSynergyState, CharacterId, Difficulty, GameMode, GameState, PoseAssistLevel } from "../simulation/types";

const RUN_HISTORY_STORAGE_KEY = "movecasters.pose-break.run-history.v1";
const MAX_RUN_HISTORY = 30;

export interface RunHistorySynergy {
  id: string;
  title: string;
  tier: ActiveSynergyState["tier"];
}

export interface RunHistory {
  id: string;
  date: string;
  characterId: CharacterId;
  mode: GameMode;
  difficulty: Difficulty;
  poseAssistLevel: PoseAssistLevel;
  victory: boolean;
  score: number;
  seconds: number;
  kills: number;
  perfectCasts: number;
  greatCasts: number;
  normalCasts: number;
  misses: number;
  maxPerfectCombo: number;
  bossPoseAttempts: number;
  bossPoseSuccesses: number;
  bossPosePerfectCounters: number;
  rewardsChosen: string[];
  activeSynergies: RunHistorySynergy[];
  damageTaken: number;
  cameraStatusSummary: string;
  averageFps: number;
  endReason: string;
}

export interface RunHistoryMetadata {
  cameraStatusSummary?: string;
  averageFps?: number;
  endReason?: string;
}

export interface RunHistoryStats {
  totalRuns: number;
  victories: number;
  clearRate: number;
  averageMissRate: number;
  averageScore: number;
  averageSeconds: number;
  averageFps: number;
  averageBossPoseSuccessRate: number;
  averageDamageTaken: number;
}

export class RunHistoryStore {
  private entries: RunHistory[];

  constructor(private readonly storageKey = RUN_HISTORY_STORAGE_KEY) {
    this.entries = this.load();
  }

  getEntries(): RunHistory[] {
    return [...this.entries];
  }

  getStats(): RunHistoryStats {
    const totalRuns = this.entries.length;
    if (totalRuns === 0) {
      return {
        totalRuns: 0,
        victories: 0,
        clearRate: 0,
        averageMissRate: 0,
        averageScore: 0,
        averageSeconds: 0,
        averageFps: 0,
        averageBossPoseSuccessRate: 0,
        averageDamageTaken: 0
      };
    }

    const victories = this.entries.filter((entry) => entry.victory).length;
    const averageMissRate =
      this.entries.reduce((sum, entry) => {
        const casts = entry.perfectCasts + entry.greatCasts + entry.normalCasts + entry.misses;
        return sum + (casts > 0 ? entry.misses / casts : 0);
      }, 0) / totalRuns;
    const averageScore = this.entries.reduce((sum, entry) => sum + entry.score, 0) / totalRuns;
    const averageSeconds = this.entries.reduce((sum, entry) => sum + entry.seconds, 0) / totalRuns;
    const fpsEntries = this.entries.filter((entry) => entry.averageFps > 0);
    const averageFps = fpsEntries.length > 0 ? fpsEntries.reduce((sum, entry) => sum + entry.averageFps, 0) / fpsEntries.length : 0;
    const bossAttempts = this.entries.reduce((sum, entry) => sum + entry.bossPoseAttempts, 0);
    const bossSuccesses = this.entries.reduce((sum, entry) => sum + entry.bossPoseSuccesses, 0);
    const averageDamageTaken = this.entries.reduce((sum, entry) => sum + entry.damageTaken, 0) / totalRuns;

    return {
      totalRuns,
      victories,
      clearRate: victories / totalRuns,
      averageMissRate,
      averageScore,
      averageSeconds,
      averageFps,
      averageBossPoseSuccessRate: bossAttempts > 0 ? bossSuccesses / bossAttempts : 0,
      averageDamageTaken
    };
  }

  recordFromState(state: GameState, victory: boolean, metadata: RunHistoryMetadata = {}): RunHistory {
    const date = new Date().toISOString();
    const bossPoseSuccesses = state.debugStats.bossChallengeSuccesses;
    const bossPoseFailures = state.debugStats.bossChallengeFailures;
    const entry: RunHistory = {
      id: createRunHistoryId(date),
      date,
      characterId: state.characterId,
      mode: state.mode,
      difficulty: state.difficulty,
      poseAssistLevel: state.poseAssistLevel,
      victory,
      score: Math.round(state.player.score),
      seconds: Math.round(state.modeTime || state.time),
      kills: state.runStats.kills,
      perfectCasts: state.runStats.perfectCasts,
      greatCasts: state.runStats.greatCasts,
      normalCasts: state.runStats.normalCasts,
      misses: state.runStats.misses,
      maxPerfectCombo: state.runStats.maxPerfectCombo,
      bossPoseAttempts: bossPoseSuccesses + bossPoseFailures,
      bossPoseSuccesses,
      bossPosePerfectCounters: state.runStats.bossPosePerfectCounters,
      rewardsChosen: [...state.runStats.rewardsChosen],
      activeSynergies: state.activeSynergies.map((synergy) => ({
        id: synergy.id,
        title: synergy.title,
        tier: synergy.tier
      })),
      damageTaken: state.runStats.damageTaken,
      cameraStatusSummary: normalizeText(metadata.cameraStatusSummary, "unknown"),
      averageFps: Math.round(finiteNumber(metadata.averageFps)),
      endReason: normalizeText(metadata.endReason, victory ? "victory" : state.player.hp <= 0 ? "player-defeated" : "ended")
    };

    this.entries = [entry, ...this.entries].slice(0, MAX_RUN_HISTORY);
    this.save();
    return entry;
  }

  clear(): void {
    this.entries = [];
    try {
      window.localStorage.removeItem(this.storageKey);
    } catch {
      // History is a balancing aid; storage failures should not block gameplay.
    }
  }

  private load(): RunHistory[] {
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map(normalizeRunHistory).filter((entry): entry is RunHistory => Boolean(entry)).slice(0, MAX_RUN_HISTORY);
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.entries.slice(0, MAX_RUN_HISTORY)));
    } catch {
      // Ignore quota/private-mode failures.
    }
  }
}

function normalizeRunHistory(value: unknown): RunHistory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const item = value as Partial<RunHistory>;
  if (!isCharacterId(item.characterId) || !isGameMode(item.mode)) {
    return null;
  }
  return {
    id: typeof item.id === "string" ? item.id : createRunHistoryId(item.date),
    date: typeof item.date === "string" ? item.date : new Date().toISOString(),
    characterId: item.characterId,
    mode: item.mode,
    difficulty: isDifficulty(item.difficulty) ? item.difficulty : "normal",
    poseAssistLevel: isPoseAssistLevel(item.poseAssistLevel) ? item.poseAssistLevel : "normal",
    victory: Boolean(item.victory),
    score: finiteNumber(item.score),
    seconds: finiteNumber(item.seconds),
    kills: finiteNumber(item.kills),
    perfectCasts: finiteNumber(item.perfectCasts),
    greatCasts: finiteNumber(item.greatCasts),
    normalCasts: finiteNumber(item.normalCasts),
    misses: finiteNumber(item.misses),
    maxPerfectCombo: finiteNumber(item.maxPerfectCombo),
    bossPoseAttempts: finiteNumber(item.bossPoseAttempts),
    bossPoseSuccesses: finiteNumber(item.bossPoseSuccesses),
    bossPosePerfectCounters: finiteNumber(item.bossPosePerfectCounters),
    rewardsChosen: Array.isArray(item.rewardsChosen) ? item.rewardsChosen.filter((reward): reward is string => typeof reward === "string") : [],
    activeSynergies: Array.isArray(item.activeSynergies)
      ? item.activeSynergies
          .map(normalizeSynergy)
          .filter((synergy): synergy is RunHistorySynergy => Boolean(synergy))
      : [],
    damageTaken: finiteNumber(item.damageTaken),
    cameraStatusSummary: normalizeText(item.cameraStatusSummary, "unknown"),
    averageFps: finiteNumber(item.averageFps),
    endReason: normalizeText(item.endReason, item.victory ? "victory" : "ended")
  };
}

function normalizeSynergy(value: unknown): RunHistorySynergy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const item = value as Partial<RunHistorySynergy>;
  if (typeof item.id !== "string" || typeof item.title !== "string") {
    return null;
  }
  return {
    id: item.id,
    title: item.title,
    tier: item.tier === "advanced" || item.tier === "signature" || item.tier === "mythic" ? item.tier : "basic"
  };
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function createRunHistoryId(seed?: unknown): string {
  const time = typeof seed === "string" ? new Date(seed).getTime() : Date.now();
  const base = Number.isFinite(time) ? time : Date.now();
  return `run-${base.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isCharacterId(value: unknown): value is CharacterId {
  return value === "rio" || value === "maru" || value === "neon" || value === "cookie";
}

function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "normal" || value === "hard" || value === "pose-master";
}

function isPoseAssistLevel(value: unknown): value is PoseAssistLevel {
  return value === "relaxed" || value === "normal" || value === "strict";
}

function isGameMode(value: unknown): value is GameMode {
  return (
    value === "title" ||
    value === "quick-demo" ||
    value === "tutorial" ||
    value === "story" ||
    value === "adventure" ||
    value === "survival" ||
    value === "boss-rush" ||
    value === "training"
  );
}
