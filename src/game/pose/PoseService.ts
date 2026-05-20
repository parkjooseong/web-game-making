import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
  type PoseLandmarkerResult
} from "@mediapipe/tasks-vision";
import type { CastGrade, GestureId, GestureResult, GestureScoreBreakdown } from "../simulation/types";
import { clamp } from "../simulation/math";

export type PoseStatus = "idle" | "starting" | "ready" | "permission-needed" | "unsupported" | "unstable" | "error";

type StatusListener = (status: PoseStatus) => void;

interface GestureScoreDetail {
  gestureId: GestureId;
  score: number;
  breakdown: GestureScoreBreakdown;
  reason: string;
}

const modelUrl = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const wasmUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

export class PoseService {
  private status: PoseStatus = "idle";
  private listeners = new Set<StatusListener>();
  private landmarker: PoseLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private previewHost: HTMLElement | null = null;
  private lastVideoTime = -1;

  getStatus(): PoseStatus {
    return this.status;
  }

  isReady(): boolean {
    return this.status === "ready" && Boolean(this.landmarker && this.video);
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  setPreviewHost(host: HTMLElement): void {
    this.previewHost = host;
    if (this.video) {
      host.appendChild(this.video);
    }
  }

  async start(): Promise<void> {
    if (this.status === "ready" || this.status === "starting") {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.setStatus("unsupported");
      return;
    }

    this.setStatus("starting");
    try {
      const vision = await FilesetResolver.forVisionTasks(wasmUrl);
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numPoses: 1
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });

      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.autoplay = true;
      this.video.playsInline = true;
      this.video.srcObject = stream;
      this.video.className = "camera-preview-video";
      this.video.setAttribute("aria-label", "웹캠 포즈 미리보기");
      (this.previewHost ?? document.body).appendChild(this.video);
      await this.video.play();
      this.setStatus("ready");
    } catch (error) {
      console.warn("PoseService start failed", error);
      this.setStatus("permission-needed");
    }
  }

  async capture(expectedGesture: GestureId, durationMs = 1200): Promise<GestureResult> {
    if (!this.isReady() || !this.video || !this.landmarker) {
      return {
        gestureId: expectedGesture,
        score: 0,
        grade: "Miss",
        confidence: 0,
        reason: "카메라가 준비되지 않았습니다.",
        breakdown: emptyBreakdown("카메라를 켜고 상반신이 화면에 들어오게 해주세요.")
      };
    }

    const startedAt = performance.now();
    const frames: PoseLandmarkerResult[] = [];

    while (performance.now() - startedAt < durationMs) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!this.video || !this.landmarker) {
        break;
      }
      if (this.video.currentTime === this.lastVideoTime) {
        continue;
      }
      this.lastVideoTime = this.video.currentTime;
      frames.push(this.landmarker.detectForVideo(this.video, performance.now()));
    }

    return this.scoreFrames(expectedGesture, frames);
  }

  private setStatus(status: PoseStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }

  private scoreFrames(expectedGesture: GestureId, frames: PoseLandmarkerResult[]): GestureResult {
    const samples = frames
      .map((frame) => frame.landmarks[0])
      .filter((landmarks): landmarks is NormalizedLandmark[] => Boolean(landmarks && landmarks.length >= 17));

    if (samples.length < 4) {
      this.setStatus("unstable");
      return {
        gestureId: expectedGesture,
        score: 0,
        grade: "Miss",
        confidence: 0,
        reason: "몸이 충분히 보이지 않습니다.",
        breakdown: emptyBreakdown("양어깨와 양손목이 모두 화면 안에 들어오게 카메라에서 조금 뒤로 물러나세요.")
      };
    }

    this.setStatus("ready");
    const detail =
      expectedGesture === "slash"
        ? this.scoreSlash(samples)
        : expectedGesture === "thrust"
          ? this.scoreThrust(samples)
          : expectedGesture === "rise"
            ? this.scoreRise(samples)
            : expectedGesture === "open-arms"
              ? this.scoreOpenArms(samples)
              : expectedGesture === "cross-guard"
                ? this.scoreCrossGuard(samples)
                : expectedGesture === "ground-slam"
                  ? this.scoreGroundSlam(samples)
                  : expectedGesture === "point"
                    ? this.scorePoint(samples)
                    : expectedGesture === "circle"
                      ? this.scoreCircle(samples)
                      : expectedGesture === "wave"
                        ? this.scoreSlash(samples)
                        : expectedGesture === "spread"
                          ? this.scoreSpread(samples)
                          : expectedGesture === "heart" || expectedGesture === "focus-triangle"
                            ? this.scoreHeart(samples, expectedGesture === "focus-triangle")
                            : this.scoreThrust(samples);

    return {
      gestureId: expectedGesture,
      score: detail.score,
      grade: gradeFromScore(detail.score),
      confidence: clamp(detail.score / 100, 0, 1),
      reason: detail.reason,
      breakdown: detail.breakdown
    };
  }

  private scoreSlash(samples: NormalizedLandmark[][]): GestureScoreDetail {
    const left = wristPath(samples, 15);
    const right = wristPath(samples, 16);
    const best = betterPathDetail(pathDetailForSlash(left), pathDetailForSlash(right));
    return makeGestureDetail("slash", best);
  }

  private scoreThrust(samples: NormalizedLandmark[][]): GestureScoreDetail {
    const shoulderWidth = average(samples.map((sample) => Math.abs(sample[11].x - sample[12].x))) || 0.22;
    const left = wristPath(samples, 15);
    const right = wristPath(samples, 16);
    const best = betterPathDetail(pathDetailForThrust(left, shoulderWidth), pathDetailForThrust(right, shoulderWidth));
    return makeGestureDetail("thrust", best);
  }

  private scoreRise(samples: NormalizedLandmark[][]): GestureScoreDetail {
    let best = 0;
    let bestPosition = 0;
    for (const index of [15, 16]) {
      const highestWrist = Math.min(...samples.map((sample) => sample[index].y));
      const shoulderLine = average(samples.map((sample) => (sample[11].y + sample[12].y) / 2));
      const noseLine = average(samples.map((sample) => sample[0].y));
      const aboveShoulder = shoulderLine - highestWrist;
      const aboveNose = noseLine - highestWrist;
      const position = clamp(aboveShoulder * 230 + Math.max(0, aboveNose) * 180, 0, 100);
      bestPosition = Math.max(bestPosition, position);
      best = Math.max(best, 35 + position * 0.72);
    }
    return makeGestureDetail("rise", {
      positionScore: bestPosition,
      motionScore: bestPosition * 0.55,
      speedScore: 72,
      stabilityScore: stabilityScore(samples),
      sizeScore: bestPosition,
      tip: bestPosition < 60 ? "손이 머리 위로 확실히 올라오게 들어보세요." : "좋아요. 손을 조금 더 빠르게 올리면 Perfect에 가까워집니다."
    });
  }

  private scoreOpenArms(samples: NormalizedLandmark[][]): GestureScoreDetail {
    let best = 0;
    let bestBreakdown: GestureScoreBreakdown = emptyBreakdown("양팔을 어깨보다 넓게 벌려보세요.");
    for (const sample of samples) {
      const leftShoulder = sample[11];
      const rightShoulder = sample[12];
      const leftWrist = sample[15];
      const rightWrist = sample[16];
      const shoulderWidth = Math.max(0.12, Math.abs(leftShoulder.x - rightShoulder.x));
      const leftOut = (leftShoulder.x - leftWrist.x) / shoulderWidth;
      const rightOut = (rightWrist.x - rightShoulder.x) / shoulderWidth;
      const shoulderLine = (leftShoulder.y + rightShoulder.y) / 2;
      const raised = Math.max(0, shoulderLine - Math.min(leftWrist.y, rightWrist.y));
      const symmetry = 1 - Math.min(1, Math.abs(leftWrist.y - rightWrist.y) * 3);
      const candidate: GestureScoreBreakdown = {
        positionScore: clamp((leftOut + rightOut) * 34, 0, 100),
        motionScore: clamp((leftOut + rightOut) * 25 + raised * 120, 0, 100),
        speedScore: 72,
        stabilityScore: symmetry * 100,
        sizeScore: clamp((leftOut + rightOut) * 42, 0, 100),
        tip: (leftOut + rightOut) < 1.7 ? "양팔을 어깨보다 넓게 벌려보세요." : "카메라에서 조금 뒤로 물러나면 양손이 더 안정적으로 잡힙니다."
      };
      const score = scoreFromBreakdown(candidate);
      if (score > best) {
        best = score;
        bestBreakdown = candidate;
      }
    }
    return makeGestureDetail("open-arms", bestBreakdown);
  }

  private scoreCrossGuard(samples: NormalizedLandmark[][]): GestureScoreDetail {
    let best = 0;
    let bestBreakdown: GestureScoreBreakdown = emptyBreakdown("양손목이 몸 중앙에서 교차해야 합니다.");
    for (const sample of samples) {
      const leftShoulder = sample[11];
      const rightShoulder = sample[12];
      const leftWrist = sample[15];
      const rightWrist = sample[16];
      const shoulderWidth = Math.max(0.12, Math.abs(leftShoulder.x - rightShoulder.x));
      const crossed = leftWrist.x > rightWrist.x ? 42 : 0;
      const centerLine = (leftShoulder.x + rightShoulder.x) / 2;
      const nearCenter = 1 - Math.min(1, (Math.abs(leftWrist.x - centerLine) + Math.abs(rightWrist.x - centerLine)) / shoulderWidth);
      const chestLine = (leftShoulder.y + rightShoulder.y) / 2 + 0.08;
      const heightMatch = 1 - Math.min(1, (Math.abs(leftWrist.y - chestLine) + Math.abs(rightWrist.y - chestLine)) * 3);
      const candidate: GestureScoreBreakdown = {
        positionScore: clamp(crossed + nearCenter * 38 + heightMatch * 28, 0, 100),
        motionScore: crossed > 0 ? 72 : 25,
        speedScore: 70,
        stabilityScore: heightMatch * 100,
        sizeScore: nearCenter * 100,
        tip: crossed === 0 ? "양손목이 몸 중앙에서 교차해야 합니다." : "손이 가슴 높이에 오도록 해보세요."
      };
      const score = scoreFromBreakdown(candidate);
      if (score > best) {
        best = score;
        bestBreakdown = candidate;
      }
    }
    return makeGestureDetail("cross-guard", bestBreakdown);
  }

  private scoreGroundSlam(samples: NormalizedLandmark[][]): GestureScoreDetail {
    const left = wristPath(samples, 15);
    const right = wristPath(samples, 16);
    const best = betterPathDetail(pathDetailForSlam(left), pathDetailForSlam(right));
    return makeGestureDetail("ground-slam", best);
  }

  private scorePoint(samples: NormalizedLandmark[][]): GestureScoreDetail {
    let best = 0;
    let bestBreakdown = emptyBreakdown("손을 몸 중심에서 더 멀리 뻗어보세요.");
    for (const sample of samples) {
      const shoulderWidth = Math.max(0.12, Math.abs(sample[11].x - sample[12].x));
      const centerX = (sample[11].x + sample[12].x) / 2;
      const centerY = (sample[11].y + sample[12].y) / 2;
      for (const wristIndex of [15, 16] as const) {
        const wrist = sample[wristIndex];
        const elbow = sample[wristIndex - 2];
        const extension = Math.hypot(wrist.x - centerX, wrist.y - centerY) / shoulderWidth;
        const straightness = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y) / shoulderWidth;
        const candidate: GestureScoreBreakdown = {
          positionScore: clamp(extension * 38, 0, 100),
          motionScore: clamp(straightness * 46, 0, 100),
          speedScore: 70,
          stabilityScore: 72,
          sizeScore: clamp(extension * 34, 0, 100),
          tip: "손을 몸 중심에서 더 멀리 뻗어보세요."
        };
        const score = scoreFromBreakdown(candidate);
        if (score > best) {
          best = score;
          bestBreakdown = candidate;
        }
      }
    }
    return makeGestureDetail("point", bestBreakdown);
  }

  private scoreCircle(samples: NormalizedLandmark[][]): GestureScoreDetail {
    const left = wristPath(samples, 15);
    const right = wristPath(samples, 16);
    const best = betterPathDetail(pathDetailForCircle(left), pathDetailForCircle(right));
    return makeGestureDetail("circle", best);
  }

  private scoreSpread(samples: NormalizedLandmark[][]): GestureScoreDetail {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const shoulderWidth = Math.max(0.12, Math.abs(last[11].x - last[12].x));
    const firstGap = Math.abs(first[15].x - first[16].x) / shoulderWidth;
    const lastGap = Math.abs(last[15].x - last[16].x) / shoulderWidth;
    const opened = Math.max(0, lastGap - firstGap);
    return makeGestureDetail("spread", {
      positionScore: clamp(lastGap * 36, 0, 100),
      motionScore: clamp(opened * 90, 0, 100),
      speedScore: clamp((totalPathDistance(wristPath(samples, 15)) + totalPathDistance(wristPath(samples, 16))) * 60, 0, 100),
      stabilityScore: stabilityScore(samples),
      sizeScore: clamp(lastGap * 42, 0, 100),
      tip: opened < 0.6 ? "양손을 모았다가 더 크게 펼쳐보세요." : "좋아요. 시작과 끝 차이를 조금 더 크게 만들면 안정적입니다."
    });
  }

  private scoreHeart(samples: NormalizedLandmark[][], compact: boolean): GestureScoreDetail {
    let best = 0;
    let bestBreakdown = emptyBreakdown(compact ? "양손으로 삼각형을 얼굴 앞에 더 또렷하게 만들어보세요." : "양손을 얼굴 근처에서 더 가깝게 모아보세요.");
    for (const sample of samples) {
      const leftWrist = sample[15];
      const rightWrist = sample[16];
      const shoulderLine = (sample[11].y + sample[12].y) / 2;
      const noseLine = sample[0].y;
      const shoulderWidth = Math.max(0.12, Math.abs(sample[11].x - sample[12].x));
      const wristGap = Math.abs(leftWrist.x - rightWrist.x) / shoulderWidth;
      const closeHands = 1 - Math.min(1, wristGap / (compact ? 0.9 : 1.35));
      const highHands = Math.max(0, shoulderLine - Math.max(leftWrist.y, rightWrist.y));
      const nearFace = 1 - Math.min(1, Math.abs((leftWrist.y + rightWrist.y) / 2 - noseLine) * 3.5);
      const candidate: GestureScoreBreakdown = {
        positionScore: clamp(closeHands * 44 + highHands * 150 + nearFace * 22, 0, 100),
        motionScore: compact ? 62 : 70,
        speedScore: 68,
        stabilityScore: 74,
        sizeScore: clamp((1 - wristGap / 2) * 100, 0, 100),
        tip: compact ? "양손으로 삼각형을 얼굴 앞에 더 또렷하게 만들어보세요." : "양손을 얼굴 근처에서 더 가깝게 모아보세요."
      };
      const score = scoreFromBreakdown(candidate);
      if (score > best) {
        best = score;
        bestBreakdown = candidate;
      }
    }
    return makeGestureDetail(compact ? "focus-triangle" : "heart", bestBreakdown);
  }
}

function wristPath(samples: NormalizedLandmark[][], index: 15 | 16): NormalizedLandmark[] {
  return samples.map((sample) => sample[index]);
}

function pathDetailForSlash(path: NormalizedLandmark[]): GestureScoreBreakdown {
  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  const horizontalSpan = Math.max(...xs) - Math.min(...xs);
  const verticalSpan = Math.max(...ys) - Math.min(...ys);
  const travel = totalPathDistance(path);
  return {
    positionScore: clamp(Math.max(0, horizontalSpan - verticalSpan * 0.45) * 360, 0, 100),
    motionScore: clamp(horizontalSpan * 360 + Math.max(0, horizontalSpan - verticalSpan) * 120, 0, 100),
    speedScore: clamp(travel * 120, 0, 100),
    stabilityScore: clamp(100 - verticalSpan * 220, 35, 100),
    sizeScore: clamp(horizontalSpan * 420, 0, 100),
    tip: horizontalSpan < 0.22 ? "손을 더 크게 휘둘러보세요." : "손목이 어깨선 밖으로 지나가야 합니다."
  };
}

function pathDetailForThrust(path: NormalizedLandmark[], shoulderWidth: number): GestureScoreBreakdown {
  const first = path[0];
  const last = path[path.length - 1];
  const zValues = path.map((point) => point.z ?? 0);
  const zSpan = Math.max(...zValues) - Math.min(...zValues);
  const xyTravel = Math.hypot(last.x - first.x, last.y - first.y);
  const extension = totalPathDistance(path) / Math.max(shoulderWidth, 0.15);
  return {
    positionScore: clamp(extension * 34, 0, 100),
    motionScore: clamp(zSpan * 260 + xyTravel * 250, 0, 100),
    speedScore: clamp(totalPathDistance(path) * 105, 0, 100),
    stabilityScore: 74,
    sizeScore: clamp(extension * 30, 0, 100),
    tip: "손을 카메라 쪽으로 더 뻗고, 팔이 화면 밖으로 나가지 않게 해보세요."
  };
}

function pathDetailForSlam(path: NormalizedLandmark[]): GestureScoreBreakdown {
  const first = path[0];
  const last = path[path.length - 1];
  const ys = path.map((point) => point.y);
  const downward = last.y - first.y;
  const verticalSpan = Math.max(...ys) - Math.min(...ys);
  return {
    positionScore: clamp(Math.max(0, downward) * 300, 0, 100),
    motionScore: clamp(verticalSpan * 230, 0, 100),
    speedScore: clamp(totalPathDistance(path) * 90, 0, 100),
    stabilityScore: 70,
    sizeScore: clamp(verticalSpan * 260, 0, 100),
    tip: "손을 위에서 아래로 더 확실히 내려쳐보세요."
  };
}

function pathDetailForCircle(path: NormalizedLandmark[]): GestureScoreBreakdown {
  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const span = Math.min(width, height);
  const balance = 1 - Math.min(1, Math.abs(width - height) * 5);
  const first = path[0];
  const last = path[path.length - 1];
  const closure = 1 - Math.min(1, Math.hypot(first.x - last.x, first.y - last.y) * 5);
  return {
    positionScore: clamp(balance * 100, 0, 100),
    motionScore: clamp(totalPathDistance(path) * 90, 0, 100),
    speedScore: clamp(totalPathDistance(path) * 76, 0, 100),
    stabilityScore: clamp(closure * 100, 0, 100),
    sizeScore: clamp(span * 420, 0, 100),
    tip: span < 0.18 ? "원이 너무 작습니다." : closure < 0.55 ? "시작점과 끝점이 더 가까워야 합니다." : "원 궤적이 좋아요. 속도를 조금 더 일정하게 해보세요."
  };
}

function betterPathDetail(a: GestureScoreBreakdown, b: GestureScoreBreakdown): GestureScoreBreakdown {
  return scoreFromBreakdown(a) >= scoreFromBreakdown(b) ? a : b;
}

function makeGestureDetail(gestureId: GestureId, breakdown: GestureScoreBreakdown): GestureScoreDetail {
  const score = scoreFromBreakdown(breakdown);
  const tip = tipForGesture(gestureId, breakdown, score);
  return {
    gestureId,
    score,
    breakdown: {
      ...breakdown,
      tip
    },
    reason: score >= 70 ? "pose matched" : tip
  };
}

function scoreFromBreakdown(breakdown: GestureScoreBreakdown): number {
  return clamp(
    breakdown.positionScore * 0.26 +
      breakdown.motionScore * 0.24 +
      breakdown.speedScore * 0.18 +
      breakdown.stabilityScore * 0.16 +
      breakdown.sizeScore * 0.16,
    0,
    100
  );
}

function emptyBreakdown(tip: string): GestureScoreBreakdown {
  return {
    positionScore: 0,
    motionScore: 0,
    speedScore: 0,
    stabilityScore: 0,
    sizeScore: 0,
    tip
  };
}

function stabilityScore(samples: NormalizedLandmark[][]): number {
  const shoulderWidths = samples.map((sample) => Math.abs(sample[11].x - sample[12].x));
  const avg = average(shoulderWidths);
  const variance = average(shoulderWidths.map((value) => Math.abs(value - avg)));
  return clamp(100 - variance * 520, 35, 100);
}

function tipForGesture(gestureId: GestureId, breakdown: GestureScoreBreakdown, score: number): string {
  if (score >= 90) {
    return "Perfect에 가까운 좋은 동작입니다.";
  }
  if (breakdown.stabilityScore < 45) {
    return "팔이 화면 밖으로 나가지 않게 하세요.";
  }
  if (gestureId === "slash" || gestureId === "wave") {
    if (breakdown.sizeScore < 58) {
      return "손을 더 크게 휘둘러보세요.";
    }
    return "손목이 어깨선 밖으로 지나가야 합니다.";
  }
  if (gestureId === "cross-guard") {
    if (breakdown.positionScore < 62) {
      return "양손목이 몸 중앙에서 교차해야 합니다.";
    }
    return "손이 가슴 높이에 오도록 해보세요.";
  }
  if (gestureId === "circle") {
    if (breakdown.sizeScore < 55) {
      return "원이 너무 작습니다.";
    }
    return "시작점과 끝점이 더 가까워야 합니다.";
  }
  if (gestureId === "open-arms") {
    if (breakdown.sizeScore < 62) {
      return "양팔을 어깨보다 넓게 벌려보세요.";
    }
    return "카메라에서 조금 뒤로 물러나세요.";
  }
  if (gestureId === "rise") {
    return "손을 머리 위로 더 높고 빠르게 들어보세요.";
  }
  if (gestureId === "focus-triangle" || gestureId === "heart") {
    return "양손 모양을 얼굴 앞에서 더 또렷하게 유지해보세요.";
  }
  return breakdown.tip;
}

function totalPathDistance(path: NormalizedLandmark[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y);
  }
  return total;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function gradeFromScore(score: number): CastGrade {
  if (score >= 90) {
    return "Perfect";
  }
  if (score >= 70) {
    return "Great";
  }
  if (score >= 40) {
    return "Normal";
  }
  return "Miss";
}
