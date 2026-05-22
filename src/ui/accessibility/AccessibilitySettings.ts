import type { CameraFxIntensity } from "../camera/CameraFxOverlay";
import type { PerformanceQuality } from "../../game/performance/PerformanceMonitor";

export type ScreenShakeMode = "on" | "reduced" | "off";
export type FlashMode = "on" | "reduced" | "off";
export type TextScaleMode = "normal" | "large";

export interface AccessibilitySettings {
  screenShake: ScreenShakeMode;
  flashes: FlashMode;
  cameraOriginalVisible: boolean;
  cameraArIntensity: CameraFxIntensity;
  textScale: TextScaleMode;
  highContrastUi: boolean;
  colorBlindAssist: boolean;
  keyboardFallbackEnabled: boolean;
  reducedMotion: boolean;
  performanceMode: PerformanceQuality;
}

export const ACCESSIBILITY_SETTINGS_STORAGE_KEY = "movecasters.pose-break.accessibility-settings";

export const defaultAccessibilitySettings: AccessibilitySettings = {
  screenShake: "reduced",
  flashes: "reduced",
  cameraOriginalVisible: true,
  cameraArIntensity: "medium",
  textScale: "normal",
  highContrastUi: false,
  colorBlindAssist: false,
  keyboardFallbackEnabled: true,
  reducedMotion: false,
  performanceMode: "balanced"
};

export const screenShakeModes: ScreenShakeMode[] = ["on", "reduced", "off"];
export const flashModes: FlashMode[] = ["on", "reduced", "off"];
export const textScaleModes: TextScaleMode[] = ["normal", "large"];
export const performanceQualityModes: PerformanceQuality[] = ["high", "balanced", "performance"];

export function readAccessibilitySettingsStorage(
  key = ACCESSIBILITY_SETTINGS_STORAGE_KEY,
  fallback: AccessibilitySettings = defaultAccessibilitySettings
): AccessibilitySettings {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return { ...fallback };
    }
    const parsedRaw = JSON.parse(raw) as unknown;
    const parsed = isRecord(parsedRaw) ? parsedRaw : {};
    return {
      screenShake: isScreenShakeMode(parsed.screenShake) ? parsed.screenShake : fallback.screenShake,
      flashes: isFlashMode(parsed.flashes) ? parsed.flashes : fallback.flashes,
      cameraOriginalVisible:
        typeof parsed.cameraOriginalVisible === "boolean" ? parsed.cameraOriginalVisible : fallback.cameraOriginalVisible,
      cameraArIntensity: isCameraFxIntensity(parsed.cameraArIntensity) ? parsed.cameraArIntensity : fallback.cameraArIntensity,
      textScale: isTextScaleMode(parsed.textScale) ? parsed.textScale : fallback.textScale,
      highContrastUi: typeof parsed.highContrastUi === "boolean" ? parsed.highContrastUi : fallback.highContrastUi,
      colorBlindAssist: typeof parsed.colorBlindAssist === "boolean" ? parsed.colorBlindAssist : fallback.colorBlindAssist,
      keyboardFallbackEnabled:
        typeof parsed.keyboardFallbackEnabled === "boolean" ? parsed.keyboardFallbackEnabled : fallback.keyboardFallbackEnabled,
      reducedMotion: typeof parsed.reducedMotion === "boolean" ? parsed.reducedMotion : fallback.reducedMotion,
      performanceMode: isPerformanceQuality(parsed.performanceMode) ? parsed.performanceMode : fallback.performanceMode
    };
  } catch {
    return { ...fallback };
  }
}

export function writeAccessibilitySettingsStorage(
  value: AccessibilitySettings,
  key = ACCESSIBILITY_SETTINGS_STORAGE_KEY
): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Accessibility settings are optional; keep the game playable if storage fails.
  }
}

export function isScreenShakeMode(value: unknown): value is ScreenShakeMode {
  return value === "on" || value === "reduced" || value === "off";
}

export function isFlashMode(value: unknown): value is FlashMode {
  return value === "on" || value === "reduced" || value === "off";
}

export function isTextScaleMode(value: unknown): value is TextScaleMode {
  return value === "normal" || value === "large";
}

export function isCameraFxIntensity(value: unknown): value is CameraFxIntensity {
  return value === "low" || value === "medium" || value === "high";
}

export function isPerformanceQuality(value: unknown): value is PerformanceQuality {
  return value === "high" || value === "balanced" || value === "performance";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
