import type { RewardTag } from "./rewards";
import { getRewardDefinition } from "./rewards";
import type { ActiveSynergyState, CharacterId, SynergyTier } from "../simulation/types";

export interface SynergyDefinition {
  id: string;
  title: string;
  description: string;
  activeEffect: string;
  tier: SynergyTier;
  characterId: CharacterId | null;
  tag?: RewardTag;
  requiredCount?: number;
  requiredTags?: Partial<Record<RewardTag, number>>;
}

export const synergyTierLabels: Record<SynergyTier, string> = {
  basic: "BASIC",
  advanced: "ADV",
  signature: "SIGNATURE",
  mythic: "MYTHIC"
};

export const SYNERGIES: SynergyDefinition[] = [
  {
    id: "rio-delivery-route",
    title: "번개 배달 루트",
    description: "리오가 대시 태그 카드를 3장 이상 모았습니다.",
    activeEffect: "대시 후 스킬 사용 시 가까운 적에게 추가 번개 피해를 줍니다.",
    tier: "basic",
    characterId: "rio",
    tag: "dash",
    requiredCount: 3
  },
  {
    id: "maru-oni-wall",
    title: "도깨비 성벽",
    description: "마루가 보호막 태그 카드를 4장 이상 모았습니다.",
    activeEffect: "보호막이 50 이상이면 주변 적을 천천히 밀어냅니다.",
    tier: "basic",
    characterId: "maru",
    tag: "shield",
    requiredCount: 4
  },
  {
    id: "neon-glitch-executor",
    title: "글리치 처형자",
    description: "네온이 표식 태그 카드를 4장 이상 모았습니다.",
    activeEffect: "표식 적 처치 시 가까운 적에게 표식이 전이됩니다.",
    tier: "basic",
    characterId: "neon",
    tag: "mark",
    requiredCount: 4
  },
  {
    id: "cookie-slime-party-chef",
    title: "슬라임 파티 셰프",
    description: "쿠키가 소환 태그 카드를 4장 이상 모았습니다.",
    activeEffect: "소환수가 5마리 이상이면 소환수 공격 속도가 증가합니다.",
    tier: "basic",
    characterId: "cookie",
    tag: "summon",
    requiredCount: 4
  },
  {
    id: "perfect-caster",
    title: "퍼펙트 캐스터",
    description: "퍼펙트 태그 카드를 4장 이상 모았습니다.",
    activeEffect: "퍼펙트 캐스트 성공 시 추가 점수를 얻습니다.",
    tier: "basic",
    characterId: null,
    tag: "perfect",
    requiredCount: 4
  },
  {
    id: "core-runaway",
    title: "코어 폭주",
    description: "게이지 태그 카드를 4장 이상 모았습니다.",
    activeEffect: "게이지가 90 이상이면 스킬 피해가 증가합니다.",
    tier: "basic",
    characterId: null,
    tag: "gauge",
    requiredCount: 4
  },
  {
    id: "rio-chain-master",
    title: "번개 체인 마스터",
    description: "리오가 스킬 태그 4개와 광역 태그 2개를 함께 모았습니다.",
    activeEffect: "체인 볼트가 추가 대상에게 튀고, 광역 스킬 피해가 소폭 증가합니다.",
    tier: "signature",
    characterId: "rio",
    requiredTags: { skill: 4, area: 2 }
  },
  {
    id: "maru-absolute-line",
    title: "절대 방어선",
    description: "마루가 보호막 태그 카드를 5장 이상 모았습니다.",
    activeEffect: "보호막이 높을 때 짧은 간격으로 주변 적에게 방패 압력을 줍니다.",
    tier: "signature",
    characterId: "maru",
    requiredTags: { shield: 5 }
  },
  {
    id: "neon-hacking-field",
    title: "해킹 필드",
    description: "네온이 함정 태그 3개와 표식 태그 3개를 함께 모았습니다.",
    activeEffect: "함정이 표식 적을 더 강하게 태우고 주변 노이즈에 표식을 퍼뜨립니다.",
    tier: "signature",
    characterId: "neon",
    requiredTags: { trap: 3, mark: 3 }
  },
  {
    id: "cookie-jelly-kingdom",
    title: "젤리 왕국",
    description: "쿠키가 소환 태그 카드를 5장 이상 모았습니다.",
    activeEffect: "소환수가 충분하면 슬라임 피해가 오르고 플레이어 보호막이 천천히 보강됩니다.",
    tier: "signature",
    characterId: "cookie",
    requiredTags: { summon: 5 }
  },
  {
    id: "perfectionist",
    title: "완벽주의자",
    description: "퍼펙트 태그 카드를 5장 이상 모았습니다.",
    activeEffect: "퍼펙트 캐스트가 추가 점수와 짧은 쿨타임 보너스를 줍니다.",
    tier: "advanced",
    characterId: null,
    requiredTags: { perfect: 5 }
  },
  {
    id: "dangerous-choice",
    title: "위험한 선택",
    description: "보스 태그 3개와 생존 태그 2개를 함께 모았습니다.",
    activeEffect: "보스에게 주는 피해가 증가하지만 체력이 낮을 때만 방어 보너스가 켜집니다.",
    tier: "mythic",
    characterId: null,
    requiredTags: { boss: 3, survival: 2 }
  },
  {
    id: "basic-attack-expert",
    title: "기본 공격 전문가",
    description: "기본 공격 태그 카드를 5장 이상 모았습니다.",
    activeEffect: "기본 공격이 더 빠르게 발사되고 일정 간격으로 보조 탄환을 추가합니다.",
    tier: "advanced",
    characterId: null,
    requiredTags: { basic: 5 }
  },
  {
    id: "area-sweeper",
    title: "광역 청소부",
    description: "광역 태그 카드를 5장 이상 모았습니다.",
    activeEffect: "광역 스킬 범위가 커지고 적 처치 시 작은 청소 폭발이 발생합니다.",
    tier: "advanced",
    characterId: null,
    requiredTags: { area: 5 }
  },
  {
    id: "fast-hands-route",
    title: "빠른 손 루트",
    description: "쿨감 태그 4개와 퍼펙트 태그 2개를 함께 모았습니다.",
    activeEffect: "퍼펙트 캐스트 시 모든 스킬 쿨타임이 조금 더 줄어듭니다.",
    tier: "advanced",
    characterId: null,
    requiredTags: { cooldown: 4, perfect: 2 }
  },
  {
    id: "survival-caster",
    title: "생존형 캐스터",
    description: "생존 태그 4개와 보호막 태그 2개를 함께 모았습니다.",
    activeEffect: "피해를 받으면 짧은 보호막 회복과 게이지 보정이 발동합니다.",
    tier: "advanced",
    characterId: null,
    requiredTags: { survival: 4, shield: 2 }
  }
];

export function calculateActiveSynergies(characterId: CharacterId, rewardIds: string[]): ActiveSynergyState[] {
  const tagCounts = countRewardTags(rewardIds);
  return SYNERGIES.filter((synergy) => {
    const characterMatches = synergy.characterId === null || synergy.characterId === characterId;
    return characterMatches && synergyRequirementMet(synergy, tagCounts);
  }).map(({ id, title, description, activeEffect, tier }) => ({
    id,
    title,
    description,
    activeEffect,
    tier
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

export function getSynergyRequiredTags(synergy: SynergyDefinition): Partial<Record<RewardTag, number>> {
  if (synergy.requiredTags) {
    return synergy.requiredTags;
  }
  if (synergy.tag && synergy.requiredCount) {
    return { [synergy.tag]: synergy.requiredCount };
  }
  return {};
}

export function synergyRequirementMet(synergy: SynergyDefinition, tagCounts: Partial<Record<RewardTag, number>>): boolean {
  const requiredTags = getSynergyRequiredTags(synergy);
  return Object.entries(requiredTags).every(([tag, count]) => (tagCounts[tag as RewardTag] ?? 0) >= count);
}
