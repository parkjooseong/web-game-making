import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
  type PoseLandmarkerResult
} from "@mediapipe/tasks-vision";
import type { CastGrade, GestureId, GestureResult } from "../simulation/types";
import { clamp } from "../simulation/math";

export type PoseStatus = "idle" | "starting" | "ready" | "permission-needed" | "unsupported" | "unstable" | "error";

type StatusListener = (status: PoseStatus) => void;

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
        reason: "카메라가 준비되지 않았습니다."
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
        reason: "몸이 충분히 보이지 않습니다."
      };
    }

    this.setStatus("ready");
    const score =
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
      score,
      grade: gradeFromScore(score),
      confidence: clamp(score / 100, 0, 1),
      reason: score >= 40 ? "pose matched" : "포즈가 너무 약했습니다."
    };
  }

  private scoreSlash(samples: NormalizedLandmark[][]): number {
    const left = wristPath(samples, 15);
    const right = wristPath(samples, 16);
    const best = Math.max(pathScoreForSlash(left), pathScoreForSlash(right));
    return clamp(best, 0, 100);
  }

  private scoreThrust(samples: NormalizedLandmark[][]): number {
    const shoulderWidth = average(samples.map((sample) => Math.abs(sample[11].x - sample[12].x))) || 0.22;
    const left = wristPath(samples, 15);
    const right = wristPath(samples, 16);
    const best = Math.max(pathScoreForThrust(left, shoulderWidth), pathScoreForThrust(right, shoulderWidth));
    return clamp(best, 0, 100);
  }

  private scoreRise(samples: NormalizedLandmark[][]): number {
    let best = 0;
    for (const index of [15, 16]) {
      const highestWrist = Math.min(...samples.map((sample) => sample[index].y));
      const shoulderLine = average(samples.map((sample) => (sample[11].y + sample[12].y) / 2));
      const noseLine = average(samples.map((sample) => sample[0].y));
      const aboveShoulder = shoulderLine - highestWrist;
      const aboveNose = noseLine - highestWrist;
      best = Math.max(best, 35 + aboveShoulder * 230 + Math.max(0, aboveNose) * 180);
    }
    return clamp(best, 0, 100);
  }

  private scoreOpenArms(samples: NormalizedLandmark[][]): number {
    let best = 0;
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
      best = Math.max(best, 22 + (leftOut + rightOut) * 28 + raised * 180 + symmetry * 20);
    }
    return clamp(best, 0, 100);
  }

  private scoreCrossGuard(samples: NormalizedLandmark[][]): number {
    let best = 0;
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
      best = Math.max(best, crossed + nearCenter * 35 + heightMatch * 30);
    }
    return clamp(best, 0, 100);
  }

  private scoreGroundSlam(samples: NormalizedLandmark[][]): number {
    const left = wristPath(samples, 15);
    const right = wristPath(samples, 16);
    return clamp(Math.max(pathScoreForSlam(left), pathScoreForSlam(right)), 0, 100);
  }

  private scorePoint(samples: NormalizedLandmark[][]): number {
    let best = 0;
    for (const sample of samples) {
      const shoulderWidth = Math.max(0.12, Math.abs(sample[11].x - sample[12].x));
      const centerX = (sample[11].x + sample[12].x) / 2;
      const centerY = (sample[11].y + sample[12].y) / 2;
      for (const wristIndex of [15, 16] as const) {
        const wrist = sample[wristIndex];
        const elbow = sample[wristIndex - 2];
        const extension = Math.hypot(wrist.x - centerX, wrist.y - centerY) / shoulderWidth;
        const straightness = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y) / shoulderWidth;
        best = Math.max(best, 18 + extension * 32 + straightness * 24);
      }
    }
    return clamp(best, 0, 100);
  }

  private scoreCircle(samples: NormalizedLandmark[][]): number {
    const left = wristPath(samples, 15);
    const right = wristPath(samples, 16);
    return clamp(Math.max(pathScoreForCircle(left), pathScoreForCircle(right)), 0, 100);
  }

  private scoreSpread(samples: NormalizedLandmark[][]): number {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const shoulderWidth = Math.max(0.12, Math.abs(last[11].x - last[12].x));
    const firstGap = Math.abs(first[15].x - first[16].x) / shoulderWidth;
    const lastGap = Math.abs(last[15].x - last[16].x) / shoulderWidth;
    const opened = Math.max(0, lastGap - firstGap);
    return clamp(35 + opened * 42 + lastGap * 20 + totalPathDistance(wristPath(samples, 15)) * 28 + totalPathDistance(wristPath(samples, 16)) * 28, 0, 100);
  }

  private scoreHeart(samples: NormalizedLandmark[][], compact: boolean): number {
    let best = 0;
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
      best = Math.max(best, 24 + closeHands * 42 + highHands * 190 + nearFace * (compact ? 28 : 14));
    }
    return clamp(best, 0, 100);
  }
}

function wristPath(samples: NormalizedLandmark[][], index: 15 | 16): NormalizedLandmark[] {
  return samples.map((sample) => sample[index]);
}

function pathScoreForSlash(path: NormalizedLandmark[]): number {
  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  const horizontalSpan = Math.max(...xs) - Math.min(...xs);
  const verticalSpan = Math.max(...ys) - Math.min(...ys);
  const speedBonus = totalPathDistance(path) * 95;
  return 32 + horizontalSpan * 360 + Math.max(0, horizontalSpan - verticalSpan) * 140 + speedBonus;
}

function pathScoreForThrust(path: NormalizedLandmark[], shoulderWidth: number): number {
  const first = path[0];
  const last = path[path.length - 1];
  const zValues = path.map((point) => point.z ?? 0);
  const zSpan = Math.max(...zValues) - Math.min(...zValues);
  const xyTravel = Math.hypot(last.x - first.x, last.y - first.y);
  const extension = totalPathDistance(path) / Math.max(shoulderWidth, 0.15);
  return 34 + zSpan * 260 + xyTravel * 250 + extension * 12;
}

function pathScoreForSlam(path: NormalizedLandmark[]): number {
  const first = path[0];
  const last = path[path.length - 1];
  const ys = path.map((point) => point.y);
  const downward = last.y - first.y;
  const verticalSpan = Math.max(...ys) - Math.min(...ys);
  return 30 + Math.max(0, downward) * 300 + verticalSpan * 190 + totalPathDistance(path) * 55;
}

function pathScoreForCircle(path: NormalizedLandmark[]): number {
  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const span = Math.min(width, height);
  const balance = 1 - Math.min(1, Math.abs(width - height) * 5);
  const first = path[0];
  const last = path[path.length - 1];
  const closure = 1 - Math.min(1, Math.hypot(first.x - last.x, first.y - last.y) * 5);
  return 28 + span * 360 + totalPathDistance(path) * 70 + balance * 18 + closure * 16;
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
