import "./styles.css";
import { isSoundEnabled, toggleSoundEnabled } from "./game/audio/audioSettings";
import { ProgressionStore } from "./game/progression/progression";
import { RunHistoryStore } from "./game/progression/runHistory";
import { GameSimulation } from "./game/simulation/GameSimulation";
import { PoseService } from "./game/pose/PoseService";
import { PerformanceMonitor } from "./game/performance/PerformanceMonitor";
import { createPhaserGame } from "./phaser/createPhaserGame";
import { CameraFxOverlay } from "./ui/camera/CameraFxOverlay";
import { Hud } from "./ui/hud/Hud";

const progression = new ProgressionStore();
const runHistory = new RunHistoryStore();
const simulation = new GameSimulation(progression, runHistory);
const poseService = new PoseService();
const performanceMonitor = new PerformanceMonitor();

const syncPoseAssistContext = () => {
  const snapshot = progression.getSnapshot();
  const state = simulation.getState();
  poseService.setPoseAssistContext(snapshot.selectedPoseAssistLevel, state.mode);
};

const hud = new Hud({
  onEnableCamera: async () => {
    await poseService.start();
    hud.setCameraStatus(poseService.getStatus());
  },
  onCalibrationGestureTest: (gestureId) => {
    syncPoseAssistContext();
    return poseService.capture(gestureId, 1200);
  },
  onRewardSelected: (rewardId) => simulation.chooseReward(rewardId),
  onRewardReroll: () => simulation.rerollRewards(),
  onRestart: () => {
    simulation.reset();
    syncPoseAssistContext();
  },
  onCharacterSelected: (characterId) => {
    simulation.switchCharacter(characterId);
    syncPoseAssistContext();
  },
  onModeSelected: (mode) => {
    simulation.setMode(mode);
    syncPoseAssistContext();
  },
  onHubToggled: (visible) => simulation.setPaused(visible),
  onCoreSelected: (coreId) => {
    progression.equipCore(coreId);
    simulation.reset();
    syncPoseAssistContext();
    hud.showToast("코어 장착");
  },
  onSkinSelected: (characterId, skinId) => {
    progression.equipSkin(characterId, skinId);
    simulation.reset();
    syncPoseAssistContext();
    hud.showToast("스킨 장착");
  },
  onEffectPaletteSelected: (paletteId) => {
    progression.equipEffectPalette(paletteId);
    simulation.reset();
    syncPoseAssistContext();
    hud.showToast("이펙트 적용");
  },
  onDifficultySelected: (difficulty) => {
    progression.setDifficulty(difficulty);
    simulation.reset();
    syncPoseAssistContext();
    hud.showToast(`난이도: ${difficulty}`);
  },
  onPoseAssistSelected: (level) => {
    progression.setPoseAssistLevel(level);
    simulation.reset();
    syncPoseAssistContext();
    hud.showToast(`포즈 보정: ${level}`);
  },
  onAdventureStageSelected: (stageId) => {
    if (progression.selectAdventureStage(stageId)) {
      simulation.setMode("adventure");
      syncPoseAssistContext();
      hud.showToast(`AREA ${stageId}`);
    } else {
      hud.showToast("아직 잠긴 단계입니다.");
    }
  },
  onDevFillGauge: () => simulation.debugFillGauge(),
  onDevClearWave: () => simulation.debugClearWave(),
  onDevSpawnBoss: () => simulation.debugSpawnBoss(),
  onDevForceReward: () => simulation.debugForceReward(),
  onRunHistoryCleared: () => runHistory.clear(),
  isSoundEnabled,
  onSoundToggled: () => toggleSoundEnabled().soundEnabled,
  runHistory,
  progression
});

syncPoseAssistContext();
hud.update(simulation.getState());
poseService.setPreviewHost(hud.getCameraPreviewHost());
poseService.onStatusChange((status) => hud.setCameraStatus(status));
simulation.setRunTelemetryProvider(() => ({
  cameraStatusSummary: poseService.getStatus(),
  averageFps: hud.getAverageFps()
}));
const cameraFxOverlay = new CameraFxOverlay(hud.getCameraArCanvas());
hud.setCameraFxOverlay(cameraFxOverlay);
poseService.onFrame((frame) => {
  cameraFxOverlay.handleFrame(frame);
  performanceMonitor.setPoseFps(poseService.getPoseFps());
  performanceMonitor.setCameraFxParticles(cameraFxOverlay.getParticleCount());
  hud.handlePoseFrame(frame);
});

createPhaserGame({
  parent: "game-root",
  simulation,
  poseService,
  performanceMonitor,
  hud
});
