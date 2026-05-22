import Phaser from "phaser";
import type { GameSimulation } from "../game/simulation/GameSimulation";
import type { PoseService } from "../game/pose/PoseService";
import type { PerformanceMonitor } from "../game/performance/PerformanceMonitor";
import type { Hud } from "../ui/hud/Hud";
import { BattleScene } from "./scenes/BattleScene";

interface CreateGameOptions {
  parent: string;
  simulation: GameSimulation;
  poseService: PoseService;
  performanceMonitor: PerformanceMonitor;
  hud: Hud;
}

export function createPhaserGame(options: CreateGameOptions): Phaser.Game {
  const scene = new BattleScene(options.simulation, options.poseService, options.hud, options.performanceMonitor);

  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.parent,
    backgroundColor: "#090b13",
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: 1280,
      height: 720,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    render: {
      antialias: true,
      pixelArt: false
    },
    scene: [scene]
  });
}
