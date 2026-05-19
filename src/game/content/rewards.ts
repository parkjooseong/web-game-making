import type { CharacterId } from "../simulation/types";

export type RewardRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type RewardTag =
  | "attack"
  | "skill"
  | "cooldown"
  | "gauge"
  | "survival"
  | "dash"
  | "perfect"
  | "basic"
  | "area"
  | "boss"
  | "shield"
  | "summon"
  | "mark"
  | "trap"
  | "ultimate";

export interface RewardDefinition {
  id: string;
  title: string;
  description: string;
  rarity: RewardRarity;
  characterId: CharacterId | null;
  tags: RewardTag[];
  maxStacks: number;
}

export const rarityLabels: Record<RewardRarity, string> = {
  common: "COMMON",
  uncommon: "UNCOMMON",
  rare: "RARE",
  epic: "EPIC",
  legendary: "LEGEND"
};

export const REWARDS: RewardDefinition[] = [
  {
    id: "perfect-tempo",
    title: "완벽한 자세",
    description: "Perfect Cast 시 현재 스킬 쿨타임을 35% 돌려받습니다.",
    rarity: "rare",
    characterId: null,
    tags: ["perfect", "cooldown"],
    maxStacks: 1
  },
  {
    id: "runner-current",
    title: "움직임의 피",
    description: "대시 후 2초 동안 모든 스킬 피해량 +25%.",
    rarity: "uncommon",
    characterId: null,
    tags: ["dash", "skill"],
    maxStacks: 3
  },
  {
    id: "noise-absorb",
    title: "노이즈 흡수",
    description: "적 처치 시 스킬 게이지 획득량 +45%.",
    rarity: "uncommon",
    characterId: null,
    tags: ["gauge"],
    maxStacks: 3
  },
  {
    id: "spark-hands",
    title: "빠른 손끝",
    description: "기본 공격 속도 +18%, 기본 탄환 속도 +10%.",
    rarity: "common",
    characterId: null,
    tags: ["basic", "attack"],
    maxStacks: 4
  },
  {
    id: "charged-heart",
    title: "전력 충전",
    description: "최대 체력 +20, 즉시 20 회복합니다.",
    rarity: "common",
    characterId: null,
    tags: ["survival"],
    maxStacks: 4
  },
  {
    id: "combo-battery",
    title: "콤보 배터리",
    description: "Perfect 2연속 보너스 게이지가 더 많이 차오릅니다.",
    rarity: "rare",
    characterId: null,
    tags: ["perfect", "gauge"],
    maxStacks: 2
  },
  {
    id: "motion-resonance",
    title: "모션 공명",
    description: "모든 피해량 +12%. 단순하지만 어떤 빌드에도 잘 붙습니다.",
    rarity: "common",
    characterId: null,
    tags: ["attack"],
    maxStacks: 5
  },
  {
    id: "core-pocket",
    title: "예비 코어 포켓",
    description: "최대 스킬 게이지 +20, 즉시 20 충전합니다.",
    rarity: "uncommon",
    characterId: null,
    tags: ["gauge"],
    maxStacks: 3
  },
  {
    id: "quick-reset",
    title: "빠른 재정렬",
    description: "모든 스킬 쿨타임이 8% 짧아집니다.",
    rarity: "uncommon",
    characterId: null,
    tags: ["cooldown"],
    maxStacks: 4
  },
  {
    id: "cast-amplifier",
    title: "캐스트 증폭기",
    description: "포즈 스킬 피해량 +16%.",
    rarity: "rare",
    characterId: null,
    tags: ["skill", "attack"],
    maxStacks: 3
  },
  {
    id: "wide-gesture",
    title: "거대한 손짓",
    description: "스킬 범위와 판정 폭 +10%.",
    rarity: "uncommon",
    characterId: null,
    tags: ["area", "skill"],
    maxStacks: 4
  },
  {
    id: "safe-failure",
    title: "안전 보정",
    description: "Miss 때 잃는 쿨타임이 35% 감소합니다.",
    rarity: "common",
    characterId: null,
    tags: ["cooldown", "survival"],
    maxStacks: 2
  },
  {
    id: "last-stand",
    title: "마지막 박자",
    description: "체력이 45% 이하일 때 피해량 +28%.",
    rarity: "rare",
    characterId: null,
    tags: ["survival", "attack"],
    maxStacks: 2
  },
  {
    id: "kinetic-heal",
    title: "운동 회복",
    description: "대시할 때마다 작은 보호막을 얻고 체력을 2 회복합니다.",
    rarity: "uncommon",
    characterId: null,
    tags: ["dash", "survival"],
    maxStacks: 3
  },
  {
    id: "shield-spark",
    title: "보호막 스파크",
    description: "보호막이 있을 때 피해량 +18%.",
    rarity: "uncommon",
    characterId: null,
    tags: ["shield", "attack"],
    maxStacks: 3
  },
  {
    id: "focus-route",
    title: "집중 루트",
    description: "같은 스킬을 연속 시전할 때마다 추가 피해가 커집니다.",
    rarity: "rare",
    characterId: null,
    tags: ["skill", "attack"],
    maxStacks: 2
  },
  {
    id: "rapid-reload",
    title: "자동 장전",
    description: "기본 공격 속도 +25%.",
    rarity: "common",
    characterId: null,
    tags: ["basic", "attack"],
    maxStacks: 4
  },
  {
    id: "battery-heart",
    title: "배터리 심장",
    description: "최대 체력 +10, 최대 게이지 +10.",
    rarity: "common",
    characterId: null,
    tags: ["survival", "gauge"],
    maxStacks: 5
  },
  {
    id: "perfect-discipline",
    title: "완벽한 호흡",
    description: "Perfect Cast 성공 시 게이지를 추가로 8 회복합니다.",
    rarity: "rare",
    characterId: null,
    tags: ["perfect", "gauge"],
    maxStacks: 3
  },
  {
    id: "wave-cleaner",
    title: "스웜 청소기",
    description: "스웜과 러너에게 주는 피해 +24%.",
    rarity: "common",
    characterId: null,
    tags: ["attack"],
    maxStacks: 3
  },
  {
    id: "elite-hunter",
    title: "엘리트 헌터",
    description: "탱커와 보스에게 주는 피해 +22%.",
    rarity: "rare",
    characterId: null,
    tags: ["boss", "attack"],
    maxStacks: 3
  },
  {
    id: "score-hunter",
    title: "하이 스코어 루트",
    description: "적 처치 점수 +20%, 보상 선택 직후 게이지 +10.",
    rarity: "common",
    characterId: null,
    tags: ["gauge"],
    maxStacks: 4
  },
  {
    id: "forked-slash",
    title: "번개 잔상",
    description: "스파크 슬래시 피해량 +20%, Perfect 시 검기가 한 번 더 터집니다.",
    rarity: "uncommon",
    characterId: "rio",
    tags: ["skill", "attack", "area"],
    maxStacks: 4
  },
  {
    id: "chain-overload",
    title: "체인 과충전",
    description: "체인 볼트가 추가 대상 2명을 더 타격합니다.",
    rarity: "rare",
    characterId: "rio",
    tags: ["skill", "area"],
    maxStacks: 3
  },
  {
    id: "delivery-guard",
    title: "배달 보호막",
    description: "라이트닝 대시를 사용하면 짧은 보호막을 얻습니다.",
    rarity: "common",
    characterId: "rio",
    tags: ["dash", "shield"],
    maxStacks: 3
  },
  {
    id: "overdrive-loop",
    title: "오버드라이브 루프",
    description: "썬더 오버드라이브 지속시간 +2초, 오버드라이브 중 피해량 +15%.",
    rarity: "rare",
    characterId: "rio",
    tags: ["ultimate", "attack"],
    maxStacks: 3
  },
  {
    id: "thunder-fork",
    title: "갈라지는 낙뢰",
    description: "체인 볼트 피해 +18%, 연쇄 감쇠가 줄어듭니다.",
    rarity: "uncommon",
    characterId: "rio",
    tags: ["skill", "attack"],
    maxStacks: 3
  },
  {
    id: "courier-boosters",
    title: "배달 부스터",
    description: "라이트닝 대시 거리 +20%, 대시 판정 폭 +10%.",
    rarity: "uncommon",
    characterId: "rio",
    tags: ["dash", "skill"],
    maxStacks: 3
  },
  {
    id: "blue-afterimage",
    title: "푸른 잔광",
    description: "스파크 슬래시 사거리 +16%, 폭 +12%.",
    rarity: "common",
    characterId: "rio",
    tags: ["skill", "area"],
    maxStacks: 3
  },
  {
    id: "static-routing",
    title: "정전기 경로",
    description: "체인 볼트가 추가 대상 1명을 더 타격하고 피해 +8%.",
    rarity: "common",
    characterId: "rio",
    tags: ["skill", "area"],
    maxStacks: 4
  },
  {
    id: "voltage-rush",
    title: "전압 러시",
    description: "대시 후 스킬 피해 보너스가 더 강해집니다.",
    rarity: "rare",
    characterId: "rio",
    tags: ["dash", "skill", "attack"],
    maxStacks: 2
  },
  {
    id: "air-splitting-slash",
    title: "공기 가르기",
    description: "스파크 슬래시 피해 +14%, Perfect 추가 폭발 피해가 증가합니다.",
    rarity: "rare",
    characterId: "rio",
    tags: ["skill", "attack"],
    maxStacks: 3
  },
  {
    id: "lightning-parcel",
    title: "번개 택배",
    description: "라이트닝 대시 피해 +20%, 적중 시 게이지를 조금 회복합니다.",
    rarity: "epic",
    characterId: "rio",
    tags: ["dash", "gauge", "attack"],
    maxStacks: 2
  },
  {
    id: "overdrive-battery",
    title: "오버드라이브 배터리",
    description: "썬더 오버드라이브 발동 시 게이지를 일부 돌려받습니다.",
    rarity: "epic",
    characterId: "rio",
    tags: ["ultimate", "gauge"],
    maxStacks: 2
  },
  {
    id: "oni-brace",
    title: "도깨비 손목보호대",
    description: "도깨비 가드 보호막 +25%.",
    rarity: "common",
    characterId: "maru",
    tags: ["shield", "skill"],
    maxStacks: 4
  },
  {
    id: "rebound-practice",
    title: "반사 훈련",
    description: "반사한 탄환 피해 +18%, 가드 충전량이 증가합니다.",
    rarity: "uncommon",
    characterId: "maru",
    tags: ["shield", "attack"],
    maxStacks: 3
  },
  {
    id: "fortress-heart",
    title: "성벽 심장",
    description: "보호막이 30 이상이면 피해량 +22%.",
    rarity: "rare",
    characterId: "maru",
    tags: ["shield", "attack"],
    maxStacks: 2
  },
  {
    id: "push-wave",
    title: "밀어내는 파도",
    description: "밀어내기 범위 +15%, 넉백 거리 +30%.",
    rarity: "common",
    characterId: "maru",
    tags: ["skill", "area"],
    maxStacks: 3
  },
  {
    id: "ground-resonance",
    title: "땅울림 공명",
    description: "땅울림 반경 +18%, 피해 +10%.",
    rarity: "uncommon",
    characterId: "maru",
    tags: ["skill", "area"],
    maxStacks: 3
  },
  {
    id: "wall-tax",
    title: "방패벽 통행료",
    description: "거대 방패벽 지속시간 +1.5초, 반사 피해가 증가합니다.",
    rarity: "rare",
    characterId: "maru",
    tags: ["ultimate", "shield"],
    maxStacks: 3
  },
  {
    id: "guardian-oath",
    title: "수호자의 약속",
    description: "가드 스킬 사용 시 체력을 4 회복합니다.",
    rarity: "uncommon",
    characterId: "maru",
    tags: ["survival", "shield"],
    maxStacks: 3
  },
  {
    id: "shield-carpenter",
    title: "방패 장인",
    description: "최대 체력 +15, 모든 보호막 획득량 +10%.",
    rarity: "common",
    characterId: "maru",
    tags: ["survival", "shield"],
    maxStacks: 4
  },
  {
    id: "mark-cache",
    title: "표식 캐시",
    description: "글리치 마크 대상 +1.",
    rarity: "common",
    characterId: "neon",
    tags: ["mark", "skill"],
    maxStacks: 3
  },
  {
    id: "glitch-refund",
    title: "글리치 환급",
    description: "표식 적 처치 시 모든 쿨타임이 조금 줄고 게이지를 얻습니다.",
    rarity: "rare",
    characterId: "neon",
    tags: ["mark", "cooldown", "gauge"],
    maxStacks: 3
  },
  {
    id: "trap-stack",
    title: "트랩 중첩",
    description: "노이즈 트랩 반경 +14%, 지속시간 +1초.",
    rarity: "common",
    characterId: "neon",
    tags: ["trap", "area"],
    maxStacks: 4
  },
  {
    id: "silent-execute",
    title: "무음 처형",
    description: "쉐도우 컷 피해 +22%, 표식 대상에게 추가 피해.",
    rarity: "rare",
    characterId: "neon",
    tags: ["mark", "attack"],
    maxStacks: 3
  },
  {
    id: "blackout-script",
    title: "블랙아웃 스크립트",
    description: "블랙아웃 반경 +12%, 둔화 지속시간 증가.",
    rarity: "epic",
    characterId: "neon",
    tags: ["ultimate", "area"],
    maxStacks: 2
  },
  {
    id: "mirror-bug",
    title: "거울 버그",
    description: "표식 지속시간 +2초, 표식 피해 +12%.",
    rarity: "uncommon",
    characterId: "neon",
    tags: ["mark", "attack"],
    maxStacks: 3
  },
  {
    id: "cut-through",
    title: "관통 컷",
    description: "쉐도우 컷 대상 +1.",
    rarity: "uncommon",
    characterId: "neon",
    tags: ["skill", "mark"],
    maxStacks: 3
  },
  {
    id: "system-lag",
    title: "시스템 랙",
    description: "피해를 준 적을 짧게 둔화시킵니다.",
    rarity: "common",
    characterId: "neon",
    tags: ["skill", "survival"],
    maxStacks: 3
  },
  {
    id: "extra-slime",
    title: "슬라임 한 스푼",
    description: "슬라임 소환 수 +1.",
    rarity: "common",
    characterId: "cookie",
    tags: ["summon"],
    maxStacks: 3
  },
  {
    id: "jelly-splash",
    title: "젤리 스플래시",
    description: "젤리 폭탄 반경 +14%, 피해 +10%.",
    rarity: "common",
    characterId: "cookie",
    tags: ["skill", "area"],
    maxStacks: 4
  },
  {
    id: "sweet-recovery",
    title: "달콤한 회복",
    description: "젤리 폭탄과 달콤한 장판의 회복량이 증가합니다.",
    rarity: "uncommon",
    characterId: "cookie",
    tags: ["survival", "area"],
    maxStacks: 3
  },
  {
    id: "slime-chef",
    title: "슬라임 셰프",
    description: "슬라임 피해 +18%, 지속시간 +2초.",
    rarity: "uncommon",
    characterId: "cookie",
    tags: ["summon", "attack"],
    maxStacks: 3
  },
  {
    id: "party-leftovers",
    title: "파티 남은 재료",
    description: "대왕 슬라임 파티가 작은 슬라임을 2마리 더 남깁니다.",
    rarity: "rare",
    characterId: "cookie",
    tags: ["ultimate", "summon"],
    maxStacks: 2
  },
  {
    id: "sticky-syrup",
    title: "끈적 시럽",
    description: "쿠키의 피해를 받은 적이 더 오래 둔화됩니다.",
    rarity: "common",
    characterId: "cookie",
    tags: ["area", "survival"],
    maxStacks: 3
  },
  {
    id: "bouncing-bomb",
    title: "통통 젤리탄",
    description: "젤리 폭탄이 터진 곳에 작은 회복 장판을 남깁니다.",
    rarity: "rare",
    characterId: "cookie",
    tags: ["skill", "area", "survival"],
    maxStacks: 2
  },
  {
    id: "giant-recipe",
    title: "대왕 레시피",
    description: "대왕 슬라임 피해 +25%, 지속시간 +2초.",
    rarity: "epic",
    characterId: "cookie",
    tags: ["ultimate", "summon", "attack"],
    maxStacks: 2
  }
];

export function getRewardDefinition(rewardId: string): RewardDefinition | undefined {
  return REWARDS.find((reward) => reward.id === rewardId);
}
