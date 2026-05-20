import type { RewardTag } from "./rewards";
import { getRewardDefinition } from "./rewards";
import type { ActiveSynergyState, CharacterId } from "../simulation/types";

export interface SynergyDefinition {
  id: string;
  title: string;
  description: string;
  activeEffect: string;
  characterId: CharacterId | null;
  tag: RewardTag;
  requiredCount: number;
}

export const SYNERGIES: SynergyDefinition[] = [
  {
    id: "rio-delivery-route",
    title: "번개 배달 루트",
    description: "리오가 대시 태그 카드를 3장 이상 모았습니다.",
    activeEffect: "대시 후 스킬 사용 시 가까운 적에게 추가 번개 피해를 줍니다.",
    characterId: "rio",
    tag: "dash",
    requiredCount: 3
  },
  {
    id: "maru-oni-wall",
    title: "도깨비 성벽",
    description: "마루가 보호막 태그 카드를 4장 이상 모았습니다.",
    activeEffect: "보호막이 50 이상이면 주변 적을 천천히 밀어냅니다.",
    characterId: "maru",
    tag: "shield",
    requiredCount: 4
  },
  {
    id: "neon-glitch-executor",
    title: "글리치 처형자",
    description: "네온이 표식 태그 카드를 4장 이상 모았습니다.",
    activeEffect: "표식 적 처치 시 가까운 적에게 표식이 전이됩니다.",
    characterId: "neon",
    tag: "mark",
    requiredCount: 4
  },
  {
    id: "cookie-slime-party-chef",
    title: "슬라임 파티 셰프",
    description: "쿠키가 소환 태그 카드를 4장 이상 모았습니다.",
    activeEffect: "소환수가 5마리 이상이면 소환수 공격 속도가 증가합니다.",
    characterId: "cookie",
    tag: "summon",
    requiredCount: 4
  },
  {
    id: "perfect-caster",
    title: "퍼펙트 캐스터",
    description: "Perfect 태그 카드를 4장 이상 모았습니다.",
    activeEffect: "Perfect Cast 성공 시 추가 점수를 얻습니다.",
    characterId: null,
    tag: "perfect",
    requiredCount: 4
  },
  {
    id: "core-runaway",
    title: "코어 폭주",
    description: "게이지 태그 카드를 4장 이상 모았습니다.",
    activeEffect: "게이지가 90 이상이면 스킬 피해가 증가합니다.",
    characterId: null,
    tag: "gauge",
    requiredCount: 4
  }
];

export function calculateActiveSynergies(characterId: CharacterId, rewardIds: string[]): ActiveSynergyState[] {
  const tagCounts = countRewardTags(rewardIds);
  return SYNERGIES.filter((synergy) => {
    const characterMatches = synergy.characterId === null || synergy.characterId === characterId;
    return characterMatches && (tagCounts[synergy.tag] ?? 0) >= synergy.requiredCount;
  }).map(({ id, title, description, activeEffect }) => ({
    id,
    title,
    description,
    activeEffect
  }));
}

export function countRewardTags(rewardIds: string[]): Partial<Record<RewardTag, number>> {
  const counts: Partial<Record<RewardTag, number>> = {};
  for (const rewardId of rewardIds) {
    const reward = getRewardDefinition(rewardId);
    if (!reward) {
      continue;
    }
    for (const tag of reward.tags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}
