import type { AchievementId, AchievementUnlock } from "../simulation/types";
import type { ProgressSnapshot } from "./progression";

export interface AchievementProgress {
  current: number;
  completed: boolean;
  completedAt: number | null;
}

export interface AchievementProgressView {
  current: number;
  target: number;
  label: string;
  percent: number;
  completed: boolean;
}

export interface AchievementDefinition {
  id: AchievementId;
  title: string;
  description: string;
  category: "캐스팅" | "클리어" | "보스" | "캐릭터" | "수집";
  target: number;
  rewardDescription?: string;
  getCurrent: (snapshot: ProgressSnapshot) => number;
}

const BOSS_TOTAL = 5;
const CORE_TOTAL = 6;

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    id: "perfect-cast-10",
    title: "자세가 살아있네",
    description: "퍼펙트 캐스트를 총 10회 성공합니다.",
    category: "캐스팅",
    target: 10,
    getCurrent: totalPerfectCasts
  },
  {
    id: "perfect-cast-100",
    title: "퍼펙트 캐스터",
    description: "퍼펙트 캐스트를 총 100회 성공합니다.",
    category: "캐스팅",
    target: 100,
    rewardDescription: "네온 팝 이펙트 팔레트 해금 조건",
    getCurrent: totalPerfectCasts
  },
  {
    id: "no-miss-stage-clear",
    title: "흔들림 없는 주문",
    description: "미스 없이 스테이지를 클리어합니다.",
    category: "클리어",
    target: 1,
    getCurrent: (snapshot) => snapshot.achievementStats.noMissStageClears
  },
  {
    id: "boss-pose-perfect",
    title: "보스 포즈 브레이커",
    description: "보스 포즈 브레이크를 퍼펙트로 카운터합니다.",
    category: "보스",
    target: 1,
    getCurrent: (snapshot) => snapshot.achievementStats.bossPosePerfectCounters
  },
  {
    id: "rio-fast-clear",
    title: "번개 속달",
    description: "리오로 5분 이내에 런을 클리어합니다.",
    category: "캐릭터",
    target: 1,
    rewardDescription: "리오 사이버 닌자 스킨 해금 조건",
    getCurrent: (snapshot) => snapshot.achievementStats.rioFastClears
  },
  {
    id: "maru-shield-300",
    title: "도깨비 성벽",
    description: "마루로 보호막 피해를 누적 300 흡수합니다.",
    category: "캐릭터",
    target: 300,
    rewardDescription: "마루 곰돌이 잠옷 스킨 해금 조건",
    getCurrent: (snapshot) => snapshot.achievementStats.maruShieldDamageAbsorbed
  },
  {
    id: "neon-marked-100",
    title: "글리치 처형자",
    description: "네온으로 표식이 있는 적을 100마리 처치합니다.",
    category: "캐릭터",
    target: 100,
    rewardDescription: "네온 글리치 아이돌 스킨 해금 조건",
    getCurrent: (snapshot) => snapshot.achievementStats.neonMarkedKills
  },
  {
    id: "cookie-slime-100",
    title: "슬라임 파티 셰프",
    description: "쿠키로 슬라임을 누적 100마리 소환합니다.",
    category: "캐릭터",
    target: 100,
    rewardDescription: "쿠키 마녀 요리사 스킨 해금 조건",
    getCurrent: (snapshot) => snapshot.achievementStats.cookieSlimesSummoned
  },
  {
    id: "survival-10",
    title: "10분의 움직임",
    description: "생존 모드에서 10분을 버티고 클리어합니다.",
    category: "클리어",
    target: 1,
    getCurrent: (snapshot) => snapshot.achievementStats.survivalTenMinuteClears
  },
  {
    id: "all-bosses",
    title: "루프시티 보스 정화",
    description: "드럼, 풍선 광대, 크리스탈 리플렉터, 미러, 제로 보스를 모두 처치합니다.",
    category: "보스",
    target: BOSS_TOTAL,
    rewardDescription: "골드 러시 이펙트 팔레트 해금 조건",
    getCurrent: (snapshot) => snapshot.achievementStats.defeatedBossTypes.length
  },
  {
    id: "all-cores",
    title: "모션 코어 컬렉터",
    description: "모든 모션 코어를 해금합니다.",
    category: "수집",
    target: CORE_TOTAL,
    getCurrent: (snapshot) => snapshot.unlockedCoreIds.length
  }
];

export function getAchievementDefinition(id: AchievementId): AchievementDefinition | null {
  return ACHIEVEMENTS.find((achievement) => achievement.id === id) ?? null;
}

export function getAchievementProgress(snapshot: ProgressSnapshot, definition: AchievementDefinition): AchievementProgressView {
  const current = Math.max(0, definition.getCurrent(snapshot));
  const target = Math.max(1, definition.target);
  return {
    current,
    target,
    label: `${Math.min(current, target)}/${target}`,
    percent: Math.min(100, (current / target) * 100),
    completed: current >= target
  };
}

export function createAchievementUnlock(definition: AchievementDefinition): AchievementUnlock {
  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    rewardDescription: definition.rewardDescription
  };
}

function totalPerfectCasts(snapshot: ProgressSnapshot): number {
  return Object.values(snapshot.characters).reduce((sum, character) => sum + character.perfectCasts, 0);
}
