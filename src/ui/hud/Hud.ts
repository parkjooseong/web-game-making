import { REWARDS, rarityLabels, type RewardTag } from "../../game/content/rewards";
import { ADVENTURE_STAGES } from "../../game/content/adventure";
import { DIFFICULTIES, getDifficultyDefinition } from "../../game/content/difficulty";
import { POSE_ASSIST_LEVELS, getEffectivePoseAssistLevel, getPoseAssistDefinition } from "../../game/content/poseAssist";
import { CHARACTERS, getCharacter, getSkillsForCharacter, gradeLabels, type SkillDefinition, SKILLS } from "../../game/content/skills";
import { ACHIEVEMENTS, getAchievementProgress } from "../../game/progression/achievements";
import { CHARACTER_QUEST_LINES, getCharacterQuestLine } from "../../game/progression/characterQuests";
import { SYNERGIES, calculateActiveSynergies, countRewardTags, getSynergyRequiredTags, synergyTierLabels } from "../../game/content/synergies";
import type { PerformanceMetrics, PerformanceQuality } from "../../game/performance/PerformanceMonitor";
import type { SkillSlot } from "../../game/input/actions";
import {
  CORES,
  EFFECT_PALETTES,
  NOISE_CODEX,
  STORY_ENTRIES,
  describeDailyModifiers,
  getCoreDefinition,
  getSkinsForCharacter,
  type ProgressionStore,
  type ProgressSnapshot
} from "../../game/progression/progression";
import type { RunHistory, RunHistoryStore } from "../../game/progression/runHistory";
import { getUnlockProgress, type UnlockProgress } from "../../game/progression/unlocks";
import type {
  GameState,
  CastGrade,
  CastResponse,
  CharacterId,
  CharacterSkinId,
  CoreId,
  Difficulty,
  EffectPaletteId,
  GameMode,
  BossChallengeState,
  PoseAssistLevel
} from "../../game/simulation/types";
import type { GestureId, GestureResult, GestureScoreBreakdown } from "../../game/simulation/types";
import type { PoseOverlayFrame, PoseStatus } from "../../game/pose/PoseOverlayTypes";
import {
  defaultCameraFxSettings,
  type CameraFxIntensity,
  type CameraFxOverlay,
  type CameraFxSettings,
  type CameraPreviewSize
} from "../camera/CameraFxOverlay";
import {
  ACCESSIBILITY_SETTINGS_STORAGE_KEY,
  defaultAccessibilitySettings,
  flashModes,
  isCameraFxIntensity as isAccessibilityCameraFxIntensity,
  isFlashMode,
  isPerformanceQuality,
  isScreenShakeMode,
  isTextScaleMode,
  performanceQualityModes,
  readAccessibilitySettingsStorage,
  screenShakeModes,
  textScaleModes,
  type AccessibilitySettings,
  type FlashMode,
  type ScreenShakeMode,
  type TextScaleMode,
  writeAccessibilitySettingsStorage
} from "../accessibility/AccessibilitySettings";
import { CHARACTER_CARD_DETAILS, renderCharacterPortrait } from "./CharacterPortraitRenderer";

interface HudOptions {
  onEnableCamera: () => Promise<void>;
  onCalibrationGestureTest: (gestureId: GestureId) => Promise<GestureResult>;
  onRewardSelected: (rewardId: string) => void;
  onRewardReroll: () => CastResponse;
  onRestart: () => void;
  onCharacterSelected: (characterId: CharacterId) => void;
  onModeSelected: (mode: GameMode) => void;
  onHubToggled: (visible: boolean) => void;
  onCoreSelected: (coreId: CoreId) => void;
  onSkinSelected: (characterId: CharacterId, skinId: CharacterSkinId) => void;
  onEffectPaletteSelected: (paletteId: EffectPaletteId) => void;
  onDifficultySelected: (difficulty: Difficulty) => void;
  onPoseAssistSelected: (level: PoseAssistLevel) => void;
  onAdventureStageSelected: (stageId: string) => void;
  onDevFillGauge: () => CastResponse;
  onDevClearWave: () => CastResponse;
  onDevSpawnBoss: () => CastResponse;
  onDevForceReward: () => CastResponse;
  onRunHistoryCleared: () => void;
  isSoundEnabled: () => boolean;
  onSoundToggled: () => boolean;
  runHistory: RunHistoryStore;
  progression: ProgressionStore;
}

interface HudDevMetrics extends Partial<PerformanceMetrics> {
  fps: number;
}

const DEV_PANEL_STORAGE_KEY = "movecasters.pose-break.dev-panel.visible";
const CAMERA_SIZE_STORAGE_KEY = "movecasters.pose-break.camera-size";
const CAMERA_FX_SETTINGS_STORAGE_KEY = "movecasters.pose-break.camera-fx-settings";
const cameraPreviewSizes: CameraPreviewSize[] = ["small", "medium", "large"];
const cameraFxIntensities: CameraFxIntensity[] = ["low", "medium", "high"];
type CameraToggleKey = keyof Pick<CameraFxSettings, "arFxEnabled" | "showSkeleton" | "showHandGlow" | "showOriginalVideo">;
type AccessibilityChoiceKey = keyof Pick<
  AccessibilitySettings,
  "screenShake" | "flashes" | "cameraArIntensity" | "textScale" | "performanceMode"
>;
type AccessibilityToggleKey = keyof Pick<
  AccessibilitySettings,
  "cameraOriginalVisible" | "highContrastUi" | "colorBlindAssist" | "keyboardFallbackEnabled" | "reducedMotion"
>;
type CalibrationGestureId = Extract<GestureId, "slash" | "cross-guard" | "open-arms">;
type PoseLandmark = NonNullable<PoseOverlayFrame["landmarks"]>[number];

interface CameraCalibrationCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  warning?: boolean;
}

interface CalibrationTestState {
  completed: boolean;
  grade: CastGrade | null;
  score: number;
  reason: string;
  via: "camera" | "keyboard" | null;
  breakdown?: GestureScoreBreakdown;
}

const calibrationGestures: Array<{
  id: CalibrationGestureId;
  title: string;
  prompt: string;
  color: string;
}> = [
  {
    id: "slash",
    title: "슬래시",
    prompt: "손을 어깨 밖으로 빠르게 휘둘러요.",
    color: "#48f7ff"
  },
  {
    id: "cross-guard",
    title: "크로스 가드",
    prompt: "양손목을 몸 중앙에서 X자로 모아요.",
    color: "#ffd166"
  },
  {
    id: "open-arms",
    title: "오픈 암",
    prompt: "양손을 어깨보다 넓게 벌려요.",
    color: "#ff5ea8"
  }
];

type SkillElements = Record<
  SkillSlot,
  {
    root: HTMLElement;
    cooldown: HTMLElement;
    gauge: HTMLElement;
  }
>;

export class Hud {
  private readonly root: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly shieldFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly brandName: HTMLElement;
  private readonly brandTitle: HTMLElement;
  private readonly waveText: HTMLElement;
  private readonly stageText: HTMLElement;
  private readonly enemyText: HTMLElement;
  private readonly scoreText: HTMLElement;
  private readonly comboText: HTMLElement;
  private readonly buildText: HTMLElement;
  private readonly overdriveText: HTMLElement;
  private readonly gaugeText: HTMLElement;
  private readonly adventureBanner: HTMLElement;
  private readonly tutorialPanel: HTMLElement;
  private readonly bossChallengePrompt: HTMLElement;
  private readonly trainingPanel: HTMLElement;
  private readonly castPrompt: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly cameraPanel: HTMLElement;
  private readonly cameraPreviewHost: HTMLElement;
  private readonly cameraArCanvas: HTMLCanvasElement;
  private readonly cameraFxLayer: HTMLElement;
  private readonly cameraStatus: HTMLElement;
  private readonly cameraSettingsControls: HTMLElement;
  private readonly cameraButton: HTMLButtonElement;
  private readonly cameraCalibrationOverlay: HTMLElement;
  private readonly rewardsOverlay: HTMLElement;
  private readonly modalOverlay: HTMLElement;
  private readonly modalPanel: HTMLElement;
  private readonly devPanel: HTMLElement;
  private readonly titleOverlay: HTMLElement;
  private readonly hubOverlay: HTMLElement;
  private readonly characterSelectOverlay: HTMLElement;
  private readonly characterSelectButton: HTMLButtonElement;
  private readonly hubButton: HTMLButtonElement;
  private readonly soundButton: HTMLButtonElement;
  private readonly characterSwitch: HTMLElement;
  private readonly modeSwitch: HTMLElement;
  private readonly skillEls: SkillElements;
  private progressSnapshot: ProgressSnapshot;
  private latestState: GameState | null = null;
  private titleRenderKey = "";
  private titleSettingsVisible = false;
  private tutorialRecommendationVisible = false;
  private hubVisible = false;
  private characterSelectVisible = false;
  private characterSelectRenderKey = "";
  private hubRenderKey = "";
  private rewardKey = "";
  private modalKey = "";
  private achievementToastKey = "";
  private questToastKey = "";
  private runHistoryExpanded = false;
  private devPanelVisible = false;
  private devPanelRenderAt = 0;
  private fpsSamples: number[] = [];
  private cameraFxSettings: CameraFxSettings = { ...defaultCameraFxSettings };
  private accessibilitySettings: AccessibilitySettings = { ...defaultAccessibilitySettings };
  private cameraOverlay: CameraFxOverlay | null = null;
  private characterButtonRenderKey = "";
  private modeButtonRenderKey = "";
  private latestPoseFrame: PoseOverlayFrame = {
    landmarks: null,
    timestamp: 0,
    status: "idle"
  };
  private cameraCalibrationVisible = false;
  private calibrationCaptureGesture: CalibrationGestureId | null = null;
  private calibrationLastResult: GestureResult | null = null;
  private calibrationRenderAt = 0;
  private calibrationTests: Record<CalibrationGestureId, CalibrationTestState> = createCalibrationTests();
  private rewardLogVisible = false;
  private readonly rewardLogPanel: HTMLElement;
  private toastTimer = 0;
  private castPromptToken = 0;

  constructor(private readonly options: HudOptions) {
    const root = document.getElementById("hud-root");
    if (!root) {
      throw new Error("Missing #hud-root");
    }
    this.root = root;
    this.root.innerHTML = "";

    const topLeft = div("hud-cluster top-left");
    topLeft.innerHTML = `
      <div class="identity-row">
        <div class="character-portrait"><span></span><i></i></div>
        <div>
          <div class="brand-line">
            <span class="brand-mark"></span>
            <span class="brand-name">RIO</span>
          </div>
          <div class="brand-title"></div>
        </div>
      </div>
      <div class="bar-row">
        <span>HP</span>
        <div class="bar"><span class="bar-fill hp-fill"></span></div>
        <strong class="hp-text"></strong>
      </div>
      <div class="bar-row compact">
        <span>SH</span>
        <div class="bar shield"><span class="bar-fill shield-fill"></span></div>
      </div>
      <div class="combo-text"></div>
      <div class="build-text"></div>
      <div class="overdrive-text"></div>
      <div class="character-switch"></div>
    `;

    const topRight = div("hud-cluster top-right");
    topRight.innerHTML = `
      <div class="wave-text"></div>
      <div class="stage-text"></div>
      <div class="enemy-text"></div>
      <div class="score-text"></div>
      <div class="mode-switch"></div>
    `;

    const skillDock = div("skill-dock");
    const skillEls = {} as SkillElements;
    for (const slot of Object.keys(SKILLS) as SkillSlot[]) {
      const skill = SKILLS[slot];
      const button = div("skill-slot");
      button.style.setProperty("--skill-color", skill.uiColor);
      button.innerHTML = `
        <b>${slot}</b>
        <span>${skill.name}</span>
        <i class="skill-gauge"></i>
        <em class="skill-cooldown"></em>
      `;
      skillDock.appendChild(button);
      skillEls[slot] = {
        root: button,
        cooldown: button.querySelector(".skill-cooldown") as HTMLElement,
        gauge: button.querySelector(".skill-gauge") as HTMLElement
      };
    }
    this.skillEls = skillEls;

    const gaugeChip = div("gauge-chip");
    gaugeChip.innerHTML = `<span>코어 게이지</span><strong class="gauge-text"></strong>`;
    skillDock.appendChild(gaugeChip);

    const camera = div("camera-panel");
    camera.innerHTML = `
      <div class="camera-preview-wrap">
        <div class="silhouette">
          <span></span>
        </div>
        <div class="camera-fx-layer">
          <span class="camera-scanline"></span>
          <i></i>
        </div>
        <canvas class="camera-ar-canvas" aria-hidden="true"></canvas>
      </div>
      <div class="camera-copy">
        <strong>모션 코어</strong>
        <p class="camera-status"></p>
        <div class="camera-settings" aria-label="카메라 AR 설정">
          <div class="camera-setting-row camera-size-options" aria-label="카메라 크기">
            <button type="button" data-camera-size="small">S</button>
            <button type="button" data-camera-size="medium">M</button>
            <button type="button" data-camera-size="large">L</button>
          </div>
          <div class="camera-setting-row camera-intensity-options" aria-label="AR 강도">
            <button type="button" data-camera-intensity="low">LOW</button>
            <button type="button" data-camera-intensity="medium">MID</button>
            <button type="button" data-camera-intensity="high">HIGH</button>
          </div>
        <div class="camera-setting-row camera-toggle-options" aria-label="AR 표시 옵션">
            <button type="button" data-camera-toggle="arFxEnabled">AR</button>
            <button type="button" data-camera-toggle="showSkeleton">BONE</button>
            <button type="button" data-camera-toggle="showHandGlow">HAND</button>
            <button type="button" data-camera-toggle="showOriginalVideo">VIDEO</button>
          </div>
        </div>
        <button class="camera-calibration-open" type="button">보정</button>
      </div>
    `;
    this.cameraButton = document.createElement("button");
    this.cameraButton.type = "button";
    this.cameraButton.className = "camera-button";
    this.cameraButton.textContent = "카메라 켜기";
    this.cameraButton.addEventListener("click", () => {
      this.cameraButton.disabled = true;
      void this.options.onEnableCamera().finally(() => {
        this.cameraButton.disabled = false;
      });
    });
    camera.appendChild(this.cameraButton);

    this.adventureBanner = div("adventure-banner objective-banner");
    this.tutorialPanel = div("tutorial-panel");
    this.bossChallengePrompt = div("boss-challenge-prompt");
    this.trainingPanel = div("training-panel");
    this.castPrompt = div("cast-prompt");
    this.toast = div("toast");
    this.titleOverlay = div("title-overlay");
    this.characterSelectOverlay = div("character-select-overlay");
    this.hubOverlay = div("hub-overlay");
    this.cameraCalibrationOverlay = div("camera-calibration-overlay");
    this.rewardsOverlay = div("reward-overlay");
    this.rewardLogPanel = div("reward-log-panel");
    this.devPanel = div("dev-panel");
    this.modalOverlay = div("modal-overlay");
    this.modalPanel = div("modal-panel");
    this.modalOverlay.appendChild(this.modalPanel);

    this.root.append(
      topLeft,
      topRight,
      skillDock,
      camera,
      this.adventureBanner,
      this.tutorialPanel,
      this.bossChallengePrompt,
      this.trainingPanel,
      this.castPrompt,
      this.titleOverlay,
      this.toast,
      this.characterSelectOverlay,
      this.hubOverlay,
      this.cameraCalibrationOverlay,
      this.rewardsOverlay,
      this.rewardLogPanel,
      this.devPanel,
      this.modalOverlay
    );

    this.hpFill = topLeft.querySelector(".hp-fill") as HTMLElement;
    this.shieldFill = topLeft.querySelector(".shield-fill") as HTMLElement;
    this.hpText = topLeft.querySelector(".hp-text") as HTMLElement;
    this.brandName = topLeft.querySelector(".brand-name") as HTMLElement;
    this.brandTitle = topLeft.querySelector(".brand-title") as HTMLElement;
    this.waveText = topRight.querySelector(".wave-text") as HTMLElement;
    this.stageText = topRight.querySelector(".stage-text") as HTMLElement;
    this.enemyText = topRight.querySelector(".enemy-text") as HTMLElement;
    this.scoreText = topRight.querySelector(".score-text") as HTMLElement;
    this.comboText = topLeft.querySelector(".combo-text") as HTMLElement;
    this.buildText = topLeft.querySelector(".build-text") as HTMLElement;
    this.overdriveText = topLeft.querySelector(".overdrive-text") as HTMLElement;
    this.gaugeText = gaugeChip.querySelector(".gauge-text") as HTMLElement;
    this.cameraPanel = camera;
    this.cameraPreviewHost = camera.querySelector(".camera-preview-wrap") as HTMLElement;
    this.cameraArCanvas = camera.querySelector(".camera-ar-canvas") as HTMLCanvasElement;
    this.cameraFxLayer = camera.querySelector(".camera-fx-layer") as HTMLElement;
    this.cameraStatus = camera.querySelector(".camera-status") as HTMLElement;
    this.cameraSettingsControls = camera.querySelector(".camera-settings") as HTMLElement;
    this.characterSwitch = topLeft.querySelector(".character-switch") as HTMLElement;
    this.modeSwitch = topRight.querySelector(".mode-switch") as HTMLElement;
    this.characterSelectButton = document.createElement("button");
    this.characterSelectButton.type = "button";
    this.characterSelectButton.className = "character-select-open";
    this.characterSelectButton.addEventListener("click", () => this.toggleCharacterSelect());
    this.hubButton = document.createElement("button");
    this.hubButton.type = "button";
    this.hubButton.className = "mode-button hub-button";
    this.hubButton.textContent = "허브";
    this.hubButton.addEventListener("click", () => this.toggleHub());
    this.soundButton = document.createElement("button");
    this.soundButton.type = "button";
    this.soundButton.className = "mode-button sound-button";
    this.soundButton.addEventListener("click", () => {
      const enabled = this.options.onSoundToggled();
      this.updateSoundButton();
      this.showToast(enabled ? "사운드 ON" : "사운드 OFF");
    });
    this.characterSwitch.append(this.characterSelectButton);
    this.modeSwitch.append(
      ...[
        { mode: "title" as GameMode, label: "타이틀" },
        { mode: "quick-demo" as GameMode, label: "3분" },
        { mode: "story" as GameMode, label: "전투" },
        { mode: "tutorial" as GameMode, label: "튜토리얼" },
        { mode: "adventure" as GameMode, label: "모험" },
        { mode: "survival" as GameMode, label: "생존" },
        { mode: "boss-rush" as GameMode, label: "보스" },
        { mode: "training" as GameMode, label: "훈련장" }
      ].map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mode-button";
        button.textContent = item.label;
        button.addEventListener("click", () => this.options.onModeSelected(item.mode));
        return button;
      })
    );
    this.modeSwitch.append(this.soundButton, this.hubButton);
    this.updateSoundButton();
    this.devPanelVisible = readBooleanStorage(DEV_PANEL_STORAGE_KEY, false);
    this.devPanel.classList.toggle("is-visible", this.devPanelVisible);
    this.setCameraFxSettings(readCameraFxSettingsStorage(CAMERA_FX_SETTINGS_STORAGE_KEY, defaultCameraFxSettings), false);
    this.setAccessibilitySettings(readAccessibilitySettingsStorage(ACCESSIBILITY_SETTINGS_STORAGE_KEY), false);
    this.cameraSettingsControls.querySelectorAll<HTMLButtonElement>("[data-camera-size]").forEach((button) => {
      button.addEventListener("click", () => {
        const size = button.dataset.cameraSize as CameraPreviewSize | undefined;
        if (!size || !cameraPreviewSizes.includes(size)) {
          return;
        }
        this.setCameraFxSettings({ cameraSize: size });
      });
    });
    this.cameraSettingsControls.querySelectorAll<HTMLButtonElement>("[data-camera-intensity]").forEach((button) => {
      button.addEventListener("click", () => {
        const intensity = button.dataset.cameraIntensity as CameraFxIntensity | undefined;
        if (!intensity || !cameraFxIntensities.includes(intensity)) {
          return;
        }
        this.setCameraFxSettings({ arFxIntensity: intensity });
      });
    });
    this.cameraSettingsControls.querySelectorAll<HTMLButtonElement>("[data-camera-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.cameraToggle as CameraToggleKey | undefined;
        if (!key || typeof this.cameraFxSettings[key] !== "boolean") {
          return;
        }
        this.setCameraFxSettings({ [key]: !this.cameraFxSettings[key] } as Partial<CameraFxSettings>);
      });
    });
    camera.querySelector<HTMLButtonElement>(".camera-calibration-open")?.addEventListener("click", () => this.toggleCameraCalibration(true));
    window.addEventListener("keydown", (event) => {
      if (!this.cameraCalibrationVisible || event.repeat) {
        return;
      }
      if (event.key !== "1" && event.key !== "2" && event.key !== "3") {
        return;
      }
      const grade: CastGrade = event.key === "3" ? "Perfect" : event.key === "2" ? "Great" : "Normal";
      const gestureId = this.calibrationCaptureGesture ?? this.getNextCalibrationGesture();
      if (!gestureId) {
        return;
      }
      event.preventDefault();
      this.completeCalibrationWithKeyboard(gestureId, grade);
    });

    this.progressSnapshot = this.options.progression.getSnapshot();
    this.options.progression.subscribe((snapshot) => {
      this.progressSnapshot = snapshot;
      this.titleRenderKey = "";
      this.characterSelectRenderKey = "";
      this.hubRenderKey = "";
      this.renderTitle(this.latestState);
      this.renderCharacterSelect();
      this.renderHub();
    });
  }

  getCameraPreviewHost(): HTMLElement {
    return this.cameraPreviewHost;
  }

  getCameraArCanvas(): HTMLCanvasElement {
    return this.cameraArCanvas;
  }

  getAverageFps(): number {
    if (this.fpsSamples.length === 0) {
      return 0;
    }
    const total = this.fpsSamples.reduce((sum, value) => sum + value, 0);
    return Math.round(total / this.fpsSamples.length);
  }

  getAccessibilitySettings(): AccessibilitySettings {
    return { ...this.accessibilitySettings };
  }

  getPerformanceMode(): PerformanceQuality {
    return this.accessibilitySettings.performanceMode;
  }

  setCameraFxOverlay(overlay: CameraFxOverlay): void {
    this.cameraOverlay = overlay;
    overlay.setSettings(this.cameraFxSettings);
    overlay.setPerformanceMode(this.accessibilitySettings.performanceMode);
  }

  private setCameraFxSettings(settings: Partial<CameraFxSettings>, persist = true): void {
    this.cameraFxSettings = {
      ...this.cameraFxSettings,
      ...settings
    };
    this.accessibilitySettings = {
      ...this.accessibilitySettings,
      cameraArIntensity: this.cameraFxSettings.arFxIntensity,
      cameraOriginalVisible: this.cameraFxSettings.showOriginalVideo
    };
    this.applyCameraFxDatasets();
    this.applyAccessibilityDatasets();
    this.cameraOverlay?.setSettings(this.cameraFxSettings);
    this.cameraOverlay?.setPerformanceMode(this.accessibilitySettings.performanceMode);
    this.renderCameraSettingsButtons();
    this.titleRenderKey = "";
    this.hubRenderKey = "";
    if (persist) {
      writeCameraFxSettingsStorage(CAMERA_FX_SETTINGS_STORAGE_KEY, this.cameraFxSettings);
      writeAccessibilitySettingsStorage(this.accessibilitySettings, ACCESSIBILITY_SETTINGS_STORAGE_KEY);
      this.showToast(cameraFxSettingsToast(settings, this.cameraFxSettings));
    }
    this.renderTitle(this.latestState);
    this.renderHub();
  }

  private setAccessibilitySettings(settings: Partial<AccessibilitySettings>, persist = true): void {
    this.accessibilitySettings = {
      ...this.accessibilitySettings,
      ...settings
    };
    this.cameraFxSettings = {
      ...this.cameraFxSettings,
      arFxIntensity: this.accessibilitySettings.cameraArIntensity,
      showOriginalVideo: this.accessibilitySettings.cameraOriginalVisible
    };
    this.applyCameraFxDatasets();
    this.applyAccessibilityDatasets();
    this.cameraOverlay?.setSettings(this.cameraFxSettings);
    this.cameraOverlay?.setPerformanceMode(this.accessibilitySettings.performanceMode);
    this.renderCameraSettingsButtons();
    this.titleRenderKey = "";
    this.hubRenderKey = "";
    if (persist) {
      writeAccessibilitySettingsStorage(this.accessibilitySettings, ACCESSIBILITY_SETTINGS_STORAGE_KEY);
      writeCameraFxSettingsStorage(CAMERA_FX_SETTINGS_STORAGE_KEY, this.cameraFxSettings);
      this.showToast(accessibilitySettingsToast(settings, this.accessibilitySettings));
    }
    this.renderTitle(this.latestState);
    this.renderHub();
  }

  private applyCameraFxDatasets(): void {
    this.root.dataset.cameraSize = this.cameraFxSettings.cameraSize;
    this.root.dataset.cameraFx = this.cameraFxSettings.arFxEnabled ? "on" : "off";
    this.root.dataset.cameraFxIntensity = this.cameraFxSettings.arFxIntensity;
    this.root.dataset.cameraSkeleton = this.cameraFxSettings.showSkeleton ? "on" : "off";
    this.root.dataset.cameraHandGlow = this.cameraFxSettings.showHandGlow ? "on" : "off";
    this.root.dataset.cameraVideo = this.cameraFxSettings.showOriginalVideo ? "visible" : "hidden";
  }

  private applyAccessibilityDatasets(): void {
    this.root.dataset.screenShake = this.accessibilitySettings.screenShake;
    this.root.dataset.flashes = this.accessibilitySettings.flashes;
    this.root.dataset.textScale = this.accessibilitySettings.textScale;
    this.root.dataset.highContrast = this.accessibilitySettings.highContrastUi ? "on" : "off";
    this.root.dataset.colorBlind = this.accessibilitySettings.colorBlindAssist ? "on" : "off";
    this.root.dataset.keyboardFallback = this.accessibilitySettings.keyboardFallbackEnabled ? "on" : "off";
    this.root.dataset.reducedMotion = this.accessibilitySettings.reducedMotion ? "on" : "off";
    this.root.dataset.performanceMode = this.accessibilitySettings.performanceMode;
  }

  private setAccessibilityChoice(key: AccessibilityChoiceKey | undefined, value: string | undefined): void {
    if (!key || !value) {
      return;
    }
    if (key === "screenShake" && isScreenShakeMode(value)) {
      this.setAccessibilitySettings({ screenShake: value });
      return;
    }
    if (key === "flashes" && isFlashMode(value)) {
      this.setAccessibilitySettings({ flashes: value });
      return;
    }
    if (key === "cameraArIntensity" && isAccessibilityCameraFxIntensity(value)) {
      this.setAccessibilitySettings({ cameraArIntensity: value });
      return;
    }
    if (key === "textScale" && isTextScaleMode(value)) {
      this.setAccessibilitySettings({ textScale: value });
      return;
    }
    if (key === "performanceMode" && isPerformanceQuality(value)) {
      this.setAccessibilitySettings({ performanceMode: value });
    }
  }

  private toggleAccessibilitySetting(key: AccessibilityToggleKey | undefined): void {
    if (!key || typeof this.accessibilitySettings[key] !== "boolean") {
      return;
    }
    this.setAccessibilitySettings({ [key]: !this.accessibilitySettings[key] } as Partial<AccessibilitySettings>);
  }

  private renderCameraSettingsButtons(): void {
    this.cameraSettingsControls.querySelectorAll<HTMLButtonElement>("[data-camera-size]").forEach((button) => {
      const active = button.dataset.cameraSize === this.cameraFxSettings.cameraSize;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    this.cameraSettingsControls.querySelectorAll<HTMLButtonElement>("[data-camera-intensity]").forEach((button) => {
      const active = button.dataset.cameraIntensity === this.cameraFxSettings.arFxIntensity;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    this.cameraSettingsControls.querySelectorAll<HTMLButtonElement>("[data-camera-toggle]").forEach((button) => {
      const key = button.dataset.cameraToggle as CameraToggleKey | undefined;
      const active = key ? Boolean(this.cameraFxSettings[key]) : false;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  toggleHub(force?: boolean): boolean {
    this.hubVisible = force ?? !this.hubVisible;
    this.hubOverlay.classList.toggle("is-visible", this.hubVisible);
    this.hubButton.classList.toggle("is-active", this.hubVisible);
    this.options.onHubToggled(this.hubVisible);
    this.renderHub();
    return this.hubVisible;
  }

  toggleCharacterSelect(force?: boolean): boolean {
    this.characterSelectVisible = force ?? !this.characterSelectVisible;
    this.characterSelectOverlay.classList.toggle("is-visible", this.characterSelectVisible);
    this.characterSelectButton.classList.toggle("is-active", this.characterSelectVisible);
    this.renderCharacterSelect();
    return this.characterSelectVisible;
  }

  toggleRewardLog(force?: boolean): boolean {
    this.rewardLogVisible = force ?? !this.rewardLogVisible;
    this.renderRewardLog(this.latestState);
    return this.rewardLogVisible;
  }

  toggleDevPanel(force?: boolean): boolean {
    this.devPanelVisible = force ?? !this.devPanelVisible;
    this.devPanel.classList.toggle("is-visible", this.devPanelVisible);
    writeBooleanStorage(DEV_PANEL_STORAGE_KEY, this.devPanelVisible);
    this.devPanelRenderAt = 0;
    this.renderDevPanel(this.latestState, { fps: 0 });
    return this.devPanelVisible;
  }

  updateSoundButton(): void {
    const enabled = this.options.isSoundEnabled();
    this.soundButton.textContent = enabled ? "사운드 ON" : "사운드 OFF";
    this.soundButton.classList.toggle("is-muted", !enabled);
    this.soundButton.title = enabled ? "효과음 끄기 (O)" : "효과음 켜기 (O)";
  }

  setCameraStatus(status: PoseStatus): void {
    const labels: Record<PoseStatus, string> = {
      idle: "대체 입력 OK",
      starting: "연결 중",
      ready: "카메라 준비",
      "permission-needed": "권한 필요",
      unsupported: "지원 안 됨",
      unstable: "손/상반신 확인",
      error: "오류"
    };
    this.cameraStatus.textContent = labels[status];
    this.root.dataset.camera = status;
    const hasCamera = status === "ready" || status === "unstable";
    this.cameraPanel.classList.toggle("has-camera", hasCamera);
    this.cameraButton.textContent = hasCamera ? "연결됨" : "카메라 켜기";
    this.cameraButton.disabled = hasCamera || status === "starting";
    this.renderCameraCalibrationPanel();
  }

  handlePoseFrame(frame: PoseOverlayFrame): void {
    this.latestPoseFrame = frame;
    if (!this.cameraCalibrationVisible) {
      return;
    }
    if (frame.timestamp - this.calibrationRenderAt < 140) {
      return;
    }
    this.renderCameraCalibrationPanel();
  }

  toggleCameraCalibration(force?: boolean): boolean {
    this.cameraCalibrationVisible = force ?? !this.cameraCalibrationVisible;
    this.cameraCalibrationOverlay.classList.toggle("is-visible", this.cameraCalibrationVisible);
    this.renderCameraCalibrationPanel();
    return this.cameraCalibrationVisible;
  }

  private renderCameraCalibrationPanel(): void {
    if (!this.cameraCalibrationVisible) {
      this.cameraCalibrationOverlay.classList.remove("is-visible");
      return;
    }

    this.calibrationRenderAt = performance.now();
    const checks = getCalibrationChecks(this.latestPoseFrame);
    const completedCount = calibrationGestures.filter((gesture) => this.calibrationTests[gesture.id].completed).length;
    const allComplete = completedCount >= calibrationGestures.length;
    const cameraReady = this.latestPoseFrame.status === "ready" || this.latestPoseFrame.status === "unstable";
    const currentCharacter = this.latestState?.characterId ?? "rio";
    const character = getCharacter(currentCharacter);
    const activeResult = this.calibrationLastResult ?? this.latestState?.training.lastResult ?? null;
    const resultBreakdown = activeResult?.breakdown;
    const breakdownRows = resultBreakdown ? renderCalibrationBreakdownRows(resultBreakdown) : "";
    const testCards = calibrationGestures
      .map((gesture) => {
        const test = this.calibrationTests[gesture.id];
        const busy = this.calibrationCaptureGesture === gesture.id;
        return `
          <div class="calibration-test-card ${test.completed ? "is-complete" : ""} ${busy ? "is-running" : ""}" style="--calibration-color:${gesture.color}">
            <div>
              <i>${test.completed ? "✓" : busy ? "..." : "·"}</i>
              <strong>${gesture.title}</strong>
              <span>${gesture.prompt}</span>
            </div>
            <small>${test.completed ? `${gradeLabels[test.grade ?? "Normal"]} · ${test.via === "keyboard" ? "대체 입력" : "카메라"}` : "준비 전 테스트"}</small>
            <div class="calibration-test-actions">
              <button type="button" data-calibration-test="${gesture.id}" ${busy ? "disabled" : ""}>웹캠 테스트</button>
              <button type="button" data-calibration-keyboard="${gesture.id}">키보드 완료</button>
            </div>
          </div>
        `;
      })
      .join("");
    const statusCards = checks
      .map(
        (check) => `
          <div class="calibration-check ${check.ok ? "is-ok" : check.warning ? "is-warning" : "is-missing"}">
            <b>${check.ok ? "✓" : check.warning ? "!" : "×"}</b>
            <span>${check.label}</span>
            <small>${check.detail}</small>
          </div>
        `
      )
      .join("");

    this.cameraCalibrationOverlay.classList.add("is-visible");
    this.cameraCalibrationOverlay.innerHTML = `
      <div class="camera-calibration-panel" style="--character-color:${character.uiColor}">
        <div class="camera-calibration-header">
          <div>
            <p>모션 코어 보정</p>
            <h2>카메라 보정</h2>
            <span>${character.name}의 포즈가 잘 잡히는지 확인해요.</span>
          </div>
          <button class="camera-calibration-close" type="button">닫기</button>
        </div>
        <div class="camera-calibration-status ${allComplete ? "is-ready" : ""}">
          <strong>${allComplete ? "포즈 인식 준비 완료" : cameraReady ? "상반신을 중앙에 맞춰요" : "카메라 또는 1/2/3으로 진행해요"}</strong>
          <span>${cameraReady ? "얼굴, 손, 어깨, 중앙 위치를 확인 중입니다." : "카메라가 없어도 1/2/3으로 테스트할 수 있어요."}</span>
        </div>
        <div class="calibration-layout">
          <section class="calibration-section">
            <div class="calibration-section-head">
              <strong>실시간 감지</strong>
              <button class="calibration-enable-camera" type="button" ${cameraReady ? "disabled" : ""}>${cameraReady ? "카메라 연결됨" : "카메라 켜기"}</button>
            </div>
            <div class="calibration-check-grid">${statusCards}</div>
          </section>
          <section class="calibration-section">
            <div class="calibration-section-head">
              <strong>시작 전 포즈 테스트</strong>
              <span>${completedCount}/${calibrationGestures.length}</span>
            </div>
            <div class="calibration-test-grid">${testCards}</div>
            <p class="calibration-keyboard-note">대체 입력: 1 노멀 / 2 그레이트 / 3 퍼펙트</p>
          </section>
        </div>
        <section class="calibration-result-section">
          <div class="calibration-section-head">
            <strong>${this.calibrationLastResult ? "최근 보정 판정" : "훈련장 최근 판정"}</strong>
            <span>${activeResult ? `${gestureLabel(activeResult.gestureId)} · ${gradeLabels[activeResult.grade]}` : "아직 없음"}</span>
          </div>
          ${
            activeResult
              ? `
                <div class="calibration-result-card">
                  <b>${Math.round(activeResult.score)}</b>
                  <div>
                    <strong>${activeResult.reason}</strong>
                    <span>${resultBreakdown?.tip ?? "보정 테스트나 훈련장 미션 후 세부 판정이 표시됩니다."}</span>
                  </div>
                </div>
                ${resultBreakdown ? `<div class="training-breakdown calibration-breakdown">${breakdownRows}</div>` : ""}
              `
              : `<div class="calibration-empty-result">슬래시, 크로스 가드, 오픈 암을 테스트하면 세부 판정이 표시됩니다.</div>`
          }
        </section>
      </div>
    `;

    this.cameraCalibrationOverlay.querySelector<HTMLButtonElement>(".camera-calibration-close")?.addEventListener("click", () => {
      this.toggleCameraCalibration(false);
    });
    this.cameraCalibrationOverlay.querySelector<HTMLButtonElement>(".calibration-enable-camera")?.addEventListener("click", () => {
      void this.options.onEnableCamera();
    });
    this.cameraCalibrationOverlay.querySelectorAll<HTMLButtonElement>("[data-calibration-test]").forEach((button) => {
      button.addEventListener("click", () => {
        const gestureId = button.dataset.calibrationTest as CalibrationGestureId | undefined;
        if (gestureId) {
          void this.runCalibrationTest(gestureId);
        }
      });
    });
    this.cameraCalibrationOverlay.querySelectorAll<HTMLButtonElement>("[data-calibration-keyboard]").forEach((button) => {
      button.addEventListener("click", () => {
        const gestureId = button.dataset.calibrationKeyboard as CalibrationGestureId | undefined;
        if (gestureId) {
          this.completeCalibrationWithKeyboard(gestureId, "Great");
        }
      });
    });
  }

  private async runCalibrationTest(gestureId: CalibrationGestureId): Promise<void> {
    if (this.calibrationCaptureGesture) {
      return;
    }
    const config = calibrationGestures.find((gesture) => gesture.id === gestureId);
    this.calibrationCaptureGesture = gestureId;
    this.cameraOverlay?.setContext({
      characterId: this.latestState?.characterId ?? "rio",
      expectedGesture: gestureId,
      isCapturing: true,
      lastGrade: null,
      color: config?.color ?? "#48f7ff",
      label: "보정",
      boss: false
    });
    this.renderCameraCalibrationPanel();
    const result = await this.options.onCalibrationGestureTest(gestureId);
    this.calibrationLastResult = result;
    if (result.grade !== "Miss") {
      this.calibrationTests[gestureId] = {
        completed: true,
        grade: result.grade,
        score: result.score,
        reason: result.reason,
        via: "camera",
        breakdown: result.breakdown
      };
      this.cameraOverlay?.triggerBurst(result.grade, {
        color: config?.color ?? "#48f7ff",
        label: `${config?.title ?? "포즈"} OK`,
        intensityBoost: result.grade === "Perfect" ? 1.3 : 1
      });
      this.showToast(`${config?.title ?? "포즈"} 보정 완료`);
    } else {
      this.showToast(result.breakdown?.tip ?? result.reason);
    }
    this.calibrationCaptureGesture = null;
    this.cameraOverlay?.setContext({ isCapturing: false, lastGrade: result.grade, label: "" });
    this.cameraOverlay?.clearExpectedGesture(result.grade === "Miss" ? 80 : 520);
    this.invalidateCameraCalibrationSurfaces();
    this.renderCameraCalibrationPanel();
  }

  private completeCalibrationWithKeyboard(gestureId: CalibrationGestureId, grade: Exclude<CastGrade, "Miss">): void {
    const config = calibrationGestures.find((gesture) => gesture.id === gestureId);
    const score = grade === "Perfect" ? 96 : grade === "Great" ? 82 : 58;
    const breakdown = keyboardCalibrationBreakdown(grade);
    this.calibrationLastResult = {
      gestureId,
      score,
      grade,
      confidence: 1,
      reason: "1/2/3 대체 입력으로 테스트했어요.",
      breakdown
    };
    this.calibrationTests[gestureId] = {
      completed: true,
      grade,
      score,
      reason: this.calibrationLastResult.reason,
      via: "keyboard",
      breakdown
    };
    this.calibrationCaptureGesture = null;
    this.cameraOverlay?.triggerBurst(grade, {
      color: config?.color ?? "#48f7ff",
      label: `${config?.title ?? "POSE"} ALT`,
      intensityBoost: grade === "Perfect" ? 1.25 : 0.92
    });
    this.invalidateCameraCalibrationSurfaces();
    this.showToast(`${config?.title ?? "포즈"} 대체 입력 완료`);
    this.renderCameraCalibrationPanel();
  }

  private getNextCalibrationGesture(): CalibrationGestureId | null {
    return calibrationGestures.find((gesture) => !this.calibrationTests[gesture.id].completed)?.id ?? null;
  }

  private getCalibrationSummaryKey(): string {
    const checks = getCalibrationChecks(this.latestPoseFrame);
    return [
      this.latestPoseFrame.status,
      checks.map((check) => `${check.id}:${check.ok ? 1 : check.warning ? 2 : 0}`).join(","),
      calibrationGestures.map((gesture) => `${gesture.id}:${this.calibrationTests[gesture.id].completed ? 1 : 0}:${this.calibrationTests[gesture.id].grade ?? "-"}`).join(",")
    ].join("|");
  }

  private renderCalibrationLauncher(): string {
    const checks = getCalibrationChecks(this.latestPoseFrame);
    const completedCount = calibrationGestures.filter((gesture) => this.calibrationTests[gesture.id].completed).length;
    const allComplete = completedCount >= calibrationGestures.length;
    const cameraReady = this.latestPoseFrame.status === "ready" || this.latestPoseFrame.status === "unstable";
    const okCount = checks.filter((check) => check.ok).length;
    const checkChips = checks
      .slice(0, 6)
      .map((check) => `<i class="${check.ok ? "is-ok" : check.warning ? "is-warning" : "is-missing"}">${check.ok ? "✓" : check.warning ? "!" : "×"} ${check.label}</i>`)
      .join("");
    return `
      <div class="calibration-launcher ${allComplete ? "is-ready" : ""}">
        <div>
          <strong>${allComplete ? "포즈 인식 준비 완료" : "카메라 보정"}</strong>
          <span>${cameraReady ? `실시간 체크 ${okCount}/${checks.length} · 테스트 ${completedCount}/${calibrationGestures.length}` : "카메라가 꺼져 있어도 키보드 대체 입력으로 진행 가능"}</span>
        </div>
        <div class="calibration-launcher-checks">${checkChips}</div>
        <button type="button" data-open-calibration>${allComplete ? "다시 확인" : "보정 패널 열기"}</button>
      </div>
    `;
  }

  private invalidateCameraCalibrationSurfaces(): void {
    this.titleRenderKey = "";
    this.hubRenderKey = "";
    if (this.latestState) {
      this.renderTitle(this.latestState);
      this.renderHub();
    }
  }

  update(state: GameState, devMetrics: HudDevMetrics = { fps: 0 }): void {
    this.latestState = state;
    if (state.mode !== "title" && Number.isFinite(devMetrics.fps) && devMetrics.fps > 0) {
      this.fpsSamples.push(devMetrics.fps);
      if (this.fpsSamples.length > 360) {
        this.fpsSamples.shift();
      }
    }
    this.hpFill.style.width = `${Math.max(0, (state.player.hp / state.player.maxHp) * 100)}%`;
    this.shieldFill.style.width = `${Math.min(100, (state.player.shield / 40) * 100)}%`;
    this.hpText.textContent = `${Math.ceil(state.player.hp)}/${state.player.maxHp}`;
    const character = getCharacter(state.characterId);
    const skills = getSkillsForCharacter(state.characterId);
    if (this.characterButtonRenderKey !== state.characterId) {
      const detail = CHARACTER_CARD_DETAILS[state.characterId];
      this.brandName.textContent = character.name;
      this.brandTitle.textContent = character.title;
      this.root.style.setProperty("--active-character", character.uiColor);
      this.root.dataset.character = state.characterId;
      this.characterSelectButton.style.setProperty("--character-color", character.uiColor);
      this.characterSelectButton.innerHTML = `
        <span>캐릭터 선택</span>
        <strong>${character.name}</strong>
        <small>${detail.role}</small>
      `;
      this.root.querySelectorAll<HTMLButtonElement>(".character-select-card").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.characterId === state.characterId);
      });
      this.characterButtonRenderKey = state.characterId;
    }
    if (this.modeButtonRenderKey !== state.mode) {
      this.root.dataset.mode = state.mode;
      const labelByMode: Record<GameMode, string> = {
        title: "타이틀",
        "quick-demo": "3분",
        tutorial: "튜토리얼",
        story: "전투",
        adventure: "모험",
        survival: "생존",
        "boss-rush": "보스",
        training: "훈련장"
      };
      this.root.querySelectorAll<HTMLButtonElement>(".mode-button").forEach((button) => {
        button.classList.toggle("is-active", button.textContent === labelByMode[state.mode]);
      });
      this.modeButtonRenderKey = state.mode;
    }
    this.cameraOverlay?.setContext({ characterId: state.characterId });
    this.waveText.textContent = this.getModeTitle(state);
    this.stageText.textContent = state.stageName;
    this.enemyText.textContent =
      state.mode === "title"
        ? "데모 준비"
        : state.mode === "quick-demo"
        ? `${state.enemies.length + state.spawnQueue.length} 데모`
        : state.mode === "tutorial"
        ? "가이드"
        : state.mode === "training"
        ? `${state.enemies.length} 표적`
        : state.mode === "boss-rush"
          ? `${state.enemies.length + state.spawnQueue.length} 보스`
          : state.mode === "adventure"
            ? `${state.enemies.length + state.spawnQueue.length} 남음`
          : `${state.enemies.length + state.spawnQueue.length} 노이즈`;
    this.scoreText.textContent =
      state.mode === "title"
        ? "타이틀"
        : state.mode === "quick-demo"
        ? `${Math.floor(Math.max(0, 180 - state.modeTime))}초 데모`
        : state.mode === "tutorial"
        ? `단계 ${Math.min(state.tutorial.currentStepIndex + 1, state.tutorial.steps.length)}/${state.tutorial.steps.length}`
        : state.mode === "training"
        ? "자유 연습"
        : state.mode === "survival"
          ? `${Math.floor(Math.max(0, 600 - state.modeTime))}초 남음`
          : state.mode === "adventure"
            ? `스테이지 ${state.adventureStageIndex + 1}/${state.adventureStageTotal}`
          : `${state.player.score.toString().padStart(5, "0")} PTS`;
    this.comboText.textContent =
      state.player.comboPerfect > 1
        ? `퍼펙트 x${state.player.comboPerfect}`
        : state.player.comboRangeBonusTime > 0
          ? "범위 강화"
          : "무브캐스터";
    this.buildText.textContent =
      state.activeSynergies.length > 0
        ? `BUILD: ${highestSynergyTierLabel(state)} · ${state.activeSynergies.map((synergy) => synergy.title).join(" + ")}`
        : "BUILD: 탐색 중";
    this.overdriveText.textContent =
      state.player.overdriveTime > 0
        ? `OVERDRIVE ${state.player.overdriveTime.toFixed(1)}s`
        : state.player.shieldWallTime > 0
          ? `SHIELD WALL ${state.player.shieldWallTime.toFixed(1)}s`
          : `F: ${skills.F.name}`;
    this.gaugeText.textContent = `${Math.floor(state.player.gauge)}%`;
    this.hubButton.classList.toggle("is-active", this.hubVisible);
    this.updateSoundButton();

    for (const slot of Object.keys(SKILLS) as SkillSlot[]) {
      const skill = skills[slot];
      const elements = this.skillEls[slot];
      const cooldown = state.cooldowns[slot];
      const ready = cooldown <= 0 && state.player.gauge >= skill.gaugeCost;
      elements.root.style.setProperty("--skill-color", skill.uiColor);
      const label = elements.root.querySelector("span");
      if (label) {
        label.textContent = skill.name;
      }
      elements.root.classList.toggle("is-ready", ready);
      elements.root.classList.toggle("is-prepared", state.preparedSkill?.slot === slot);
      elements.cooldown.textContent = cooldown > 0 ? cooldown.toFixed(1) : "";
      elements.gauge.style.width = `${Math.min(100, (state.player.gauge / skill.gaugeCost) * 100)}%`;
    }

    this.renderTitle(state);
    this.renderRewards(state);
    this.renderModal(state);
    this.renderObjectiveBanner(state);
    this.renderTutorialPanel(state);
    this.renderBossChallenge(state);
    this.renderTrainingPanel(state);
    this.renderCharacterSelect();
    this.renderHub();
    this.renderAchievementToast(state);
    this.renderQuestToast(state);
    this.renderRewardLog(state);
    this.renderDevPanel(state, devMetrics);
    this.tickToast();
  }

  showCastPrompt(skill: SkillDefinition): void {
    this.castPromptToken += 1;
    this.castPrompt.innerHTML = `
      <strong>${skill.slot}: ${skill.name}</strong>
      <span>${skill.gestureLabel}</span>
      <small>1 / 2 / 3</small>
    `;
    this.castPrompt.style.setProperty("--prompt-color", skill.uiColor);
    this.castPrompt.classList.add("is-visible");
    this.cameraPanel.style.setProperty("--camera-fx-color", skill.uiColor);
    this.cameraFxLayer.querySelector("i")!.textContent = skill.shortName.toUpperCase();
    this.cameraPanel.classList.remove("grade-normal", "grade-great", "grade-perfect");
    this.cameraPanel.classList.add("is-capturing");
    this.cameraOverlay?.setContext({
      characterId: this.latestState?.characterId ?? "rio",
      expectedGesture: skill.gestureId,
      isCapturing: true,
      lastGrade: null,
      color: skill.uiColor,
      label: skill.shortName,
      boss: false
    });
  }

  showCastResult(grade: CastGrade, line: string): void {
    const token = ++this.castPromptToken;
    this.castPrompt.innerHTML = `
      <strong>${gradeLabels[grade]}</strong>
      <span>${line}</span>
    `;
    this.castPrompt.classList.add("is-visible", `grade-${grade.toLowerCase()}`);
    this.cameraPanel.classList.remove("is-capturing", "grade-normal", "grade-great", "grade-perfect");
    if (grade !== "Miss") {
      this.cameraPanel.classList.add(`grade-${grade.toLowerCase()}`);
      this.cameraOverlay?.setContext({ lastGrade: grade, isCapturing: false });
      this.cameraOverlay?.triggerBurst(grade);
      window.setTimeout(() => {
        this.cameraPanel.classList.remove("grade-normal", "grade-great", "grade-perfect");
      }, 820);
    } else {
      this.cameraOverlay?.setContext({ lastGrade: grade, isCapturing: false });
    }
    this.cameraOverlay?.clearExpectedGesture(grade === "Miss" ? 80 : 520);
    window.setTimeout(() => {
      if (token !== this.castPromptToken) {
        return;
      }
      this.castPrompt.className = "cast-prompt";
      this.cameraOverlay?.setContext({ isCapturing: false, label: "" });
    }, 720);
  }

  showBossChallengeCapture(challenge: BossChallengeState): void {
    this.castPromptToken += 1;
    const color =
      challenge.bossType === "drum"
        ? "#ffd166"
        : challenge.bossType === "mirror" || challenge.bossType === "crystalReflector"
          ? "#48f7ff"
          : challenge.bossType === "balloonClown"
            ? "#ff7ad9"
            : "#c7b8ff";
    this.cameraPanel.style.setProperty("--camera-fx-color", color);
    this.cameraFxLayer.querySelector("i")!.textContent = "BOSS";
    this.cameraPanel.classList.remove("grade-normal", "grade-great", "grade-perfect");
    this.cameraPanel.classList.add("is-capturing", "boss-capture");
    this.cameraOverlay?.setContext({
      characterId: this.latestState?.characterId ?? "rio",
      expectedGesture: challenge.requiredGesture,
      isCapturing: true,
      lastGrade: null,
      color,
      label: "보스 포즈",
      boss: true
    });
  }

  showBossChallengeResult(grade: CastGrade, line: string): void {
    const token = ++this.castPromptToken;
    this.cameraPanel.classList.remove("is-capturing", "boss-capture", "grade-normal", "grade-great", "grade-perfect");
    const counterColor = grade === "Perfect" ? "#ffd166" : grade === "Great" ? "#48f7ff" : "#c7b8ff";
    const counterLabel = grade === "Perfect" ? "퍼펙트 카운터" : grade === "Miss" ? "브레이크 실패" : `${gradeLabels[grade]} 카운터`;
    if (grade !== "Miss") {
      this.cameraPanel.classList.add(`grade-${grade.toLowerCase()}`);
      this.cameraPanel.style.setProperty("--camera-fx-color", counterColor);
      this.cameraOverlay?.setContext({
        lastGrade: grade,
        isCapturing: false,
        color: counterColor,
        label: counterLabel,
        boss: true
      });
      this.cameraOverlay?.triggerBurst(grade, {
        color: counterColor,
        label: counterLabel,
        boss: true,
        perfectCounter: grade === "Perfect",
        intensityBoost: grade === "Perfect" ? 1.7 : 1.22
      });
    } else {
      this.cameraOverlay?.setContext({ lastGrade: grade, isCapturing: false, label: counterLabel, boss: true });
    }
    this.cameraOverlay?.clearExpectedGesture(grade === "Miss" ? 80 : 620);
    this.castPrompt.innerHTML = `
      <strong>${grade === "Miss" ? "브레이크 실패" : `${gradeLabels[grade]} 카운터`}</strong>
      <span>${line}</span>
    `;
    this.castPrompt.style.setProperty("--prompt-color", grade === "Perfect" ? "#ffd166" : "#48f7ff");
    this.castPrompt.classList.add("is-visible", `grade-${grade.toLowerCase()}`);
    window.setTimeout(() => {
      if (token !== this.castPromptToken) {
        return;
      }
      this.cameraPanel.classList.remove("grade-normal", "grade-great", "grade-perfect");
      this.castPrompt.className = "cast-prompt";
      this.cameraOverlay?.setContext({ isCapturing: false, label: "", boss: false });
    }, 900);
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add("is-visible");
    this.toastTimer = window.setTimeout(() => {
      this.toast.classList.remove("is-visible");
    }, 1100);
  }

  private tickToast(): void {
    if (this.toastTimer === 0) {
      return;
    }
  }

  private renderAchievementToast(state: GameState): void {
    const key = state.runStats.unlockedAchievements.map((achievement) => achievement.id).join(",");
    if (!key || key === this.achievementToastKey) {
      return;
    }
    this.achievementToastKey = key;
    const latest = state.runStats.unlockedAchievements[state.runStats.unlockedAchievements.length - 1];
    if (latest) {
      this.showToast(`업적 달성: ${latest.title}`);
    }
  }

  private renderQuestToast(state: GameState): void {
    const key = state.runStats.characterQuestUnlocks.map((unlock) => unlock.objectiveId).join(",");
    if (!key || key === this.questToastKey) {
      return;
    }
    this.questToastKey = key;
    const latest = state.runStats.characterQuestUnlocks[state.runStats.characterQuestUnlocks.length - 1];
    if (latest) {
      this.showToast(`${latest.completedLine ? "퀘스트라인 완료" : "퀘스트 완료"}: ${latest.objectiveTitle}`);
    }
  }

  private getModeTitle(state: GameState): string {
    if (state.victory) {
      return "클리어";
    }
    if (state.mode === "title") {
      return "MOVECASTERS";
    }
    if (state.mode === "quick-demo") {
      const remaining = Math.max(0, 180 - Math.floor(state.modeTime));
      const minutesText = Math.floor(remaining / 60)
        .toString()
        .padStart(2, "0");
      const secondsText = (remaining % 60).toString().padStart(2, "0");
      return `3분 데모 ${minutesText}:${secondsText}`;
    }
    if (state.mode === "tutorial") {
      return "튜토리얼";
    }
    if (state.mode === "training") {
      return "훈련장";
    }
    if (state.mode === "survival") {
      const seconds = Math.floor(state.modeTime);
      const minutesText = Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0");
      const secondsText = (seconds % 60).toString().padStart(2, "0");
      return `SURVIVAL ${minutesText}:${secondsText}`;
    }
    if (state.mode === "adventure") {
      return `AREA ${state.adventureStageCode}`;
    }
    if (state.mode === "boss-rush") {
      return `BOSS ${Math.min(state.waveIndex, 5)} / 5`;
    }
    return `WAVE ${Math.min(state.waveIndex, 5)} / 5`;
  }

  private renderObjectiveBanner(state: GameState): void {
    if (state.mode === "title" || state.victory || state.gameOver || !state.objectiveText) {
      this.adventureBanner.classList.remove("is-visible");
      this.adventureBanner.classList.remove("is-urgent");
      this.adventureBanner.innerHTML = "";
      return;
    }

    const progress = Math.min(100, Math.max(0, state.objectiveProgress));
    this.adventureBanner.dataset.mode = state.mode;
    this.adventureBanner.classList.toggle("is-urgent", state.objectiveIsUrgent);
    this.adventureBanner.classList.add("is-visible");
    this.adventureBanner.innerHTML = `
      <div class="objective-heading">
        <strong>${this.getObjectiveKicker(state)}</strong>
        <span>${state.stageName}</span>
      </div>
      <p>${state.objectiveText}</p>
      <small>${state.objectiveDetail}</small>
      <div class="adventure-progress objective-progress"><i style="width:${progress}%"></i></div>
    `;
  }

  private getObjectiveKicker(state: GameState): string {
    if (state.bossChallenge || state.enemies.some((enemy) => enemy.type === "drum" || enemy.type === "mirror" || enemy.type === "zero" || enemy.type === "balloonClown" || enemy.type === "crystalReflector")) {
      return "BOSS OBJECTIVE";
    }
    if (state.mode === "tutorial") {
      return "TUTORIAL";
    }
    if (state.mode === "training") {
      return "TRAINING";
    }
    if (state.mode === "quick-demo") {
      return `QUICK DEMO ${Math.min(4, Math.max(1, state.quickDemo.phaseIndex + 1))}/4`;
    }
    if (state.mode === "survival") {
      return "SURVIVAL";
    }
    if (state.mode === "boss-rush") {
      return `BOSS RUSH ${Math.max(1, state.bossRushIndex)}/5`;
    }
    if (state.mode === "adventure") {
      return `AREA ${state.adventureStageCode || state.waveIndex}`;
    }
    return `WAVE ${Math.max(1, state.waveIndex)}/5`;
  }

  private renderTutorialPanel(state: GameState): void {
    if (state.mode !== "tutorial" || state.victory || state.gameOver) {
      this.tutorialPanel.classList.remove("is-visible");
      this.tutorialPanel.innerHTML = "";
      return;
    }

    const tutorial = state.tutorial;
    const step = tutorial.steps[tutorial.currentStepIndex];
    if (!step) {
      this.tutorialPanel.classList.remove("is-visible");
      this.tutorialPanel.innerHTML = "";
      return;
    }

    const progress = Math.min(100, (tutorial.steps.filter((item) => item.completed).length / tutorial.steps.length) * 100);
    const detail =
      step.id === "move"
        ? `이동 유지 ${Math.min(100, Math.round((tutorial.moveSeconds / 0.8) * 100))}%`
        : step.id === "basic-attack"
          ? `명중 ${tutorial.basicAttackHits}/1`
          : step.id === "prepare-q"
            ? "Q 입력 대기"
            : step.id === "cast-skill"
              ? "포즈 또는 1/2/3 대기"
              : step.id === "reward"
                ? "카드 선택 대기"
                : step.id === "boss-pose-break"
                  ? "보스 카운터 대기"
                  : "";

    this.tutorialPanel.classList.add("is-visible");
    this.tutorialPanel.innerHTML = `
      <div class="tutorial-kicker">포즈 캐스트 가이드 · ${tutorial.currentStepIndex + 1}/${tutorial.steps.length}</div>
      <strong>${step.title}</strong>
      <span>${step.prompt}</span>
      <p>${step.hint}</p>
      <small>${detail}</small>
      <div class="tutorial-progress"><i style="width:${progress}%"></i></div>
    `;
  }

  private renderBossChallenge(state: GameState): void {
    const challenge = state.bossChallenge;
    if (!challenge || state.victory || state.gameOver) {
      this.bossChallengePrompt.classList.remove("is-visible");
      this.bossChallengePrompt.innerHTML = "";
      return;
    }

    const remaining = Math.max(0, challenge.expiresAt - state.time);
    const progress = Math.max(0, Math.min(100, (remaining / challenge.stepDuration) * 100));
    const stepNow = challenge.currentIndex + 1;
    const stepTotal = Math.max(1, challenge.sequence.length);
    const sequenceText = challenge.sequence.map((gesture, index) => `${index === challenge.currentIndex ? "▶ " : ""}${gestureLabel(gesture)}`).join(" / ");
    const bossLabels: Record<BossChallengeState["bossType"], string> = {
      drum: "드럼 노이즈",
      mirror: "거울의 마녀",
      zero: "제로 모션",
      balloonClown: "풍선 광대",
      crystalReflector: "크리스탈 리플렉터"
    };
    const bossLabel = bossLabels[challenge.bossType];
    this.bossChallengePrompt.dataset.boss = challenge.bossType;
    this.bossChallengePrompt.classList.add("is-visible");
    this.bossChallengePrompt.innerHTML = `
      <div class="boss-challenge-kicker">보스 포즈 브레이크 · ${stepNow}/${stepTotal}</div>
      <strong>${bossLabel}</strong>
      <span>${challenge.prompt}</span>
      <p>${sequenceText} · 1/2/3 가능</p>
      <div class="boss-challenge-timer"><i style="width:${progress}%"></i></div>
    `;
  }

  private renderTrainingPanel(state: GameState): void {
    if (state.mode !== "training") {
      this.trainingPanel.classList.remove("is-visible");
      this.trainingPanel.innerHTML = "";
      return;
    }

    const training = state.training;
    const totalAttempts = training.missions.reduce((sum, mission) => sum + mission.attempts, 0);
    const totalPerfects = training.missions.reduce((sum, mission) => sum + mission.perfects, 0);
    const totalCompleted = training.missions.filter((mission) => mission.completed).length;
    const perfectRate = totalAttempts > 0 ? Math.round((totalPerfects / totalAttempts) * 100) : 0;
    const last = training.lastResult;
    const breakdown = last?.breakdown;
    const tipIsImportant = last?.grade === "Miss" || last?.grade === "Normal";
    const effectiveAssist = getEffectivePoseAssistLevel(state.poseAssistLevel, state.mode);
    const assistNotice =
      effectiveAssist === "relaxed"
        ? `<div class="training-assist-note"><strong>보정 적용 중</strong><span>훈련장은 관대한 판정으로 연습해요.</span></div>`
        : "";
    const breakdownRows = breakdown
      ? [
          ["자세", breakdown.positionScore],
          ["동작", breakdown.motionScore],
          ["속도", breakdown.speedScore],
          ["안정", breakdown.stabilityScore],
          ["크기", breakdown.sizeScore]
        ]
          .map(
            ([label, score]) => `
              <div class="training-breakdown-row">
                <span>${label}</span>
                <i><b style="width:${Math.round(Number(score))}%"></b></i>
                <strong>${Math.round(Number(score))}</strong>
              </div>
            `
          )
          .join("")
      : "";
    const missionRows = training.missions
      .map((mission) => {
        const progress = Math.min(100, (mission.successes / mission.targetSuccesses) * 100);
        const missionPerfectRate = mission.attempts > 0 ? Math.round((mission.perfects / mission.attempts) * 100) : 0;
        return `
          <div class="training-mission ${mission.completed ? "is-complete" : ""}">
            <div>
              <strong>${mission.title}</strong>
              <span>${gestureLabel(mission.gestureId)} · ${mission.successes}/${mission.targetSuccesses}</span>
            </div>
            <p>${mission.prompt}</p>
            <div class="training-progress"><i style="width:${progress}%"></i></div>
            <small>${mission.completed ? "완료" : `퍼펙트 ${missionPerfectRate}%`}</small>
          </div>
        `;
      })
      .join("");

    this.trainingPanel.classList.add("is-visible");
    this.trainingPanel.innerHTML = `
      <div class="training-header">
        <div>
          <p>포즈 훈련</p>
          <strong>훈련장 미션</strong>
        </div>
        <span>${totalCompleted}/${training.missions.length} 완료</span>
      </div>
      <div class="training-summary">
        <div><span>퍼펙트 성공률</span><strong>${perfectRate}%</strong></div>
        <div><span>최근 점수</span><strong>${last ? Math.round(last.score) : "--"}</strong></div>
        <div><span>최근 등급</span><strong class="${last ? `grade-${last.grade.toLowerCase()}` : ""}">${last ? gradeLabels[last.grade] : "준비"}</strong></div>
      </div>
      ${assistNotice}
      <div class="training-last">
        <b>${last ? gestureLabel(last.gestureId) : "포즈 대기"}</b>
        <span>${last ? last.reason : "스킬 준비 후 포즈를 취해요. 1/2/3도 가능!"}</span>
      </div>
      ${
        breakdown
          ? `
            <div class="training-breakdown">
              <strong>세부 판정</strong>
              ${breakdownRows}
              <p class="${tipIsImportant ? "is-important" : ""}">${breakdown.tip}</p>
            </div>
          `
          : ""
      }
      <div class="training-camera-guide">
        <strong>카메라 보정 팁</strong>
        <span>상반신과 양손이 화면에 들어오게 앉아요. 역광을 피하고, 포즈는 준비 후 바로 끝내면 안정적입니다.</span>
        <button class="training-calibration-open" type="button">카메라 보정 열기</button>
      </div>
      <div class="training-mission-list">${missionRows}</div>
      <div class="training-unlock-note">완료 키: ${training.completedRewardKeys.length > 0 ? training.completedRewardKeys.join(" / ") : "아직 없음"}</div>
    `;
    this.trainingPanel.querySelector<HTMLButtonElement>(".training-calibration-open")?.addEventListener("click", () => {
      this.toggleCameraCalibration(true);
    });
  }

  private renderTitle(state: GameState | null): void {
    const visible = state?.mode === "title";
    this.titleOverlay.classList.toggle("is-visible", visible);
    if (!visible || !state) {
      if (this.titleRenderKey !== "") {
        this.titleOverlay.innerHTML = "";
        this.titleRenderKey = "";
      }
      return;
    }

    const renderKey = [
      state.characterId,
      this.progressSnapshot.selectedDifficulty,
      this.progressSnapshot.selectedPoseAssistLevel,
      this.progressSnapshot.tutorialCompleted ? "tutorial-done" : "tutorial-open",
      this.titleSettingsVisible ? "settings" : "main",
      this.tutorialRecommendationVisible ? "recommend" : "normal",
      JSON.stringify(this.cameraFxSettings),
      JSON.stringify(this.accessibilitySettings),
      this.getCalibrationSummaryKey(),
      ...Object.values(CHARACTERS).map((character) => {
        const progress = this.progressSnapshot.characters[character.id];
        const skinId = this.progressSnapshot.equippedSkins[character.id];
        return `${character.id}:${progress.level}:${skinId}`;
      })
    ].join("|");
    if (renderKey === this.titleRenderKey) {
      return;
    }
    this.titleRenderKey = renderKey;

    const selectedCharacter = getCharacter(state.characterId);
    const selectedDetail = CHARACTER_CARD_DETAILS[state.characterId];
    const characterCards = Object.values(CHARACTERS)
      .map((character) => {
        const detail = CHARACTER_CARD_DETAILS[character.id];
        const progress = this.progressSnapshot.characters[character.id];
        const equippedSkinId = this.progressSnapshot.equippedSkins[character.id];
        const equippedSkin = getSkinsForCharacter(character.id).find((skin) => skin.id === equippedSkinId);
        const active = character.id === state.characterId;
        return `
          <button class="title-character-card ${active ? "is-active" : ""}" type="button" data-title-character-id="${character.id}" style="--character-color:${character.uiColor}">
            ${renderCharacterPortrait(character.id, { active, compact: true })}
            <span class="title-character-role">${detail.role}</span>
            <strong>${character.name}</strong>
            <em>${character.title}</em>
            <div class="title-character-meta">
              <span>난이도 <b>${detail.difficulty}</b></span>
              <span>Lv.${progress.level}</span>
            </div>
            <small>대표 제스처: ${detail.gestures}</small>
            <small>전용 시너지: ${detail.synergy}</small>
            <i>스킨: ${equippedSkin?.title ?? equippedSkinId}</i>
          </button>
        `;
      })
      .join("");
    const titleSettings = this.titleSettingsVisible
      ? `
        <section class="title-settings-panel">
          <div>
            <p>카메라 설정</p>
            <strong>카메라 / AR 설정</strong>
            <span>원본을 숨겨도 포즈 인식은 계속 작동합니다. 카메라가 없으면 1/2/3으로 테스트해요.</span>
          </div>
          ${renderDifficultySettingsPanel(this.progressSnapshot.selectedDifficulty, "title")}
          ${renderPoseAssistSettingsPanel(this.progressSnapshot.selectedPoseAssistLevel, state.mode, "title")}
          ${renderAccessibilitySettingsPanel(this.accessibilitySettings, "title")}
          ${renderCameraFxSettingsPanel(this.cameraFxSettings, "title")}
          ${this.renderCalibrationLauncher()}
        </section>
      `
      : "";
    const recommendModal = this.tutorialRecommendationVisible
      ? `
        <div class="title-recommend-modal" role="dialog" aria-modal="true">
          <div class="title-recommend-card">
            <p>첫 플레이 팁</p>
            <h3>처음 플레이는 튜토리얼을 추천합니다</h3>
            <span>스킬 버튼을 누른 뒤 포즈를 취해요. 1분이면 대체 입력까지 익힐 수 있습니다.</span>
            <div>
              <button type="button" data-title-recommend="tutorial">튜토리얼 시작</button>
              <button type="button" data-title-recommend="skip">그래도 시작</button>
              <button type="button" data-title-recommend="close">닫기</button>
            </div>
          </div>
        </div>
      `
      : "";

    this.titleOverlay.innerHTML = `
      <div class="title-panel">
        <section class="title-hero">
          <p>MOVECASTERS: POSE BREAK</p>
          <h1>무브캐스터즈</h1>
          <strong>포즈 브레이크</strong>
          <span>키보드로 피하고, 결정적 순간 포즈 캐스트로 스킬을 터뜨리는 액션 로그라이트 데모입니다.</span>
          <div class="title-actions">
            <button type="button" data-title-action="start" class="primary">게임 시작</button>
            <button type="button" data-title-action="quick-demo" class="primary ghost">3분 데모</button>
            <button type="button" data-title-action="tutorial">튜토리얼</button>
            <button type="button" data-title-action="training">훈련장</button>
            <button type="button" data-title-action="hub">허브</button>
            <button type="button" data-title-action="settings">${this.titleSettingsVisible ? "설정 닫기" : "설정"}</button>
          </div>
          <small>${this.progressSnapshot.tutorialCompleted ? "튜토리얼 완료" : "처음이면 튜토리얼 추천"} · 카메라 없이도 1/2/3 가능</small>
        </section>
        <section class="title-selected-card" style="--character-color:${selectedCharacter.uiColor}">
          ${renderCharacterPortrait(state.characterId, { active: true })}
          <div>
            <p>현재 선택</p>
            <h2>${selectedCharacter.name}</h2>
            <strong>${selectedDetail.role}</strong>
            <span>${selectedDetail.gestures} · ${selectedDetail.synergy}</span>
          </div>
        </section>
        <section class="title-roster">
          <div class="title-section-heading">
            <p>SELECT MOVECASTER</p>
            <strong>캐릭터 선택</strong>
          </div>
          <div class="title-character-grid">${characterCards}</div>
        </section>
        ${titleSettings}
        ${recommendModal}
      </div>
    `;

    this.titleOverlay.querySelectorAll<HTMLButtonElement>("[data-title-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.titleAction;
        if (action === "start") {
          if (!this.progressSnapshot.tutorialCompleted) {
            this.tutorialRecommendationVisible = true;
            this.titleRenderKey = "";
            this.renderTitle(state);
            return;
          }
          this.options.onModeSelected("adventure");
        } else if (action === "quick-demo") {
          this.options.onModeSelected("quick-demo");
        } else if (action === "tutorial") {
          this.options.onModeSelected("tutorial");
        } else if (action === "training") {
          this.options.onModeSelected("training");
        } else if (action === "hub") {
          this.toggleHub(true);
        } else if (action === "settings") {
          this.titleSettingsVisible = !this.titleSettingsVisible;
          this.titleRenderKey = "";
          this.renderTitle(state);
        }
      });
    });
    this.titleOverlay.querySelectorAll<HTMLButtonElement>("[data-title-character-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const characterId = button.dataset.titleCharacterId as CharacterId | undefined;
        if (!characterId) {
          return;
        }
        this.options.onCharacterSelected(characterId);
        button.classList.add("is-picked");
        this.showToast(`${getCharacter(characterId).name} 선택`);
        this.titleRenderKey = "";
      });
    });
    this.titleOverlay.querySelectorAll<HTMLButtonElement>("[data-title-recommend]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.titleRecommend;
        this.tutorialRecommendationVisible = false;
        this.titleRenderKey = "";
        if (action === "tutorial") {
          this.options.onModeSelected("tutorial");
          return;
        }
        if (action === "skip") {
          this.options.onModeSelected("adventure");
          return;
        }
        this.renderTitle(state);
      });
    });
    this.titleOverlay.querySelectorAll<HTMLButtonElement>("[data-title-difficulty]").forEach((button) => {
      button.addEventListener("click", () => {
        const difficulty = button.dataset.titleDifficulty as Difficulty | undefined;
        if (!difficulty) {
          return;
        }
        this.options.onDifficultySelected(difficulty);
        this.titleRenderKey = "";
        this.hubRenderKey = "";
        this.showToast(`난이도: ${getDifficultyDefinition(difficulty).title}`);
      });
    });
    this.titleOverlay.querySelectorAll<HTMLButtonElement>("[data-title-pose-assist]").forEach((button) => {
      button.addEventListener("click", () => {
        const level = button.dataset.titlePoseAssist as PoseAssistLevel | undefined;
        if (!level) {
          return;
        }
        this.options.onPoseAssistSelected(level);
        this.titleRenderKey = "";
        this.hubRenderKey = "";
        this.showToast(`포즈 보정: ${getPoseAssistDefinition(level).title}`);
      });
    });
    this.titleOverlay.querySelectorAll<HTMLButtonElement>("[data-title-camera-size]").forEach((button) => {
      button.addEventListener("click", () => {
        const size = button.dataset.titleCameraSize as CameraPreviewSize | undefined;
        if (size && cameraPreviewSizes.includes(size)) {
          this.setCameraFxSettings({ cameraSize: size });
        }
      });
    });
    this.titleOverlay.querySelectorAll<HTMLButtonElement>("[data-title-camera-intensity]").forEach((button) => {
      button.addEventListener("click", () => {
        const intensity = button.dataset.titleCameraIntensity as CameraFxIntensity | undefined;
        if (intensity && cameraFxIntensities.includes(intensity)) {
          this.setCameraFxSettings({ arFxIntensity: intensity });
        }
      });
    });
    this.titleOverlay.querySelectorAll<HTMLButtonElement>("[data-title-camera-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.titleCameraToggle as CameraToggleKey | undefined;
        if (!key || typeof this.cameraFxSettings[key] !== "boolean") {
          return;
        }
        this.setCameraFxSettings({ [key]: !this.cameraFxSettings[key] } as Partial<CameraFxSettings>);
      });
    });
    this.titleOverlay.querySelectorAll<HTMLButtonElement>("[data-title-a11y-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.titleA11yChoice as AccessibilityChoiceKey | undefined;
        const value = button.dataset.value;
        this.setAccessibilityChoice(key, value);
      });
    });
    this.titleOverlay.querySelectorAll<HTMLButtonElement>("[data-title-a11y-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.titleA11yToggle as AccessibilityToggleKey | undefined;
        this.toggleAccessibilitySetting(key);
      });
    });
    this.titleOverlay.querySelector<HTMLButtonElement>("[data-open-calibration]")?.addEventListener("click", () => {
      this.toggleCameraCalibration(true);
    });
  }

  private renderCharacterSelect(): void {
    if (!this.characterSelectVisible || !this.latestState) {
      return;
    }

    const state = this.latestState;
    const renderKey = [
      state.characterId,
      ...Object.values(CHARACTERS).map((character) => {
        const progress = this.progressSnapshot.characters[character.id];
        return `${character.id}:${progress.level}:${progress.xp}:${progress.victories}:${progress.runs}`;
      })
    ].join("|");

    if (renderKey === this.characterSelectRenderKey) {
      return;
    }
    this.characterSelectRenderKey = renderKey;

    const cards = Object.values(CHARACTERS)
      .map((character) => {
        const detail = CHARACTER_CARD_DETAILS[character.id];
        const progress = this.progressSnapshot.characters[character.id];
        const active = character.id === state.characterId;
        return `
          <button class="character-select-card ${active ? "is-active" : ""}" type="button" data-character-id="${character.id}" style="--character-color:${character.uiColor}">
            ${renderCharacterPortrait(character.id, { active })}
            <span class="character-card-kicker">${detail.role}</span>
            <strong>${character.name}</strong>
            <em>${character.title}</em>
            <div class="character-card-meta">
              <span>난이도 <b>${detail.difficulty}</b></span>
              <span>Lv.${progress.level}</span>
            </div>
            <div class="character-card-gesture">${detail.gestures}</div>
            <small>${detail.synergy}</small>
          </button>
        `;
      })
      .join("");

    this.characterSelectOverlay.innerHTML = `
      <div class="character-select-panel">
        <div class="character-select-header">
          <div>
            <p>MOVECASTER ROSTER</p>
            <h2>캐릭터 선택</h2>
          </div>
          <button class="character-select-close" type="button">닫기</button>
        </div>
        <div class="character-select-grid">${cards}</div>
      </div>
    `;

    this.characterSelectOverlay.querySelector<HTMLButtonElement>(".character-select-close")?.addEventListener("click", () => {
      this.toggleCharacterSelect(false);
    });
    this.characterSelectOverlay.querySelectorAll<HTMLButtonElement>(".character-select-card").forEach((button) => {
      button.addEventListener("click", () => {
        const characterId = button.dataset.characterId as CharacterId | undefined;
        if (!characterId) {
          return;
        }
        this.options.onCharacterSelected(characterId);
        this.characterSelectOverlay.querySelectorAll(".character-select-card").forEach((card) => card.classList.remove("is-picked"));
        button.classList.add("is-picked");
        this.showToast(`${getCharacter(characterId).name} 선택`);
        this.characterSelectRenderKey = "";
      });
    });
  }

  private renderRewardLog(state: GameState | null): void {
    if (!state || !this.rewardLogVisible) {
      this.rewardLogPanel.classList.remove("is-visible");
      this.rewardLogPanel.innerHTML = "";
      return;
    }

    const grouped = new Map<string, number>();
    for (const rewardId of state.runStats.rewardsChosen) {
      grouped.set(rewardId, (grouped.get(rewardId) ?? 0) + 1);
    }
    const rewardRows = Array.from(grouped.entries())
      .map(([rewardId, count]) => {
        const reward = REWARDS.find((item) => item.id === rewardId);
        if (!reward) {
          return "";
        }
        return `
          <li class="rarity-${reward.rarity}">
            <i>${rarityLabels[reward.rarity]}</i>
            <div>
              <strong>${reward.title} <b>${count}/${reward.maxStacks}</b></strong>
              <span>${reward.tags.join(" / ")}</span>
            </div>
          </li>
        `;
      })
      .join("");
    const synergyRows =
      state.activeSynergies.length > 0
        ? state.activeSynergies
            .map(
                (synergy) => `
                  <li>
                  <i class="tier-${synergy.tier}">${synergyTierLabels[synergy.tier]}</i>
                  <div>
                    <strong>${synergy.title}</strong>
                    <span>${synergy.activeEffect}</span>
                  </div>
                </li>
              `
            )
            .join("")
        : `<li class="empty-reward-log"><div><strong>완성된 빌드 없음</strong><span>같은 태그 보상을 모아보세요.</span></div></li>`;

    this.rewardLogPanel.classList.add("is-visible");
    this.rewardLogPanel.innerHTML = `
      <div class="reward-log-header">
        <strong>선택한 보상</strong>
        <span>Tab</span>
      </div>
      <ul>${rewardRows || `<li class="empty-reward-log"><div><strong>선택한 카드 없음</strong><span>웨이브 보상을 고르면 여기에 기록됩니다.</span></div></li>`}</ul>
      <div class="reward-log-header is-sub">
        <strong>현재 빌드</strong>
      </div>
      <ul>${synergyRows}</ul>
    `;
  }

  private renderDevPanel(state: GameState | null, metrics: HudDevMetrics): void {
    this.devPanel.classList.toggle("is-visible", this.devPanelVisible);
    if (!state || !this.devPanelVisible) {
      return;
    }

    const now = performance.now();
    if (this.devPanel.innerHTML && now - this.devPanelRenderAt < 180) {
      return;
    }
    this.devPanelRenderAt = now;

    const stats = state.runStats;
    const debug = state.debugStats;
    const historyStats = this.options.runHistory.getStats();
    const activeSynergies =
      state.activeSynergies.length > 0
        ? state.activeSynergies
            .map((synergy) => `<li><i class="tier-${synergy.tier}">${synergyTierLabels[synergy.tier]}</i><span>${synergy.title}</span></li>`)
            .join("")
        : `<li><i>NONE</i><span>활성 시너지 없음</span></li>`;

    this.devPanel.innerHTML = `
      <div class="dev-panel-header">
        <div>
          <p>DEV BALANCE PANEL</p>
          <strong>${Math.round(metrics.fpsAverage || metrics.fps || 0)} FPS AVG</strong>
        </div>
        <button type="button" data-dev-action="close">닫기</button>
      </div>
      <div class="dev-stat-grid">
        ${devStat("모드", `${modeLabel(state.mode)} / ${state.stageName}`)}
        ${devStat("성능 모드", performanceQualityLabel(this.accessibilitySettings.performanceMode))}
        ${devStat("FPS 현재", Math.round(metrics.fps || 0).toString())}
        ${devStat("FPS 평균", Math.round(metrics.fpsAverage || metrics.fps || 0).toString())}
        ${devStat("FPS 최근 최소", Math.round(metrics.fpsMinRecent || 0).toString())}
        ${devStat("Pose FPS", Math.round(metrics.poseFps || 0).toString())}
        ${devStat("AR 파티클", Math.round(metrics.cameraFxParticles || 0).toString())}
        ${devStat("Phaser 텍스트", Math.round(metrics.activePhaserTexts || 0).toString())}
        ${devStat("난이도", difficultyLabel(state.difficulty))}
        ${devStat("적", `${metrics.enemies ?? state.enemies.length} / 대기 ${state.spawnQueue.length}`)}
        ${devStat("투사체", (metrics.projectiles ?? state.projectiles.length).toString())}
        ${devStat("게이지", `${Math.round(state.player.gauge)}%`)}
        ${devStat("DPS", debug.dpsEstimate.toFixed(1))}
        ${devStat("카드", stats.rewardsChosen.length.toString())}
        ${devStat("최근 클리어율", historyStats.totalRuns > 0 ? `${Math.round(historyStats.clearRate * 100)}%` : "--")}
        ${devStat("평균 미스", historyStats.totalRuns > 0 ? `${Math.round(historyStats.averageMissRate * 100)}%` : "--")}
        ${devStat("기록 평균 FPS", historyStats.averageFps > 0 ? Math.round(historyStats.averageFps).toString() : "--")}
        ${devStat("보스 포즈 성공률", historyStats.totalRuns > 0 ? `${Math.round(historyStats.averageBossPoseSuccessRate * 100)}%` : "--")}
      </div>
      <div class="dev-grade-line">
        <span>퍼펙트 <b>${stats.perfectCasts}</b></span>
        <span>그레이트 <b>${stats.greatCasts}</b></span>
        <span>노멀 <b>${stats.normalCasts}</b></span>
        <span>미스 <b>${stats.misses}</b></span>
      </div>
      <div class="dev-grade-line">
        <span>보스 포즈 성공 <b>${debug.bossChallengeSuccesses}</b></span>
        <span>보스 포즈 실패 <b>${debug.bossChallengeFailures}</b></span>
      </div>
      <div class="dev-action-grid">
        <button type="button" data-dev-action="gauge">게이지 100</button>
        <button type="button" data-dev-action="clear-wave">웨이브 클리어</button>
        <button type="button" data-dev-action="spawn-boss">보스 소환</button>
        <button type="button" data-dev-action="force-reward">보상 카드</button>
        <button type="button" data-dev-action="clear-history">기록 초기화</button>
      </div>
      <div class="dev-section">
        <strong>활성 시너지</strong>
        <ul class="dev-synergy-list">${activeSynergies}</ul>
      </div>
      <div class="dev-section">
        <strong>주요 업그레이드</strong>
        <div class="dev-upgrade-grid">${renderDevUpgradeRows(state)}</div>
      </div>
      <small class="dev-panel-hint">열기/닫기: 백틱 또는 Shift+D</small>
    `;

    this.devPanel.querySelectorAll<HTMLButtonElement>("[data-dev-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.devAction;
        if (action === "close") {
          this.toggleDevPanel(false);
          return;
        }
        if (action === "clear-history") {
          this.options.onRunHistoryCleared();
          this.hubRenderKey = "";
          this.showToast("최근 기록 초기화");
          this.renderHub();
          this.devPanelRenderAt = 0;
          return;
        }
        const response =
          action === "gauge"
            ? this.options.onDevFillGauge()
            : action === "clear-wave"
              ? this.options.onDevClearWave()
              : action === "spawn-boss"
                ? this.options.onDevSpawnBoss()
                : this.options.onDevForceReward();
        this.showToast(response.line);
        this.devPanelRenderAt = 0;
      });
    });
  }

  private renderHub(): void {
    if (!this.hubVisible || !this.latestState) {
      return;
    }

    const state = this.latestState;
    const characterProgress = this.progressSnapshot.characters[state.characterId];
    const skills = Object.values(getSkillsForCharacter(state.characterId));
    const skillKey = skills
      .map((skill) => {
        const progress = this.progressSnapshot.skills[skill.id];
        return `${skill.id}:${progress?.uses ?? 0}:${progress?.perfects ?? 0}:${progress?.level ?? 1}`;
      })
      .join("|");
    const unlockProgressKey = [
      this.progressSnapshot.unlockedCoreIds.join(","),
      this.progressSnapshot.unlockedEffectPaletteIds.join(","),
      ACHIEVEMENTS.map((achievement) => {
        const progress = this.progressSnapshot.achievements[achievement.id];
        return `${achievement.id}:${progress?.current ?? 0}:${progress?.completed ? 1 : 0}`;
      }).join("|"),
      Object.values(this.progressSnapshot.characters)
        .map((progress) => `${progress.level}:${progress.perfectCasts}:${progress.runs}:${progress.victories}`)
        .join("|"),
      Object.values(this.progressSnapshot.skills)
        .map((progress) => `${progress.uses}:${progress.perfects}:${progress.level}`)
        .join("|"),
      CHARACTER_QUEST_LINES.map((line) => {
        const progress = this.progressSnapshot.characterQuestProgress[line.characterId];
        return line.objectives.map((objective) => {
          const item = progress?.objectives[objective.id];
          return `${objective.id}:${item?.current ?? 0}:${item?.completed ? 1 : 0}`;
        }).join(",");
      }).join("|"),
      `${this.progressSnapshot.unlockStats.storyVictories}:${this.progressSnapshot.unlockStats.maruBossClears}:${this.progressSnapshot.unlockStats.lowHpVictories}`
    ].join("::");
    const renderKey = [
      state.characterId,
      JSON.stringify(this.cameraFxSettings),
      JSON.stringify(this.accessibilitySettings),
      this.options.runHistory.getEntries().map((entry) => `${entry.date}:${entry.score}:${entry.victory ? 1 : 0}`).join("|"),
      this.progressSnapshot.equippedCoreId,
      this.progressSnapshot.equippedSkins[state.characterId],
      this.progressSnapshot.equippedEffectPaletteId,
      this.progressSnapshot.unlockedSkinIds.join(","),
      this.progressSnapshot.discoveredEnemyTypes.join(","),
      this.progressSnapshot.selectedAdventureStageId,
      this.progressSnapshot.tutorialCompleted ? "tutorial-done" : "tutorial-new",
      this.progressSnapshot.selectedDifficulty,
      this.progressSnapshot.selectedPoseAssistLevel,
      ADVENTURE_STAGES.map((stage) => {
        const progress = this.progressSnapshot.adventureStages[stage.id];
        return `${stage.id}:${progress?.clears ?? 0}:${progress?.bestGrade ?? "-"}:${progress?.bestScore ?? 0}`;
      }).join("|"),
      this.progressSnapshot.daily.dateKey,
      unlockProgressKey,
      characterProgress.xp,
      characterProgress.level,
      this.getCalibrationSummaryKey(),
      skillKey
    ].join("::");

    if (renderKey === this.hubRenderKey) {
      return;
    }
    this.hubRenderKey = renderKey;

    const equippedCore = getCoreDefinition(this.progressSnapshot.equippedCoreId);
    const characterCards = Object.values(CHARACTERS)
      .map((character) => {
        const progress = this.progressSnapshot.characters[character.id];
        const detail = CHARACTER_CARD_DETAILS[character.id];
        const active = character.id === state.characterId;
        return `
          <button class="hub-character-card ${active ? "is-active" : ""}" type="button" data-character-id="${character.id}" style="--character-color:${character.uiColor}">
            ${renderCharacterPortrait(character.id, { active, compact: true })}
            <div>
              <strong>${character.name} Lv.${progress.level}</strong>
              <span>${detail.role} · ${detail.difficulty}</span>
              <small>${detail.synergy} · ${progress.victories}/${progress.runs} 승리 · XP ${progress.xp}</small>
            </div>
          </button>
        `;
      })
      .join("");
    const skillRows = skills
      .map((skill) => {
        const progress = this.progressSnapshot.skills[skill.id] ?? { uses: 0, perfects: 0, level: 1 };
        return `
          <div class="hub-skill-row">
            <strong>${skill.slot} ${skill.name}</strong>
            <span>숙련도 ${progress.level}/5</span>
            <small>${progress.uses}회 사용 · 퍼펙트 ${progress.perfects}</small>
          </div>
        `;
      })
      .join("");
    const coreButtons = CORES.map((core) => {
      const equipped = core.id === this.progressSnapshot.equippedCoreId;
      const unlocked = this.progressSnapshot.unlockedCoreIds.includes(core.id);
      const unlock = getUnlockProgress(this.progressSnapshot, "core", core.id);
      return `
        <button class="core-card ${equipped ? "is-equipped" : ""} ${unlocked ? "" : "is-locked"}" data-core-id="${core.id}">
          <strong>${core.title}</strong>
          <span>${core.description}</span>
          <small>${equipped ? "장착 중" : unlocked ? "장착" : `잠김 · ${unlock?.condition ?? "해금 조건 미달성"}`}</small>
          ${unlocked ? "" : renderUnlockProgress(unlock)}
        </button>
      `;
    }).join("");
    const adventureCards = ADVENTURE_STAGES.map((stage, index) => {
      const progress = this.progressSnapshot.adventureStages[stage.id] ?? { clears: 0, bestScore: 0, bestSeconds: 0, bestGrade: null };
      const previousStage = ADVENTURE_STAGES[index - 1];
      const unlocked = index === 0 || (previousStage ? (this.progressSnapshot.adventureStages[previousStage.id]?.clears ?? 0) > 0 : false);
      const selected = this.progressSnapshot.selectedAdventureStageId === stage.id;
      const cleared = progress.clears > 0;
      return `
        <button class="adventure-stage-card ${selected ? "is-selected" : ""} ${cleared ? "is-cleared" : ""}" data-stage-id="${stage.id}" ${unlocked ? "" : "disabled"}>
          <i>${stage.code}</i>
          <strong>${stage.title}</strong>
          <span>${stage.region} · ${stage.goal}</span>
          <small>${
            unlocked
              ? cleared
                ? `BEST ${progress.bestGrade ?? "C"} · ${progress.bestScore}점 · ${Math.ceil(progress.bestSeconds)}초`
                : selected
                  ? "선택됨 · 첫 클리어 도전"
                  : "도전 가능"
              : "이전 단계를 클리어하면 해금"
          }</small>
        </button>
      `;
    }).join("");
    const selectedSkinId = this.progressSnapshot.equippedSkins[state.characterId];
    const skinCards = getSkinsForCharacter(state.characterId)
      .map((skin) => {
        const unlocked = this.progressSnapshot.unlockedSkinIds.includes(skin.id);
        const equipped = skin.id === selectedSkinId;
        const unlock = getUnlockProgress(this.progressSnapshot, "skin", skin.id);
        return `
          <button class="skin-card ${equipped ? "is-equipped" : ""} ${unlocked ? "" : "is-locked"}" data-skin-id="${skin.id}" style="--skin-color:${skin.themeColor}" ${unlocked ? "" : "disabled"}>
            <i>${skin.shortLabel}</i>
            <strong>${skin.title}</strong>
            <span>${skin.description}</span>
            <small>${equipped ? "장착 중" : unlocked ? "장착" : `잠김 · ${unlock?.condition ?? "해금 조건 미달성"}`}</small>
            ${unlocked ? "" : renderUnlockProgress(unlock)}
          </button>
        `;
      })
      .join("");
    const effectCards = EFFECT_PALETTES.map((palette) => {
      const equipped = palette.id === this.progressSnapshot.equippedEffectPaletteId;
      const unlocked = this.progressSnapshot.unlockedEffectPaletteIds.includes(palette.id);
      const unlock = getUnlockProgress(this.progressSnapshot, "effect", palette.id);
      return `
        <button class="effect-card ${equipped ? "is-equipped" : ""} ${unlocked ? "" : "is-locked"}" data-effect-id="${palette.id}" style="--effect-color:${palette.uiColor}" ${unlocked ? "" : "disabled"}>
          <i>${palette.shortLabel}</i>
          <strong>${palette.title}</strong>
          <span>${palette.description}</span>
          <small>${equipped ? "적용 중" : unlocked ? "적용" : `잠김 · ${unlock?.condition ?? "해금 조건 미달성"}`}</small>
          ${unlocked ? "" : renderUnlockProgress(unlock)}
        </button>
      `;
    }).join("");
    const storyCards = STORY_ENTRIES.filter((entry) => entry.characterId === state.characterId)
      .map((entry) => {
        const unlocked = characterProgress.level >= entry.requiredLevel;
        return `
          <div class="story-card ${unlocked ? "" : "is-locked"}">
            <strong>${entry.title}</strong>
            <span>${unlocked ? entry.body : `Lv.${entry.requiredLevel}에 해금됩니다.`}</span>
          </div>
        `;
      })
      .join("");
    const questLine = getCharacterQuestLine(state.characterId);
    const questProgress = this.progressSnapshot.characterQuestProgress[state.characterId];
    const questCards = questLine.objectives
      .map((objective, index) => {
        const progress = questProgress.objectives[objective.id] ?? { current: 0, completed: false, completedAt: null };
        const percent = Math.min(100, Math.round((progress.current / objective.target) * 100));
        return `
          <div class="character-quest-card ${progress.completed ? "is-complete" : ""}">
            <i>${index + 1}</i>
            <strong>${objective.title}</strong>
            <span>${objective.description}</span>
            <small>${progress.completed ? objective.rewardText : `${progress.current}/${objective.target}`}</small>
            <div class="character-quest-progress"><b style="width:${percent}%"></b></div>
          </div>
        `;
      })
      .join("");
    const codexCards = NOISE_CODEX.map((entry) => {
      const discovered = this.progressSnapshot.discoveredEnemyTypes.includes(entry.enemyType);
      return `
        <div class="codex-card ${discovered ? "" : "is-locked"}" data-enemy-type="${entry.enemyType}">
          <strong>${discovered ? entry.title : "미발견 노이즈"}</strong>
          <span>${discovered ? `${entry.role} · 약점: ${entry.weakness}` : "전투에서 마주치면 정보가 기록됩니다."}</span>
          <small>${discovered ? entry.description : "???"}</small>
        </div>
      `;
    }).join("");
    const achievementCards = ACHIEVEMENTS.map((achievement) => {
      const stored = this.progressSnapshot.achievements[achievement.id];
      const progress = getAchievementProgress(this.progressSnapshot, achievement);
      const completed = Boolean(stored?.completed || progress.completed);
      return `
        <div class="achievement-card ${completed ? "is-complete" : ""}">
          <i>${achievement.category}</i>
          <strong>${achievement.title}</strong>
          <span>${achievement.description}</span>
          <small>${completed ? "달성 완료" : progress.label}${achievement.rewardDescription ? ` · ${achievement.rewardDescription}` : ""}</small>
          <div class="achievement-progress"><b style="width:${progress.percent}%"></b></div>
        </div>
      `;
    }).join("");
    const dailyEffectRows = describeDailyModifiers(this.progressSnapshot.daily.modifiers)
      .map((effect) => `<li>${effect}</li>`)
      .join("");
    const cameraSettingsMarkup = renderCameraFxSettingsPanel(this.cameraFxSettings);
    const accessibilitySettingsMarkup = renderAccessibilitySettingsPanel(this.accessibilitySettings, "hub");
    const difficultySettingsMarkup = renderDifficultySettingsPanel(this.progressSnapshot.selectedDifficulty, "hub");
    const poseAssistSettingsMarkup = renderPoseAssistSettingsPanel(this.progressSnapshot.selectedPoseAssistLevel, state.mode, "hub");
    const runHistoryEntries = this.options.runHistory.getEntries();
    const runHistoryStats = this.options.runHistory.getStats();
    const runHistoryCards = renderRunHistoryCards(runHistoryEntries, this.runHistoryExpanded);

    this.hubOverlay.innerHTML = `
      <div class="hub-panel">
        <div class="hub-header">
          <div>
            <p>LOOP CITY HUB</p>
            <h2>루프시티 거점</h2>
          </div>
          <button class="hub-close" type="button">닫기</button>
        </div>
        <div class="hub-grid">
          <section class="hub-section hub-hero">
            <strong>${getCharacter(state.characterId).name} Lv.${characterProgress.level}</strong>
            <span>${getCharacter(state.characterId).title}</span>
            <div class="hub-xp"><i style="width:${Math.min(100, characterProgress.xp % 100)}%"></i></div>
            <small>퍼펙트 캐스트 ${characterProgress.perfectCasts}회 · 장착 코어 ${equippedCore.title}</small>
          </section>
          <section class="hub-section daily-section">
            <strong>오늘의 데일리 챌린지</strong>
            <span>${this.progressSnapshot.daily.title}</span>
            <small>${this.progressSnapshot.daily.description}</small>
            <ul class="daily-effect-list">${dailyEffectRows}</ul>
          </section>
          <section class="hub-section hub-facilities">
            <strong>시설</strong>
            <span>모션 연구소 · 캐릭터 라운지 · 코어 공방 · 훈련장 · 노이즈 도감 · 스타일 룸</span>
            <div class="hub-action-row">
              <button class="hub-tutorial" type="button">튜토리얼</button>
              <button class="hub-training" type="button">훈련장</button>
              <button class="hub-adventure" type="button">모험 시작</button>
            </div>
            <small>${this.progressSnapshot.tutorialCompleted ? "튜토리얼 완료 · 언제든 다시 연습 가능" : "처음이면 튜토리얼부터 추천"}</small>
          </section>
          <section class="hub-section difficulty-settings-section">
            <strong>난이도 / 포즈 보정</strong>
            <span>전투 난이도와 포즈 판정을 조절해요. 튜토리얼/훈련장은 관대하게 적용됩니다.</span>
            ${difficultySettingsMarkup}
            ${poseAssistSettingsMarkup}
          </section>
          <section class="hub-section camera-settings-section">
            <strong>카메라 / AR</strong>
            <span>원본 영상과 AR 이펙트를 조절해요. 원본을 숨겨도 인식은 계속됩니다.</span>
            ${cameraSettingsMarkup}
            ${this.renderCalibrationLauncher()}
          </section>
          <section class="hub-section accessibility-settings-section">
            <strong>접근성 / 안전</strong>
            <span>흔들림, 번쩍임, 글자 크기, 색상 보조, 1/2/3 입력을 조절해요.</span>
            ${accessibilitySettingsMarkup}
          </section>
          <section class="hub-section hub-wide run-history-section">
            <div class="run-history-header">
              <div>
                <strong>최근 플레이 기록</strong>
                <span>최근 30개 런을 저장합니다. 평균 지표와 피드백 흐름을 확인해요.</span>
              </div>
              <div class="run-history-actions">
                <button class="run-history-toggle" type="button" ${runHistoryEntries.length <= 5 ? "disabled" : ""}>${
                  this.runHistoryExpanded ? "최근 5개만" : "전체 기록 보기"
                }</button>
                <button class="run-history-clear" type="button" ${runHistoryEntries.length === 0 ? "disabled" : ""}>기록 초기화</button>
              </div>
            </div>
            <div class="run-history-metrics">
              <div><span>기록 수</span><strong>${runHistoryStats.totalRuns}</strong></div>
              <div><span>평균 클리어율</span><strong>${runHistoryStats.totalRuns > 0 ? `${Math.round(runHistoryStats.clearRate * 100)}%` : "--"}</strong></div>
              <div><span>평균 미스 비율</span><strong>${runHistoryStats.totalRuns > 0 ? `${Math.round(runHistoryStats.averageMissRate * 100)}%` : "--"}</strong></div>
              <div><span>평균 점수</span><strong>${runHistoryStats.totalRuns > 0 ? Math.round(runHistoryStats.averageScore).toLocaleString() : "--"}</strong></div>
              <div><span>보스 포즈 성공률</span><strong>${runHistoryStats.totalRuns > 0 ? `${Math.round(runHistoryStats.averageBossPoseSuccessRate * 100)}%` : "--"}</strong></div>
              <div><span>평균 FPS</span><strong>${runHistoryStats.averageFps > 0 ? Math.round(runHistoryStats.averageFps).toString() : "--"}</strong></div>
            </div>
            <div class="run-history-list">${runHistoryCards}</div>
          </section>
          <section class="hub-section hub-wide adventure-map-section">
            <strong>모험 지도</strong>
            <span>클리어한 단계는 기록되고, 다음 단계가 차례로 열립니다. 카드를 누르면 그 단계부터 바로 시작합니다.</span>
            <div class="adventure-map-grid">${adventureCards}</div>
          </section>
          <section class="hub-section hub-wide">
            <strong>스타일 룸</strong>
            <span>${getCharacter(state.characterId).name} 외형과 스킬 이펙트 팔레트를 고릅니다.</span>
            <div class="style-subtitle">캐릭터 스킨</div>
            <div class="style-grid">${skinCards}</div>
            <div class="style-subtitle">이펙트 스킨</div>
            <div class="effect-grid">${effectCards}</div>
          </section>
          <section class="hub-section hub-wide">
            <strong>캐릭터 라운지</strong>
            <span>${questLine.title} · ${questLine.description}</span>
            <div class="character-quest-header">
              <b>${questProgress.completed ? "퀘스트라인 완료" : "장기 목표 진행 중"}</b>
              <small>${questProgress.completed ? questLine.cosmeticRewardText : "완료 보상은 추후 전용 컷인/이펙트와 연결됩니다."}</small>
            </div>
            <div class="character-quest-grid">${questCards}</div>
            <div class="style-subtitle">캐릭터 에피소드</div>
            <div class="story-list">${storyCards}</div>
          </section>
          <section class="hub-section hub-wide">
            <strong>업적</strong>
            <span>장기 목표를 달성하면 결과 화면에 기록되고, 일부 업적은 스킨과 이펙트 해금 조건이 됩니다.</span>
            <div class="achievement-grid">${achievementCards}</div>
          </section>
          <section class="hub-section hub-wide">
            <strong>노이즈 도감</strong>
            <span>모험 중 마주친 적의 역할과 대응법을 기록합니다.</span>
            <div class="codex-grid">${codexCards}</div>
          </section>
          <section class="hub-section hub-wide">
            <strong>캐릭터 성장</strong>
            <div class="hub-card-grid">${characterCards}</div>
          </section>
          <section class="hub-section hub-wide">
            <strong>스킬 숙련도</strong>
            <div class="hub-skill-list">${skillRows}</div>
          </section>
          <section class="hub-section hub-wide">
            <strong>코어 공방</strong>
            <div class="core-grid">${coreButtons}</div>
          </section>
        </div>
      </div>
    `;

    this.hubOverlay.querySelector<HTMLButtonElement>(".hub-close")?.addEventListener("click", () => this.toggleHub(false));
    this.hubOverlay.querySelector<HTMLButtonElement>(".hub-tutorial")?.addEventListener("click", () => {
      this.options.onModeSelected("tutorial");
      this.toggleHub(false);
    });
    this.hubOverlay.querySelector<HTMLButtonElement>(".hub-training")?.addEventListener("click", () => {
      this.options.onModeSelected("training");
      this.toggleHub(false);
    });
    this.hubOverlay.querySelector<HTMLButtonElement>(".hub-adventure")?.addEventListener("click", () => {
      this.options.onModeSelected("adventure");
      this.toggleHub(false);
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>("[data-hub-difficulty]").forEach((button) => {
      button.addEventListener("click", () => {
        const difficulty = button.dataset.hubDifficulty as Difficulty | undefined;
        if (!difficulty) {
          return;
        }
        this.options.onDifficultySelected(difficulty);
        this.hubRenderKey = "";
        this.titleRenderKey = "";
        this.showToast(`난이도: ${getDifficultyDefinition(difficulty).title}`);
      });
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>("[data-hub-pose-assist]").forEach((button) => {
      button.addEventListener("click", () => {
        const level = button.dataset.hubPoseAssist as PoseAssistLevel | undefined;
        if (!level) {
          return;
        }
        this.options.onPoseAssistSelected(level);
        this.hubRenderKey = "";
        this.titleRenderKey = "";
        this.showToast(`포즈 보정: ${getPoseAssistDefinition(level).title}`);
      });
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>("[data-hub-camera-size]").forEach((button) => {
      button.addEventListener("click", () => {
        const size = button.dataset.hubCameraSize as CameraPreviewSize | undefined;
        if (size && cameraPreviewSizes.includes(size)) {
          this.setCameraFxSettings({ cameraSize: size });
          this.hubRenderKey = "";
          this.renderHub();
        }
      });
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>("[data-hub-camera-intensity]").forEach((button) => {
      button.addEventListener("click", () => {
        const intensity = button.dataset.hubCameraIntensity as CameraFxIntensity | undefined;
        if (intensity && cameraFxIntensities.includes(intensity)) {
          this.setCameraFxSettings({ arFxIntensity: intensity });
          this.hubRenderKey = "";
          this.renderHub();
        }
      });
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>("[data-hub-camera-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.hubCameraToggle as CameraToggleKey | undefined;
        if (!key || typeof this.cameraFxSettings[key] !== "boolean") {
          return;
        }
        this.setCameraFxSettings({ [key]: !this.cameraFxSettings[key] } as Partial<CameraFxSettings>);
        this.hubRenderKey = "";
        this.renderHub();
      });
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>("[data-hub-a11y-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.hubA11yChoice as AccessibilityChoiceKey | undefined;
        const value = button.dataset.value;
        this.setAccessibilityChoice(key, value);
      });
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>("[data-hub-a11y-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.hubA11yToggle as AccessibilityToggleKey | undefined;
        this.toggleAccessibilitySetting(key);
      });
    });
    this.hubOverlay.querySelector<HTMLButtonElement>("[data-open-calibration]")?.addEventListener("click", () => {
      this.toggleCameraCalibration(true);
    });
    this.hubOverlay.querySelector<HTMLButtonElement>(".run-history-toggle")?.addEventListener("click", () => {
      this.runHistoryExpanded = !this.runHistoryExpanded;
      this.hubRenderKey = "";
      this.renderHub();
    });
    this.hubOverlay.querySelector<HTMLButtonElement>(".run-history-clear")?.addEventListener("click", () => {
      this.options.onRunHistoryCleared();
      this.runHistoryExpanded = false;
      this.hubRenderKey = "";
      this.showToast("최근 기록 초기화");
      this.renderHub();
      this.devPanelRenderAt = 0;
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>(".adventure-stage-card").forEach((button) => {
      button.addEventListener("click", () => {
        const stageId = button.dataset.stageId;
        if (stageId) {
          this.options.onAdventureStageSelected(stageId);
          this.toggleHub(false);
        }
      });
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>(".hub-character-card").forEach((button) => {
      button.addEventListener("click", () => {
        const characterId = button.dataset.characterId as CharacterId | undefined;
        if (!characterId) {
          return;
        }
        this.options.onCharacterSelected(characterId);
        button.classList.add("is-picked");
        this.showToast(`${getCharacter(characterId).name} 선택`);
        this.options.onHubToggled(true);
        this.hubRenderKey = "";
        this.renderHub();
      });
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>(".core-card").forEach((button) => {
      button.addEventListener("click", () => {
        const coreId = button.dataset.coreId as CoreId | undefined;
        if (coreId) {
          if (!this.progressSnapshot.unlockedCoreIds.includes(coreId)) {
            const unlock = getUnlockProgress(this.progressSnapshot, "core", coreId);
            this.showToast(`잠김: ${unlock?.condition ?? "해금 조건 미달성"}${unlock ? ` (${unlock.label})` : ""}`);
            return;
          }
          this.options.onCoreSelected(coreId);
          this.options.onHubToggled(true);
          this.hubRenderKey = "";
          this.renderHub();
        }
      });
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>(".skin-card").forEach((button) => {
      button.addEventListener("click", () => {
        const skinId = button.dataset.skinId as CharacterSkinId | undefined;
        if (skinId) {
          this.options.onSkinSelected(state.characterId, skinId);
          this.options.onHubToggled(true);
          this.hubRenderKey = "";
          this.renderHub();
        }
      });
    });
    this.hubOverlay.querySelectorAll<HTMLButtonElement>(".effect-card").forEach((button) => {
      button.addEventListener("click", () => {
        const effectId = button.dataset.effectId as EffectPaletteId | undefined;
        if (effectId) {
          this.options.onEffectPaletteSelected(effectId);
          this.options.onHubToggled(true);
          this.hubRenderKey = "";
          this.renderHub();
        }
      });
    });
  }

  private renderRewards(state: GameState): void {
    if (state.pendingRewardIds.length === 0) {
      if (this.rewardKey !== "empty") {
        this.rewardsOverlay.innerHTML = "";
        this.rewardsOverlay.classList.remove("is-visible");
        this.rewardKey = "empty";
      }
      return;
    }

    const key = [
      state.pendingRewardIds.join("|"),
      state.rewardOfferHistoryIds.join("|"),
      state.rewardRerollsRemaining,
      Math.floor(state.player.score),
      Math.floor(state.player.gauge),
      state.runStats.rewardsChosen.join("|"),
      state.pendingRewardIds.map((rewardId) => `${rewardId}:${state.rewardStacks[rewardId] ?? 0}`).join("|")
    ].join("::");
    if (key === this.rewardKey) {
      this.rewardsOverlay.classList.toggle("is-visible", state.pendingRewardIds.length > 0);
      return;
    }

    this.rewardKey = key;
    this.rewardsOverlay.innerHTML = "";
    const panel = div("reward-panel");
    const header = div("reward-header");
    const title = document.createElement("h2");
    title.textContent = state.mode === "adventure" ? `${state.adventureStageCode} 스테이지 클리어` : "모션 코어 보상";
    const isFreeReroll = state.rewardRerollsRemaining >= 2;
    const canPayReroll = state.player.score >= 500 || state.player.gauge >= 20;
    const canReroll = state.rewardRerollsRemaining > 0 && (isFreeReroll || canPayReroll);
    const rerollButton = document.createElement("button");
    rerollButton.type = "button";
    rerollButton.className = "reward-reroll";
    rerollButton.disabled = !canReroll;
    rerollButton.innerHTML = `
      <strong>리롤</strong>
      <span>${state.rewardRerollsRemaining}회 남음 · ${isFreeReroll ? "무료" : "500점 또는 게이지 20"}</span>
    `;
    rerollButton.addEventListener("click", () => {
      const response = this.options.onRewardReroll();
      this.showToast(response.line);
      this.rewardKey = "";
      if (this.latestState) {
        this.renderRewards(this.latestState);
      }
    });
    header.append(title, rerollButton);
    panel.appendChild(header);

    const cards = div("reward-cards");
    for (const rewardId of state.pendingRewardIds) {
      const reward = REWARDS.find((item) => item.id === rewardId);
      if (!reward) {
        continue;
      }
      const stack = state.rewardStacks[reward.id] ?? 0;
      const buildReady = getBuildReadyTitles(state, reward.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `reward-card rarity-${reward.rarity}`;
      button.innerHTML = `
        <div class="reward-card-top">
          <i class="reward-rarity">${rarityLabels[reward.rarity]}</i>
          <em>${stack}/${reward.maxStacks}</em>
        </div>
        <strong>${reward.title}</strong>
        <span>${reward.description}</span>
        <div class="reward-tag-list">${renderRewardTagChips(state, reward.id)}</div>
        ${
          buildReady.length > 0
            ? `<div class="build-ready"><i>빌드 준비</i><span>${buildReady.join(" / ")}</span></div>`
            : ""
        }
        <small>${reward.characterId ? `${getCharacter(reward.characterId).name} 전용` : "공용"} · 현재 스택 ${stack}/${reward.maxStacks}</small>
      `;
      button.addEventListener("click", () => this.options.onRewardSelected(reward.id));
      cards.appendChild(button);
    }
    panel.appendChild(cards);
    this.rewardsOverlay.appendChild(panel);
    this.rewardsOverlay.classList.add("is-visible");
  }

  private renderModal(state: GameState): void {
    if (this.hubVisible) {
      this.modalOverlay.classList.remove("is-visible");
      this.modalKey = "";
      return;
    }

    const stats = state.runStats;
    const key = [
      state.paused,
      state.gameOver,
      state.victory,
      state.mode,
      state.difficulty,
      state.characterId,
      Math.floor(state.modeTime),
      state.player.score,
      stats.kills,
      stats.perfectCasts,
      stats.greatCasts,
      stats.normalCasts,
      stats.misses,
      stats.maxPerfectCombo,
      stats.damageTaken,
      stats.skillsUsed,
      stats.bossPosePerfectCounters,
      state.debugStats.bossChallengeSuccesses,
      state.debugStats.bossChallengeFailures,
      stats.xpGained,
      stats.dailyChallengeTitle,
      stats.dailyChallengeCleared,
      stats.unlockedItems.map((item) => item.id).join(","),
      stats.unlockedAchievements.map((achievement) => achievement.id).join(","),
      stats.characterQuestUnlocks.map((unlock) => unlock.objectiveId).join(","),
      state.activeSynergies.map((synergy) => synergy.id).join(","),
      stats.rewardsChosen.join(",")
    ].join(":");
    if (key === this.modalKey) {
      return;
    }
    this.modalKey = key;

    if (state.victory || state.gameOver) {
      this.modalPanel.className = "modal-panel result-panel";
      const character = getCharacter(state.characterId);
      const nextStage = state.mode === "adventure" ? ADVENTURE_STAGES[state.adventureStageIndex + 1] : undefined;
      const rewardItems =
        stats.rewardsChosen.length > 0
          ? stats.rewardsChosen
              .map((rewardId) => REWARDS.find((reward) => reward.id === rewardId))
              .filter((reward): reward is NonNullable<typeof reward> => Boolean(reward))
              .map((reward) => `<li class="rarity-${reward.rarity}"><i>${rarityLabels[reward.rarity]}</i><span>${reward.title}</span></li>`)
              .join("")
          : `<li class="empty-result-reward"><span>선택한 보상 없음</span></li>`;
      const levelText =
        stats.levelAfter > stats.levelBefore
          ? `LV ${stats.levelBefore} → ${stats.levelAfter}`
          : `LV ${stats.levelAfter}`;
      const unlockItems =
        stats.unlockedItems.length > 0
          ? stats.unlockedItems
              .map(
                (item) => `
                  <li>
                    <i>${unlockTypeLabel(item.type)}</i>
                    <div>
                      <strong>${item.title}</strong>
                      <span>${item.description}</span>
                    </div>
                  </li>
                `
              )
              .join("")
          : `<li class="empty-unlock"><div><strong>새 해금 없음</strong><span>다음 판에서 조건을 노려보세요.</span></div></li>`;
      const achievementItems =
        stats.unlockedAchievements.length > 0
          ? stats.unlockedAchievements
              .map(
                (achievement) => `
                  <li>
                    <i>ACHV</i>
                    <div>
                      <strong>${achievement.title}</strong>
                      <span>${achievement.rewardDescription ? `${achievement.description} · ${achievement.rewardDescription}` : achievement.description}</span>
                    </div>
                  </li>
                `
              )
              .join("")
          : `<li class="empty-unlock"><div><strong>새 업적 없음</strong><span>허브의 업적 목록에서 다음 목표를 확인하세요.</span></div></li>`;
      const questUnlockItems =
        stats.characterQuestUnlocks.length > 0
          ? stats.characterQuestUnlocks
              .map(
                (unlock) => `
                  <li>
                    <i>${unlock.completedLine ? "QUEST+" : "QUEST"}</i>
                    <div>
                      <strong>${unlock.objectiveTitle}</strong>
                      <span>${unlock.questTitle} · ${unlock.rewardText}</span>
                    </div>
                  </li>
                `
              )
              .join("")
          : `<li class="empty-unlock"><div><strong>퀘스트 보상 없음</strong><span>허브의 캐릭터 라운지에서 장기 목표를 확인하세요.</span></div></li>`;
      const synergyItems =
        state.activeSynergies.length > 0
          ? state.activeSynergies
              .map(
                (synergy) => `
                  <li>
                    <i class="tier-${synergy.tier}">${synergyTierLabels[synergy.tier]}</i>
                    <div>
                      <strong>${synergy.title}</strong>
                      <span>${synergy.activeEffect}</span>
                    </div>
                  </li>
                `
              )
              .join("")
          : `<li class="empty-unlock"><div><strong>완성한 빌드 없음</strong><span>태그가 같은 보상 카드를 모으면 빌드가 완성됩니다.</span></div></li>`;
      const dailyResultLabel = stats.dailyChallengeCleared ? "클리어" : state.victory || state.gameOver ? "미완료" : "진행 중";
      const bossPoseAttempts = state.debugStats.bossChallengeSuccesses + state.debugStats.bossChallengeFailures;
      const bossPoseText =
        bossPoseAttempts > 0
          ? `${state.debugStats.bossChallengeSuccesses}/${bossPoseAttempts} · 퍼펙트 ${stats.bossPosePerfectCounters}`
          : "시도 없음";
      const averageFps = this.getAverageFps();
      const endReason = state.victory ? "victory" : state.player.hp <= 0 ? "player-defeated" : "run-ended";
      const resultKicker = state.mode === "quick-demo" ? (state.victory ? "데모 완료" : "데모 실패") : state.victory ? "런 클리어" : "런 실패";
      const resultTitle = state.mode === "quick-demo" ? (state.victory ? "데모 완료" : "데모 실패") : state.victory ? "포즈 브레이크 결과" : "노이즈에 압도됨";

      this.modalPanel.innerHTML = `
        <div class="result-header">
          <p>${resultKicker}</p>
          <h1>${resultTitle}</h1>
          <span>${character.name} · ${modeLabel(state.mode)} · ${state.stageName}</span>
        </div>
        <div class="result-summary-grid">
          ${resultStat("생존 시간", formatDuration(state.modeTime || state.time))}
          ${resultStat("난이도", difficultyLabel(state.difficulty))}
          ${resultStat("포즈 보정", poseAssistLabel(state.poseAssistLevel, state.mode))}
          ${resultStat("점수", state.player.score.toLocaleString())}
          ${resultStat("처치 수", stats.kills.toLocaleString())}
          ${resultStat("획득 XP", `+${stats.xpGained.toLocaleString()}`)}
          ${resultStat("레벨", levelText)}
          ${resultStat("받은 피해", stats.damageTaken.toLocaleString())}
          ${resultStat("데일리", `${dailyResultLabel} · ${stats.dailyChallengeTitle}`)}
          ${resultStat("보스 포즈", bossPoseText)}
          ${resultStat("카메라", poseStatusLabel(this.latestPoseFrame.status))}
          ${resultStat("평균 FPS", averageFps > 0 ? averageFps.toString() : "--")}
          ${resultStat("종료 이유", endReasonLabel(endReason))}
        </div>
        <div class="result-body-grid">
          <section class="result-section">
            <strong>포즈 캐스트 판정</strong>
            <div class="cast-grade-grid">
              ${resultGrade("Perfect", stats.perfectCasts)}
              ${resultGrade("Great", stats.greatCasts)}
              ${resultGrade("Normal", stats.normalCasts)}
              ${resultGrade("Miss", stats.misses)}
            </div>
            <div class="result-combo-line">
              <span>최고 퍼펙트 콤보</span>
              <b>x${stats.maxPerfectCombo}</b>
            </div>
            <div class="result-combo-line">
              <span>스킬 사용</span>
              <b>${stats.skillsUsed}</b>
            </div>
          </section>
          <section class="result-section">
            <strong>선택한 보상</strong>
            <ul class="result-reward-list">${rewardItems}</ul>
          </section>
          <section class="result-section result-synergy-section">
            <strong>완성한 빌드</strong>
            <ul class="result-unlock-list result-synergy-list">${synergyItems}</ul>
          </section>
          <section class="result-section result-achievement-section">
            <strong>업적</strong>
            <ul class="result-unlock-list result-achievement-list">${achievementItems}</ul>
          </section>
          <section class="result-section result-quest-section">
            <strong>캐릭터 퀘스트</strong>
            <ul class="result-unlock-list result-quest-list">${questUnlockItems}</ul>
          </section>
          <section class="result-section result-unlock-section">
            <strong>새 해금</strong>
            <ul class="result-unlock-list">${unlockItems}</ul>
          </section>
        </div>
        <div class="result-actions">
          <button class="result-button primary result-retry" type="button">다시 도전</button>
          <button class="result-button result-copy-summary" type="button">피드백용 요약 복사</button>
          <button class="result-button result-hub" type="button">허브 열기</button>
          <button class="result-button result-training" type="button">훈련장</button>
          <button class="result-button result-next-adventure" type="button" ${nextStage ? "" : "disabled"}>
            ${nextStage ? `다음 모험 스테이지` : "다음 모험 스테이지 없음"}
          </button>
        </div>
      `;

      this.modalOverlay.classList.add("is-visible");
      this.modalPanel.querySelector<HTMLButtonElement>(".result-retry")?.addEventListener("click", () => this.options.onRestart());
      this.modalPanel.querySelector<HTMLButtonElement>(".result-copy-summary")?.addEventListener("click", () => {
        void this.copyRunFeedbackSummary(state);
      });
      this.modalPanel.querySelector<HTMLButtonElement>(".result-hub")?.addEventListener("click", () => this.toggleHub(true));
      this.modalPanel.querySelector<HTMLButtonElement>(".result-training")?.addEventListener("click", () => this.options.onModeSelected("training"));
      this.modalPanel.querySelector<HTMLButtonElement>(".result-next-adventure")?.addEventListener("click", () => {
        if (nextStage) {
          this.options.onAdventureStageSelected(nextStage.id);
        }
      });
    } else if (state.paused) {
      this.modalPanel.className = "modal-panel";
      this.modalPanel.innerHTML = `
        <h1 class="modal-title">Paused</h1>
        <p class="modal-text">숨을 고르고 다시 움직일 시간입니다.</p>
      `;
      this.modalOverlay.classList.add("is-visible");
    } else {
      this.modalOverlay.classList.remove("is-visible");
    }
  }

  private async copyRunFeedbackSummary(state: GameState): Promise<void> {
    const text = createRunFeedbackSummary(state, this.latestPoseFrame.status, this.getAverageFps());
    const copied = await copyTextToClipboard(text);
    this.showToast(copied ? "피드백용 요약 복사 완료" : "복사 실패: 브라우저 권한을 확인하세요");
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to the textarea path below.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

function createRunFeedbackSummary(state: GameState, cameraStatus: PoseStatus, averageFps: number): string {
  const stats = state.runStats;
  const character = getCharacter(state.characterId);
  const bossAttempts = state.debugStats.bossChallengeSuccesses + state.debugStats.bossChallengeFailures;
  const endReason = state.victory ? "victory" : state.player.hp <= 0 ? "player-defeated" : "run-ended";
  const rewards = stats.rewardsChosen
    .map((rewardId) => REWARDS.find((reward) => reward.id === rewardId)?.title ?? rewardId)
    .join(", ");
  const synergies = state.activeSynergies
    .map((synergy) => `${synergy.title}(${synergyTierLabels[synergy.tier]})`)
    .join(", ");

  return [
    "[무브캐스터즈 플레이 피드백 요약]",
    `결과: ${state.victory ? "클리어" : "실패"} / ${endReasonLabel(endReason)}`,
    `캐릭터: ${character.name} (${state.characterId})`,
    `모드: ${modeLabel(state.mode)} / 난이도: ${difficultyLabel(state.difficulty)} / 포즈 보정: ${poseAssistLabel(state.poseAssistLevel, state.mode)} / 스테이지: ${state.stageName}`,
    `시간: ${formatDuration(state.modeTime || state.time)} / 점수: ${Math.round(state.player.score).toLocaleString()} / 처치: ${stats.kills}`,
    `포즈 캐스트: 퍼펙트 ${stats.perfectCasts}, 그레이트 ${stats.greatCasts}, 노멀 ${stats.normalCasts}, 미스 ${stats.misses}, 최고 콤보 x${stats.maxPerfectCombo}`,
    `보스 포즈: ${state.debugStats.bossChallengeSuccesses}/${bossAttempts} 성공, 퍼펙트 카운터 ${stats.bossPosePerfectCounters}`,
    `받은 피해: ${stats.damageTaken} / 사용 스킬: ${stats.skillsUsed}`,
    `보상: ${rewards || "없음"}`,
    `시너지: ${synergies || "없음"}`,
    `카메라: ${poseStatusLabel(cameraStatus)} / 평균 FPS: ${averageFps > 0 ? averageFps : "--"}`,
    `데일리: ${stats.dailyChallengeTitle} (${stats.dailyChallengeCleared ? "클리어" : "미완료"})`
  ].join("\n");
}

function div(className: string): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  return element;
}

function getBuildReadyTitles(state: GameState, rewardId: string): string[] {
  const currentIds = new Set(state.activeSynergies.map((synergy) => synergy.id));
  return calculateActiveSynergies(state.characterId, [...state.runStats.rewardsChosen, rewardId])
    .filter((synergy) => !currentIds.has(synergy.id))
    .map((synergy) => `${synergyTierLabels[synergy.tier]} · ${synergy.title}`);
}

function renderRewardTagChips(state: GameState, rewardId: string): string {
  const reward = REWARDS.find((item) => item.id === rewardId);
  if (!reward) {
    return "";
  }

  const currentCounts = countRewardTags(state.runStats.rewardsChosen);
  const nextCounts = countRewardTags([...state.runStats.rewardsChosen, rewardId]);
  const currentIds = new Set(state.activeSynergies.map((synergy) => synergy.id));
  const nextSynergies = calculateActiveSynergies(state.characterId, [...state.runStats.rewardsChosen, rewardId]);
  return reward.tags
    .map((tag) => {
      const synergy = findNearestTagSynergy(state.characterId, tag, currentCounts);
      const requiredTags = synergy ? getSynergyRequiredTags(synergy) : {};
      const required = requiredTags[tag];
      const nextCount = nextCounts[tag] ?? 0;
      const progress = synergy && required ? `${Math.min(nextCount, required)}/${required}` : `+${nextCount}`;
      const ready = synergy && nextSynergies.some((item) => item.id === synergy.id) && !currentIds.has(synergy.id);
      const tier = synergy ? ` tier-${synergy.tier}` : "";
      return `<i class="${ready ? "is-ready" : ""}${tier}">${tagLabel(tag)} ${progress}</i>`;
    })
    .join("");
}

function findNearestTagSynergy(characterId: CharacterId, tag: RewardTag, counts: Partial<Record<RewardTag, number>>) {
  return SYNERGIES.filter((item) => item.characterId === null || item.characterId === characterId)
    .filter((item) => getSynergyRequiredTags(item)[tag] !== undefined)
    .sort((a, b) => {
      const aRequired = getSynergyRequiredTags(a)[tag] ?? 99;
      const bRequired = getSynergyRequiredTags(b)[tag] ?? 99;
      const aRemaining = Math.max(0, aRequired - (counts[tag] ?? 0));
      const bRemaining = Math.max(0, bRequired - (counts[tag] ?? 0));
      return aRemaining - bRemaining || aRequired - bRequired;
    })[0];
}

function highestSynergyTierLabel(state: GameState): string {
  const rank: Record<string, number> = { basic: 1, advanced: 2, signature: 3, mythic: 4 };
  const top = [...state.activeSynergies].sort((a, b) => rank[b.tier] - rank[a.tier])[0];
  return top ? synergyTierLabels[top.tier] : "빌드";
}

function tagLabel(tag: string): string {
  const labels: Record<string, string> = {
    attack: "공격",
    skill: "스킬",
    cooldown: "쿨감",
    gauge: "게이지",
    survival: "생존",
    dash: "대시",
    perfect: "퍼펙트",
    basic: "기본",
    area: "광역",
    boss: "보스",
    shield: "실드",
    summon: "소환",
    mark: "표식",
    trap: "함정",
    ultimate: "궁극"
  };
  return labels[tag] ?? tag;
}

function resultStat(label: string, value: string): string {
  return `
    <div class="result-stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function resultGrade(label: CastGrade, value: number): string {
  return `
    <div class="result-grade grade-${label.toLowerCase()}">
      <span>${gradeLabels[label]}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function devStat(label: string, value: string): string {
  return `
    <div class="dev-stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderDevUpgradeRows(state: GameState): string {
  const upgrades = state.upgrades;
  const rows: Array<[string, number]> = [
    ["피해", upgrades.globalDamageMultiplier * upgrades.skillDamageMultiplier],
    ["쿨타임", upgrades.cooldownMultiplier],
    ["게이지", upgrades.gaugeGainMultiplier],
    ["범위", upgrades.areaMultiplier],
    ["기본 공격", upgrades.basicDamageMultiplier],
    ["대시 스킬", upgrades.dashSkillDamageMultiplier],
    ["궁극기", upgrades.overdriveDamageMultiplier],
    ["실드", upgrades.guardShieldMultiplier],
    ["표식", upgrades.markedDamageMultiplier],
    ["슬라임", upgrades.slimeDamageMultiplier]
  ];

  return rows
    .map(
      ([label, value]) => `
        <span>
          <i>${label}</i>
          <b>x${value.toFixed(2)}</b>
        </span>
      `
    )
    .join("");
}

function renderRunHistoryCards(entries: RunHistory[], expanded = false): string {
  if (entries.length === 0) {
    return `
      <div class="run-history-empty">
        <strong>아직 저장된 런이 없습니다</strong>
        <span>전투, 모험, 생존, 보스 러시를 끝내면 여기에 최근 기록이 쌓입니다.</span>
      </div>
    `;
  }

  return entries
    .slice(0, expanded ? 30 : 5)
    .map((entry) => {
      const character = getCharacter(entry.characterId);
      const castTotal = entry.perfectCasts + entry.greatCasts + entry.normalCasts + entry.misses;
      const missRate = castTotal > 0 ? Math.round((entry.misses / castTotal) * 100) : 0;
      const bossRate = entry.bossPoseAttempts > 0 ? Math.round((entry.bossPoseSuccesses / entry.bossPoseAttempts) * 100) : 0;
      const rewards = entry.rewardsChosen
        .slice(-3)
        .map((rewardId) => REWARDS.find((reward) => reward.id === rewardId)?.title ?? rewardId)
        .join(" / ");
      const synergies =
        entry.activeSynergies.length > 0
          ? entry.activeSynergies.map((synergy) => `${synergy.title}(${synergyTierLabels[synergy.tier]})`).join(" + ")
          : "시너지 없음";
      return `
        <article class="run-history-card ${entry.victory ? "is-victory" : "is-defeat"}" style="--character-color:${character.uiColor}">
          <div class="run-history-card-head">
            <i>${entry.victory ? "클리어" : "실패"}</i>
            <span>${formatHistoryDate(entry.date)}</span>
          </div>
          <strong>${character.name} · ${modeLabel(entry.mode)} · ${difficultyLabel(entry.difficulty)} · ${poseAssistLabel(entry.poseAssistLevel, entry.mode)}</strong>
          <div class="run-history-score">
            <b>${entry.score.toLocaleString()}</b>
            <span>${formatDuration(entry.seconds)} · ${entry.kills} 처치</span>
          </div>
          <div class="run-history-casts">
            <span>퍼펙트 ${entry.perfectCasts}</span>
            <span>그레이트 ${entry.greatCasts}</span>
            <span>노멀 ${entry.normalCasts}</span>
            <span>미스 ${entry.misses} (${missRate}%)</span>
            <span>콤보 x${entry.maxPerfectCombo}</span>
          </div>
          <small>${synergies}</small>
          <em>${rewards || "선택 보상 없음"} · 피해 ${entry.damageTaken} · 보스 ${entry.bossPoseSuccesses}/${entry.bossPoseAttempts} (${bossRate}%) · 퍼펙트 ${entry.bossPosePerfectCounters}</em>
          <em>카메라 ${poseStatusLabel(entry.cameraStatusSummary)} · FPS ${entry.averageFps || "--"} · ${endReasonLabel(entry.endReason)}</em>
        </article>
      `;
    })
    .join("");
}

function formatHistoryDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return "--";
  }
  return `${String(parsed.getMonth() + 1).padStart(2, "0")}/${String(parsed.getDate()).padStart(2, "0")} ${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

function renderUnlockProgress(progress: UnlockProgress | null): string {
  if (!progress) {
    return `
      <div class="unlock-progress">
        <span>조건 정보 없음</span>
        <i><b style="width:0%"></b></i>
      </div>
    `;
  }

  return `
    <div class="unlock-progress">
      <span>${progress.label}</span>
      <i><b style="width:${progress.percent}%"></b></i>
    </div>
  `;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutesText = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const secondsText = (total % 60).toString().padStart(2, "0");
  return `${minutesText}:${secondsText}`;
}

function modeLabel(mode: GameMode): string {
  const labels: Record<GameMode, string> = {
    title: "타이틀",
    "quick-demo": "3분 데모",
    tutorial: "튜토리얼",
    story: "전투",
    adventure: "모험",
    survival: "생존",
    "boss-rush": "보스 러시",
    training: "훈련장"
  };
  return labels[mode];
}

function difficultyLabel(difficulty: Difficulty): string {
  return getDifficultyDefinition(difficulty).title;
}

function poseAssistLabel(level: PoseAssistLevel, mode: GameMode): string {
  const effective = getEffectivePoseAssistLevel(level, mode);
  const label = getPoseAssistDefinition(effective).title;
  return effective === level ? label : `${label} (모드 보정)`;
}

function poseStatusLabel(status: PoseStatus | string): string {
  const labels: Record<string, string> = {
    idle: "대기",
    loading: "로딩",
    ready: "카메라 준비",
    unstable: "손/상반신 확인",
    "permission-needed": "권한 필요",
    unavailable: "카메라 없음",
    error: "오류"
  };
  return labels[status] ?? status;
}

function endReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    victory: "클리어",
    "player-defeated": "체력 0",
    "run-ended": "런 종료",
    ended: "런 종료"
  };
  return labels[reason] ?? reason;
}

function unlockTypeLabel(type: "core" | "skin" | "effect"): string {
  const labels: Record<"core" | "skin" | "effect", string> = {
    core: "코어",
    skin: "스킨",
    effect: "이펙트"
  };
  return labels[type];
}

function gestureLabel(gesture: BossChallengeState["requiredGesture"]): string {
  const labels: Record<BossChallengeState["requiredGesture"], string> = {
    slash: "슬래시",
    thrust: "팜 스러스트",
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
  return labels[gesture];
}

function createCalibrationTests(): Record<CalibrationGestureId, CalibrationTestState> {
  return calibrationGestures.reduce(
    (acc, gesture) => {
      acc[gesture.id] = {
        completed: false,
        grade: null,
        score: 0,
        reason: "",
        via: null
      };
      return acc;
    },
    {} as Record<CalibrationGestureId, CalibrationTestState>
  );
}

function getCalibrationChecks(frame: PoseOverlayFrame): CameraCalibrationCheck[] {
  const landmarks = frame.landmarks;
  const statusReady = frame.status === "ready" || frame.status === "unstable";
  const face = landmarks?.[0] ?? null;
  const leftShoulder = landmarks?.[11] ?? null;
  const rightShoulder = landmarks?.[12] ?? null;
  const leftHand = landmarks?.[15] ?? null;
  const rightHand = landmarks?.[16] ?? null;
  const faceOk = statusReady && isLandmarkVisible(face);
  const leftHandOk = statusReady && isLandmarkVisible(leftHand);
  const rightHandOk = statusReady && isLandmarkVisible(rightHand);
  const shouldersOk = statusReady && isLandmarkVisible(leftShoulder) && isLandmarkVisible(rightShoulder);
  const bodyCenterX = shouldersOk && face ? (face.x + leftShoulder!.x + rightShoulder!.x) / 3 : null;
  const bodyCenterY = shouldersOk && face ? (face.y + leftShoulder!.y + rightShoulder!.y) / 3 : null;
  const centered = Boolean(bodyCenterX !== null && bodyCenterY !== null && bodyCenterX > 0.34 && bodyCenterX < 0.66 && bodyCenterY > 0.22 && bodyCenterY < 0.72);
  const handsOut = Boolean(
    statusReady &&
      ((leftHand && isLandmarkVisible(leftHand, 0.2) && !isLandmarkInSafeFrame(leftHand)) ||
        (rightHand && isLandmarkVisible(rightHand, 0.2) && !isLandmarkInSafeFrame(rightHand)))
  );

  return [
    {
      id: "face",
      label: "얼굴",
      ok: faceOk,
      detail: faceOk ? "감지됨" : "얼굴을 화면 안에 맞춰요."
    },
    {
      id: "left-hand",
      label: "왼손",
      ok: leftHandOk,
      detail: leftHandOk ? "감지됨" : "왼손을 화면 안에 넣어요."
    },
    {
      id: "right-hand",
      label: "오른손",
      ok: rightHandOk,
      detail: rightHandOk ? "감지됨" : "오른손을 화면 안에 넣어요."
    },
    {
      id: "shoulders",
      label: "양어깨",
      ok: shouldersOk,
      detail: shouldersOk ? "감지됨" : "상반신과 양어깨를 맞춰요."
    },
    {
      id: "center",
      label: "중앙 위치",
      ok: centered,
      detail: centered ? "좋은 위치" : statusReady ? "몸을 화면 중앙으로 옮겨요." : "카메라 연결 후 확인",
      warning: statusReady && !centered
    },
    {
      id: "hands-frame",
      label: "손 화면 안",
      ok: statusReady && !handsOut,
      detail: !statusReady ? "카메라 연결 후 확인" : handsOut ? "손이 화면 밖으로 나갔어요." : "안전 범위 안",
      warning: handsOut
    }
  ];
}

function isLandmarkVisible(landmark: PoseLandmark | null, minVisibility = 0.45): boolean {
  if (!landmark) {
    return false;
  }
  const visibility = typeof landmark.visibility === "number" ? landmark.visibility : 1;
  return visibility >= minVisibility && landmark.x > -0.08 && landmark.x < 1.08 && landmark.y > -0.08 && landmark.y < 1.08;
}

function isLandmarkInSafeFrame(landmark: PoseLandmark): boolean {
  return landmark.x >= 0.035 && landmark.x <= 0.965 && landmark.y >= 0.035 && landmark.y <= 0.965;
}

function keyboardCalibrationBreakdown(grade: Exclude<CastGrade, "Miss">): GestureScoreBreakdown {
  const score = grade === "Perfect" ? 96 : grade === "Great" ? 82 : 58;
  return {
    positionScore: score,
    motionScore: score,
    speedScore: score,
    stabilityScore: 100,
    sizeScore: score,
    tip: "카메라가 없거나 조명이 어두우면 1/2/3으로 같은 흐름을 테스트해요."
  };
}

function renderCalibrationBreakdownRows(breakdown: GestureScoreBreakdown): string {
  return [
    ["자세", breakdown.positionScore],
    ["동작", breakdown.motionScore],
    ["속도", breakdown.speedScore],
    ["안정", breakdown.stabilityScore],
    ["크기", breakdown.sizeScore]
  ]
    .map(
      ([label, score]) => `
        <div class="training-breakdown-row">
          <span>${label}</span>
          <i><b style="width:${Math.round(Number(score))}%"></b></i>
          <strong>${Math.round(Number(score))}</strong>
        </div>
      `
    )
    .join("");
}

function readBooleanStorage(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) {
      return fallback;
    }
    return value === "true";
  } catch {
    return fallback;
  }
}

function writeBooleanStorage(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Dev panel visibility is optional; ignore storage failures.
  }
}

function readCameraFxSettingsStorage(key: string, fallback: CameraFxSettings): CameraFxSettings {
  try {
    const raw = window.localStorage.getItem(key);
    const migratedCameraSize = readLegacyCameraSizeStorage(CAMERA_SIZE_STORAGE_KEY, fallback.cameraSize);
    if (!raw) {
      return {
        ...fallback,
        cameraSize: migratedCameraSize
      };
    }
    const parsedRaw = JSON.parse(raw) as unknown;
    const parsed = isRecord(parsedRaw) ? (parsedRaw as Partial<CameraFxSettings>) : {};
    return {
      cameraSize: isCameraPreviewSize(parsed.cameraSize) ? parsed.cameraSize : migratedCameraSize,
      arFxEnabled: typeof parsed.arFxEnabled === "boolean" ? parsed.arFxEnabled : fallback.arFxEnabled,
      arFxIntensity: isCameraFxIntensity(parsed.arFxIntensity) ? parsed.arFxIntensity : fallback.arFxIntensity,
      showSkeleton: typeof parsed.showSkeleton === "boolean" ? parsed.showSkeleton : fallback.showSkeleton,
      showHandGlow: typeof parsed.showHandGlow === "boolean" ? parsed.showHandGlow : fallback.showHandGlow,
      showOriginalVideo: typeof parsed.showOriginalVideo === "boolean" ? parsed.showOriginalVideo : fallback.showOriginalVideo
    };
  } catch {
    return { ...fallback };
  }
}

function writeCameraFxSettingsStorage(key: string, value: CameraFxSettings): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.localStorage.setItem(CAMERA_SIZE_STORAGE_KEY, value.cameraSize);
  } catch {
    // Camera AR settings are optional; ignore storage failures.
  }
}

function readLegacyCameraSizeStorage(key: string, fallback: CameraPreviewSize): CameraPreviewSize {
  try {
    const value = window.localStorage.getItem(key);
    return isCameraPreviewSize(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function isCameraPreviewSize(value: unknown): value is CameraPreviewSize {
  return value === "small" || value === "medium" || value === "large";
}

function isCameraFxIntensity(value: unknown): value is CameraFxIntensity {
  return value === "low" || value === "medium" || value === "high";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cameraFxSettingsToast(changed: Partial<CameraFxSettings>, settings: CameraFxSettings): string {
  if (changed.cameraSize) {
    return `카메라 크기: ${cameraSizeLabel(settings.cameraSize)}`;
  }
  if (changed.arFxIntensity) {
    return `AR 강도: ${cameraIntensityLabel(settings.arFxIntensity)}`;
  }
  if (changed.arFxEnabled !== undefined) {
    return settings.arFxEnabled ? "AR 이펙트 ON" : "AR 이펙트 OFF";
  }
  if (changed.showSkeleton !== undefined) {
    return settings.showSkeleton ? "스켈레톤 표시 ON" : "스켈레톤 표시 OFF";
  }
  if (changed.showHandGlow !== undefined) {
    return settings.showHandGlow ? "손 glow ON" : "손 glow OFF";
  }
  if (changed.showOriginalVideo !== undefined) {
    return settings.showOriginalVideo ? "카메라 원본 표시" : "카메라 원본 숨김";
  }
  return "카메라 AR 설정 저장";
}

function accessibilitySettingsToast(changed: Partial<AccessibilitySettings>, settings: AccessibilitySettings): string {
  if (changed.screenShake) {
    return `화면 흔들림: ${screenShakeLabel(settings.screenShake)}`;
  }
  if (changed.flashes) {
    return `번쩍임: ${flashLabel(settings.flashes)}`;
  }
  if (changed.cameraArIntensity) {
    return `접근성 AR 강도: ${cameraIntensityLabel(settings.cameraArIntensity)}`;
  }
  if (changed.textScale) {
    return `글자 크기: ${textScaleLabel(settings.textScale)}`;
  }
  if (changed.cameraOriginalVisible !== undefined) {
    return settings.cameraOriginalVisible ? "카메라 원본 표시" : "카메라 원본 숨김";
  }
  if (changed.highContrastUi !== undefined) {
    return settings.highContrastUi ? "고대비 UI ON" : "고대비 UI OFF";
  }
  if (changed.colorBlindAssist !== undefined) {
    return settings.colorBlindAssist ? "색상 보조 ON" : "색상 보조 OFF";
  }
  if (changed.keyboardFallbackEnabled !== undefined) {
    return settings.keyboardFallbackEnabled ? "키보드 대체 입력 ON" : "키보드 대체 입력 OFF";
  }
  if (changed.reducedMotion !== undefined) {
    return settings.reducedMotion ? "모션 줄이기 ON" : "모션 줄이기 OFF";
  }
  if (changed.performanceMode) {
    return `성능 모드: ${performanceQualityLabel(settings.performanceMode)}`;
  }
  return "접근성 설정 저장";
}

function screenShakeLabel(mode: ScreenShakeMode): string {
  const labels: Record<ScreenShakeMode, string> = {
    on: "켜기",
    reduced: "줄임",
    off: "끄기"
  };
  return labels[mode];
}

function flashLabel(mode: FlashMode): string {
  const labels: Record<FlashMode, string> = {
    on: "켜기",
    reduced: "줄임",
    off: "끄기"
  };
  return labels[mode];
}

function textScaleLabel(mode: TextScaleMode): string {
  const labels: Record<TextScaleMode, string> = {
    normal: "기본",
    large: "크게"
  };
  return labels[mode];
}

function performanceQualityLabel(mode: PerformanceQuality): string {
  const labels: Record<PerformanceQuality, string> = {
    high: "고품질",
    balanced: "균형",
    performance: "성능"
  };
  return labels[mode];
}

function cameraSizeLabel(size: CameraPreviewSize): string {
  const labels: Record<CameraPreviewSize, string> = {
    small: "작게",
    medium: "보통",
    large: "크게"
  };
  return labels[size];
}

function cameraIntensityLabel(intensity: CameraFxIntensity): string {
  const labels: Record<CameraFxIntensity, string> = {
    low: "낮음",
    medium: "보통",
    high: "높음"
  };
  return labels[intensity];
}

function renderDifficultySettingsPanel(selected: Difficulty, scope: "hub" | "title"): string {
  const attr = scope === "hub" ? "data-hub-difficulty" : "data-title-difficulty";
  const cards = DIFFICULTIES.map((difficulty) => {
    const active = difficulty.id === selected;
    return `
      <button type="button" ${attr}="${difficulty.id}" class="difficulty-card ${active ? "is-active" : ""}" aria-pressed="${active ? "true" : "false"}">
        <i>${difficulty.shortLabel}</i>
        <strong>${difficulty.title}</strong>
        <span>${difficulty.description}</span>
        <small>${difficulty.effects.join(" · ")}</small>
      </button>
    `;
  }).join("");
  return `
    <div class="difficulty-settings">
      <div class="difficulty-settings-head">
        <span>현재 난이도</span>
        <strong>${difficultyLabel(selected)}</strong>
      </div>
      <div class="difficulty-card-grid">${cards}</div>
    </div>
  `;
}

function renderPoseAssistSettingsPanel(selected: PoseAssistLevel, mode: GameMode, scope: "hub" | "title"): string {
  const attr = scope === "hub" ? "data-hub-pose-assist" : "data-title-pose-assist";
  const effective = getEffectivePoseAssistLevel(selected, mode);
  const cards = POSE_ASSIST_LEVELS.map((level) => {
    const active = level.id === selected;
    return `
      <button type="button" ${attr}="${level.id}" class="difficulty-card pose-assist-card ${active ? "is-active" : ""}" aria-pressed="${active ? "true" : "false"}">
        <i>${level.shortLabel}</i>
        <strong>${level.title}</strong>
        <span>${level.description}</span>
        <small>${level.effects.join(" · ")}</small>
      </button>
    `;
  }).join("");
  return `
    <div class="difficulty-settings pose-assist-settings">
      <div class="difficulty-settings-head">
        <span>포즈 보정</span>
        <strong>${poseAssistLabel(selected, mode)}</strong>
      </div>
      ${
        effective !== selected
          ? `<p class="settings-inline-note">현재 모드는 연습용 관대 판정으로 동작해요.</p>`
          : ""
      }
      <div class="difficulty-card-grid">${cards}</div>
    </div>
  `;
}

function renderAccessibilitySettingsPanel(settings: AccessibilitySettings, scope: "hub" | "title" = "hub"): string {
  const choiceAttr = scope === "hub" ? "data-hub-a11y-choice" : "data-title-a11y-choice";
  const toggleAttr = scope === "hub" ? "data-hub-a11y-toggle" : "data-title-a11y-toggle";
  const modeButtons = <T extends string>(key: AccessibilityChoiceKey, values: T[], selected: T, labeler: (value: T) => string) =>
    values
      .map(
        (value) => `
          <button type="button" ${choiceAttr}="${key}" data-value="${value}" class="${
            selected === value ? "is-active" : ""
          }" aria-pressed="${selected === value ? "true" : "false"}">${labeler(value)}</button>
        `
      )
      .join("");
  const toggles: Array<{ key: AccessibilityToggleKey; label: string; detail: string }> = [
    { key: "cameraOriginalVisible", label: "카메라 원본", detail: "꺼도 인식은 계속 작동" },
    { key: "highContrastUi", label: "고대비 UI", detail: "패널과 글자 대비 강화" },
    { key: "colorBlindAssist", label: "색상 보조", detail: "희귀도/판정 라벨 보강" },
    { key: "keyboardFallbackEnabled", label: "1/2/3 대체 입력", detail: "일반 플레이 디버그 판정" },
    { key: "reducedMotion", label: "모션 줄이기", detail: "UI 애니메이션과 줌 완화" }
  ];
  const toggleButtons = toggles
    .map(
      (toggle) => `
        <button type="button" ${toggleAttr}="${toggle.key}" class="${settings[toggle.key] ? "is-active" : ""}" aria-pressed="${
          settings[toggle.key] ? "true" : "false"
        }">
          <strong>${toggle.label}</strong>
          <small>${toggle.detail}</small>
        </button>
      `
    )
    .join("");
  return `
    <div class="accessibility-settings">
      <p class="settings-inline-note">번쩍임과 흔들림을 줄여도 조작은 그대로입니다. 훈련장/튜토리얼은 1/2/3을 항상 안내해요.</p>
      <div class="accessibility-row">
        <span>화면 흔들림</span>
        <div>${modeButtons<ScreenShakeMode>("screenShake", screenShakeModes, settings.screenShake, screenShakeLabel)}</div>
      </div>
      <div class="accessibility-row">
        <span>번쩍임 / 컷인</span>
        <div>${modeButtons<FlashMode>("flashes", flashModes, settings.flashes, flashLabel)}</div>
      </div>
      <div class="accessibility-row">
        <span>카메라 AR 강도</span>
        <div>${modeButtons<CameraFxIntensity>("cameraArIntensity", cameraFxIntensities, settings.cameraArIntensity, cameraIntensityLabel)}</div>
      </div>
      <div class="accessibility-row">
        <span>글자 크기</span>
        <div>${modeButtons<TextScaleMode>("textScale", textScaleModes, settings.textScale, textScaleLabel)}</div>
      </div>
      <div class="accessibility-row">
        <span>성능 모드</span>
        <div>${modeButtons<PerformanceQuality>("performanceMode", performanceQualityModes, settings.performanceMode, performanceQualityLabel)}</div>
      </div>
      <div class="accessibility-toggle-grid">${toggleButtons}</div>
    </div>
  `;
}

function renderCameraFxSettingsPanel(settings: CameraFxSettings, scope: "hub" | "title" = "hub"): string {
  const sizeAttr = scope === "hub" ? "data-hub-camera-size" : "data-title-camera-size";
  const intensityAttr = scope === "hub" ? "data-hub-camera-intensity" : "data-title-camera-intensity";
  const toggleAttr = scope === "hub" ? "data-hub-camera-toggle" : "data-title-camera-toggle";
  const sizeButtons = cameraPreviewSizes
    .map(
      (size) => `
        <button type="button" ${sizeAttr}="${size}" class="${settings.cameraSize === size ? "is-active" : ""}" aria-pressed="${
          settings.cameraSize === size ? "true" : "false"
        }">${cameraSizeLabel(size)}</button>
      `
    )
    .join("");
  const intensityButtons = cameraFxIntensities
    .map(
      (intensity) => `
        <button type="button" ${intensityAttr}="${intensity}" class="${settings.arFxIntensity === intensity ? "is-active" : ""}" aria-pressed="${
          settings.arFxIntensity === intensity ? "true" : "false"
        }">${cameraIntensityLabel(intensity)}</button>
      `
    )
    .join("");
  const toggles: Array<{ key: CameraToggleKey; label: string; detail: string }> = [
    { key: "arFxEnabled", label: "AR 이펙트", detail: "가이드와 성공 이펙트" },
    { key: "showSkeleton", label: "스켈레톤", detail: "어깨/팔 관절선" },
    { key: "showHandGlow", label: "손 glow", detail: "손목 추적 점" },
    { key: "showOriginalVideo", label: "원본 영상", detail: "프라이버시 표시" }
  ];
  const toggleButtons = toggles
    .map(
      (toggle) => `
        <button type="button" ${toggleAttr}="${toggle.key}" class="${settings[toggle.key] ? "is-active" : ""}" aria-pressed="${
          settings[toggle.key] ? "true" : "false"
        }">
          <strong>${toggle.label}</strong>
          <small>${toggle.detail}</small>
        </button>
      `
    )
    .join("");
  return `
    <div class="hub-camera-settings">
      <div class="hub-camera-row">
        <span>프리뷰 크기</span>
        <div>${sizeButtons}</div>
      </div>
      <div class="hub-camera-row">
        <span>AR 강도</span>
        <div>${intensityButtons}</div>
      </div>
      <div class="hub-camera-toggle-grid">${toggleButtons}</div>
    </div>
  `;
}
