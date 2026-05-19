export interface RewardDefinition {
  id: string;
  title: string;
  description: string;
}

export const REWARDS: RewardDefinition[] = [
  {
    id: "forked-slash",
    title: "번개 잔상",
    description: "스파크 슬래시 피해량 +20%, Perfect 시 검기가 한 번 더 터집니다."
  },
  {
    id: "perfect-tempo",
    title: "완벽한 자세",
    description: "Perfect Cast 시 현재 스킬 쿨타임을 35% 돌려받습니다."
  },
  {
    id: "runner-current",
    title: "움직임의 피",
    description: "대시 후 2초 동안 모든 스킬 피해량 +25%."
  },
  {
    id: "noise-absorb",
    title: "노이즈 흡수",
    description: "적 처치 시 스킬 게이지 획득량 +45%."
  },
  {
    id: "chain-overload",
    title: "체인 과충전",
    description: "체인 볼트가 추가 대상 2명을 더 타격합니다."
  },
  {
    id: "spark-hands",
    title: "빠른 손끝",
    description: "기본 공격 속도 +18%, 기본 탄환 속도 +10%."
  },
  {
    id: "delivery-guard",
    title: "배달 보호막",
    description: "라이트닝 대시를 사용하면 짧은 보호막을 얻습니다."
  },
  {
    id: "charged-heart",
    title: "전력 충전",
    description: "최대 체력 +20, 즉시 20 회복합니다."
  },
  {
    id: "overdrive-loop",
    title: "오버드라이브 루프",
    description: "썬더 오버드라이브 지속시간 +2초, 오버드라이브 중 피해량 +15%."
  },
  {
    id: "combo-battery",
    title: "콤보 배터리",
    description: "Perfect 2연속 보너스 게이지가 더 많이 차오릅니다."
  }
];
