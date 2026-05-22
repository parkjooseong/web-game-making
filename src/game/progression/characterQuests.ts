import type { CharacterId } from "../simulation/types";

export type CharacterQuestObjectiveMode = "add" | "max" | "complete";

export interface CharacterQuestObjectiveDefinition {
  id: string;
  title: string;
  description: string;
  target: number;
  rewardText: string;
}

export interface CharacterQuestLineDefinition {
  id: string;
  characterId: CharacterId;
  title: string;
  description: string;
  cosmeticRewardText: string;
  objectives: CharacterQuestObjectiveDefinition[];
}

export interface CharacterQuestObjectiveProgress {
  current: number;
  completed: boolean;
  completedAt: number | null;
}

export interface CharacterQuestLineProgress {
  completed: boolean;
  completedAt: number | null;
  rewardText: string;
  objectives: Record<string, CharacterQuestObjectiveProgress>;
}

export type CharacterQuestProgress = Record<CharacterId, CharacterQuestLineProgress>;

export interface CharacterQuestUnlock {
  characterId: CharacterId;
  questId: string;
  questTitle: string;
  objectiveId: string;
  objectiveTitle: string;
  rewardText: string;
  completedLine: boolean;
}

export const CHARACTER_QUEST_LINES: CharacterQuestLineDefinition[] = [
  {
    id: "rio-lightning-delivery-route",
    characterId: "rio",
    title: "번개 배달 루트",
    description: "리오의 속도와 오버드라이브를 완성하는 장기 목표입니다.",
    cosmeticRewardText: "리오 전용 컷인 콘셉트: 번개 배송 완료",
    objectives: [
      {
        id: "rio-lightning-dash-kills",
        title: "번개 관통 배송",
        description: "라이트닝 대시로 적 20마리 처치",
        target: 20,
        rewardText: "리오 대시 잔상 코스메틱 예약"
      },
      {
        id: "rio-fast-clear",
        title: "5분 배송 보증",
        description: "리오로 5분 안에 스테이지 또는 런 클리어",
        target: 1,
        rewardText: "리오 클리어 포즈 대사 예약"
      },
      {
        id: "rio-overdrive-boss",
        title: "번개까지 같이 왔어",
        description: "오버드라이브 중 보스 처치",
        target: 1,
        rewardText: "리오 오버드라이브 컷인 예약"
      }
    ]
  },
  {
    id: "maru-never-step-back",
    characterId: "maru",
    title: "무서워도 안 물러나",
    description: "마루가 막고 버티고 반격하는 수호자 루트입니다.",
    cosmeticRewardText: "마루 전용 컷인 콘셉트: 도깨비 성벽",
    objectives: [
      {
        id: "maru-guard-perfects",
        title: "완벽한 도깨비 가드",
        description: "가드 퍼펙트 10회",
        target: 10,
        rewardText: "마루 방패 문양 코스메틱 예약"
      },
      {
        id: "maru-shield-absorb",
        title: "내가 막을게",
        description: "보호막 피해 300 흡수",
        target: 300,
        rewardText: "마루 보호막 색상 예약"
      },
      {
        id: "maru-low-hp-boss-clear",
        title: "마지막까지 버티기",
        description: "체력 30% 이하로 보스 클리어",
        target: 1,
        rewardText: "마루 저체력 승리 대사 예약"
      }
    ]
  },
  {
    id: "neon-undeletable-error",
    characterId: "neon",
    title: "삭제할 수 없는 오류",
    description: "네온의 표식, 함정, 블랙아웃 처형 루트입니다.",
    cosmeticRewardText: "네온 전용 컷인 콘셉트: 오류 삭제",
    objectives: [
      {
        id: "neon-marked-kills",
        title: "표식 삭제",
        description: "표식 적 50마리 처치",
        target: 50,
        rewardText: "네온 표식 글리치 팔레트 예약"
      },
      {
        id: "neon-trap-overlaps",
        title: "중첩 폭발",
        description: "트랩 중첩 폭발 10회",
        target: 10,
        rewardText: "네온 함정 이펙트 예약"
      },
      {
        id: "neon-blackout-boss",
        title: "블랙아웃 처형",
        description: "Blackout으로 보스 처치",
        target: 1,
        rewardText: "네온 블랙아웃 컷인 예약"
      }
    ]
  },
  {
    id: "cookie-slime-party-recipe",
    characterId: "cookie",
    title: "슬라임 파티 레시피",
    description: "쿠키의 소환수와 대왕 슬라임 파티 루트입니다.",
    cosmeticRewardText: "쿠키 전용 컷인 콘셉트: 대왕 슬라임 파티",
    objectives: [
      {
        id: "cookie-slimes-summoned",
        title: "친구들, 출동!",
        description: "슬라임 50마리 소환",
        target: 50,
        rewardText: "쿠키 슬라임 외형 예약"
      },
      {
        id: "cookie-seven-slimes-run",
        title: "북적이는 주방",
        description: "한 판에 슬라임 7마리 유지",
        target: 7,
        rewardText: "쿠키 슬라임 파티 승리 포즈 예약"
      },
      {
        id: "cookie-big-slime-boss",
        title: "압살 레시피",
        description: "대왕 슬라임으로 보스 처치",
        target: 1,
        rewardText: "쿠키 대왕 슬라임 컷인 예약"
      }
    ]
  }
];

export function getCharacterQuestLine(characterId: CharacterId): CharacterQuestLineDefinition {
  return CHARACTER_QUEST_LINES.find((line) => line.characterId === characterId) ?? CHARACTER_QUEST_LINES[0];
}

export function createDefaultCharacterQuestProgress(): CharacterQuestProgress {
  return Object.fromEntries(
    CHARACTER_QUEST_LINES.map((line) => [
      line.characterId,
      {
        completed: false,
        completedAt: null,
        rewardText: line.cosmeticRewardText,
        objectives: Object.fromEntries(
          line.objectives.map((objective) => [
            objective.id,
            {
              current: 0,
              completed: false,
              completedAt: null
            }
          ])
        )
      }
    ])
  ) as CharacterQuestProgress;
}

export function normalizeCharacterQuestProgress(input?: Partial<CharacterQuestProgress>): CharacterQuestProgress {
  const fallback = createDefaultCharacterQuestProgress();
  const normalized = createDefaultCharacterQuestProgress();

  for (const line of CHARACTER_QUEST_LINES) {
    const existingLine = input?.[line.characterId];
    const nextLine = normalized[line.characterId];
    nextLine.rewardText =
      typeof existingLine?.rewardText === "string" && existingLine.rewardText.length > 0
        ? existingLine.rewardText
        : fallback[line.characterId].rewardText;

    for (const objective of line.objectives) {
      const existing = existingLine?.objectives?.[objective.id];
      const next = nextLine.objectives[objective.id];
      next.current = Math.min(objective.target, Math.max(0, Math.floor(existing?.current ?? 0)));
      next.completed = Boolean(existing?.completed || next.current >= objective.target);
      next.completedAt = typeof existing?.completedAt === "number" ? existing.completedAt : next.completed ? Date.now() : null;
    }

    nextLine.completed = line.objectives.every((objective) => nextLine.objectives[objective.id]?.completed);
    nextLine.completedAt = typeof existingLine?.completedAt === "number" ? existingLine.completedAt : nextLine.completed ? Date.now() : null;
  }

  return normalized;
}

export function updateCharacterQuestObjective(
  progress: CharacterQuestProgress,
  characterId: CharacterId,
  objectiveId: string,
  amount: number,
  mode: CharacterQuestObjectiveMode = "add"
): CharacterQuestUnlock[] {
  const line = getCharacterQuestLine(characterId);
  const objective = line.objectives.find((item) => item.id === objectiveId);
  const lineProgress = progress[characterId];
  const objectiveProgress = lineProgress?.objectives[objectiveId];

  if (!objective || !lineProgress || !objectiveProgress || objectiveProgress.completed) {
    return [];
  }

  const previousLineCompleted = lineProgress.completed;
  if (mode === "complete") {
    objectiveProgress.current = objective.target;
  } else if (mode === "max") {
    objectiveProgress.current = Math.max(objectiveProgress.current, Math.floor(amount));
  } else {
    objectiveProgress.current += Math.max(0, Math.floor(amount));
  }
  objectiveProgress.current = Math.min(objective.target, objectiveProgress.current);

  const unlocks: CharacterQuestUnlock[] = [];
  if (objectiveProgress.current >= objective.target) {
    objectiveProgress.completed = true;
    objectiveProgress.completedAt = Date.now();
    const completedLine = line.objectives.every((item) => lineProgress.objectives[item.id]?.completed);
    if (completedLine) {
      lineProgress.completed = true;
      lineProgress.completedAt = Date.now();
    }
    unlocks.push({
      characterId,
      questId: line.id,
      questTitle: line.title,
      objectiveId: objective.id,
      objectiveTitle: objective.title,
      rewardText: completedLine && !previousLineCompleted ? line.cosmeticRewardText : objective.rewardText,
      completedLine: completedLine && !previousLineCompleted
    });
  }

  return unlocks;
}
