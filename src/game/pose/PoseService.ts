import type { NormalizedLandmark, PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { getPoseAssistModifiers, type PoseAssistModifiers } from "../content/poseAssist";
import type { CastGrade, GameMode, GestureId, GestureResult, GestureScoreBreakdown, PoseAssistLevel } from "../simulation/types";
import { clamp } from "../simulation/math";
import type { BufferedPoseFrame, PoseFrameListener, PoseOverlayFrame, PoseStatus } from "./PoseOverlayTypes";

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
  private frameListeners = new Set<PoseFrameListener>();
  private landmarker: PoseLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private previewHost: HTMLElement | null = null;
  private lastVideoTime = -1;
  private latestResult: PoseLandmarkerResult | null = null;
  private latestLandmarks: NormalizedLandmark[] | null = null;
  private frameBuffer: BufferedPoseFrame[] = [];
  private trackingRafId = 0;
  private trackingActive = false;
  private detectingFrame = false;
  private detectedFrameTimestamps: number[] = [];
  private poseAssistLevel: PoseAssistLevel = "normal";
  private poseAssistMode: GameMode = "story";

  getStatus(): PoseStatus {
    return this.status;
  }

  isReady(): boolean {
    return (this.status === "ready" || this.status === "unstable") && Boolean(this.landmarker && this.video);
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  onFrame(listener: PoseFrameListener): () => void {
    this.frameListeners.add(listener);
    listener({
      landmarks: this.latestLandmarks,
      timestamp: performance.now(),
      status: this.status
    });
    return () => this.frameListeners.delete(listener);
  }

  getLatestLandmarks(): NormalizedLandmark[] | null {
    return this.latestLandmarks;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  getPoseFps(): number {
    const now = performance.now();
    const cutoff = now - 1200;
    while (this.detectedFrameTimestamps.length > 0 && this.detectedFrameTimestamps[0] < cutoff) {
      this.detectedFrameTimestamps.shift();
    }
    if (this.detectedFrameTimestamps.length < 2) {
      return 0;
    }
    const elapsedSeconds = (this.detectedFrameTimestamps[this.detectedFrameTimestamps.length - 1] - this.detectedFrameTimestamps[0]) / 1000;
    return elapsedSeconds > 0 ? (this.detectedFrameTimestamps.length - 1) / elapsedSeconds : 0;
  }

  setPoseAssistContext(level: PoseAssistLevel, mode: GameMode): void {
    this.poseAssistLevel = level;
    this.poseAssistMode = mode;
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
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
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
      this.startTrackingLoop();
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
        reason: "카메라 준비가 필요해요.",
        breakdown: emptyBreakdown("카메라를 켜고 상반신과 양손을 화면에 넣어요.")
      };
    }

    const startedAt = performance.now();
    if (durationMs > 0) {
      await waitForAnimationDuration(durationMs);
    }

    const endedAt = performance.now();
    const minTimestamp = Math.max(startedAt - 80, endedAt - durationMs - 80);
    const frames = this.frameBuffer
      .filter((frame) => frame.timestamp >= minTimestamp && frame.timestamp <= endedAt + 32)
      .map((frame) => frame.result);
    return this.scoreFrames(expectedGesture, frames);
  }

  private startTrackingLoop(): void {
    if (this.trackingActive) {
      return;
    }
    this.trackingActive = true;
    this.trackingRafId = requestAnimationFrame((timestamp) => this.trackFrame(timestamp));
  }

  private trackFrame(timestamp: number): void {
    this.trackingRafId = requestAnimationFrame((nextTimestamp) => this.trackFrame(nextTimestamp));
    const canTrack = this.status === "ready" || this.status === "unstable";
    if (!this.video || !this.landmarker || !canTrack || this.detectingFrame) {
      this.emitFrame(timestamp);
      return;
    }
    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || this.video.currentTime === this.lastVideoTime) {
      this.emitFrame(timestamp);
      return;
    }

    this.detectingFrame = true;
    try {
      this.lastVideoTime = this.video.currentTime;
      const result = this.landmarker.detectForVideo(this.video, timestamp);
      this.latestResult = result;
      this.latestLandmarks = result.landmarks[0] && result.landmarks[0].length >= 17 ? result.landmarks[0] : null;
      this.detectedFrameTimestamps.push(timestamp);
      const poseCutoff = timestamp - 1200;
      while (this.detectedFrameTimestamps.length > 0 && this.detectedFrameTimestamps[0] < poseCutoff) {
        this.detectedFrameTimestamps.shift();
      }
      if (this.latestLandmarks && this.status === "unstable") {
        this.setStatus("ready");
      }
      this.frameBuffer.push({ result, timestamp });
      const cutoff = timestamp - 1800;
      while (this.frameBuffer.length > 0 && this.frameBuffer[0].timestamp < cutoff) {
        this.frameBuffer.shift();
      }
      this.emitFrame(timestamp);
    } catch (error) {
      console.warn("PoseService live tracking failed", error);
      this.latestResult = null;
      this.latestLandmarks = null;
      this.emitFrame(timestamp);
    } finally {
      this.detectingFrame = false;
    }
  }

  private emitFrame(timestamp = performance.now()): void {
    if (this.frameListeners.size === 0) {
      return;
    }
    const frame: PoseOverlayFrame = {
      landmarks: this.latestLandmarks,
      timestamp,
      status: this.status
    };
    for (const listener of this.frameListeners) {
      listener(frame);
    }
  }

  private setStatus(status: PoseStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    for (const listener of this.listeners) {
      listener(status);
    }
    this.emitFrame();
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
        reason: "상반신이 잘 보여야 해요.",
        breakdown: emptyBreakdown("상반신과 양손이 화면에 들어오게 해요.")
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
    const assist = getPoseAssistModifiers(this.poseAssistLevel, this.poseAssistMode);
    const adjustedScore = clamp(detail.score + assist.scoreBonus, 0, 100);
    const grade = gradeFromScore(adjustedScore, assist);
    const assistTip = assist.scoreBonus > 0 ? `${detail.breakdown.tip} 보정 +${assist.scoreBonus} 적용 중` : detail.breakdown.tip;

    return {
      gestureId: expectedGesture,
      score: adjustedScore,
      grade,
      confidence: clamp(adjustedScore / 100 + assist.confidenceBonus, 0, 1),
      reason: grade === "Miss" ? detail.reason : assist.scoreBonus > 0 ? `${detail.reason} · 보정 적용` : detail.reason,
      breakdown: {
        ...detail.breakdown,
        tip: assistTip
      }
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
      tip: bestPosition < 60 ? "손을 머리 위로 더 높이 들어요." : "좋아요. 조금 더 빠르면 퍼펙트에 가까워요."
    });
  }

  private scoreOpenArms(samples: NormalizedLandmark[][]): GestureScoreDetail {
    let best = 0;
    let bestBreakdown: GestureScoreBreakdown = emptyBreakdown("양팔을 어깨보다 넓게 벌려요.");
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
        tip: (leftOut + rightOut) < 1.7 ? "양팔을 어깨보다 넓게 벌려요." : "조금 뒤로 물러나면 양손이 더 잘 보여요."
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
    let bestBreakdown: GestureScoreBreakdown = emptyBreakdown("양손목을 몸 중앙에서 X자로 모아요.");
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
        tip: crossed === 0 ? "양손목을 몸 중앙에서 X자로 모아요." : "손을 가슴 높이에 맞춰요."
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
    let bestBreakdown = emptyBreakdown("손을 몸 중심에서 더 멀리 뻗어요.");
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
          tip: "손을 몸 중심에서 더 멀리 뻗어요."
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
      tip: opened < 0.6 ? "양손을 모았다가 더 크게 펼쳐요." : "좋아요. 시작과 끝을 더 크게 벌려요."
    });
  }

  private scoreHeart(samples: NormalizedLandmark[][], compact: boolean): GestureScoreDetail {
    let best = 0;
    let bestBreakdown = emptyBreakdown(compact ? "얼굴 앞에 삼각형을 또렷하게 만들어요." : "양손을 얼굴 근처로 모아요.");
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
        tip: compact ? "얼굴 앞에 삼각형을 또렷하게 만들어요." : "양손을 얼굴 근처로 모아요."
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

function waitForAnimationDuration(durationMs: number): Promise<void> {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (performance.now() - startedAt >= durationMs) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
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
    tip: horizontalSpan < 0.22 ? "손을 더 크게 휘둘러요." : "손목이 어깨선 밖을 지나가게 해요."
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
    tip: "손을 카메라 쪽으로 뻗고, 팔은 화면 안에 둬요."
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
    tip: "손을 위에서 아래로 확실히 내려쳐요."
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
    tip: span < 0.18 ? "원을 더 크게 그려요." : closure < 0.55 ? "시작점과 끝점을 더 가깝게 맞춰요." : "좋아요. 속도를 조금 더 일정하게!"
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
    reason: score >= 70 ? "포즈가 잘 맞았어요." : tip
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
    return "퍼펙트에 가까운 좋은 동작이에요.";
  }
  if (breakdown.stabilityScore < 45) {
    return "팔이 화면 밖으로 나가지 않게 해요.";
  }
  if (gestureId === "slash" || gestureId === "wave") {
    if (breakdown.sizeScore < 58) {
      return "손을 더 크게 휘둘러요.";
    }
    return "손목이 어깨선 밖을 지나가게 해요.";
  }
  if (gestureId === "cross-guard") {
    if (breakdown.positionScore < 62) {
      return "양손목을 몸 중앙에서 X자로 모아요.";
    }
    return "손을 가슴 높이에 맞춰요.";
  }
  if (gestureId === "circle") {
    if (breakdown.sizeScore < 55) {
      return "원을 더 크게 그려요.";
    }
    return "시작점과 끝점을 더 가깝게 맞춰요.";
  }
  if (gestureId === "open-arms") {
    if (breakdown.sizeScore < 62) {
      return "양팔을 어깨보다 넓게 벌려요.";
    }
    return "카메라에서 조금 뒤로 물러나요.";
  }
  if (gestureId === "rise") {
    return "손을 머리 위로 더 높고 빠르게 들어요.";
  }
  if (gestureId === "focus-triangle" || gestureId === "heart") {
    return "얼굴 앞 손 모양을 또렷하게 유지해요.";
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

function gradeFromScore(score: number, thresholds: PoseAssistModifiers): CastGrade {
  if (score >= thresholds.perfectThreshold) {
    return "Perfect";
  }
  if (score >= thresholds.greatThreshold) {
    return "Great";
  }
  if (score >= thresholds.normalThreshold) {
    return "Normal";
  }
  return "Miss";
}
