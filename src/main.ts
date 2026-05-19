import "./styles.css";
import { ProgressionStore } from "./game/progression/progression";
import { GameSimulation } from "./game/simulation/GameSimulation";
import { PoseService } from "./game/pose/PoseService";
import { createPhaserGame } from "./phaser/createPhaserGame";
import { Hud } from "./ui/hud/Hud";

const progression = new ProgressionStore();
const simulation = new GameSimulation(progression);
const poseService = new PoseService();

const hud = new Hud({
  onEnableCamera: async () => {
    await poseService.start();
    hud.setCameraStatus(poseService.getStatus());
  },
  onRewardSelected: (rewardId) => simulation.chooseReward(rewardId),
  onRestart: () => simulation.reset(),
  onCharacterSelected: (characterId) => simulation.switchCharacter(characterId),
  onModeSelected: (mode) => simulation.setMode(mode),
  onHubToggled: (visible) => simulation.setPaused(visible),
  onCoreSelected: (coreId) => {
    progression.equipCore(coreId);
    simulation.reset();
    hud.showToast("코어 장착");
  },
  onSkinSelected: (characterId, skinId) => {
    progression.equipSkin(characterId, skinId);
    simulation.reset();
    hud.showToast("스킨 장착");
  },
  onEffectPaletteSelected: (paletteId) => {
    progression.equipEffectPalette(paletteId);
    simulation.reset();
    hud.showToast("이펙트 적용");
  },
  onAdventureStageSelected: (stageId) => {
    if (progression.selectAdventureStage(stageId)) {
      simulation.setMode("adventure");
      hud.showToast(`AREA ${stageId}`);
    } else {
      hud.showToast("아직 잠긴 단계입니다.");
    }
  },
  progression
});

poseService.setPreviewHost(hud.getCameraPreviewHost());
poseService.onStatusChange((status) => hud.setCameraStatus(status));

createPhaserGame({
  parent: "game-root",
  simulation,
  poseService,
  hud
});
