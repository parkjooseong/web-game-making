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
    title: "Slash Path",
    prompt: "손목이 어깨선 밖으로 확실히 지나가도록 빠르게 휘두르세요.",
    targetSuccesses: 5,
    rewardKey: "training.slash.basic"
  },
  {
    id: "guard-cross",
    gestureId: "cross-guard",
    title: "Guard Cross",
    prompt: "양 손목이 몸 중앙에서 교차되도록 팔을 X자로 모으세요.",
    targetSuccesses: 5,
    rewardKey: "training.guard.basic"
  },
  {
    id: "circle-control",
    gestureId: "circle",
    title: "Circle Control",
    prompt: "손목 궤적이 작아지지 않게 부드럽게 원을 그리세요.",
    targetSuccesses: 5,
    rewardKey: "training.circle.basic"
  },
  {
    id: "open-arms-release",
    gestureId: "open-arms",
    title: "Open Arms",
    prompt: "양 손목을 어깨보다 넓게 벌리고 상체가 화면에 남도록 유지하세요.",
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
