import type { TutorialState, TutorialStepState } from "../simulation/types";

export const TUTORIAL_STEPS: TutorialStepState[] = [
  {
    id: "move",
    title: "1. 이동",
    prompt: "WASD 또는 방향키로 리오를 움직이세요.",
    hint: "0.8초 정도 움직이면 다음 단계로 넘어갑니다.",
    completed: false
  },
  {
    id: "dash",
    title: "2. 대시",
    prompt: "Space를 눌러 노이즈 사이를 빠르게 빠져나가세요.",
    hint: "이동 중 Space를 누르면 더 자연스럽습니다.",
    completed: false
  },
  {
    id: "basic-attack",
    title: "3. 자동 공격",
    prompt: "가까운 훈련 표적을 바라보며 자동 기본 공격을 확인하세요.",
    hint: "기본 공격은 웹캠 없이 자동으로 발사됩니다.",
    completed: false
  },
  {
    id: "prepare-q",
    title: "4. Q 스킬 준비",
    prompt: "Q를 눌러 스파크 슬래시 포즈 캐스팅을 준비하세요.",
    hint: "포즈 인식은 스킬 버튼을 누른 뒤에만 켜집니다.",
    completed: false
  },
  {
    id: "cast-skill",
    title: "5. 포즈 캐스팅",
    prompt: "손을 좌우로 휘두르거나 1/2/3을 눌러 스킬을 성공시키세요.",
    hint: "카메라가 없어도 1 Normal, 2 Great, 3 Perfect로 테스트할 수 있습니다.",
    completed: false
  },
  {
    id: "reward",
    title: "6. 보상 카드",
    prompt: "3장 중 하나를 골라 이번 빌드를 강화하세요.",
    hint: "같은 태그의 카드를 모으면 빌드 시너지가 완성됩니다.",
    completed: false
  },
  {
    id: "boss-pose-break",
    title: "7. 보스 포즈 브레이크",
    prompt: "드럼 노이즈의 큰 패턴을 크로스 가드 또는 1/2/3으로 카운터하세요.",
    hint: "성공하면 보스 패턴이 끊기고 튜토리얼이 완료됩니다.",
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
