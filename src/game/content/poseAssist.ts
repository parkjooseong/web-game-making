import type { GameMode, PoseAssistLevel } from "../simulation/types";

export interface PoseAssistModifiers {
  scoreBonus: number;
  perfectThreshold: number;
  greatThreshold: number;
  normalThreshold: number;
  confidenceBonus: number;
}

export interface PoseAssistDefinition {
  id: PoseAssistLevel;
  title: string;
  shortLabel: string;
  description: string;
  effects: string[];
  modifiers: PoseAssistModifiers;
}

export const POSE_ASSIST_LEVELS: PoseAssistDefinition[] = [
  {
    id: "relaxed",
    title: "관대",
    shortLabel: "관대",
    description: "카메라 환경이 불안정해도 실패 부담을 줄여요.",
    effects: ["포즈 점수 +10", "미스 기준 완화", "훈련장/튜토리얼 기본"],
    modifiers: {
      scoreBonus: 10,
      perfectThreshold: 90,
      greatThreshold: 65,
      normalThreshold: 30,
      confidenceBonus: 0.08
    }
  },
  {
    id: "normal",
    title: "기본",
    shortLabel: "기본",
    description: "일반 플레이에 맞춘 기본 판정입니다.",
    effects: ["기본 점수", "기본 판정선"],
    modifiers: {
      scoreBonus: 0,
      perfectThreshold: 90,
      greatThreshold: 70,
      normalThreshold: 40,
      confidenceBonus: 0
    }
  },
  {
    id: "strict",
    title: "엄격",
    shortLabel: "엄격",
    description: "더 정확한 포즈를 요구하는 도전 판정입니다.",
    effects: ["퍼펙트 기준 상승", "점수 보정 없음", "결과 화면에 엄격 표시"],
    modifiers: {
      scoreBonus: 0,
      perfectThreshold: 95,
      greatThreshold: 76,
      normalThreshold: 48,
      confidenceBonus: 0
    }
  }
];

export function getPoseAssistDefinition(level: PoseAssistLevel): PoseAssistDefinition {
  return POSE_ASSIST_LEVELS.find((item) => item.id === level) ?? POSE_ASSIST_LEVELS[1];
}

export function isPoseAssistLevel(value: unknown): value is PoseAssistLevel {
  return value === "relaxed" || value === "normal" || value === "strict";
}

export function getEffectivePoseAssistLevel(level: PoseAssistLevel, mode: GameMode): PoseAssistLevel {
  if (mode === "tutorial" || mode === "training") {
    return "relaxed";
  }
  return level;
}

export function getPoseAssistModifiers(level: PoseAssistLevel, mode: GameMode): PoseAssistModifiers {
  return getPoseAssistDefinition(getEffectivePoseAssistLevel(level, mode)).modifiers;
}
