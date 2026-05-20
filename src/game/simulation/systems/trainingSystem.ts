import type { CastGrade, CastResponse, FxEvent, GameState, GestureId, GestureResult, GestureScoreBreakdown } from "../types";

export function castTrainingDebugGrade(state: GameState, fxEvents: FxEvent[], grade: Exclude<CastGrade, "Miss">): CastResponse {
  const gestureId = getNextTrainingGesture(state);
  const result: GestureResult = {
    gestureId,
    score: grade === "Perfect" ? 96 : grade === "Great" ? 82 : 58,
    grade,
    confidence: 1,
    reason: "debug input",
    breakdown: debugBreakdown(grade, "디버그 입력입니다. 실제 카메라에서는 각 세부 점수가 표시됩니다.")
  };
  recordTrainingGestureResult(state, fxEvents, result);
  state.runStats.skillsUsed += 1;
  state.runStats[grade === "Perfect" ? "perfectCasts" : grade === "Great" ? "greatCasts" : "normalCasts"] += 1;
  if (grade === "Perfect") {
    state.player.comboPerfect += 1;
    state.runStats.maxPerfectCombo = Math.max(state.runStats.maxPerfectCombo, state.player.comboPerfect);
  } else {
    state.player.comboPerfect = 0;
  }
  state.message = `훈련 ${gestureId} ${grade}`;
  fxEvents.push({
    kind: "float-text",
    x: state.player.x,
    y: state.player.y - 86,
    text: grade,
    color: grade === "Perfect" ? 0xffd166 : grade === "Great" ? 0xb8ff5c : 0x48f7ff
  });
  fxEvents.push({ kind: "sound", sound: castGradeSound(grade), grade });
  return { ok: true, line: state.message };
}

export function getNextTrainingGesture(state: GameState): GestureId {
  return state.training.missions.find((mission) => !mission.completed)?.gestureId ?? state.training.missions[0]?.gestureId ?? "slash";
}

export function recordTrainingGestureResult(state: GameState, fxEvents: FxEvent[], result: GestureResult): void {
  if (state.mode !== "training") {
    return;
  }

  state.training.lastResult = {
    gestureId: result.gestureId,
    score: result.score,
    grade: result.grade,
    reason: result.reason,
    breakdown: result.breakdown,
    at: state.time
  };

  const mission = state.training.missions.find((item) => item.gestureId === result.gestureId);
  if (!mission) {
    return;
  }

  const wasCompleted = mission.completed;
  mission.attempts += 1;
  if (result.grade === "Perfect") {
    mission.perfects += 1;
  }
  if (result.grade !== "Miss") {
    mission.successes = Math.min(mission.targetSuccesses, mission.successes + 1);
    mission.completed = mission.successes >= mission.targetSuccesses;
  }

  if (!wasCompleted && mission.completed) {
    state.training.completedRewardKeys.push(mission.rewardKey);
    fxEvents.push({
      kind: "float-text",
      x: state.player.x,
      y: state.player.y - 126,
      text: `${mission.title} COMPLETE`,
      color: 0xffd166
    });
    fxEvents.push({ kind: "sound", sound: "unlock" });
  }
}

export function debugBreakdown(grade: CastGrade, tip: string): GestureScoreBreakdown {
  const value = grade === "Perfect" ? 96 : grade === "Great" ? 82 : grade === "Normal" ? 58 : 0;
  return {
    positionScore: value,
    motionScore: value,
    speedScore: value,
    stabilityScore: value,
    sizeScore: value,
    tip
  };
}

function castGradeSound(grade: CastGrade) {
  if (grade === "Perfect") {
    return "cast-perfect";
  }
  if (grade === "Great") {
    return "cast-great";
  }
  if (grade === "Normal") {
    return "cast-normal";
  }
  return "hit";
}
