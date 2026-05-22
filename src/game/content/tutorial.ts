import type { TutorialState, TutorialStepState } from "../simulation/types";

export const TUTORIAL_STEPS: TutorialStepState[] = [
  {
    id: "move",
    title: "1. 이동",
    prompt: "WASD 또는 방향키로 움직여요.",
    hint: "잠깐 움직이면 다음 단계로 넘어갑니다.",
    completed: false
  },
  {
    id: "dash",
    title: "2. 대시",
    prompt: "Space로 빠르게 대시해요.",
    hint: "이동 중 누르면 더 자연스럽습니다.",
    completed: false
  },
  {
    id: "basic-attack",
    title: "3. 자동 공격",
    prompt: "표적 근처에서 자동 공격을 확인해요.",
    hint: "기본 공격은 포즈 없이 자동 발사됩니다.",
    completed: false
  },
  {
    id: "prepare-q",
    title: "4. Q 스킬 준비",
    prompt: "Q를 눌러 포즈 캐스트를 준비해요.",
    hint: "포즈 인식은 스킬 준비 중에만 켜집니다.",
    completed: false
  },
  {
    id: "cast-skill",
    title: "5. 포즈 캐스트",
    prompt: "손을 좌우로 휘둘러요. 또는 1/2/3!",
    hint: "카메라가 없으면 1 노멀, 2 그레이트, 3 퍼펙트로 테스트합니다.",
    completed: false
  },
  {
    id: "reward",
    title: "6. 보상 카드",
    prompt: "카드 1장을 골라 빌드를 강화해요.",
    hint: "같은 태그를 모으면 시너지가 완성됩니다.",
    completed: false
  },
  {
    id: "boss-pose-break",
    title: "7. 보스 포즈 브레이크",
    prompt: "크로스 가드로 보스 패턴을 막아요!",
    hint: "성공하면 패턴이 끊기고 튜토리얼이 끝납니다.",
    completed: false
  }
];

export function createTutorialState(): TutorialState {
  return {
    steps: TUTORIAL_STEPS.map((step) => ({ ...step, completed: false })),
    currentStepIndex: 0,
    moveSeconds: 0,
    basicAttackHits: 0,
    skillPrepared: false,
    skillCast: false,
    rewardChosen: false,
    bossChallengeCleared: false,
    completed: false
  };
}
