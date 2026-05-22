export type PerformanceQuality = "high" | "balanced" | "performance";

export interface PerformanceMetrics {
  fps: number;
  fpsAverage: number;
  fpsMinRecent: number;
  poseFps: number;
  cameraFxParticles: number;
  activePhaserTexts: number;
  enemies: number;
  projectiles: number;
}

interface SceneMetrics {
  activePhaserTexts?: number;
  enemies?: number;
  projectiles?: number;
}

const maxFpsSamples = 240;

export class PerformanceMonitor {
  private fpsSamples: number[] = [];
  private fpsCurrent = 0;
  private poseFps = 0;
  private cameraFxParticles = 0;
  private activePhaserTexts = 0;
  private enemies = 0;
  private projectiles = 0;

  recordFrame(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      return;
    }
    this.fpsCurrent = Math.min(240, 1000 / deltaMs);
    this.fpsSamples.push(this.fpsCurrent);
    if (this.fpsSamples.length > maxFpsSamples) {
      this.fpsSamples.shift();
    }
  }

  setPoseFps(value: number): void {
    this.poseFps = sanitizeMetric(value);
  }

  setCameraFxParticles(value: number): void {
    this.cameraFxParticles = Math.max(0, Math.round(sanitizeMetric(value)));
  }

  setSceneMetrics(metrics: SceneMetrics): void {
    if (metrics.activePhaserTexts !== undefined) {
      this.activePhaserTexts = Math.max(0, Math.round(sanitizeMetric(metrics.activePhaserTexts)));
    }
    if (metrics.enemies !== undefined) {
      this.enemies = Math.max(0, Math.round(sanitizeMetric(metrics.enemies)));
    }
    if (metrics.projectiles !== undefined) {
      this.projectiles = Math.max(0, Math.round(sanitizeMetric(metrics.projectiles)));
    }
  }

  getMetrics(overrides: SceneMetrics = {}): PerformanceMetrics {
    this.setSceneMetrics(overrides);
    const fpsAverage =
      this.fpsSamples.length === 0 ? this.fpsCurrent : this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length;
    const recent = this.fpsSamples.slice(-90);
    const fpsMinRecent = recent.length === 0 ? this.fpsCurrent : Math.min(...recent);
    return {
      fps: Math.round(this.fpsCurrent),
      fpsAverage: Math.round(fpsAverage),
      fpsMinRecent: Math.round(fpsMinRecent),
      poseFps: Math.round(this.poseFps),
      cameraFxParticles: this.cameraFxParticles,
      activePhaserTexts: this.activePhaserTexts,
      enemies: this.enemies,
      projectiles: this.projectiles
    };
  }
}

function sanitizeMetric(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
