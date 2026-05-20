import type { AchievementId, CharacterId, CharacterSkinId, CoreId, EffectPaletteId, UnlockItemType } from "../simulation/types";
import { getAchievementDefinition, getAchievementProgress } from "./achievements";
import type { ProgressSnapshot } from "./progression";

export interface UnlockProgress {
  condition: string;
  current: number;
  target: number;
  label: string;
  percent: number;
  completed: boolean;
}

export interface UnlockConditionDefinition {
  itemType: UnlockItemType;
  itemId: CoreId | CharacterSkinId | EffectPaletteId;
  condition: string;
  getProgress: (snapshot: ProgressSnapshot) => UnlockProgress;
}

function progress(condition: string, current: number, target: number, unit: string): UnlockProgress {
  const safeTarget = Math.max(1, target);
  const safeCurrent = Math.max(0, current);
  return {
    condition,
    current: safeCurrent,
    target: safeTarget,
    label: `${Math.min(safeCurrent, safeTarget)}/${safeTarget}${unit}`,
    percent: Math.min(100, (safeCurrent / safeTarget) * 100),
    completed: safeCurrent >= safeTarget
  };
}

function granted(condition = "기본 지급"): (snapshot: ProgressSnapshot) => UnlockProgress {
  return () => progress(condition, 1, 1, "");
}

function totalPerfectCasts(snapshot: ProgressSnapshot): number {
  return Object.values(snapshot.characters).reduce((sum, character) => sum + character.perfectCasts, 0);
}

function maxSkillUses(snapshot: ProgressSnapshot): number {
  return Object.values(snapshot.skills).reduce((max, skill) => Math.max(max, skill.uses), 0);
}

function characterLevel(snapshot: ProgressSnapshot, characterId: CharacterId): number {
  return snapshot.characters[characterId]?.level ?? 1;
}

function achievementCompleted(snapshot: ProgressSnapshot, achievementId: AchievementId): number {
  return snapshot.achievements[achievementId]?.completed ? 1 : 0;
}

function achievementUnlock(achievementId: AchievementId, condition: string): (snapshot: ProgressSnapshot) => UnlockProgress {
  return (snapshot) => {
    const definition = getAchievementDefinition(achievementId);
    if (!definition) {
      return progress(condition, 0, 1, "회");
    }
    const view = getAchievementProgress(snapshot, definition);
    return {
      condition,
      current: view.current,
      target: view.target,
      label: view.label,
      percent: view.percent,
      completed: achievementCompleted(snapshot, achievementId) > 0 || view.completed
    };
  };
}

export const UNLOCK_CONDITIONS: UnlockConditionDefinition[] = [
  {
    itemType: "core",
    itemId: "stability-core",
    condition: "기본 지급",
    getProgress: granted()
  },
  {
    itemType: "core",
    itemId: "echo-core",
    condition: "스토리 모드에서 1회 승리",
    getProgress: (snapshot) => progress("스토리 모드에서 1회 승리", snapshot.unlockStats.storyVictories, 1, "회")
  },
  {
    itemType: "core",
    itemId: "rhythm-core",
    condition: "Perfect Cast 총 30회",
    getProgress: (snapshot) => progress("Perfect Cast 총 30회", totalPerfectCasts(snapshot), 30, "회")
  },
  {
    itemType: "core",
    itemId: "guard-core",
    condition: "마루로 보스가 포함된 런 1회 클리어",
    getProgress: (snapshot) => progress("마루로 보스가 포함된 런 1회 클리어", snapshot.unlockStats.maruBossClears, 1, "회")
  },
  {
    itemType: "core",
    itemId: "rampage-core",
    condition: "체력 40% 이하 상태로 1회 승리",
    getProgress: (snapshot) => progress("체력 40% 이하 상태로 1회 승리", snapshot.unlockStats.lowHpVictories, 1, "회")
  },
  {
    itemType: "core",
    itemId: "focus-core",
    condition: "같은 스킬을 50회 사용",
    getProgress: (snapshot) => progress("같은 스킬을 50회 사용", maxSkillUses(snapshot), 50, "회")
  },
  {
    itemType: "effect",
    itemId: "classic",
    condition: "기본 지급",
    getProgress: granted()
  },
  {
    itemType: "effect",
    itemId: "neon-pop",
    condition: "업적 '퍼펙트 캐스터' 달성",
    getProgress: achievementUnlock("perfect-cast-100", "업적 '퍼펙트 캐스터' 달성")
  },
  {
    itemType: "effect",
    itemId: "gold-rush",
    condition: "업적 '루프시티 보스 정화' 달성",
    getProgress: achievementUnlock("all-bosses", "업적 '루프시티 보스 정화' 달성")
  },
  {
    itemType: "effect",
    itemId: "slime-soda",
    condition: "쿠키 Lv.5 달성",
    getProgress: (snapshot) => progress("쿠키 Lv.5 달성", characterLevel(snapshot, "cookie"), 5, "레벨")
  },
  ...skinUnlocks("rio", ["rio-default", "rio-racer", "rio-ninja"]),
  ...skinUnlocks("maru", ["maru-default", "maru-knight", "maru-pajama"]),
  ...skinUnlocks("neon", ["neon-default", "neon-hacker", "neon-idol"]),
  ...skinUnlocks("cookie", ["cookie-default", "cookie-patissier", "cookie-witch"])
];

export function getUnlockDefinition(
  itemType: UnlockItemType,
  itemId: CoreId | CharacterSkinId | EffectPaletteId
): UnlockConditionDefinition | null {
  return UNLOCK_CONDITIONS.find((condition) => condition.itemType === itemType && condition.itemId === itemId) ?? null;
}

export function getUnlockProgress(
  snapshot: ProgressSnapshot,
  itemType: UnlockItemType,
  itemId: CoreId | CharacterSkinId | EffectPaletteId
): UnlockProgress | null {
  return getUnlockDefinition(itemType, itemId)?.getProgress(snapshot) ?? null;
}

export function isUnlockConditionMet(snapshot: ProgressSnapshot, definition: UnlockConditionDefinition): boolean {
  return definition.getProgress(snapshot).completed;
}

function skinUnlocks(characterId: CharacterId, skinIds: CharacterSkinId[]): UnlockConditionDefinition[] {
  const characterName = characterLabel(characterId);
  return skinIds.map((skinId, index) => {
    const requiredLevel = index === 0 ? 1 : index === 1 ? 2 : 5;
    const linkedAchievement = skinAchievement(characterId, index);
    const condition = index === 0 ? "기본 지급" : linkedAchievement ? `업적 '${linkedAchievement.title}' 달성` : `${characterName} Lv.${requiredLevel} 달성`;
    return {
      itemType: "skin",
      itemId: skinId,
      condition,
      getProgress:
        index === 0
          ? granted()
          : linkedAchievement
            ? achievementUnlock(linkedAchievement.id, condition)
            : (snapshot: ProgressSnapshot) => progress(condition, characterLevel(snapshot, characterId), requiredLevel, "레벨")
    };
  });
}

function skinAchievement(characterId: CharacterId, index: number): { id: AchievementId; title: string } | null {
  if (index !== 2) {
    return null;
  }
  const achievements: Record<CharacterId, { id: AchievementId; title: string }> = {
    rio: { id: "rio-fast-clear", title: "번개 속달" },
    maru: { id: "maru-shield-300", title: "도깨비 성벽" },
    neon: { id: "neon-marked-100", title: "글리치 처형자" },
    cookie: { id: "cookie-slime-100", title: "슬라임 파티 셰프" }
  };
  return achievements[characterId];
}

function characterLabel(characterId: CharacterId): string {
  const labels: Record<CharacterId, string> = {
    rio: "리오",
    maru: "마루",
    neon: "네온",
    cookie: "쿠키"
  };
  return labels[characterId];
}
