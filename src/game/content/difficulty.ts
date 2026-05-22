import type { Difficulty, GameMode } from "../simulation/types";

export interface DifficultyModifiers {
  enemyHpMultiplier: number;
  enemySpeedMultiplier: number;
  bossChallengeTimeBonus: number;
  scoreMultiplier: number;
  perfectDamageMultiplier: number;
  missCooldownMultiplier: number;
}

export interface DifficultyDefinition {
  id: Difficulty;
  title: string;
  shortLabel: string;
  description: string;
  effects: string[];
  modifiers: DifficultyModifiers;
}

export const DIFFICULTIES: DifficultyDefinition[] = [
  {
    id: "easy",
    title: "쉬움",
    shortLabel: "쉬움",
    description: "포즈 캐스트와 보스 패턴을 익히기 좋은 완화 난이도입니다.",
    effects: ["적 체력 -15%", "적 속도 -10%", "보스 포즈 브레이크 +0.5초", "점수 -10%", "미스 쿨타임 손실 감소"],
    modifiers: {
      enemyHpMultiplier: 0.85,
      enemySpeedMultiplier: 0.9,
      bossChallengeTimeBonus: 0.5,
      scoreMultiplier: 0.9,
      perfectDamageMultiplier: 1,
      missCooldownMultiplier: 0.7
    }
  },
  {
    id: "normal",
    title: "기본",
    shortLabel: "기본",
    description: "기획 기준이 되는 기본 난이도입니다.",
    effects: ["기본 밸런스"],
    modifiers: {
      enemyHpMultiplier: 1,
      enemySpeedMultiplier: 1,
      bossChallengeTimeBonus: 0,
      scoreMultiplier: 1,
      perfectDamageMultiplier: 1,
      missCooldownMultiplier: 1
    }
  },
  {
    id: "hard",
    title: "어려움",
    shortLabel: "어려움",
    description: "적이 더 단단하고 빨라지는 대신 점수 보너스가 붙습니다.",
    effects: ["적 체력 +25%", "적 속도 +15%", "보스 포즈 브레이크 -0.3초", "점수 +25%"],
    modifiers: {
      enemyHpMultiplier: 1.25,
      enemySpeedMultiplier: 1.15,
      bossChallengeTimeBonus: -0.3,
      scoreMultiplier: 1.25,
      perfectDamageMultiplier: 1,
      missCooldownMultiplier: 1
    }
  },
  {
    id: "pose-master",
    title: "포즈 마스터",
    shortLabel: "포즈",
    description: "정확한 포즈를 강하게 보상하지만 실수 패널티도 커지는 고난도입니다.",
    effects: ["퍼펙트 피해 +50%", "미스 패널티 증가", "보스 포즈 브레이크 -0.2초", "점수 +50%"],
    modifiers: {
      enemyHpMultiplier: 1,
      enemySpeedMultiplier: 1,
      bossChallengeTimeBonus: -0.2,
      scoreMultiplier: 1.5,
      perfectDamageMultiplier: 1.5,
      missCooldownMultiplier: 1.4
    }
  }
];

export function getDifficultyDefinition(difficulty: Difficulty): DifficultyDefinition {
  return DIFFICULTIES.find((item) => item.id === difficulty) ?? DIFFICULTIES[1];
}

export function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "normal" || value === "hard" || value === "pose-master";
}

export function shouldApplyDifficulty(mode: GameMode): boolean {
  return mode !== "title" && mode !== "tutorial" && mode !== "training";
}

export function getAppliedDifficultyModifiers(difficulty: Difficulty, mode: GameMode): DifficultyModifiers {
  if (mode === "tutorial" || mode === "training") {
    return getDifficultyDefinition("easy").modifiers;
  }
  return shouldApplyDifficulty(mode) ? getDifficultyDefinition(difficulty).modifiers : getDifficultyDefinition("normal").modifiers;
}
