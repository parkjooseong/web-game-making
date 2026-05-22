import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { PoseOverlayFrame, PoseStatus } from "../../game/pose/PoseOverlayTypes";
import type { PerformanceQuality } from "../../game/performance/PerformanceMonitor";
import type { CastGrade, CharacterId, GestureId } from "../../game/simulation/types";

export interface CameraFxContext {
  characterId?: CharacterId;
  expectedGesture?: GestureId | null;
  isCapturing?: boolean;
  lastGrade?: CastGrade | null;
  color?: string;
  label?: string;
  boss?: boolean;
}

export type CameraPreviewSize = "small" | "medium" | "large";
export type CameraFxIntensity = "low" | "medium" | "high";

export interface CameraFxSettings {
  cameraSize: CameraPreviewSize;
  arFxEnabled: boolean;
  arFxIntensity: CameraFxIntensity;
  showSkeleton: boolean;
  showHandGlow: boolean;
  showOriginalVideo: boolean;
}

export const defaultCameraFxSettings: CameraFxSettings = {
  cameraSize: "medium",
  arFxEnabled: true,
  arFxIntensity: "medium",
  showSkeleton: false,
  showHandGlow: true,
  showOriginalVideo: true
};

interface CameraFxOverlayOptions {
  settings?: Partial<CameraFxSettings>;
  maxParticles?: number;
}

interface CameraBurstOptions {
  color?: string;
  label?: string;
  boss?: boolean;
  perfectCounter?: boolean;
  intensityBoost?: number;
}

interface Point {
  x: number;
  y: number;
}

interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
}

interface HandPathSample {
  timestamp: number;
  left: Point | null;
  right: Point | null;
  center: Point | null;
}

interface GestureFxState {
  gestureId: GestureId;
  characterId: CharacterId;
  grade: CastGrade;
  color: string;
  label: string;
  startedAt: number;
  duration: number;
  boss: boolean;
  perfectCounter: boolean;
  intensityBoost: number;
}

interface CharacterFxPalette {
  primary: string;
  secondary: string;
  accent: string;
  soft: string;
}

const wristIndexes = [15, 16] as const;
const skeletonPairs: Array<[number, number]> = [
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 12]
];

const characterPalettes: Record<CharacterId, CharacterFxPalette> = {
  rio: {
    primary: "#48f7ff",
    secondary: "#ffd166",
    accent: "#d7ff3f",
    soft: "#2f86ff"
  },
  maru: {
    primary: "#8c7aff",
    secondary: "#ffd166",
    accent: "#7dffb2",
    soft: "#c7b8ff"
  },
  neon: {
    primary: "#ff5ea8",
    secondary: "#48f7ff",
    accent: "#c7b8ff",
    soft: "#291f44"
  },
  cookie: {
    primary: "#ff7ad9",
    secondary: "#7dffb2",
    accent: "#ffd166",
    soft: "#ffb0e7"
  }
};

const gestureDisplayNames: Record<GestureId, string> = {
  slash: "슬래시",
  thrust: "스러스트",
  rise: "라이즈",
  "open-arms": "오픈 암",
  "cross-guard": "크로스 가드",
  "palm-push": "팜 푸시",
  "ground-slam": "그라운드 슬램",
  point: "포인트",
  circle: "서클",
  wave: "웨이브",
  spread: "스프레드",
  heart: "하트",
  "focus-triangle": "포커스 트라이앵글"
};

export class CameraFxOverlay {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly baseMaxParticles: number;
  private settings: CameraFxSettings = { ...defaultCameraFxSettings };
  private latestLandmarks: NormalizedLandmark[] | null = null;
  private status: PoseStatus = "idle";
  private context: Required<CameraFxContext> = {
    characterId: "rio",
    expectedGesture: null,
    isCapturing: false,
    lastGrade: null,
    color: "#48f7ff",
    label: "",
    boss: false
  };
  private handPath: HandPathSample[] = [];
  private resultFx: GestureFxState | null = null;
  private particles: BurstParticle[] = [];
  private performanceMode: PerformanceQuality = "balanced";
  private clearToken = 0;
  private lastTimestamp = performance.now();
  private width = 0;
  private height = 0;

  constructor(private readonly canvas: HTMLCanvasElement, options: CameraFxOverlayOptions = {}) {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      throw new Error("CameraFxOverlay requires a 2D canvas context.");
    }
    this.ctx = context;
    this.baseMaxParticles = options.maxParticles ?? 40;
    this.settings = {
      ...defaultCameraFxSettings,
      ...options.settings
    };
    this.resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            this.resizeCanvas();
            this.draw(performance.now());
          });
    this.resizeObserver?.observe(canvas);
    this.resizeCanvas();
  }

  setSettings(settings: Partial<CameraFxSettings>): void {
    this.settings = {
      ...this.settings,
      ...settings
    };
    if (!this.settings.arFxEnabled) {
      this.particles = [];
      this.resultFx = null;
    }
    this.draw(performance.now());
  }

  setPerformanceMode(mode: PerformanceQuality): void {
    if (this.performanceMode === mode) {
      return;
    }
    this.performanceMode = mode;
    this.trimParticlesToLimit();
    this.draw(performance.now());
  }

  getParticleCount(): number {
    return this.particles.length;
  }

  handleFrame(frame: PoseOverlayFrame): void {
    this.latestLandmarks = frame.landmarks;
    this.status = frame.status;
    this.pushHandPath(frame.timestamp, frame.landmarks);
    this.draw(frame.timestamp);
  }

  setContext(context: CameraFxContext): void {
    let changed = false;
    let startedCapture = false;
    if (context.characterId !== undefined && context.characterId !== this.context.characterId) {
      this.context.characterId = context.characterId;
      changed = true;
    }
    if (context.expectedGesture !== undefined && context.expectedGesture !== this.context.expectedGesture) {
      this.context.expectedGesture = context.expectedGesture;
      changed = true;
    }
    if (context.isCapturing !== undefined && context.isCapturing !== this.context.isCapturing) {
      this.context.isCapturing = context.isCapturing;
      startedCapture = Boolean(context.isCapturing && this.context.expectedGesture);
      changed = true;
    }
    if (context.lastGrade !== undefined && context.lastGrade !== this.context.lastGrade) {
      this.context.lastGrade = context.lastGrade;
      changed = true;
    }
    if (context.color !== undefined && context.color !== this.context.color) {
      this.context.color = context.color;
      changed = true;
    }
    if (context.label !== undefined && context.label !== this.context.label) {
      this.context.label = context.label;
      changed = true;
    }
    if (context.boss !== undefined && context.boss !== this.context.boss) {
      this.context.boss = context.boss;
      changed = true;
    }
    if (startedCapture || (context.expectedGesture && this.context.isCapturing)) {
      this.clearToken += 1;
    }
    if (changed) {
      this.draw(performance.now());
    }
  }

  setExpectedGesture(gestureId: GestureId, color: string, label = "", boss = false): void {
    this.setContext({
      expectedGesture: gestureId,
      isCapturing: true,
      lastGrade: null,
      color,
      label,
      boss
    });
  }

  clearExpectedGesture(delayMs = 0): void {
    const token = ++this.clearToken;
    const clear = () => {
      if (token !== this.clearToken) {
        return;
      }
      this.setContext({
        expectedGesture: null,
        isCapturing: false,
        label: "",
        boss: false
      });
    };
    if (delayMs <= 0) {
      clear();
      return;
    }
    window.setTimeout(clear, delayMs);
  }

  triggerBurst(grade: CastGrade, colorOrOptions?: string | CameraBurstOptions): void {
    if (!this.settings.arFxEnabled) {
      this.context.lastGrade = grade;
      return;
    }
    if (grade === "Miss") {
      this.context.lastGrade = grade;
      return;
    }
    const options = typeof colorOrOptions === "string" ? { color: colorOrOptions } : colorOrOptions ?? {};
    const gestureId = this.context.expectedGesture ?? this.resultFx?.gestureId ?? "rise";
    const burstColor = options.color ?? this.context.color ?? characterPalettes[this.context.characterId].primary;
    const isPerfectCounter = Boolean(options.perfectCounter || (this.context.boss && grade === "Perfect"));
    const boost = options.intensityBoost ?? (isPerfectCounter ? 1.55 : options.boss || this.context.boss ? 1.18 : 1);
    this.context.lastGrade = grade;
    this.resultFx = {
      gestureId,
      characterId: this.context.characterId,
      grade,
      color: burstColor,
      label: options.label ?? (isPerfectCounter ? "퍼펙트 카운터" : this.context.label),
      startedAt: performance.now(),
      duration: isPerfectCounter ? 1120 : grade === "Perfect" ? 880 : grade === "Great" ? 680 : 520,
      boss: options.boss ?? this.context.boss,
      perfectCounter: isPerfectCounter,
      intensityBoost: boost
    };
    this.spawnBurstParticles(grade, burstColor, boost);
    this.draw(performance.now());
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.particles = [];
    this.handPath = [];
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  private draw(timestamp: number): void {
    this.resizeCanvas();
    const deltaMs = Math.min(48, Math.max(0, timestamp - this.lastTimestamp));
    this.lastTimestamp = timestamp;
    this.ctx.clearRect(0, 0, this.width, this.height);

    if (!this.settings.arFxEnabled) {
      this.particles = [];
      return;
    }

    if (this.status !== "ready" && this.status !== "unstable") {
      this.drawIdle(timestamp);
      this.drawCaptureLabel(timestamp);
      this.drawParticles(deltaMs);
      return;
    }

    if (!this.latestLandmarks) {
      this.drawSearching(timestamp);
      this.drawCaptureLabel(timestamp);
      this.drawParticles(deltaMs);
      return;
    }

    if (this.settings.showSkeleton) {
      this.drawSkeleton();
    }
    if (this.settings.showHandGlow) {
      this.drawWristGlow(timestamp);
    }
    this.drawActiveGestureFx(timestamp);
    this.drawResultGestureFx(timestamp);
    this.drawCaptureLabel(timestamp);
    this.drawParticles(deltaMs);
  }

  private drawActiveGestureFx(timestamp: number): void {
    const gestureId = this.context.expectedGesture;
    if (!gestureId || !this.context.isCapturing) {
      return;
    }
    const palette = this.paletteFor(this.context.characterId);
    const grade = this.context.lastGrade ?? "Normal";
    this.drawGestureEffect({
      gestureId,
      characterId: this.context.characterId,
      grade,
      color: this.context.color || palette.primary,
      label: this.context.label,
      startedAt: timestamp - 220,
      duration: 1000,
      boss: this.context.boss,
      perfectCounter: false,
      intensityBoost: 1
    }, timestamp, true);
  }

  private drawResultGestureFx(timestamp: number): void {
    if (!this.resultFx) {
      return;
    }
    if (timestamp - this.resultFx.startedAt > this.resultFx.duration) {
      this.resultFx = null;
      return;
    }
    this.drawGestureEffect(this.resultFx, timestamp, false);
    this.drawResultStamp(this.resultFx, timestamp);
  }

  private drawCaptureLabel(timestamp: number): void {
    const gestureId = this.context.expectedGesture;
    if (!gestureId || !this.context.isCapturing) {
      return;
    }
    const color = this.context.color || this.paletteFor(this.context.characterId).primary;
    const label = this.context.label || (this.context.boss ? "보스 포즈" : "포즈 캐스트");
    const text = `${label} · ${gestureDisplayNames[gestureId]}`;
    const hint = this.context.boss ? "보스 포즈 브레이크" : "포즈 캐스트";
    const pulse = 0.68 + Math.sin(timestamp / 140) * 0.32;

    this.drawReadableOverlay(() => {
      this.ctx.save();
      this.ctx.font = "900 10px Inter, ui-sans-serif, system-ui, sans-serif";
      const width = Math.min(this.width - 16, Math.max(118, this.ctx.measureText(text).width + 24));
      const height = 34;
      const x = 8;
      const y = 8;
      this.ctx.globalAlpha = 0.88;
      this.ctx.fillStyle = "rgba(5, 8, 14, 0.76)";
      this.roundRectPath(x, y, width, height, 8);
      this.ctx.fill();
      this.ctx.lineWidth = 1.4;
      this.ctx.strokeStyle = withAlpha(color, 0.48 + pulse * 0.22);
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = 8 * this.glowMultiplier();
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
      this.ctx.fillStyle = withAlpha(color, 0.96);
      this.ctx.fillText(text, x + 10, y + 15);
      this.ctx.fillStyle = "rgba(246, 251, 255, 0.68)";
      this.ctx.font = "800 8px Inter, ui-sans-serif, system-ui, sans-serif";
      this.ctx.fillText(hint, x + 10, y + 27);
      this.ctx.restore();
    });
  }

  private drawResultStamp(effect: GestureFxState, timestamp: number): void {
    const progress = Math.min(1, Math.max(0, (timestamp - effect.startedAt) / effect.duration));
    const color = effect.color || this.paletteFor(effect.characterId).primary;
    const title = effect.perfectCounter
      ? "퍼펙트 카운터"
      : effect.grade === "Perfect"
        ? "퍼펙트 캐스트"
        : effect.grade === "Great"
          ? "그레이트 캐스트"
          : "노멀 캐스트";
    const subtitle = effect.label && effect.label !== title ? effect.label : gestureDisplayNames[effect.gestureId];
    const scale = effect.perfectCounter ? 1.08 + Math.sin(timestamp / 72) * 0.04 : 1;
    const alpha = Math.max(0, 1 - progress * 0.85);

    this.drawReadableOverlay(() => {
      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      this.ctx.translate(this.width * 0.5, this.height * (effect.perfectCounter ? 0.5 : 0.56));
      this.ctx.scale(scale, scale);
      this.ctx.font = `${effect.perfectCounter ? 900 : 850} ${effect.perfectCounter ? 19 : 15}px Inter, ui-sans-serif, system-ui, sans-serif`;
      const titleWidth = this.ctx.measureText(title).width;
      const boxWidth = Math.min(this.width - 22, Math.max(titleWidth + 30, effect.perfectCounter ? 178 : 136));
      const boxHeight = effect.perfectCounter ? 52 : 42;
      this.ctx.fillStyle = effect.perfectCounter ? "rgba(255, 209, 102, 0.16)" : "rgba(5, 8, 14, 0.62)";
      this.ctx.strokeStyle = withAlpha(effect.perfectCounter ? "#ffd166" : color, effect.perfectCounter ? 0.92 : 0.72);
      this.ctx.lineWidth = effect.perfectCounter ? 2.2 : 1.4;
      this.ctx.shadowColor = effect.perfectCounter ? "#ffd166" : color;
      this.ctx.shadowBlur = (effect.perfectCounter ? 24 : 14) * this.glowMultiplier();
      this.roundRectPath(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, 10);
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
      this.ctx.textAlign = "center";
      this.ctx.fillStyle = effect.perfectCounter ? "#fff2c7" : withAlpha(color, 0.98);
      this.ctx.fillText(title, 0, -2);
      this.ctx.font = "850 8px Inter, ui-sans-serif, system-ui, sans-serif";
      this.ctx.fillStyle = "rgba(246, 251, 255, 0.76)";
      this.ctx.fillText(subtitle, 0, 14);
      this.ctx.restore();
    });
  }

  private drawGestureEffect(effect: GestureFxState, timestamp: number, persistent: boolean): void {
    const progress = Math.min(1, Math.max(0, (timestamp - effect.startedAt) / effect.duration));
    const palette = this.paletteFor(effect.characterId);
    const color = effect.color || palette.primary;
    const grade = effect.grade;
    const alpha = persistent ? 0.76 : 1 - progress * 0.74;

    this.ctx.save();
    this.ctx.globalCompositeOperation = "lighter";
    this.ctx.globalAlpha = Math.min(1, alpha * (0.72 + this.intensityMultiplier() * 0.28));
    this.ctx.strokeStyle = withAlpha(color, effect.boss ? 0.95 : 0.78);
    this.ctx.fillStyle = withAlpha(color, 0.2);
    this.ctx.shadowColor = color;
    this.ctx.shadowBlur = (effect.boss ? 18 : 12) * this.glowMultiplier() * effect.intensityBoost;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    if (effect.gestureId === "rise") {
      this.drawRiseFx(timestamp, grade, palette, progress);
    } else if (effect.gestureId === "slash" || effect.gestureId === "wave") {
      this.drawSlashFx(timestamp, grade, palette);
    } else if (effect.gestureId === "cross-guard") {
      this.drawCrossGuardFx(timestamp, grade, palette, progress);
    } else if (effect.gestureId === "thrust" || effect.gestureId === "palm-push" || effect.gestureId === "point") {
      this.drawPushFx(timestamp, grade, palette, progress);
    } else if (effect.gestureId === "circle") {
      this.drawCircleFx(timestamp, grade, palette, effect.characterId, progress);
    } else if (effect.gestureId === "open-arms" || effect.gestureId === "spread") {
      this.drawOpenArmsFx(timestamp, grade, palette, progress);
    } else if (effect.gestureId === "heart") {
      this.drawHeartFx(timestamp, grade, palette, progress);
    } else if (effect.gestureId === "focus-triangle") {
      this.drawFocusTriangleFx(timestamp, grade, palette, progress);
    } else if (effect.gestureId === "ground-slam") {
      const center = this.getHandsCanvasCenter();
      this.drawImpactRing(center.x, center.y + 28, 22 + progress * 34);
    }
    this.ctx.restore();
  }

  private drawRiseFx(timestamp: number, grade: CastGrade, palette: CharacterFxPalette, progress: number): void {
    const wrists = this.getWristCanvasPoints();
    const focus = wrists.left && wrists.right ? (wrists.left.y < wrists.right.y ? wrists.left : wrists.right) : wrists.left ?? wrists.right ?? this.getGuideCenter();
    const pulse = 0.6 + Math.sin(timestamp / 86) * 0.4;
    const radius = 12 + gradePower(grade) * 7 + pulse * 4;
    this.ctx.fillStyle = radialGradient(this.ctx, focus.x, focus.y - 18, radius, palette.secondary, palette.primary);
    this.ctx.beginPath();
    this.ctx.arc(focus.x, focus.y - 18, radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.drawFlame(focus.x, focus.y - 14, radius * 1.2, palette);
    if (grade === "Perfect") {
      this.ctx.lineWidth = 2.5;
      this.ctx.strokeStyle = withAlpha(palette.accent, 0.92);
      for (let index = 0; index < 3; index += 1) {
        this.drawLightning(focus.x + (index - 1) * 14, focus.y - 28 + Math.sin(timestamp / 80 + index) * 5, 24 + progress * 18);
      }
      this.ctx.strokeStyle = withAlpha(palette.primary, 0.55);
      this.ctx.beginPath();
      this.ctx.arc(focus.x, focus.y - 18, 30 + progress * 38, 0, Math.PI * 2);
      this.ctx.stroke();
    }
  }

  private drawSlashFx(timestamp: number, grade: CastGrade, palette: CharacterFxPalette): void {
    const path = this.getDominantCanvasPath(740);
    if (path.length < 2) {
      const center = this.getGuideCenter();
      this.drawArcSwipe(center.x, center.y, 34 + gradePower(grade) * 8);
      return;
    }
    const width = grade === "Perfect" ? 8 : grade === "Great" ? 6 : 3.5;
    this.ctx.lineWidth = width;
    this.ctx.shadowBlur = grade === "Normal" ? 10 : 24;
    this.ctx.strokeStyle = withAlpha(palette.primary, grade === "Normal" ? 0.72 : 0.96);
    this.drawPath(path);
    this.ctx.lineWidth = Math.max(1.5, width * 0.38);
    this.ctx.strokeStyle = withAlpha(palette.secondary, 0.92);
    this.drawPath(path.slice(Math.max(0, path.length - 8)));
    if (grade !== "Normal") {
      const end = path[path.length - 1];
      this.ctx.fillStyle = withAlpha(palette.accent, 0.86);
      this.ctx.beginPath();
      this.ctx.arc(end.x, end.y, 5 + Math.sin(timestamp / 92) * 2, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private drawCrossGuardFx(timestamp: number, grade: CastGrade, palette: CharacterFxPalette, progress: number): void {
    const center = this.getHandsCanvasCenter();
    const size = 24 + gradePower(grade) * 8 + Math.sin(timestamp / 120) * 3;
    this.ctx.lineWidth = grade === "Perfect" ? 3.2 : 2.2;
    this.ctx.strokeStyle = withAlpha(palette.secondary, 0.92);
    this.ctx.fillStyle = withAlpha(palette.primary, 0.16);
    this.drawShield(center.x, center.y, size);
    this.ctx.strokeStyle = withAlpha(palette.accent, 0.78);
    this.drawCross(center.x, center.y - 3, size * 0.55);
    if (grade === "Perfect") {
      this.ctx.lineWidth = 2;
      this.ctx.strokeStyle = withAlpha(palette.secondary, 1 - progress * 0.3);
      this.ctx.beginPath();
      this.ctx.arc(center.x, center.y, size + progress * 58, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.arc(center.x, center.y, size + 10 + progress * 34, 0, Math.PI * 2);
      this.ctx.stroke();
    }
  }

  private drawPushFx(timestamp: number, grade: CastGrade, palette: CharacterFxPalette, progress: number): void {
    const wrists = this.getWristCanvasPoints();
    const points = [wrists.left, wrists.right].filter((point): point is Point => Boolean(point));
    const sourcePoints = points.length > 0 ? points : [this.getGuideCenter()];
    const power = gradePower(grade);
    for (const point of sourcePoints) {
      this.ctx.lineWidth = 2 + power * 1.4;
      this.ctx.strokeStyle = withAlpha(palette.secondary, 0.82);
      for (let ring = 0; ring < 3; ring += 1) {
        const radius = 8 + ring * 11 + progress * (28 + power * 18);
        this.ctx.globalAlpha = Math.max(0, 0.92 - progress * 0.65 - ring * 0.18);
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        this.ctx.stroke();
      }
    }
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = withAlpha(palette.primary, 0.18 + Math.sin(timestamp / 90) * 0.04);
  }

  private drawCircleFx(timestamp: number, grade: CastGrade, palette: CharacterFxPalette, characterId: CharacterId, progress: number): void {
    const path = this.getDominantCanvasPath(1100);
    const center = averagePoint(path) ?? this.getHandsCanvasCenter();
    const radius = Math.max(20, pathBoundsRadius(path, center) || 28) + gradePower(grade) * 5;
    if (path.length >= 3) {
      this.ctx.lineWidth = grade === "Perfect" ? 5 : grade === "Great" ? 4 : 2.5;
      this.ctx.strokeStyle = withAlpha(characterId === "cookie" ? palette.primary : characterId === "neon" ? palette.secondary : palette.primary, 0.9);
      this.drawPath(path);
    }
    if (characterId === "cookie") {
      this.drawJellyRing(center.x, center.y, radius, palette, timestamp, progress);
    } else if (characterId === "neon") {
      this.drawGlitchRing(center.x, center.y, radius, palette, timestamp);
    } else {
      this.drawMagicRing(center.x, center.y, radius, palette, timestamp);
    }
  }

  private drawOpenArmsFx(timestamp: number, grade: CastGrade, palette: CharacterFxPalette, progress: number): void {
    const bounds = this.getUpperBodyBounds();
    const pulse = 0.68 + Math.sin(timestamp / 130) * 0.32;
    this.ctx.lineWidth = 2.4 + gradePower(grade) * 1.5;
    this.ctx.strokeStyle = withAlpha(palette.primary, 0.78);
    this.ctx.fillStyle = withAlpha(palette.primary, 0.08 + pulse * 0.04);
    this.ctx.beginPath();
    this.ctx.ellipse(bounds.x, bounds.y, bounds.rx + pulse * 8, bounds.ry + pulse * 6, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.strokeStyle = withAlpha(palette.secondary, 0.66);
    this.ctx.beginPath();
    this.ctx.ellipse(bounds.x, bounds.y, bounds.rx * 0.68, bounds.ry * 1.12, 0.1, 0, Math.PI * 2);
    this.ctx.stroke();
    if (grade === "Perfect") {
      const edge = 4 + progress * 16;
      this.ctx.fillStyle = withAlpha(palette.accent, 0.12 * (1 - progress * 0.35));
      this.ctx.fillRect(0, 0, this.width, edge);
      this.ctx.fillRect(0, this.height - edge, this.width, edge);
      this.ctx.fillRect(0, 0, edge, this.height);
      this.ctx.fillRect(this.width - edge, 0, edge, this.height);
    }
  }

  private drawHeartFx(timestamp: number, grade: CastGrade, palette: CharacterFxPalette, progress: number): void {
    const center = this.getHandsCanvasCenter();
    const size = 24 + gradePower(grade) * 9 + Math.sin(timestamp / 110) * 3;
    this.ctx.lineWidth = 2.5;
    this.ctx.strokeStyle = withAlpha(palette.primary, 0.94);
    this.ctx.fillStyle = withAlpha(palette.primary, 0.18);
    this.drawHeartShape(center.x, center.y, size, true);
    this.ctx.fillStyle = withAlpha(palette.secondary, 0.62);
    const bubbleCount = grade === "Perfect" ? 9 : 5;
    for (let index = 0; index < bubbleCount; index += 1) {
      const angle = timestamp / 520 + index * ((Math.PI * 2) / bubbleCount);
      const distance = size * (0.9 + (index % 3) * 0.22) + progress * 14;
      const x = center.x + Math.cos(angle) * distance;
      const y = center.y + Math.sin(angle * 1.2) * distance * 0.62;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 3.5 + (index % 2) * 2, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private drawFocusTriangleFx(timestamp: number, grade: CastGrade, palette: CharacterFxPalette, progress: number): void {
    const face = this.latestLandmarks?.[0] ? this.pointFor(this.latestLandmarks[0]) : this.getHandsCanvasCenter();
    const center = {
      x: face.x,
      y: face.y + 10
    };
    const size = 34 + gradePower(grade) * 7 + Math.sin(timestamp / 100) * 3;
    this.ctx.lineWidth = grade === "Perfect" ? 3.2 : 2.2;
    this.ctx.strokeStyle = withAlpha(palette.secondary, 0.94);
    this.ctx.fillStyle = withAlpha(palette.primary, 0.1);
    this.drawTriangleGuide(center.x, center.y, size);
    this.ctx.strokeStyle = withAlpha(palette.primary, 0.8);
    for (let index = 0; index < 5; index += 1) {
      const y = center.y - size * 0.48 + index * (size * 0.24);
      const offset = Math.sin(timestamp / 72 + index) * (grade === "Perfect" ? 8 : 4);
      this.ctx.beginPath();
      this.ctx.moveTo(center.x - size * 0.52 + offset, y);
      this.ctx.lineTo(center.x + size * 0.52 + offset, y);
      this.ctx.stroke();
    }
    if (grade === "Perfect") {
      this.ctx.fillStyle = withAlpha(palette.secondary, 0.25 * (1 - progress * 0.4));
      for (let index = 0; index < 8; index += 1) {
        const x = center.x - size + ((index * 17 + timestamp / 12) % (size * 2));
        const y = center.y - size + ((index * 11 + timestamp / 16) % (size * 2));
        this.ctx.fillRect(x, y, 4, 4);
      }
    }
  }

  private spawnBurstParticles(grade: CastGrade, color: string, intensityBoost = 1): void {
    if (!this.settings.arFxEnabled) {
      return;
    }
    const center = this.getHandsCenter();
    const count = Math.max(4, Math.round((grade === "Perfect" ? 30 : grade === "Great" ? 20 : 13) * this.intensityMultiplier() * intensityBoost));
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + Math.random() * 0.24;
      const speed =
        (grade === "Perfect" ? 0.42 + Math.random() * 0.32 : 0.24 + Math.random() * 0.24) *
        (0.8 + this.intensityMultiplier() * 0.2) *
        intensityBoost;
      this.particles.push({
        x: center.x,
        y: center.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: (grade === "Perfect" ? 680 : 480) * (0.84 + this.intensityMultiplier() * 0.16) * Math.min(1.35, intensityBoost),
        size: (grade === "Perfect" ? 3.4 + Math.random() * 2.6 : 2.1 + Math.random() * 1.8) * this.glowMultiplier() * Math.min(1.4, intensityBoost),
        color
      });
    }
    const limit = Math.round(this.particleLimit() * Math.min(1.6, intensityBoost));
    if (this.particles.length > limit) {
      this.particles.splice(0, this.particles.length - limit);
    }
  }

  private resizeCanvas(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    this.width = width;
    this.height = height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawIdle(timestamp: number): void {
    const pulse = 0.5 + Math.sin(timestamp / 360) * 0.5;
    const radius = 13 + pulse * 5;
    this.ctx.save();
    this.ctx.globalAlpha = 0.18 + pulse * 0.08;
    this.ctx.strokeStyle = "#48f7ff";
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.arc(this.width * 0.5, this.height * 0.46, radius, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawSearching(timestamp: number): void {
    const y = ((timestamp / 9) % (this.height + 28)) - 14;
    this.ctx.save();
    this.ctx.globalAlpha = 0.42;
    this.ctx.strokeStyle = "#ffd166";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(12, y);
    this.ctx.lineTo(this.width - 12, y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawSkeleton(): void {
    if (!this.latestLandmarks) {
      return;
    }
    const glow = this.glowMultiplier();
    this.ctx.save();
    this.ctx.strokeStyle = `rgba(72, 247, 255, ${0.3 + glow * 0.12})`;
    this.ctx.lineWidth = 1.1 + glow * 0.3;
    this.ctx.shadowColor = "#48f7ff";
    this.ctx.shadowBlur = 4 * glow;
    for (const [fromIndex, toIndex] of skeletonPairs) {
      const from = this.pointFor(this.latestLandmarks[fromIndex]);
      const to = this.pointFor(this.latestLandmarks[toIndex]);
      this.ctx.beginPath();
      this.ctx.moveTo(from.x, from.y);
      this.ctx.lineTo(to.x, to.y);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawWristGlow(timestamp: number): void {
    if (!this.latestLandmarks) {
      return;
    }
    const palette = this.paletteFor(this.context.characterId);
    const pulse = 0.72 + Math.sin(timestamp / 140) * 0.28;
    const glow = this.glowMultiplier();
    for (const index of wristIndexes) {
      const wrist = this.latestLandmarks[index];
      if (!wrist) {
        continue;
      }
      const point = this.pointFor(wrist);
      const color = index === 15 ? palette.primary : palette.secondary;
      this.ctx.save();
      this.ctx.globalCompositeOperation = "lighter";
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = 14 * glow;
      this.ctx.fillStyle = withAlpha(color, 0.82);
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, (3.5 + pulse * 2.5) * glow, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = withAlpha(color, 0.32);
      this.ctx.lineWidth = 1.4 + glow * 0.6;
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, (11 + pulse * 4) * glow, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  private drawParticles(deltaMs: number): void {
    if (this.particles.length === 0) {
      return;
    }
    const glow = this.glowMultiplier();
    this.ctx.save();
    this.ctx.globalCompositeOperation = "lighter";
    for (const particle of this.particles) {
      particle.age += deltaMs;
      particle.x += particle.vx * (deltaMs / 1000);
      particle.y += particle.vy * (deltaMs / 1000);
      const lifeRatio = Math.max(0, 1 - particle.age / particle.life);
      const point = {
        x: particle.x * this.width,
        y: particle.y * this.height
      };
      this.ctx.globalAlpha = lifeRatio;
      this.ctx.shadowColor = particle.color;
      this.ctx.shadowBlur = 12 * glow;
      this.ctx.fillStyle = particle.color;
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, particle.size * (0.55 + lifeRatio), 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
    this.particles = this.particles.filter((particle) => particle.age < particle.life);
    this.trimParticlesToLimit();
  }

  private pushHandPath(timestamp: number, landmarks: NormalizedLandmark[] | null): void {
    if (!landmarks) {
      return;
    }
    const left = landmarks[15] ? { x: landmarks[15].x, y: landmarks[15].y } : null;
    const right = landmarks[16] ? { x: landmarks[16].x, y: landmarks[16].y } : null;
    const center =
      left && right
        ? {
            x: (left.x + right.x) / 2,
            y: (left.y + right.y) / 2
          }
        : left ?? right;
    if (!center) {
      return;
    }
    this.handPath.push({ timestamp, left, right, center });
    const cutoff = timestamp - 1300;
    while (this.handPath.length > 0 && this.handPath[0].timestamp < cutoff) {
      this.handPath.shift();
    }
    if (this.handPath.length > 72) {
      this.handPath.splice(0, this.handPath.length - 72);
    }
  }

  private getHandsCenter(): Point {
    if (!this.latestLandmarks) {
      return { x: 0.5, y: 0.48 };
    }
    const left = this.latestLandmarks[15];
    const right = this.latestLandmarks[16];
    if (!left || !right) {
      return { x: 0.5, y: 0.48 };
    }
    return {
      x: (left.x + right.x) / 2,
      y: (left.y + right.y) / 2
    };
  }

  private getHandsCanvasCenter(): Point {
    const center = this.getHandsCenter();
    return {
      x: center.x * this.width,
      y: center.y * this.height
    };
  }

  private getWristCanvasPoints(): { left: Point | null; right: Point | null } {
    return {
      left: this.latestLandmarks?.[15] ? this.pointFor(this.latestLandmarks[15]) : null,
      right: this.latestLandmarks?.[16] ? this.pointFor(this.latestLandmarks[16]) : null
    };
  }

  private getGuideCenter(): Point {
    if (!this.latestLandmarks) {
      return { x: this.width * 0.5, y: this.height * 0.48 };
    }
    const left = this.latestLandmarks[11];
    const right = this.latestLandmarks[12];
    const leftWrist = this.latestLandmarks[15];
    const rightWrist = this.latestLandmarks[16];
    const x = ((left?.x ?? 0.42) + (right?.x ?? 0.58) + (leftWrist?.x ?? 0.42) + (rightWrist?.x ?? 0.58)) / 4;
    const y = ((left?.y ?? 0.42) + (right?.y ?? 0.42) + (leftWrist?.y ?? 0.56) + (rightWrist?.y ?? 0.56)) / 4;
    return { x: x * this.width, y: y * this.height };
  }

  private getUpperBodyBounds(): { x: number; y: number; rx: number; ry: number } {
    const points = [11, 12, 15, 16]
      .map((index) => (this.latestLandmarks?.[index] ? this.pointFor(this.latestLandmarks[index]) : null))
      .filter((point): point is Point => Boolean(point));
    if (points.length === 0) {
      return { x: this.width * 0.5, y: this.height * 0.48, rx: this.width * 0.36, ry: this.height * 0.34 };
    }
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      rx: Math.max(32, (maxX - minX) / 2 + 24),
      ry: Math.max(28, (maxY - minY) / 2 + 22)
    };
  }

  private getDominantCanvasPath(durationMs: number): Point[] {
    const cutoff = performance.now() - durationMs;
    const samples = this.handPath.filter((sample) => sample.timestamp >= cutoff);
    const leftPath = samples.map((sample) => sample.left).filter((point): point is Point => Boolean(point));
    const rightPath = samples.map((sample) => sample.right).filter((point): point is Point => Boolean(point));
    const chosen = totalPathDistance(leftPath) > totalPathDistance(rightPath) ? leftPath : rightPath;
    return chosen.map((point) => ({
      x: point.x * this.width,
      y: point.y * this.height
    }));
  }

  private pointFor(landmark: NormalizedLandmark): Point {
    return {
      x: landmark.x * this.width,
      y: landmark.y * this.height
    };
  }

  private paletteFor(characterId: CharacterId): CharacterFxPalette {
    return characterPalettes[characterId] ?? characterPalettes.rio;
  }

  private intensityMultiplier(): number {
    const multipliers: Record<CameraFxIntensity, number> = {
      low: 0.55,
      medium: 1,
      high: 1.45
    };
    const performanceMultipliers: Record<PerformanceQuality, number> = {
      high: 1,
      balanced: 0.78,
      performance: 0.42
    };
    return multipliers[this.settings.arFxIntensity] * performanceMultipliers[this.performanceMode];
  }

  private glowMultiplier(): number {
    const multipliers: Record<CameraFxIntensity, number> = {
      low: 0.68,
      medium: 1,
      high: 1.35
    };
    const performanceMultipliers: Record<PerformanceQuality, number> = {
      high: 1,
      balanced: 0.84,
      performance: 0.5
    };
    return multipliers[this.settings.arFxIntensity] * performanceMultipliers[this.performanceMode];
  }

  private particleLimit(): number {
    const caps: Record<PerformanceQuality, number> = {
      high: 72,
      balanced: 42,
      performance: 20
    };
    return Math.max(6, Math.min(caps[this.performanceMode], Math.round(this.baseMaxParticles * this.intensityMultiplier())));
  }

  private trimParticlesToLimit(): void {
    const limit = this.particleLimit();
    if (this.particles.length > limit) {
      this.particles.splice(0, this.particles.length - limit);
    }
  }

  private drawReadableOverlay(draw: () => void): void {
    this.ctx.save();
    this.ctx.translate(this.width, 0);
    this.ctx.scale(-1, 1);
    draw();
    this.ctx.restore();
  }

  private roundRectPath(x: number, y: number, width: number, height: number, radius: number): void {
    const r = Math.min(radius, width / 2, height / 2);
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.lineTo(x + width - r, y);
    this.ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    this.ctx.lineTo(x + width, y + height - r);
    this.ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    this.ctx.lineTo(x + r, y + height);
    this.ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    this.ctx.lineTo(x, y + r);
    this.ctx.quadraticCurveTo(x, y, x + r, y);
    this.ctx.closePath();
  }

  private drawPath(path: Point[]): void {
    if (path.length < 2) {
      return;
    }
    this.ctx.beginPath();
    this.ctx.moveTo(path[0].x, path[0].y);
    for (let index = 1; index < path.length; index += 1) {
      const prev = path[index - 1];
      const current = path[index];
      this.ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + current.x) / 2, (prev.y + current.y) / 2);
    }
    this.ctx.stroke();
  }

  private drawArrow(fromX: number, fromY: number, toX: number, toY: number): void {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    this.ctx.beginPath();
    this.ctx.moveTo(fromX, fromY);
    this.ctx.lineTo(toX, toY);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(toX, toY);
    this.ctx.lineTo(toX - Math.cos(angle - 0.62) * 10, toY - Math.sin(angle - 0.62) * 10);
    this.ctx.lineTo(toX - Math.cos(angle + 0.62) * 10, toY - Math.sin(angle + 0.62) * 10);
    this.ctx.closePath();
    this.ctx.fill();
  }

  private drawArcSwipe(x: number, y: number, radius: number): void {
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, -0.68, 0.92);
    this.ctx.stroke();
  }

  private drawImpactRing(x: number, y: number, radius: number): void {
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, radius * 1.3, radius * 0.42, 0, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  private drawLightning(x: number, y: number, size: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(x, y - size);
    this.ctx.lineTo(x - size * 0.32, y);
    this.ctx.lineTo(x + size * 0.05, y);
    this.ctx.lineTo(x - size * 0.14, y + size);
    this.ctx.lineTo(x + size * 0.46, y - size * 0.16);
    this.ctx.lineTo(x + size * 0.08, y - size * 0.16);
    this.ctx.closePath();
    this.ctx.fill();
  }

  private drawFlame(x: number, y: number, size: number, palette: CharacterFxPalette): void {
    this.ctx.fillStyle = withAlpha(palette.secondary, 0.28);
    this.ctx.beginPath();
    this.ctx.moveTo(x, y - size);
    this.ctx.bezierCurveTo(x - size * 0.85, y - size * 0.15, x - size * 0.42, y + size * 0.8, x, y + size * 0.55);
    this.ctx.bezierCurveTo(x + size * 0.55, y + size * 0.42, x + size * 0.74, y - size * 0.2, x, y - size);
    this.ctx.fill();
  }

  private drawCross(x: number, y: number, size: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(x - size, y - size * 0.62);
    this.ctx.lineTo(x + size, y + size * 0.62);
    this.ctx.moveTo(x + size, y - size * 0.62);
    this.ctx.lineTo(x - size, y + size * 0.62);
    this.ctx.stroke();
  }

  private drawShield(x: number, y: number, size: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(x, y - size);
    this.ctx.quadraticCurveTo(x + size * 0.82, y - size * 0.62, x + size * 0.62, y + size * 0.2);
    this.ctx.quadraticCurveTo(x + size * 0.34, y + size * 0.82, x, y + size);
    this.ctx.quadraticCurveTo(x - size * 0.34, y + size * 0.82, x - size * 0.62, y + size * 0.2);
    this.ctx.quadraticCurveTo(x - size * 0.82, y - size * 0.62, x, y - size);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
  }

  private drawMagicRing(x: number, y: number, radius: number, palette: CharacterFxPalette, timestamp: number): void {
    this.ctx.lineWidth = 2.6;
    this.ctx.strokeStyle = withAlpha(palette.primary, 0.9);
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.strokeStyle = withAlpha(palette.secondary, 0.72);
    this.ctx.setLineDash([6, 6]);
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * 0.74 + Math.sin(timestamp / 110) * 3, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    this.drawTriangleGuide(x, y, radius * 0.82);
  }

  private drawJellyRing(x: number, y: number, radius: number, palette: CharacterFxPalette, timestamp: number, progress: number): void {
    this.ctx.lineWidth = 3.2;
    this.ctx.strokeStyle = withAlpha(palette.primary, 0.9);
    this.ctx.fillStyle = withAlpha(palette.primary, 0.12);
    this.ctx.beginPath();
    for (let index = 0; index <= 28; index += 1) {
      const angle = (Math.PI * 2 * index) / 28;
      const wobble = Math.sin(timestamp / 100 + index * 1.7) * 4;
      const px = x + Math.cos(angle) * (radius + wobble);
      const py = y + Math.sin(angle) * (radius * 0.82 + wobble);
      if (index === 0) {
        this.ctx.moveTo(px, py);
      } else {
        this.ctx.lineTo(px, py);
      }
    }
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.fillStyle = withAlpha(palette.secondary, 0.62);
    for (let index = 0; index < 6; index += 1) {
      const angle = timestamp / 600 + index * (Math.PI / 3);
      this.ctx.beginPath();
      this.ctx.arc(x + Math.cos(angle) * (radius + 7), y + Math.sin(angle) * (radius * 0.72 + 5), 3 + progress * 2, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private drawGlitchRing(x: number, y: number, radius: number, palette: CharacterFxPalette, timestamp: number): void {
    this.ctx.lineWidth = 2.4;
    this.ctx.strokeStyle = withAlpha(palette.secondary, 0.92);
    for (let index = 0; index < 10; index += 1) {
      const start = ((index / 10) * Math.PI * 2 + timestamp / 420) % (Math.PI * 2);
      const end = start + 0.2 + (index % 3) * 0.09;
      const offset = (index % 2 === 0 ? 1 : -1) * 3;
      this.ctx.beginPath();
      this.ctx.arc(x + offset, y, radius + (index % 3) * 4, start, end);
      this.ctx.stroke();
    }
    this.ctx.fillStyle = withAlpha(palette.primary, 0.7);
    for (let index = 0; index < 7; index += 1) {
      const px = x + Math.cos(index * 1.8 + timestamp / 260) * radius;
      const py = y + Math.sin(index * 1.4 + timestamp / 310) * radius * 0.75;
      this.ctx.fillRect(px, py, 4, 4);
    }
  }

  private drawTriangleGuide(x: number, y: number, size: number): void {
    this.ctx.beginPath();
    this.ctx.moveTo(x, y - size * 0.7);
    this.ctx.lineTo(x - size * 0.72, y + size * 0.54);
    this.ctx.lineTo(x + size * 0.72, y + size * 0.54);
    this.ctx.closePath();
    this.ctx.stroke();
  }

  private drawHeartShape(x: number, y: number, size: number, fill = false): void {
    this.ctx.beginPath();
    this.ctx.moveTo(x, y + size * 0.45);
    this.ctx.bezierCurveTo(x - size, y - size * 0.1, x - size * 0.55, y - size * 0.9, x, y - size * 0.38);
    this.ctx.bezierCurveTo(x + size * 0.55, y - size * 0.9, x + size, y - size * 0.1, x, y + size * 0.45);
    if (fill) {
      this.ctx.fill();
    }
    this.ctx.stroke();
  }
}

function withAlpha(color: string, alpha: number): string {
  if (!color.startsWith("#")) {
    return color;
  }
  const hex = color.replace("#", "");
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((part) => part + part)
          .join("")
      : hex.padEnd(6, "0").slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function radialGradient(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, inner: string, outer: string): CanvasGradient {
  const gradient = ctx.createRadialGradient(x, y, Math.max(1, radius * 0.12), x, y, Math.max(2, radius));
  gradient.addColorStop(0, withAlpha(inner, 0.95));
  gradient.addColorStop(0.48, withAlpha(outer, 0.42));
  gradient.addColorStop(1, withAlpha(outer, 0));
  return gradient;
}

function gradePower(grade: CastGrade): number {
  if (grade === "Perfect") {
    return 1;
  }
  if (grade === "Great") {
    return 0.72;
  }
  if (grade === "Normal") {
    return 0.42;
  }
  return 0.16;
}

function totalPathDistance(path: Point[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y);
  }
  return total;
}

function averagePoint(path: Point[]): Point | null {
  if (path.length === 0) {
    return null;
  }
  return {
    x: path.reduce((sum, point) => sum + point.x, 0) / path.length,
    y: path.reduce((sum, point) => sum + point.y, 0) / path.length
  };
}

function pathBoundsRadius(path: Point[], center: Point): number {
  if (path.length === 0) {
    return 0;
  }
  return Math.max(...path.map((point) => Math.hypot(point.x - center.x, point.y - center.y)));
}
