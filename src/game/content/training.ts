import type { GestureId, TrainingState } from "../simulation/types";

export interface TrainingMissionDefinition {
  id: string;
  gestureId: GestureId;
  title: string;
  prompt: string;
  targetSuccesses: number;
  rewardKey: string;
}

export const TRAINING_MISSIONS: TrainingMissionDefinition[] = [
  {
    id: "slash-basics",
    gestureId: "slash",
    title: "슬래시 경로",
    prompt: "손목이 어깨 밖을 지나가게 크게 휘둘러요.",
    targetSuccesses: 5,
    rewardKey: "training.slash.basic"
  },
  {
    id: "guard-cross",
    gestureId: "cross-guard",
    title: "크로스 가드",
    prompt: "양손목을 몸 중앙에서 X자로 모아요.",
    targetSuccesses: 5,
    rewardKey: "training.guard.basic"
  },
  {
    id: "circle-control",
    gestureId: "circle",
    title: "서클 컨트롤",
    prompt: "손목으로 큰 원을 부드럽게 그려요.",
    targetSuccesses: 5,
    rewardKey: "training.circle.basic"
  },
  {
    id: "open-arms-release",
    gestureId: "open-arms",
    title: "오픈 암",
    prompt: "양손을 어깨보다 넓게 벌려요.",
    targetSuccesses: 5,
    rewardKey: "training.open-arms.basic"
  }
];

export function createTrainingState(): TrainingState {
  return {
    missions: TRAINING_MISSIONS.map((mission) => ({
      ...mission,
      successes: 0,
      attempts: 0,
      perfects: 0,
      completed: false
    })),
    lastResult: null,
    completedRewardKeys: []
  };
}
