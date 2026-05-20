import Phaser from "phaser";
import { isSoundEnabled, toggleSoundEnabled } from "../../game/audio/audioSettings";
import { getCharacter } from "../../game/content/skills";
import type { SkillSlot } from "../../game/input/actions";
import { getEffectPaletteDefinition } from "../../game/progression/progression";
import { GameSimulation, WORLD_HEIGHT, WORLD_WIDTH } from "../../game/simulation/GameSimulation";
import type {
  CastGrade,
  CharacterId,
  CharacterSkinId,
  EnemyState,
  EffectPaletteId,
  FxEvent,
  GameState,
  SimulationInput,
  SoundId,
  StageHazardState
} from "../../game/simulation/types";
import type { PoseService } from "../../game/pose/PoseService";
import type { Hud } from "../../ui/hud/Hud";

interface KeyMap {
  w: Phaser.Input.Keyboard.Key;
  a: Phaser.Input.Keyboard.Key;
  s: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key;
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  space: Phaser.Input.Keyboard.Key;
  q: Phaser.Input.Keyboard.Key;
  e: Phaser.Input.Keyboard.Key;
  r: Phaser.Input.Keyboard.Key;
  f: Phaser.Input.Keyboard.Key;
  c: Phaser.Input.Keyboard.Key;
  t: Phaser.Input.Keyboard.Key;
  esc: Phaser.Input.Keyboard.Key;
  one: Phaser.Input.Keyboard.Key;
  two: Phaser.Input.Keyboard.Key;
  three: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
}

interface ViewFx {
  event: FxEvent;
  age: number;
  ttl: number;
}

interface FloatingTextFx {
  object: Phaser.GameObjects.Text;
  age: number;
  ttl: number;
  startY: number;
  drift: number;
}

type ProceduralLoopMode = "none" | "survival" | "boss";

interface SoundTone {
  frequency: number;
  delay: number;
  duration: number;
  volume: number;
  type?: OscillatorType;
  detune?: number;
}

interface NoiseBurst {
  delay: number;
  duration: number;
  volume: number;
  filterFrequency: number;
}

interface SoundConfig {
  type: OscillatorType;
  tones: SoundTone[];
  noise?: NoiseBurst[];
  cooldown?: number;
}

interface ChibiColors {
  jacket: number;
  trim: number;
  pants: number;
  hair: number;
  skin: number;
  shoe: number;
  accent: number;
}

export class BattleScene extends Phaser.Scene {
  private worldGraphics!: Phaser.GameObjects.Graphics;
  private fxGraphics!: Phaser.GameObjects.Graphics;
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private keys!: KeyMap;
  private viewFx: ViewFx[] = [];
  private floatingTexts: FloatingTextFx[] = [];
  private cinematicObjects: Phaser.GameObjects.GameObject[] = [];
  private zoomTween: Phaser.Tweens.Tween | null = null;
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private soundCooldowns = new Map<string, number>();
  private loopMode: ProceduralLoopMode = "none";
  private loopTimer = 0;
  private loopStep = 0;
  private bossChallengeCaptureKey = "";
  private backgroundKey = "";

  constructor(
    private readonly simulation: GameSimulation,
    private readonly poseService: PoseService,
    private readonly hud: Hud
  ) {
    super("battle");
  }

  create(): void {
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.gridGraphics = this.add.graphics();
    this.worldGraphics = this.add.graphics();
    this.fxGraphics = this.add.graphics();
    this.ensureStageBackground(this.simulation.getState());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clearFloatingTexts();
      this.clearCinematicObjects();
    });

    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error("Keyboard input is unavailable.");
    }

    this.keys = {
      w: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      space: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      q: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      e: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      r: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      f: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F),
      c: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C),
      t: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.T),
      esc: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
      one: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      two: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      three: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      enter: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER)
    };

    keyboard.on("keydown", this.handleKeyDown, this);
    this.hud.setCameraStatus(this.poseService.getStatus());
  }

  update(_time: number, deltaMs: number): void {
    this.handleHotkeys();
    const input = this.readInput();
    this.simulation.update(deltaMs / 1000, input);

    const state = this.simulation.getState();
    this.ensureStageBackground(state);
    this.handleBossChallengeCapture(state);
    this.updateProceduralLoop(state, deltaMs / 1000);
    this.cameras.main.centerOn(state.player.x, state.player.y);
    this.collectFx();
    this.drawWorld(deltaMs / 1000);
    this.hud.update(state);
  }

  private handleHotkeys(): void {
    // Single-press keys are handled from the keyboard event itself. Keeping
    // this method separate leaves the update loop focused on continuous input.
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.repeat) {
      return;
    }
    void this.resumeAudio();

    const key = event.key.toLowerCase();
    if (key === "escape") {
      this.simulation.togglePaused();
      return;
    }
    if (key === "enter") {
      const state = this.simulation.getState();
      if (state.gameOver || state.victory) {
        this.simulation.reset();
      }
      return;
    }
    if (key === "c") {
      this.simulation.switchCharacter();
      this.hud.showToast("캐릭터 변경");
      return;
    }
    if (key === "t") {
      const nextMode = this.simulation.getState().mode === "training" ? "story" : "training";
      this.simulation.setMode(nextMode);
      this.hud.showToast(nextMode === "training" ? "훈련장 입장" : "전투 복귀");
      return;
    }
    if (key === "h") {
      this.hud.toggleHub();
      return;
    }
    if (key === "o") {
      const settings = toggleSoundEnabled();
      this.hud.showToast(settings.soundEnabled ? "사운드 ON" : "사운드 OFF");
      return;
    }
    if (key === "tab") {
      event.preventDefault();
      this.hud.toggleRewardLog();
      return;
    }
    if (key === "m") {
      this.simulation.setMode("adventure");
      this.hud.showToast("모험 모드");
      return;
    }
    if (key === "v") {
      this.simulation.setMode("survival");
      this.hud.showToast("생존 모드");
      return;
    }
    if (key === "b") {
      this.simulation.setMode("boss-rush");
      this.hud.showToast("보스 러시");
      return;
    }
    if (key === "q") {
      this.prepareSkill("Q");
      return;
    }
    if (key === "e") {
      this.prepareSkill("E");
      return;
    }
    if (key === "r") {
      this.prepareSkill("R");
      return;
    }
    if (key === "f") {
      this.prepareSkill("F");
      return;
    }
    if (key === "1") {
      this.debugCast("Normal");
      return;
    }
    if (key === "2") {
      this.debugCast("Great");
      return;
    }
    if (key === "3") {
      this.debugCast("Perfect");
    }
  }

  private readInput(): SimulationInput {
    const left = this.keys.a.isDown || this.keys.left.isDown;
    const right = this.keys.d.isDown || this.keys.right.isDown;
    const up = this.keys.w.isDown || this.keys.up.isDown;
    const down = this.keys.s.isDown || this.keys.down.isDown;

    return {
      move: this.simulation.moveInputFromBooleans(left, right, up, down),
      dashPressed: Phaser.Input.Keyboard.JustDown(this.keys.space)
    };
  }

  private prepareSkill(slot: SkillSlot): void {
    const response = this.simulation.prepareSkill(slot);
    if (!response.ok) {
      this.hud.showToast(response.line);
      return;
    }

    const skill = this.simulation.getCurrentSkills()[slot];
    this.hud.showCastPrompt(skill);

    if (!this.poseService.isReady()) {
      return;
    }

    void this.poseService.capture(skill.gestureId).then((result) => {
      const cast = this.simulation.castPreparedSkill(result);
      if (cast.ok) {
        this.hud.showCastResult(result.grade, cast.line);
      }
    });
  }

  private debugCast(grade: Exclude<CastGrade, "Miss">): void {
    const hadBossChallenge = Boolean(this.simulation.getState().bossChallenge);
    const response = this.simulation.castDebugGrade(grade);
    if (response.ok) {
      if (hadBossChallenge) {
        this.hud.showBossChallengeResult(grade, response.line);
      } else {
        this.hud.showCastResult(grade, response.line);
      }
    }
  }

  private handleBossChallengeCapture(state: GameState): void {
    const challenge = state.bossChallenge;
    if (!challenge) {
      this.bossChallengeCaptureKey = "";
      return;
    }

    const captureKey = `${challenge.bossType}:${challenge.currentIndex}:${challenge.requiredGesture}:${challenge.expiresAt}`;
    if (this.bossChallengeCaptureKey === captureKey) {
      return;
    }

    this.bossChallengeCaptureKey = captureKey;
    this.hud.showBossChallengeCapture(challenge);
    if (!this.poseService.isReady()) {
      return;
    }

    const durationMs = Math.max(260, (challenge.expiresAt - state.time) * 1000);
    void this.poseService.capture(challenge.requiredGesture, durationMs).then((result) => {
      const cast = this.simulation.castBossChallenge(result);
      if (cast.ok) {
        this.hud.showBossChallengeResult(result.grade, cast.line);
      }
    });
  }

  private collectFx(): void {
    for (const event of this.simulation.drainFxEvents()) {
      if (event.kind === "shake") {
        this.cameras.main.shake(event.duration, event.intensity);
        continue;
      }
      if (event.kind === "sound") {
        this.playSound(event.sound, event.grade);
        continue;
      }
      if (event.kind === "float-text") {
        this.spawnFloatingText(event);
        continue;
      }
      if (event.kind === "screen-flash") {
        this.spawnScreenFlash(event);
        continue;
      }
      if (event.kind === "cut-in") {
        this.spawnCutIn(event);
        continue;
      }
      if (event.kind === "zoom-pulse") {
        this.triggerZoomPulse(event);
        continue;
      }
      const ttl = event.kind === "bolt" ? 0.2 : 0.34;
      this.viewFx.push({ event, age: 0, ttl });
    }
  }

  private spawnScreenFlash(event: Extract<FxEvent, { kind: "screen-flash" }>): void {
    const flash = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, event.color, event.alpha)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(2100);
    this.trackCinematicObject(flash);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: event.duration,
      ease: "Quad.easeOut",
      onComplete: () => this.destroyCinematicObject(flash)
    });
  }

  private spawnCutIn(event: Extract<FxEvent, { kind: "cut-in" }>): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const bandWidth = Math.min(width - 40, 760);
    const container = this.add.container(width / 2 + 48, height * 0.46).setScrollFactor(0).setDepth(2200).setAlpha(0);
    const graphics = this.add.graphics();
    graphics.fillStyle(0x061018, 0.88);
    graphics.fillRoundedRect(-bandWidth / 2, -58, bandWidth, 116, 8);
    graphics.fillStyle(event.color, 0.14);
    graphics.fillTriangle(-bandWidth / 2, -58, -bandWidth / 2 + 150, -58, -bandWidth / 2, 58);
    graphics.fillTriangle(bandWidth / 2, 58, bandWidth / 2 - 150, 58, bandWidth / 2, -58);
    graphics.lineStyle(4, event.color, 0.9);
    graphics.lineBetween(-bandWidth / 2 + 18, -45, bandWidth / 2 - 18, -45);
    graphics.lineStyle(2, 0xffffff, 0.24);
    graphics.lineBetween(-bandWidth / 2 + 34, 44, bandWidth / 2 - 34, 44);

    const title = this.add
      .text(0, -8, event.title, {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: event.title.length > 18 ? "28px" : "36px",
        fontStyle: "900",
        color: hexColor(event.color),
        stroke: "#02070d",
        strokeThickness: 7,
        align: "center"
      })
      .setOrigin(0.5, 0.5);
    title.setShadow(0, 0, hexColor(event.color), 14, true, true);

    const subtitle = this.add
      .text(0, 33, event.subtitle ?? "", {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "14px",
        fontStyle: "800",
        color: "#f6fbff",
        align: "center",
        wordWrap: { width: bandWidth - 90 }
      })
      .setOrigin(0.5, 0.5);

    container.add([graphics, title, subtitle]);
    container.setScale(0.96);
    this.trackCinematicObject(container);
    this.tweens.add({
      targets: container,
      alpha: 1,
      x: width / 2,
      scaleX: 1,
      scaleY: 1,
      duration: 90,
      ease: "Cubic.easeOut"
    });
    this.tweens.add({
      targets: container,
      alpha: 0,
      x: width / 2 - 42,
      delay: Math.max(120, event.duration - 170),
      duration: 150,
      ease: "Cubic.easeIn",
      onComplete: () => this.destroyCinematicObject(container)
    });
  }

  private triggerZoomPulse(event: Extract<FxEvent, { kind: "zoom-pulse" }>): void {
    const camera = this.cameras.main;
    this.zoomTween?.stop();
    camera.setZoom(1);
    this.zoomTween = this.tweens.add({
      targets: camera,
      zoom: event.zoom,
      duration: Math.max(45, event.duration * 0.45),
      yoyo: true,
      ease: "Quad.easeOut",
      onComplete: () => {
        camera.setZoom(1);
        this.zoomTween = null;
      }
    });
  }

  private spawnFloatingText(event: Extract<FxEvent, { kind: "float-text" }>): void {
    const important = isLargeFloatingText(event.text);
    const text = this.add.text(event.x, event.y, event.text, {
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: important ? "26px" : "15px",
      fontStyle: "900",
      color: hexColor(event.color),
      stroke: "#061018",
      strokeThickness: important ? 6 : 4,
      align: "center"
    });
    text.setOrigin(0.5, 0.5);
    text.setDepth(60);
    text.setShadow(0, 0, hexColor(event.color), important ? 14 : 8, true, true);
    this.floatingTexts.push({
      object: text,
      age: 0,
      ttl: 0.75,
      startY: event.y,
      drift: important ? 66 : 44
    });
  }

  private ensureStageBackground(state: GameState): void {
    const key = `${state.mode}:${state.stageRegion}:${state.stageName}:${state.adventureStageCode}`;
    if (this.backgroundKey === key) {
      return;
    }
    this.backgroundKey = key;
    this.drawGrid(state);
  }

  private drawGrid(state: GameState): void {
    const region = state.stageRegion;
    this.gridGraphics.clear();

    if (region === "놀이공원") {
      this.drawAmusementParkStage();
      this.drawGridOverlay(0xffd166, 0xff5ea8, 0.2);
      return;
    }
    if (region === "미러 타워") {
      this.drawMirrorTowerStage();
      this.drawGridOverlay(0xc7b8ff, 0x48f7ff, 0.24);
      return;
    }
    if (region === "제로 존") {
      this.drawZeroZoneStage();
      this.drawGridOverlay(0x8c7aff, 0xc7b8ff, 0.17);
      return;
    }

    this.drawLoopCityStage();
    this.drawGridOverlay(0x293645, 0xff5ea8, 0.34);
  }

  private drawStageBase(color: number): void {
    this.gridGraphics.fillStyle(color, 1);
    this.gridGraphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  private drawGridOverlay(lineColor: number, borderColor: number, alpha: number): void {
    this.gridGraphics.lineStyle(1, lineColor, alpha);
    for (let x = 0; x <= WORLD_WIDTH; x += 80) {
      this.gridGraphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += 80) {
      this.gridGraphics.lineBetween(0, y, WORLD_WIDTH, y);
    }

    this.gridGraphics.lineStyle(5, borderColor, 0.24);
    this.gridGraphics.strokeRect(32, 32, WORLD_WIDTH - 64, WORLD_HEIGHT - 64);
  }

  private drawLoopCityStage(): void {
    this.drawStageBase(0x080b13);
    this.drawLoopCityBlocks();
    this.drawStreetLayer();
    this.drawCityProps();
    this.drawLoopCityNeonAccents();
  }

  private drawAmusementParkStage(): void {
    const graphics = this.gridGraphics;
    this.drawStageBase(0x160b22);

    const lightZones = [
      { x: 150, y: 160, w: 520, h: 160, color: 0xff5ea8 },
      { x: 1430, y: 190, w: 510, h: 150, color: 0xffd166 },
      { x: 205, y: 1030, w: 500, h: 150, color: 0x8c7aff },
      { x: 1440, y: 1035, w: 510, h: 150, color: 0xff5ea8 }
    ];
    for (const zone of lightZones) {
      graphics.fillStyle(zone.color, 0.12);
      graphics.fillRoundedRect(zone.x, zone.y, zone.w, zone.h, 28);
      graphics.lineStyle(3, zone.color, 0.26);
      graphics.strokeRoundedRect(zone.x, zone.y, zone.w, zone.h, 28);
    }

    graphics.fillStyle(0x2a1534, 0.96);
    graphics.fillRect(0, WORLD_HEIGHT / 2 - 132, WORLD_WIDTH, 264);
    graphics.fillRect(WORLD_WIDTH / 2 - 128, 0, 256, WORLD_HEIGHT);
    graphics.lineStyle(5, 0xffd166, 0.36);
    graphics.strokeCircle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 282);
    graphics.fillStyle(0xff5ea8, 0.12);
    graphics.fillCircle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 258);
    graphics.lineStyle(4, 0xffd166, 0.52);
    for (let index = 0; index < 16; index += 1) {
      const angle = (Math.PI * 2 * index) / 16;
      graphics.lineBetween(
        WORLD_WIDTH / 2 + Math.cos(angle) * 64,
        WORLD_HEIGHT / 2 + Math.sin(angle) * 64,
        WORLD_WIDTH / 2 + Math.cos(angle) * 250,
        WORLD_HEIGHT / 2 + Math.sin(angle) * 250
      );
    }
    graphics.fillStyle(0xffd166, 0.34);
    graphics.fillCircle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 72);
    graphics.lineStyle(5, 0xffffff, 0.32);
    graphics.strokeCircle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 92);

    for (let index = 0; index < 8; index += 1) {
      const angle = (Math.PI * 2 * index) / 8 + 0.25;
      const x = WORLD_WIDTH / 2 + Math.cos(angle) * 190;
      const y = WORLD_HEIGHT / 2 + Math.sin(angle) * 190;
      graphics.fillStyle(index % 2 === 0 ? 0xffd166 : 0xff5ea8, 0.7);
      graphics.fillEllipse(x, y, 42, 24);
      graphics.lineStyle(3, 0xffffff, 0.22);
      graphics.strokeEllipse(x, y, 42, 24);
    }

    this.drawTicketBooth(210, 500);
    this.drawTicketBooth(1690, 685);
    this.drawBalloonCluster(360, 430, [0xff5ea8, 0xffd166, 0x8c7aff]);
    this.drawBalloonCluster(1840, 420, [0x48f7ff, 0xffd166, 0xff5ea8]);
    this.drawBalloonCluster(430, 970, [0xb8ff5c, 0xff5ea8, 0x8c7aff]);
  }

  private drawMirrorTowerStage(): void {
    const graphics = this.gridGraphics;
    this.drawStageBase(0x08111d);

    for (let y = 0; y < WORLD_HEIGHT; y += 96) {
      for (let x = 0; x < WORLD_WIDTH; x += 96) {
        const alternate = (x / 96 + y / 96) % 2 === 0;
        graphics.fillStyle(alternate ? 0x102235 : 0x0b1828, 0.94);
        graphics.fillRect(x, y, 96, 96);
        graphics.lineStyle(1, alternate ? 0x48f7ff : 0xc7b8ff, alternate ? 0.12 : 0.18);
        graphics.strokeRect(x + 4, y + 4, 88, 88);
      }
    }

    const shardColors = [0xc7b8ff, 0x48f7ff, 0xf6fbff, 0xff5ea8];
    for (let index = 0; index < 30; index += 1) {
      const x = 110 + ((index * 313) % (WORLD_WIDTH - 220));
      const y = 100 + ((index * 181) % (WORLD_HEIGHT - 200));
      const size = 28 + (index % 5) * 10;
      const color = shardColors[index % shardColors.length];
      graphics.fillStyle(color, 0.12 + (index % 3) * 0.04);
      graphics.fillTriangle(x, y - size, x - size * 0.58, y + size * 0.55, x + size * 0.72, y + size * 0.34);
      graphics.lineStyle(2, color, 0.34);
      graphics.strokeTriangle(x, y - size, x - size * 0.58, y + size * 0.55, x + size * 0.72, y + size * 0.34);
    }

    graphics.lineStyle(3, 0xf6fbff, 0.18);
    for (let index = -4; index <= 6; index += 1) {
      graphics.lineBetween(index * 260, WORLD_HEIGHT, index * 260 + 820, 0);
      graphics.lineBetween(index * 260 + 160, 0, index * 260 + 900, WORLD_HEIGHT);
    }

    graphics.fillStyle(0xc7b8ff, 0.08);
    graphics.fillRoundedRect(WORLD_WIDTH / 2 - 210, 112, 420, WORLD_HEIGHT - 224, 26);
    graphics.lineStyle(5, 0x48f7ff, 0.22);
    graphics.strokeRoundedRect(WORLD_WIDTH / 2 - 210, 112, 420, WORLD_HEIGHT - 224, 26);
  }

  private drawZeroZoneStage(): void {
    const graphics = this.gridGraphics;
    this.drawStageBase(0x111018);

    graphics.fillStyle(0x1a1724, 0.92);
    graphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    for (let index = 0; index < 24; index += 1) {
      const y = 80 + ((index * 131) % (WORLD_HEIGHT - 160));
      const color = index % 3 === 0 ? 0xff5ea8 : index % 3 === 1 ? 0x8c7aff : 0x48f7ff;
      graphics.lineStyle(2 + (index % 3), color, 0.14 + (index % 2) * 0.08);
      graphics.lineBetween(80 + (index % 5) * 40, y, WORLD_WIDTH - 100 - (index % 4) * 46, y + ((index % 2) * 2 - 1) * 18);
    }

    for (let index = 0; index < 8; index += 1) {
      const x = 220 + ((index * 271) % (WORLD_WIDTH - 440));
      const y = 210 + ((index * 167) % (WORLD_HEIGHT - 420));
      graphics.lineStyle(2, 0xc7b8ff, 0.18);
      graphics.strokeCircle(x, y, 72 + (index % 4) * 34);
      graphics.lineStyle(2, 0x555064, 0.16);
      graphics.lineBetween(x - 120, y, x + 120, y);
      graphics.lineBetween(x, y - 120, x, y + 120);
    }

    graphics.lineStyle(8, 0x05070d, 0.55);
    graphics.strokeRect(16, 16, WORLD_WIDTH - 32, WORLD_HEIGHT - 32);
    for (let index = 0; index < 42; index += 1) {
      const edge = index % 4;
      const x = edge < 2 ? 24 + ((index * 97) % (WORLD_WIDTH - 48)) : edge === 2 ? 28 : WORLD_WIDTH - 28;
      const y = edge >= 2 ? 24 + ((index * 89) % (WORLD_HEIGHT - 48)) : edge === 0 ? 28 : WORLD_HEIGHT - 28;
      graphics.fillStyle(index % 2 === 0 ? 0x8c7aff : 0xf6fbff, 0.24);
      graphics.fillRect(x, y, edge < 2 ? 48 : 7, edge < 2 ? 7 : 48);
    }
  }

  private drawLoopCityBlocks(): void {
    const graphics = this.gridGraphics;
    const blocks = [
      { x: 92, y: 84, w: 430, h: 240, color: 0x111a28 },
      { x: 650, y: 72, w: 370, h: 250, color: 0x131726 },
      { x: 1260, y: 70, w: 310, h: 220, color: 0x101b22 },
      { x: 1690, y: 95, w: 360, h: 250, color: 0x161527 },
      { x: 116, y: 1030, w: 400, h: 250, color: 0x121827 },
      { x: 650, y: 1040, w: 355, h: 220, color: 0x0f1d21 },
      { x: 1210, y: 1030, w: 380, h: 250, color: 0x17162a },
      { x: 1692, y: 1020, w: 360, h: 260, color: 0x101a28 }
    ];

    for (const block of blocks) {
      graphics.fillStyle(0x05070d, 0.42);
      graphics.fillRoundedRect(block.x + 12, block.y + 14, block.w, block.h, 18);
      graphics.fillStyle(block.color, 0.96);
      graphics.fillRoundedRect(block.x, block.y, block.w, block.h, 18);
      graphics.lineStyle(2, 0x48f7ff, 0.12);
      graphics.strokeRoundedRect(block.x, block.y, block.w, block.h, 18);

      for (let row = 0; row < Math.floor(block.h / 54); row += 1) {
        for (let col = 0; col < Math.floor(block.w / 72); col += 1) {
          const lit = (row + col + block.x) % 3 !== 0;
          const color = lit ? (col % 2 === 0 ? 0x48f7ff : 0xffd166) : 0x263140;
          graphics.fillStyle(color, lit ? 0.34 : 0.24);
          graphics.fillRoundedRect(block.x + 28 + col * 66, block.y + 25 + row * 50, 34, 12, 4);
        }
      }
    }
  }

  private drawStreetLayer(): void {
    const graphics = this.gridGraphics;
    graphics.fillStyle(0x111827, 0.98);
    graphics.fillRect(0, WORLD_HEIGHT / 2 - 155, WORLD_WIDTH, 310);
    graphics.fillRect(WORLD_WIDTH / 2 - 165, 0, 330, WORLD_HEIGHT);
    graphics.fillStyle(0x182335, 0.86);
    graphics.fillRect(0, WORLD_HEIGHT / 2 - 18, WORLD_WIDTH, 36);
    graphics.fillRect(WORLD_WIDTH / 2 - 18, 0, 36, WORLD_HEIGHT);

    graphics.lineStyle(6, 0xffd166, 0.42);
    for (let x = 80; x < WORLD_WIDTH; x += 180) {
      graphics.lineBetween(x, WORLD_HEIGHT / 2, x + 92, WORLD_HEIGHT / 2);
    }
    for (let y = 80; y < WORLD_HEIGHT; y += 180) {
      graphics.lineBetween(WORLD_WIDTH / 2, y, WORLD_WIDTH / 2, y + 92);
    }

    graphics.lineStyle(3, 0xffffff, 0.26);
    for (let i = -3; i <= 3; i += 1) {
      graphics.lineBetween(WORLD_WIDTH / 2 - 220 + i * 52, WORLD_HEIGHT / 2 - 208, WORLD_WIDTH / 2 - 260 + i * 52, WORLD_HEIGHT / 2 - 158);
      graphics.lineBetween(WORLD_WIDTH / 2 + 220 + i * 52, WORLD_HEIGHT / 2 + 208, WORLD_WIDTH / 2 + 260 + i * 52, WORLD_HEIGHT / 2 + 158);
    }
  }

  private drawCityProps(): void {
    const graphics = this.gridGraphics;
    const signs = [
      { x: 240, y: 186, w: 138, h: 30, color: 0x48f7ff },
      { x: 738, y: 230, w: 118, h: 26, color: 0xff5ea8 },
      { x: 1398, y: 154, w: 140, h: 28, color: 0xb8ff5c },
      { x: 1790, y: 260, w: 150, h: 32, color: 0xffd166 },
      { x: 234, y: 1130, w: 132, h: 28, color: 0xff5ea8 },
      { x: 1298, y: 1136, w: 146, h: 28, color: 0x48f7ff },
      { x: 1814, y: 1146, w: 126, h: 26, color: 0xb8ff5c }
    ];

    for (const sign of signs) {
      graphics.fillStyle(sign.color, 0.18);
      graphics.fillRoundedRect(sign.x - 8, sign.y - 8, sign.w + 16, sign.h + 16, 10);
      graphics.fillStyle(sign.color, 0.72);
      graphics.fillRoundedRect(sign.x, sign.y, sign.w, sign.h, 8);
      graphics.lineStyle(2, 0xffffff, 0.42);
      graphics.lineBetween(sign.x + 12, sign.y + sign.h / 2, sign.x + sign.w - 12, sign.y + sign.h / 2);
    }

    graphics.fillStyle(0x0b101a, 0.94);
    graphics.fillRoundedRect(WORLD_WIDTH / 2 + 230, WORLD_HEIGHT / 2 - 320, 220, 92, 18);
    graphics.lineStyle(4, 0x48f7ff, 0.44);
    graphics.strokeRoundedRect(WORLD_WIDTH / 2 + 230, WORLD_HEIGHT / 2 - 320, 220, 92, 18);
    graphics.lineStyle(5, 0xffd166, 0.7);
    graphics.lineBetween(WORLD_WIDTH / 2 + 264, WORLD_HEIGHT / 2 - 270, WORLD_WIDTH / 2 + 410, WORLD_HEIGHT / 2 - 270);

    for (let index = 0; index < 18; index += 1) {
      const x = 120 + ((index * 313) % (WORLD_WIDTH - 240));
      const y = 120 + ((index * 197) % (WORLD_HEIGHT - 240));
      graphics.lineStyle(2, 0x314252, 0.72);
      graphics.strokeCircle(x, y, 18);
      graphics.lineStyle(2, 0x48f7ff, 0.16);
      graphics.lineBetween(x - 12, y, x + 12, y);
    }
  }

  private drawLoopCityNeonAccents(): void {
    const graphics = this.gridGraphics;
    const rails = [
      { x1: 0, y1: WORLD_HEIGHT / 2 - 205, x2: WORLD_WIDTH, y2: WORLD_HEIGHT / 2 - 205, color: 0x48f7ff },
      { x1: 0, y1: WORLD_HEIGHT / 2 + 205, x2: WORLD_WIDTH, y2: WORLD_HEIGHT / 2 + 205, color: 0xff5ea8 },
      { x1: WORLD_WIDTH / 2 - 220, y1: 0, x2: WORLD_WIDTH / 2 - 220, y2: WORLD_HEIGHT, color: 0xffd166 },
      { x1: WORLD_WIDTH / 2 + 220, y1: 0, x2: WORLD_WIDTH / 2 + 220, y2: WORLD_HEIGHT, color: 0x48f7ff }
    ];

    for (const rail of rails) {
      graphics.lineStyle(6, rail.color, 0.12);
      graphics.lineBetween(rail.x1, rail.y1, rail.x2, rail.y2);
      graphics.lineStyle(2, rail.color, 0.42);
      graphics.lineBetween(rail.x1, rail.y1, rail.x2, rail.y2);
    }

    for (let index = 0; index < 22; index += 1) {
      const x = 100 + ((index * 421) % (WORLD_WIDTH - 200));
      const y = index % 2 === 0 ? WORLD_HEIGHT / 2 - 265 : WORLD_HEIGHT / 2 + 265;
      const color = index % 3 === 0 ? 0xff5ea8 : index % 3 === 1 ? 0x48f7ff : 0xffd166;
      graphics.fillStyle(color, 0.18);
      graphics.fillRoundedRect(x - 22, y - 16, 44, 32, 10);
      graphics.lineStyle(2, color, 0.56);
      graphics.strokeRoundedRect(x - 22, y - 16, 44, 32, 10);
    }
  }

  private drawTicketBooth(x: number, y: number): void {
    const graphics = this.gridGraphics;
    graphics.fillStyle(0x090b13, 0.46);
    graphics.fillRoundedRect(x + 12, y + 16, 210, 150, 16);
    graphics.fillStyle(0x3a1632, 0.96);
    graphics.fillRoundedRect(x, y, 210, 150, 16);
    graphics.lineStyle(4, 0xffd166, 0.42);
    graphics.strokeRoundedRect(x, y, 210, 150, 16);
    graphics.fillStyle(0xff5ea8, 0.88);
    graphics.fillTriangle(x - 12, y + 26, x + 105, y - 38, x + 222, y + 26);
    graphics.lineStyle(3, 0xf6fbff, 0.32);
    for (let index = 0; index < 6; index += 1) {
      graphics.lineBetween(x + 22 + index * 32, y + 12, x + 42 + index * 32, y - 12);
    }
    graphics.fillStyle(0x111827, 0.84);
    graphics.fillRoundedRect(x + 42, y + 55, 126, 62, 10);
    graphics.lineStyle(3, 0x48f7ff, 0.34);
    graphics.strokeRoundedRect(x + 42, y + 55, 126, 62, 10);
  }

  private drawBalloonCluster(x: number, y: number, colors: number[]): void {
    const graphics = this.gridGraphics;
    for (let index = 0; index < colors.length; index += 1) {
      const offsetX = (index - 1) * 25;
      const offsetY = index % 2 === 0 ? -16 : 12;
      graphics.lineStyle(2, 0xf6fbff, 0.22);
      graphics.lineBetween(x, y + 58, x + offsetX, y + offsetY + 30);
      graphics.fillStyle(colors[index], 0.72);
      graphics.fillEllipse(x + offsetX, y + offsetY, 34, 46);
      graphics.lineStyle(2, 0xffffff, 0.28);
      graphics.strokeEllipse(x + offsetX, y + offsetY, 34, 46);
    }
    graphics.fillStyle(0xffd166, 0.72);
    graphics.fillCircle(x, y + 60, 6);
  }

  private drawWorld(dt: number): void {
    const state = this.simulation.getState();
    const graphics = this.worldGraphics;
    graphics.clear();

    if (state.stageRegion === "미러 타워") {
      this.drawMirrorAfterimages(graphics, state);
    }
    this.drawStageHazards(graphics, state);

    for (const trap of state.traps) {
      if (trap.kind === "drum-warning") {
        const warning = Math.max(0.08, Math.min(1, trap.ttl / 1.25));
        const pulse = 1 + Math.sin(this.time.now * 0.04 + trap.id) * 0.05;
        graphics.fillStyle(0xff7a2f, 0.11 + (1 - warning) * 0.12);
        graphics.fillCircle(trap.x, trap.y, trap.radius * pulse);
        graphics.lineStyle(7, 0xffd166, 0.28 + (1 - warning) * 0.44);
        graphics.strokeCircle(trap.x, trap.y, trap.radius * pulse);
        graphics.lineStyle(3, 0xf6fbff, 0.45);
        graphics.lineBetween(trap.x - trap.radius * 0.68, trap.y, trap.x + trap.radius * 0.68, trap.y);
        graphics.lineBetween(trap.x, trap.y - trap.radius * 0.68, trap.x, trap.y + trap.radius * 0.68);
        graphics.fillStyle(0xff5ea8, 0.28 + (1 - warning) * 0.24);
        graphics.fillCircle(trap.x, trap.y, trap.radius * (1 - warning) * 0.85);
        continue;
      }
      const pulse = 0.88 + Math.sin(this.time.now * 0.008 + trap.id) * 0.08;
      graphics.fillStyle(trap.color, trap.kind === "sweet-field" ? 0.12 : 0.08);
      graphics.fillCircle(trap.x, trap.y, trap.radius * pulse);
      graphics.lineStyle(trap.kind === "sweet-field" ? 4 : 3, trap.color, trap.kind === "sweet-field" ? 0.42 : 0.56);
      graphics.strokeCircle(trap.x, trap.y, trap.radius * pulse);
      if (trap.kind === "noise-trap") {
        graphics.lineStyle(2, 0xffffff, 0.34);
        graphics.strokeTriangle(trap.x, trap.y - 22, trap.x - 24, trap.y + 18, trap.x + 24, trap.y + 18);
      }
    }

    for (const projectile of state.projectiles) {
      graphics.fillStyle(projectile.color, projectile.owner === "player" ? 0.95 : 0.9);
      graphics.fillCircle(projectile.x, projectile.y, projectile.radius);
      graphics.lineStyle(2, projectile.color, 0.35);
      graphics.strokeCircle(projectile.x, projectile.y, projectile.radius + 6);
    }

    for (const enemy of state.enemies) {
      const baseColor =
        enemy.type === "dummy"
          ? 0x48f7ff
          : enemy.type === "runner"
          ? 0xff5ea8
          : enemy.type === "swarm"
            ? 0xb8ff5c
            : enemy.type === "castBreaker"
              ? 0xff315f
              : enemy.type === "shieldNoise"
                ? 0x48f7ff
                : enemy.type === "anchorNoise"
                  ? 0x8c7aff
                  : enemy.type === "medicNoise"
                    ? 0x7dffb2
                    : enemy.type === "bombNoise"
                      ? 0xffd166
            : enemy.type === "tank"
              ? 0x8c7aff
              : enemy.type === "drum"
                ? 0xff7a2f
                : enemy.type === "mirror"
                  ? 0xc7b8ff
                  : enemy.type === "zero"
                    ? 0x222a44
                : 0xffd166;
      const fill = enemy.hitFlash > 0 ? 0xffffff : baseColor;
      graphics.fillStyle(0x0f1220, 0.9);
      graphics.fillCircle(enemy.x + 5, enemy.y + 7, enemy.radius + 4);
      if (enemy.markedTime > 0) {
        graphics.lineStyle(4, 0xff5ea8, 0.7);
        graphics.strokeCircle(enemy.x, enemy.y, enemy.radius + 12 + Math.sin(this.time.now * 0.018) * 4);
      }
      if (enemy.slowTime > 0) {
        graphics.lineStyle(2, 0x48f7ff, 0.42);
        graphics.strokeCircle(enemy.x, enemy.y, enemy.radius + 19);
      }
      graphics.fillStyle(fill, 0.92);
      if (enemy.type === "dummy") {
        graphics.lineStyle(4, 0xffffff, 0.3);
        graphics.strokeCircle(enemy.x, enemy.y, enemy.radius + 14);
        graphics.fillRoundedRect(enemy.x - enemy.radius, enemy.y - enemy.radius, enemy.radius * 2, enemy.radius * 2, 18);
        graphics.lineStyle(3, 0x090b13, 0.65);
        graphics.lineBetween(enemy.x - enemy.radius * 0.68, enemy.y, enemy.x + enemy.radius * 0.68, enemy.y);
        graphics.lineBetween(enemy.x, enemy.y - enemy.radius * 0.68, enemy.x, enemy.y + enemy.radius * 0.68);
      } else if (enemy.type === "runner") {
        graphics.fillTriangle(enemy.x, enemy.y - enemy.radius, enemy.x - enemy.radius, enemy.y + enemy.radius, enemy.x + enemy.radius, enemy.y + enemy.radius);
      } else if (enemy.type === "castBreaker") {
        const front = pointAt(enemy.x, enemy.y, Math.atan2(enemy.facing.y, enemy.facing.x), enemy.radius + 16);
        graphics.fillTriangle(front.x, front.y, enemy.x - enemy.facing.y * enemy.radius - enemy.facing.x * 8, enemy.y + enemy.facing.x * enemy.radius - enemy.facing.y * 8, enemy.x + enemy.facing.y * enemy.radius - enemy.facing.x * 8, enemy.y - enemy.facing.x * enemy.radius - enemy.facing.y * 8);
        graphics.lineStyle(4, 0xffffff, 0.35);
        graphics.lineBetween(enemy.x - enemy.radius * 0.45, enemy.y, enemy.x + enemy.radius * 0.45, enemy.y);
        graphics.lineStyle(3, 0xffd166, 0.7);
        graphics.strokeCircle(enemy.x, enemy.y, enemy.radius + 8 + Math.sin(this.time.now * 0.02 + enemy.id) * 3);
      } else if (enemy.type === "shieldNoise") {
        graphics.fillRoundedRect(enemy.x - enemy.radius * 0.7, enemy.y - enemy.radius * 0.72, enemy.radius * 1.4, enemy.radius * 1.44, 10);
        const angle = Math.atan2(enemy.facing.y, enemy.facing.x);
        const shield = pointAt(enemy.x, enemy.y, angle, enemy.radius * 0.78);
        graphics.fillStyle(0x071018, 0.86);
        graphics.fillRoundedRect(shield.x - 18, shield.y - 28, 36, 56, 12);
        graphics.lineStyle(5, 0x48f7ff, 0.88);
        graphics.strokeRoundedRect(shield.x - 18, shield.y - 28, 36, 56, 12);
        graphics.lineStyle(3, 0xf6fbff, 0.35);
        graphics.lineBetween(shield.x - 11, shield.y, shield.x + 11, shield.y);
        graphics.lineBetween(shield.x, shield.y - 18, shield.x, shield.y + 18);
      } else if (enemy.type === "anchorNoise") {
        graphics.fillCircle(enemy.x, enemy.y, enemy.radius);
        graphics.lineStyle(5, 0x8c7aff, 0.62);
        graphics.strokeCircle(enemy.x, enemy.y, enemy.radius + 9);
        graphics.lineStyle(4, 0xf6fbff, 0.35);
        graphics.lineBetween(enemy.x, enemy.y - enemy.radius - 8, enemy.x, enemy.y + enemy.radius + 10);
        graphics.lineBetween(enemy.x - enemy.radius - 8, enemy.y, enemy.x + enemy.radius + 8, enemy.y);
        graphics.fillStyle(0x071018, 0.5);
        graphics.fillCircle(enemy.x, enemy.y, enemy.radius * 0.38);
      } else if (enemy.type === "medicNoise") {
        graphics.fillCircle(enemy.x, enemy.y, enemy.radius);
        graphics.fillStyle(0x071018, 0.62);
        graphics.fillCircle(enemy.x, enemy.y, enemy.radius * 0.56);
        graphics.lineStyle(5, 0x7dffb2, 0.9);
        graphics.lineBetween(enemy.x - enemy.radius * 0.58, enemy.y, enemy.x + enemy.radius * 0.58, enemy.y);
        graphics.lineBetween(enemy.x, enemy.y - enemy.radius * 0.58, enemy.x, enemy.y + enemy.radius * 0.58);
        graphics.lineStyle(2, 0xffffff, 0.3);
        graphics.strokeCircle(enemy.x, enemy.y, enemy.radius + 12 + Math.sin(this.time.now * 0.01 + enemy.id) * 4);
      } else if (enemy.type === "bombNoise") {
        const pulse = 1 + Math.sin(this.time.now * 0.018 + enemy.id) * 0.1;
        graphics.fillCircle(enemy.x, enemy.y, enemy.radius * pulse);
        graphics.lineStyle(4, 0xff5ea8, 0.62);
        graphics.strokeCircle(enemy.x, enemy.y, enemy.radius + 10 * pulse);
        graphics.fillStyle(0x071018, 0.58);
        graphics.fillTriangle(enemy.x, enemy.y - enemy.radius * 0.55, enemy.x - enemy.radius * 0.48, enemy.y + enemy.radius * 0.44, enemy.x + enemy.radius * 0.48, enemy.y + enemy.radius * 0.44);
        graphics.lineStyle(3, 0xff5ea8, 0.78);
        graphics.lineBetween(enemy.x - 4, enemy.y - enemy.radius - 12, enemy.x + 12, enemy.y - enemy.radius - 28);
      } else if (enemy.type === "swarm") {
        graphics.fillCircle(enemy.x, enemy.y, enemy.radius);
        graphics.fillStyle(0x091018, 0.5);
        graphics.fillCircle(enemy.x - 4, enemy.y - 3, 3);
        graphics.fillCircle(enemy.x + 5, enemy.y - 2, 3);
      } else if (enemy.type === "tank") {
        graphics.fillRoundedRect(enemy.x - enemy.radius, enemy.y - enemy.radius * 0.78, enemy.radius * 2, enemy.radius * 1.56, 12);
        graphics.lineStyle(3, 0xffffff, 0.26);
        graphics.strokeRoundedRect(enemy.x - enemy.radius, enemy.y - enemy.radius * 0.78, enemy.radius * 2, enemy.radius * 1.56, 12);
      } else if (enemy.type === "drum") {
        graphics.fillCircle(enemy.x, enemy.y, enemy.radius);
        graphics.lineStyle(7, 0xffd166, 0.72);
        graphics.strokeCircle(enemy.x, enemy.y, enemy.radius * 0.72);
        graphics.lineStyle(4, 0x090b13, 0.8);
        graphics.lineBetween(enemy.x - enemy.radius * 0.6, enemy.y, enemy.x + enemy.radius * 0.6, enemy.y);
        graphics.lineBetween(enemy.x, enemy.y - enemy.radius * 0.6, enemy.x, enemy.y + enemy.radius * 0.6);
      } else if (enemy.type === "mirror") {
        const pulse = Math.sin(this.time.now * 0.006 + enemy.id) * 5;
        graphics.lineStyle(5, 0xff5ea8, 0.62);
        graphics.strokeCircle(enemy.x, enemy.y, enemy.radius + 10 + pulse);
        graphics.fillTriangle(enemy.x, enemy.y - enemy.radius - 18, enemy.x - enemy.radius * 0.72, enemy.y + enemy.radius * 0.55, enemy.x + enemy.radius * 0.72, enemy.y + enemy.radius * 0.55);
        graphics.fillStyle(0x101827, 0.92);
        graphics.fillCircle(enemy.x, enemy.y, enemy.radius * 0.58);
        graphics.lineStyle(4, 0x48f7ff, 0.84);
        graphics.strokeCircle(enemy.x, enemy.y, enemy.radius * 0.52);
        graphics.lineStyle(3, 0xffffff, 0.3);
        graphics.lineBetween(enemy.x - 20, enemy.y - 8, enemy.x + 20, enemy.y - 8);
        graphics.lineBetween(enemy.x - 14, enemy.y + 10, enemy.x + 14, enemy.y + 10);
      } else if (enemy.type === "zero") {
        const pulse = 1 + Math.sin(this.time.now * 0.005) * 0.08;
        graphics.fillCircle(enemy.x, enemy.y, enemy.radius * pulse);
        graphics.lineStyle(6, 0xc7b8ff, 0.52);
        graphics.strokeCircle(enemy.x, enemy.y, enemy.radius * 1.18);
        graphics.lineStyle(3, 0x48f7ff, 0.28);
        graphics.strokeCircle(enemy.x, enemy.y, enemy.radius * 1.55);
        graphics.fillStyle(0x05070d, 0.72);
        graphics.fillCircle(enemy.x, enemy.y, enemy.radius * 0.42);
        graphics.lineStyle(4, 0xff5ea8, 0.48);
        graphics.lineBetween(enemy.x - enemy.radius * 0.55, enemy.y, enemy.x + enemy.radius * 0.55, enemy.y);
      } else {
        graphics.fillRoundedRect(enemy.x - enemy.radius, enemy.y - enemy.radius, enemy.radius * 2, enemy.radius * 2, 8);
      }
      const hpRatio = Math.max(0, enemy.hp / enemy.maxHp);
      const hpWidth =
        enemy.type === "zero"
          ? 136
          : enemy.type === "drum" || enemy.type === "mirror"
            ? 106
            : enemy.type === "tank" || enemy.type === "shieldNoise"
              ? 64
              : enemy.type === "anchorNoise" || enemy.type === "medicNoise"
                ? 58
                : 48;
      graphics.fillStyle(0x111622, 0.9);
      graphics.fillRect(enemy.x - hpWidth / 2, enemy.y - enemy.radius - 13, hpWidth, 5);
      graphics.fillStyle(0xb8ff5c, 0.9);
      graphics.fillRect(enemy.x - hpWidth / 2, enemy.y - enemy.radius - 13, hpWidth * hpRatio, 5);
    }

    this.drawBossHealthBar(graphics, state);

    for (const ally of state.allies) {
      const wobble = Math.sin(this.time.now * 0.012 + ally.id) * (ally.kind === "big-slime" ? 6 : 3);
      graphics.fillStyle(0x05070d, 0.65);
      graphics.fillCircle(ally.x + 5, ally.y + 8, ally.radius + 6);
      graphics.fillStyle(ally.color, ally.kind === "big-slime" ? 0.92 : 0.86);
      graphics.fillEllipse(ally.x, ally.y + wobble * 0.35, ally.radius * 2.15, ally.radius * 1.75);
      graphics.fillStyle(0x091018, 0.55);
      graphics.fillCircle(ally.x - ally.radius * 0.35, ally.y - ally.radius * 0.1, Math.max(3, ally.radius * 0.13));
      graphics.fillCircle(ally.x + ally.radius * 0.35, ally.y - ally.radius * 0.1, Math.max(3, ally.radius * 0.13));
      graphics.lineStyle(2, 0xffffff, 0.3);
      graphics.strokeEllipse(ally.x, ally.y + wobble * 0.35, ally.radius * 2.15, ally.radius * 1.75);
    }

    this.drawPlayer(graphics);
    this.drawFx(dt);
  }

  private drawMirrorAfterimages(graphics: Phaser.GameObjects.Graphics, state: GameState): void {
    const phase = Math.sin(this.time.now * 0.005) * 10;
    graphics.lineStyle(3, 0xc7b8ff, 0.16);
    graphics.strokeCircle(state.player.x - 34 + phase, state.player.y + 18, state.player.radius + 12);
    graphics.lineStyle(3, 0x48f7ff, 0.13);
    graphics.strokeCircle(state.player.x + 42 - phase, state.player.y - 16, state.player.radius + 8);

    for (const enemy of state.enemies) {
      if (enemy.type === "dummy") {
        continue;
      }
      const offset = 16 + (enemy.id % 3) * 8;
      graphics.lineStyle(2, enemy.type === "mirror" ? 0xff5ea8 : 0xc7b8ff, 0.12);
      graphics.strokeCircle(enemy.x - offset, enemy.y + offset * 0.45, enemy.radius + 6);
      graphics.lineStyle(2, 0x48f7ff, 0.09);
      graphics.strokeCircle(enemy.x + offset * 0.8, enemy.y - offset * 0.35, enemy.radius + 4);
    }
  }

  private drawStageHazards(graphics: Phaser.GameObjects.Graphics, state: GameState): void {
    for (const hazard of state.stageHazards) {
      const active = isRenderHazardActive(hazard, state.time);
      if (hazard.kind === "rotator") {
        const pulse = 1 + Math.sin(this.time.now * 0.006 + hazard.phase) * 0.04;
        graphics.fillStyle(0xff5ea8, active ? 0.12 : 0.055);
        graphics.fillCircle(hazard.x, hazard.y, hazard.radius * pulse);
        graphics.lineStyle(active ? 5 : 3, active ? 0xff5ea8 : 0xffd166, active ? 0.58 : 0.26);
        graphics.strokeCircle(hazard.x, hazard.y, hazard.radius * pulse);
        graphics.lineStyle(active ? 12 : 7, 0xffd166, active ? 0.5 : 0.18);
        for (let index = 0; index < 4; index += 1) {
          const angle = hazard.angle + (Math.PI / 2) * index;
          graphics.lineBetween(
            hazard.x + Math.cos(angle) * 28,
            hazard.y + Math.sin(angle) * 28,
            hazard.x + Math.cos(angle) * hazard.radius * 0.92,
            hazard.y + Math.sin(angle) * hazard.radius * 0.92
          );
        }
        graphics.fillStyle(0xffd166, 0.72);
        graphics.fillCircle(hazard.x, hazard.y, 24);
        continue;
      }

      if (hazard.kind === "mirror-reversal") {
        const cycle = ((state.time + hazard.phase) % 4.8) / 4.8;
        graphics.fillStyle(0xc7b8ff, active ? 0.13 : 0.045);
        graphics.fillCircle(hazard.x, hazard.y, hazard.radius);
        graphics.lineStyle(active ? 5 : 3, active ? 0x48f7ff : 0xc7b8ff, active ? 0.62 : 0.2);
        graphics.strokeCircle(hazard.x, hazard.y, hazard.radius);
        graphics.lineStyle(2, 0xf6fbff, active ? 0.42 : 0.2);
        for (let index = -2; index <= 2; index += 1) {
          const offset = index * 34 + Math.sin(cycle * Math.PI * 2) * 12;
          graphics.lineBetween(hazard.x - hazard.radius + 20, hazard.y + offset, hazard.x + hazard.radius - 20, hazard.y - offset * 0.36);
        }
        graphics.lineStyle(3, 0xff5ea8, active ? 0.36 : 0.14);
        graphics.strokeTriangle(hazard.x, hazard.y - 42, hazard.x - 44, hazard.y + 34, hazard.x + 44, hazard.y + 34);
        continue;
      }

      const pulse = 1 + Math.sin(this.time.now * 0.005 + hazard.phase) * 0.06;
      graphics.fillStyle(0x8c7aff, 0.1);
      graphics.fillCircle(hazard.x, hazard.y, hazard.radius * pulse);
      graphics.lineStyle(4, 0xc7b8ff, 0.36);
      graphics.strokeCircle(hazard.x, hazard.y, hazard.radius * pulse);
      graphics.lineStyle(2, 0x555064, 0.34);
      graphics.strokeCircle(hazard.x, hazard.y, hazard.radius * 0.62);
      graphics.lineStyle(2, 0x48f7ff, 0.2);
      for (let index = 0; index < 8; index += 1) {
        const angle = hazard.angle + (Math.PI * 2 * index) / 8;
        graphics.lineBetween(
          hazard.x + Math.cos(angle) * hazard.radius * 0.32,
          hazard.y + Math.sin(angle) * hazard.radius * 0.32,
          hazard.x + Math.cos(angle) * hazard.radius * 0.88,
          hazard.y + Math.sin(angle) * hazard.radius * 0.88
        );
      }
    }
  }

  private drawBossHealthBar(graphics: Phaser.GameObjects.Graphics, state: GameState): void {
    const boss = state.enemies.find((enemy) => isBossEnemyType(enemy.type));
    if (!boss) {
      return;
    }

    const view = this.cameras.main.worldView;
    const width = Math.min(560, Math.max(320, view.width - 430));
    const height = 18;
    const x = view.centerX - width / 2;
    const y = view.y + 22;
    const hpRatio = Math.max(0, boss.hp / boss.maxHp);
    const color = boss.type === "drum" ? 0xffd166 : boss.type === "mirror" ? 0x48f7ff : 0xc7b8ff;

    graphics.fillStyle(0x05070d, 0.82);
    graphics.fillRoundedRect(x - 14, y - 20, width + 28, 58, 8);
    graphics.lineStyle(2, color, 0.38);
    graphics.strokeRoundedRect(x - 14, y - 20, width + 28, 58, 8);
    graphics.fillStyle(0x111622, 0.94);
    graphics.fillRoundedRect(x, y, width, height, 8);
    graphics.fillStyle(color, 0.92);
    graphics.fillRoundedRect(x, y, width * hpRatio, height, 8);

    graphics.lineStyle(2, 0xf6fbff, 0.24);
    graphics.lineBetween(x + width * 0.4, y - 4, x + width * 0.4, y + height + 4);
    graphics.lineBetween(x + width * 0.75, y - 4, x + width * 0.75, y + height + 4);
    graphics.fillStyle(0xf6fbff, 0.9);
    graphics.fillCircle(x + width * hpRatio, y + height / 2, 5);
    graphics.lineStyle(3, color, 0.36);
    graphics.strokeCircle(boss.x, boss.y, boss.radius + 24 + boss.phase * 3);
  }

  private drawPlayer(graphics: Phaser.GameObjects.Graphics): void {
    const player = this.simulation.getState().player;
    const state = this.simulation.getState();
    const character = getCharacter(state.characterId);
    const effectPalette = getEffectPaletteDefinition(state.effectPaletteId);
    const colors = getChibiColors(state.characterId, state.equippedSkinId, character.color);
    const glowColor = player.overdriveTime > 0 ? effectPalette.secondary : player.invulnerableTime > 0 ? 0xffd166 : effectPalette.primary;
    const facingAngle = Math.atan2(player.facing.y, player.facing.x);

    graphics.fillStyle(0x05070d, 0.9);
    graphics.fillEllipse(player.x + 7, player.y + 9, player.radius * 2.45, player.radius * 1.88);
    graphics.lineStyle(5, glowColor, 0.52);
    graphics.strokeCircle(player.x, player.y, player.radius + 10 + Math.sin(this.time.now * 0.012) * 3);

    if (state.characterId === "rio") {
      this.drawRio(graphics, player.x, player.y, facingAngle, colors);
    } else if (state.characterId === "maru") {
      this.drawMaru(graphics, player.x, player.y, facingAngle, colors);
    } else if (state.characterId === "neon") {
      this.drawNeon(graphics, player.x, player.y, facingAngle, colors);
    } else {
      this.drawCookie(graphics, player.x, player.y, facingAngle, colors);
    }

    if (player.shield > 0) {
      graphics.lineStyle(3, 0xb8ff5c, 0.8);
      graphics.strokeCircle(player.x, player.y, player.radius + 18);
    }
    if (player.shieldWallTime > 0) {
      graphics.lineStyle(5, effectPalette.primary, 0.5);
      graphics.strokeCircle(player.x, player.y, 165 + Math.sin(this.time.now * 0.014) * 8);
    }
    if (player.overdriveTime > 0) {
      graphics.lineStyle(4, effectPalette.secondary, 0.58);
      graphics.strokeCircle(player.x, player.y, player.radius + 30 + Math.sin(this.time.now * 0.018) * 6);
    }
  }

  private drawRio(graphics: Phaser.GameObjects.Graphics, x: number, y: number, angle: number, colors: ChibiColors): void {
    const hand = pointAt(x, y - 1, angle, 40);
    const trail = pointAt(x, y, angle + Math.PI, 64);
    graphics.lineStyle(7, colors.accent, 0.45);
    graphics.lineBetween(x - 8, y + 16, trail.x, trail.y);
    graphics.lineStyle(5, colors.trim, 0.5);
    graphics.lineBetween(x + 8, y + 18, trail.x + 16, trail.y - 8);
    this.drawChibiBase(graphics, x, y, colors);
    graphics.fillStyle(colors.trim, 1);
    graphics.fillRoundedRect(x + 13, y - 2, 23, 18, 5);
    graphics.lineStyle(4, colors.accent, 0.96);
    const boltA = pointAt(hand.x, hand.y, angle + 2.8, 16);
    const boltC = pointAt(hand.x, hand.y, angle - 0.25, 28);
    graphics.lineBetween(boltA.x, boltA.y, hand.x, hand.y);
    graphics.lineBetween(hand.x, hand.y, boltC.x, boltC.y);
    graphics.fillStyle(colors.accent, 1);
    graphics.fillCircle(hand.x, hand.y, 7);
  }

  private drawMaru(graphics: Phaser.GameObjects.Graphics, x: number, y: number, angle: number, colors: ChibiColors): void {
    this.drawChibiBase(graphics, x, y, colors);
    graphics.fillStyle(colors.trim, 0.95);
    graphics.fillTriangle(x - 16, y - 44, x - 31, y - 65, x - 22, y - 37);
    graphics.fillTriangle(x + 16, y - 44, x + 31, y - 65, x + 22, y - 37);
    const front = pointAt(x, y, angle, 27);
    graphics.fillStyle(colors.pants, 1);
    graphics.lineStyle(4, 0xf6fbff, 0.32);
    graphics.fillRoundedRect(front.x - 25, front.y - 28, 50, 56, 16);
    graphics.strokeRoundedRect(front.x - 25, front.y - 28, 50, 56, 16);
    graphics.lineStyle(5, colors.accent, 0.92);
    graphics.strokeRoundedRect(front.x - 18, front.y - 22, 36, 44, 12);
    graphics.lineStyle(3, colors.trim, 0.8);
    graphics.lineBetween(front.x - 12, front.y, front.x + 12, front.y);
    graphics.lineBetween(front.x, front.y - 15, front.x, front.y + 15);
  }

  private drawNeon(graphics: Phaser.GameObjects.Graphics, x: number, y: number, angle: number, colors: ChibiColors): void {
    const phase = Math.sin(this.time.now * 0.045) * 3;
    this.drawChibiBase(graphics, x, y, colors);
    graphics.fillStyle(colors.pants, 0.94);
    graphics.lineStyle(4, colors.trim, 0.8);
    graphics.fillTriangle(x, y - 72, x - 31, y - 31, x + 31, y - 31);
    graphics.strokeTriangle(x, y - 72, x - 31, y - 31, x + 31, y - 31);
    const front = pointAt(x, y - 17, angle, 34);
    graphics.lineStyle(4, colors.accent, 0.85);
    graphics.lineBetween(front.x - 13, front.y - 2, front.x + 13, front.y - 2);
    graphics.lineStyle(2, 0xffffff, 0.5);
    graphics.lineBetween(x - 22 + phase, y - 22, x - 6 + phase, y - 22);
    graphics.lineBetween(x + 6 - phase, y + 22, x + 24 - phase, y + 22);
  }

  private drawCookie(graphics: Phaser.GameObjects.Graphics, x: number, y: number, angle: number, colors: ChibiColors): void {
    this.drawChibiBase(graphics, x, y, colors);
    graphics.fillStyle(0xffffff, 0.92);
    graphics.fillCircle(x - 17, y - 60, 11);
    graphics.fillCircle(x, y - 67, 14);
    graphics.fillCircle(x + 17, y - 60, 11);
    graphics.fillStyle(colors.accent, 0.92);
    graphics.fillEllipse(x - 29, y + 24, 21, 13);
    graphics.fillEllipse(x + 29, y + 23, 23, 14);
    const ladle = pointAt(x, y - 4, angle, 43);
    graphics.lineStyle(4, colors.trim, 0.92);
    graphics.lineBetween(x + 18, y - 4, ladle.x, ladle.y);
    graphics.fillStyle(colors.trim, 1);
    graphics.fillCircle(ladle.x, ladle.y, 6);
  }

  private drawChibiBase(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    colors: { jacket: number; trim: number; pants: number; hair: number; skin: number; shoe: number }
  ): void {
    graphics.lineStyle(11, 0x071018, 0.78);
    graphics.lineBetween(x - 11, y + 27, x - 19, y + 45);
    graphics.lineBetween(x + 11, y + 27, x + 19, y + 45);
    graphics.lineStyle(8, colors.pants, 1);
    graphics.lineBetween(x - 11, y + 27, x - 19, y + 45);
    graphics.lineBetween(x + 11, y + 27, x + 19, y + 45);
    graphics.fillStyle(colors.shoe, 1);
    graphics.fillEllipse(x - 21, y + 48, 19, 9);
    graphics.fillEllipse(x + 21, y + 48, 19, 9);

    graphics.lineStyle(11, 0x071018, 0.72);
    graphics.lineBetween(x - 22, y - 2, x - 42, y + 16);
    graphics.lineBetween(x + 22, y - 2, x + 42, y + 16);
    graphics.lineStyle(8, colors.jacket, 1);
    graphics.lineBetween(x - 22, y - 2, x - 42, y + 16);
    graphics.lineBetween(x + 22, y - 2, x + 42, y + 16);
    graphics.fillStyle(colors.skin, 1);
    graphics.fillCircle(x - 43, y + 17, 6);
    graphics.fillCircle(x + 43, y + 17, 6);

    graphics.fillStyle(0x071018, 0.82);
    graphics.fillRoundedRect(x - 25, y - 8, 50, 47, 15);
    graphics.fillStyle(colors.jacket, 1);
    graphics.fillRoundedRect(x - 21, y - 12, 42, 48, 14);
    graphics.lineStyle(4, 0xf6fbff, 0.28);
    graphics.strokeRoundedRect(x - 21, y - 12, 42, 48, 14);
    graphics.lineStyle(5, colors.trim, 0.92);
    graphics.lineBetween(x - 14, y + 5, x + 14, y + 5);

    graphics.fillStyle(colors.skin, 1);
    graphics.fillCircle(x, y - 36, 22);
    graphics.lineStyle(4, 0xf6fbff, 0.28);
    graphics.strokeCircle(x, y - 36, 22);
    graphics.fillStyle(colors.hair, 1);
    graphics.fillEllipse(x, y - 50, 43, 25);
    graphics.fillTriangle(x - 21, y - 41, x - 6, y - 63, x + 4, y - 42);
    graphics.fillTriangle(x + 2, y - 42, x + 17, y - 61, x + 22, y - 41);
    graphics.fillStyle(0x071018, 0.72);
    graphics.fillCircle(x - 8, y - 35, 3.5);
    graphics.fillCircle(x + 8, y - 35, 3.5);
    graphics.lineStyle(2, 0x071018, 0.64);
    graphics.lineBetween(x - 6, y - 24, x + 6, y - 24);
  }

  private drawFx(dt: number): void {
    const graphics = this.fxGraphics;
    graphics.clear();
    this.updateFloatingTexts(dt);
    const remaining: ViewFx[] = [];
    const effectPaletteId = this.simulation.getState().effectPaletteId;

    for (const fx of this.viewFx) {
      fx.age += dt;
      const t = Math.min(1, fx.age / fx.ttl);
      const alpha = 1 - t;
      const event = fx.event;
      const color = "color" in event ? tintFxColor(event.color, effectPaletteId) : 0xffffff;

      if (event.kind === "burst") {
        graphics.lineStyle(event.grade === "Perfect" ? 6 : 3, color, alpha);
        graphics.strokeCircle(event.x, event.y, event.radius * (0.35 + t));
      } else if (event.kind === "slash") {
        const width = event.grade === "Perfect" ? 34 : event.grade === "Great" ? 24 : 17;
        const startX = event.x + Math.cos(event.angle) * 30;
        const startY = event.y + Math.sin(event.angle) * 30;
        const endX = event.x + Math.cos(event.angle) * event.length;
        const endY = event.y + Math.sin(event.angle) * event.length;
        graphics.lineStyle(width * alpha, color, alpha * 0.72);
        graphics.lineBetween(startX, startY, endX, endY);
        graphics.lineStyle(3, 0xffffff, alpha);
        graphics.lineBetween(startX, startY, endX, endY);
      } else if (event.kind === "bolt") {
        graphics.lineStyle(event.grade === "Perfect" ? 9 : 6, color, alpha);
        for (let index = 1; index < event.points.length; index += 1) {
          const from = event.points[index - 1];
          const to = event.points[index];
          const midX = (from.x + to.x) / 2 + Math.sin(this.time.now * 0.05 + index) * 16;
          const midY = (from.y + to.y) / 2 + Math.cos(this.time.now * 0.04 + index) * 16;
          graphics.lineBetween(from.x, from.y, midX, midY);
          graphics.lineBetween(midX, midY, to.x, to.y);
        }
      }

      if (fx.age < fx.ttl) {
        remaining.push(fx);
      }
    }

    this.viewFx = remaining;
  }

  private updateFloatingTexts(dt: number): void {
    const remaining: FloatingTextFx[] = [];

    for (const fx of this.floatingTexts) {
      fx.age += dt;
      const t = Math.min(1, fx.age / fx.ttl);
      fx.object.setY(fx.startY - fx.drift * easeOutCubic(t));
      fx.object.setAlpha(1 - t);
      fx.object.setScale(1 + 0.08 * Math.sin(t * Math.PI));

      if (fx.age < fx.ttl) {
        remaining.push(fx);
      } else {
        fx.object.destroy();
      }
    }

    this.floatingTexts = remaining;
  }

  private clearFloatingTexts(): void {
    for (const fx of this.floatingTexts) {
      fx.object.destroy();
    }
    this.floatingTexts = [];
  }

  private trackCinematicObject(object: Phaser.GameObjects.GameObject): void {
    this.cinematicObjects.push(object);
  }

  private destroyCinematicObject(object: Phaser.GameObjects.GameObject): void {
    this.cinematicObjects = this.cinematicObjects.filter((item) => item !== object);
    object.destroy();
  }

  private clearCinematicObjects(): void {
    this.zoomTween?.stop();
    this.zoomTween = null;
    for (const object of this.cinematicObjects) {
      object.destroy();
    }
    this.cinematicObjects = [];
  }

  private async resumeAudio(): Promise<void> {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      return;
    }
    if (!this.audioContext) {
      this.audioContext = new AudioCtor();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.setValueAtTime(0.58, this.audioContext.currentTime);
      this.masterGain.connect(this.audioContext.destination);
    }
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  private playSound(sound: SoundId, grade?: CastGrade): void {
    if (!isSoundEnabled() || !this.audioContext || this.audioContext.state !== "running") {
      return;
    }

    const now = this.audioContext.currentTime;
    const config = soundConfig(sound, grade);
    const nextAllowedAt = this.soundCooldowns.get(sound) ?? 0;
    if (now < nextAllowedAt) {
      return;
    }
    this.soundCooldowns.set(sound, now + (config.cooldown ?? 0.04));
    this.playSoundConfig(config, now);
  }

  private playSoundConfig(config: SoundConfig, now: number): void {
    if (!this.audioContext || this.audioContext.state !== "running") {
      return;
    }

    const destination = this.masterGain ?? this.audioContext.destination;
    for (const tone of config.tones) {
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.type = tone.type ?? config.type;
      osc.frequency.setValueAtTime(tone.frequency, now + tone.delay);
      if (tone.detune) {
        osc.detune.setValueAtTime(tone.detune, now + tone.delay);
      }
      gain.gain.setValueAtTime(0.0001, now + tone.delay);
      gain.gain.exponentialRampToValueAtTime(tone.volume, now + tone.delay + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.delay + tone.duration);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(now + tone.delay);
      osc.stop(now + tone.delay + tone.duration + 0.02);
    }

    for (const noise of config.noise ?? []) {
      this.playNoiseBurst(noise, now, destination);
    }
  }

  private playNoiseBurst(noise: NoiseBurst, now: number, destination: AudioNode): void {
    if (!this.audioContext) {
      return;
    }

    const sampleRate = this.audioContext.sampleRate;
    const frameCount = Math.max(1, Math.floor(sampleRate * noise.duration));
    const buffer = this.audioContext.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / frameCount);
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    const filter = this.audioContext.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(noise.filterFrequency, now + noise.delay);
    filter.Q.setValueAtTime(6, now + noise.delay);
    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0.0001, now + noise.delay);
    gain.gain.exponentialRampToValueAtTime(noise.volume, now + noise.delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + noise.delay + noise.duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(now + noise.delay);
    source.stop(now + noise.delay + noise.duration + 0.02);
  }

  private updateProceduralLoop(state: GameState, dt: number): void {
    const nextMode = this.getProceduralLoopMode(state);
    if (nextMode !== this.loopMode) {
      this.loopMode = nextMode;
      this.loopTimer = 0;
      this.loopStep = 0;
    }

    if (nextMode === "none" || !isSoundEnabled() || !this.audioContext || this.audioContext.state !== "running") {
      return;
    }

    this.loopTimer -= dt;
    if (this.loopTimer > 0) {
      return;
    }

    const now = this.audioContext.currentTime;
    const key = `loop-${nextMode}`;
    const nextAllowedAt = this.soundCooldowns.get(key) ?? 0;
    if (now >= nextAllowedAt) {
      this.playSoundConfig(loopSoundConfig(nextMode, this.loopStep), now);
      this.soundCooldowns.set(key, now + (nextMode === "boss" ? 0.32 : 0.38));
    }
    this.loopStep += 1;
    this.loopTimer = nextMode === "boss" ? 0.42 : 0.5;
  }

  private getProceduralLoopMode(state: GameState): ProceduralLoopMode {
    if (state.paused || state.gameOver || state.victory || state.pendingRewardIds.length > 0) {
      return "none";
    }
    if (state.mode === "survival") {
      return "survival";
    }
    if (state.mode === "boss-rush" || state.enemies.some((enemy) => isBossEnemyType(enemy.type))) {
      return "boss";
    }
    return "none";
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

function pointAt(x: number, y: number, angle: number, distance: number): { x: number; y: number } {
  return {
    x: x + Math.cos(angle) * distance,
    y: y + Math.sin(angle) * distance
  };
}

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function isLargeFloatingText(text: string): boolean {
  const normalized = text.toUpperCase();
  return ["PERFECT", "STAGE CLEAR", "OVERDRIVE", "CORE DRAIN", "BOSS", "CLEAR", "PHASE", "BUILD"].some((token) => normalized.includes(token));
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function isRenderHazardActive(hazard: StageHazardState, time: number): boolean {
  if (hazard.kind === "rotator") {
    return Math.sin(time * 1.75 + hazard.phase) > -0.25;
  }
  if (hazard.kind === "mirror-reversal") {
    return ((time + hazard.phase) % 4.8) < 1.18;
  }
  return true;
}

function isBossEnemyType(type: EnemyState["type"]): boolean {
  return type === "drum" || type === "mirror" || type === "zero";
}

function getChibiColors(characterId: CharacterId, skinId: CharacterSkinId, baseColor: number): ChibiColors {
  const defaults: Record<CharacterId, ChibiColors> = {
    rio: { jacket: baseColor, trim: 0xffd166, pants: 0x1c2a3d, hair: 0x162238, skin: 0xffd0b5, shoe: 0xd7ff3f, accent: 0xd7ff3f },
    maru: { jacket: baseColor, trim: 0x7dffb2, pants: 0x2a2442, hair: 0x4b2d52, skin: 0xf2c3aa, shoe: 0xffd166, accent: 0xffd166 },
    neon: { jacket: 0x221a3a, trim: baseColor, pants: 0x0a0e1a, hair: 0x0a0e1a, skin: 0xd9c0c8, shoe: 0x48f7ff, accent: 0x48f7ff },
    cookie: { jacket: baseColor, trim: 0xffd166, pants: 0xa64a7a, hair: 0xa64a7a, skin: 0xffd0b5, shoe: 0x7dffb2, accent: 0x7dffb2 }
  };

  switch (skinId) {
    case "rio-racer":
      return { jacket: 0xffd166, trim: 0x48f7ff, pants: 0x172235, hair: 0x162238, skin: 0xffd0b5, shoe: 0xff5ea8, accent: 0xd7ff3f };
    case "rio-ninja":
      return { jacket: 0x151a25, trim: 0xb8ff5c, pants: 0x0b1019, hair: 0x071018, skin: 0xffc8ad, shoe: 0x48f7ff, accent: 0xb8ff5c };
    case "maru-knight":
      return { jacket: 0x7dffb2, trim: 0xf6fbff, pants: 0x263348, hair: 0x635178, skin: 0xf2c3aa, shoe: 0xffd166, accent: 0xffd166 };
    case "maru-pajama":
      return { jacket: 0xffb3d9, trim: 0xb8ff5c, pants: 0x6c5485, hair: 0x5b3a63, skin: 0xf2c3aa, shoe: 0xf6fbff, accent: 0xffd166 };
    case "neon-hacker":
      return { jacket: 0x102433, trim: 0x48f7ff, pants: 0x080e18, hair: 0x071018, skin: 0xd9c0c8, shoe: 0xb8ff5c, accent: 0xff5ea8 };
    case "neon-idol":
      return { jacket: 0xff5ea8, trim: 0xc7b8ff, pants: 0x251336, hair: 0x2c183f, skin: 0xffd0d8, shoe: 0x48f7ff, accent: 0xffd166 };
    case "cookie-patissier":
      return { jacket: 0xf6fbff, trim: 0x7dffb2, pants: 0xff7ad9, hair: 0xc0508a, skin: 0xffd0b5, shoe: 0xffd166, accent: 0x7dffb2 };
    case "cookie-witch":
      return { jacket: 0x6e4b9d, trim: 0xffd166, pants: 0x2b1a44, hair: 0xff7ad9, skin: 0xffd0b5, shoe: 0xb8ff5c, accent: 0xc7b8ff };
    default:
      return defaults[characterId];
  }
}

function tintFxColor(color: number, paletteId: EffectPaletteId): number {
  if (paletteId === "classic" || color === 0xffffff || color === 0x05070d) {
    return color;
  }
  const palette = getEffectPaletteDefinition(paletteId);
  const coolColors = new Set([0x48f7ff, 0xff5ea8, 0x8c7aff, 0xc7b8ff, 0x222a44]);
  return coolColors.has(color) ? palette.primary : palette.secondary;
}

function soundConfig(sound: SoundId, grade?: CastGrade): SoundConfig {
  switch (sound) {
    case "cast-start":
    case "prepare":
      return {
        type: "triangle",
        cooldown: 0.08,
        tones: [
          { frequency: 520, delay: 0, duration: 0.07, volume: 0.036 },
          { frequency: 760, delay: 0.045, duration: 0.08, volume: 0.03 }
        ]
      };
    case "cast-perfect":
    case "perfect":
      return {
        type: "sawtooth",
        cooldown: 0.14,
        tones: [
          { frequency: 440, delay: 0, duration: 0.09, volume: 0.085 },
          { frequency: 660, delay: 0.055, duration: 0.12, volume: 0.076 },
          { frequency: 990, delay: 0.13, duration: 0.19, volume: 0.058 }
        ],
        noise: [{ delay: 0.02, duration: 0.08, volume: 0.018, filterFrequency: 5200 }]
      };
    case "cast-great":
    case "great":
      return {
        type: "triangle",
        cooldown: 0.09,
        tones: [
          { frequency: 620, delay: 0, duration: 0.13, volume: 0.058 },
          { frequency: 840, delay: 0.08, duration: 0.11, volume: 0.04 }
        ]
      };
    case "cast-normal":
    case "normal":
      return {
        type: grade === "Normal" ? "triangle" : "sine",
        cooldown: 0.07,
        tones: [{ frequency: 480, delay: 0, duration: 0.11, volume: 0.043 }]
      };
    case "rio-skill":
      return {
        type: "sawtooth",
        cooldown: 0.1,
        tones: [
          { frequency: 720, delay: 0, duration: 0.07, volume: 0.04, detune: -8 },
          { frequency: 960, delay: 0.035, duration: 0.07, volume: 0.036, detune: 10 },
          { frequency: 1240, delay: 0.07, duration: 0.08, volume: 0.028 }
        ],
        noise: [{ delay: 0.01, duration: 0.05, volume: 0.014, filterFrequency: 6400 }]
      };
    case "maru-skill":
      return {
        type: "square",
        cooldown: 0.12,
        tones: [
          { frequency: 128, delay: 0, duration: 0.15, volume: 0.07 },
          { frequency: 184, delay: 0.05, duration: 0.12, volume: 0.046 }
        ],
        noise: [{ delay: 0, duration: 0.07, volume: 0.02, filterFrequency: 900 }]
      };
    case "neon-skill":
      return {
        type: "triangle",
        cooldown: 0.1,
        tones: [
          { frequency: 360, delay: 0, duration: 0.08, volume: 0.04, detune: -22 },
          { frequency: 720, delay: 0.035, duration: 0.09, volume: 0.034, detune: 35 },
          { frequency: 540, delay: 0.105, duration: 0.06, volume: 0.03, type: "square" }
        ]
      };
    case "cookie-skill":
      return {
        type: "sine",
        cooldown: 0.1,
        tones: [
          { frequency: 620, delay: 0, duration: 0.07, volume: 0.04 },
          { frequency: 820, delay: 0.055, duration: 0.08, volume: 0.034 },
          { frequency: 1040, delay: 0.105, duration: 0.09, volume: 0.028 }
        ]
      };
    case "boss-break-start":
      return {
        type: "sawtooth",
        cooldown: 0.45,
        tones: [
          { frequency: 92, delay: 0, duration: 0.24, volume: 0.088 },
          { frequency: 138, delay: 0.1, duration: 0.18, volume: 0.052 }
        ],
        noise: [{ delay: 0.01, duration: 0.16, volume: 0.024, filterFrequency: 700 }]
      };
    case "boss-break-success":
      return {
        type: "square",
        cooldown: 0.18,
        tones: [
          { frequency: 220, delay: 0, duration: 0.08, volume: 0.06 },
          { frequency: 440, delay: 0.06, duration: 0.11, volume: 0.052 },
          { frequency: grade === "Perfect" ? 1046 : 784, delay: 0.14, duration: 0.15, volume: 0.047 }
        ]
      };
    case "boss-break-fail":
      return {
        type: "sawtooth",
        cooldown: 0.18,
        tones: [
          { frequency: 190, delay: 0, duration: 0.12, volume: 0.068 },
          { frequency: 118, delay: 0.09, duration: 0.16, volume: 0.052 }
        ],
        noise: [{ delay: 0.01, duration: 0.11, volume: 0.024, filterFrequency: 520 }]
      };
    case "reward-legendary":
      return rewardSound([523, 784, 1046, 1568], 0.055, "sawtooth", 0.28);
    case "reward-epic":
      return rewardSound([523, 698, 1046], 0.052, "triangle", 0.22);
    case "reward-rare":
      return rewardSound([523, 784, 988], 0.048, "triangle", 0.18);
    case "reward-uncommon":
      return rewardSound([466, 698], 0.046, "triangle", 0.16);
    case "reward-common":
    case "reward":
      return rewardSound([523, 784], 0.044, "triangle", 0.14);
    case "unlock":
      return {
        type: "triangle",
        cooldown: 0.22,
        tones: [
          { frequency: 392, delay: 0, duration: 0.09, volume: 0.044 },
          { frequency: 659, delay: 0.07, duration: 0.11, volume: 0.046 },
          { frequency: 1046, delay: 0.16, duration: 0.18, volume: 0.04 }
        ],
        noise: [{ delay: 0.16, duration: 0.07, volume: 0.012, filterFrequency: 5000 }]
      };
    case "phase-change":
      return {
        type: "sawtooth",
        cooldown: 0.4,
        tones: [
          { frequency: 86, delay: 0, duration: 0.28, volume: 0.086 },
          { frequency: 172, delay: 0.1, duration: 0.2, volume: 0.058 },
          { frequency: 688, delay: 0.19, duration: 0.11, volume: 0.036 }
        ],
        noise: [{ delay: 0.02, duration: 0.2, volume: 0.018, filterFrequency: 1200 }]
      };
    case "build-complete":
      return {
        type: "triangle",
        cooldown: 0.35,
        tones: [
          { frequency: 330, delay: 0, duration: 0.1, volume: 0.046 },
          { frequency: 494, delay: 0.075, duration: 0.1, volume: 0.044 },
          { frequency: 740, delay: 0.15, duration: 0.14, volume: 0.042 },
          { frequency: 1110, delay: 0.24, duration: 0.18, volume: 0.034 }
        ]
      };
    case "dash":
      return {
        type: "sawtooth",
        cooldown: 0.12,
        tones: [{ frequency: 220, delay: 0, duration: 0.1, volume: 0.038 }],
        noise: [{ delay: 0, duration: 0.035, volume: 0.01, filterFrequency: 2600 }]
      };
    case "enemy-down":
      return {
        type: "square",
        cooldown: 0.045,
        tones: [
          { frequency: 360, delay: 0, duration: 0.055, volume: 0.036 },
          { frequency: 220, delay: 0.04, duration: 0.09, volume: 0.028 }
        ]
      };
    case "hit":
      return {
        type: "square",
        cooldown: 0.08,
        tones: [{ frequency: 150, delay: 0, duration: 0.11, volume: 0.052 }],
        noise: [{ delay: 0, duration: 0.08, volume: 0.022, filterFrequency: 760 }]
      };
    case "boss":
    default:
      return {
        type: "sine",
        cooldown: 0.22,
        tones: [
          { frequency: 96, delay: 0, duration: 0.24, volume: 0.074 },
          { frequency: 144, delay: 0.12, duration: 0.16, volume: 0.042 }
        ]
      };
  }
}

function rewardSound(frequencies: number[], volume: number, type: OscillatorType, cooldown: number): SoundConfig {
  return {
    type,
    cooldown,
    tones: frequencies.map((frequency, index) => ({
      frequency,
      delay: index * 0.07,
      duration: 0.1 + index * 0.018,
      volume: Math.max(0.022, volume - index * 0.004)
    }))
  };
}

function loopSoundConfig(mode: Exclude<ProceduralLoopMode, "none">, step: number): SoundConfig {
  if (mode === "boss") {
    const root = step % 4 === 0 ? 74 : step % 4 === 2 ? 86 : 98;
    return {
      type: "sine",
      tones: [
        { frequency: root, delay: 0, duration: 0.12, volume: 0.022 },
        { frequency: root * 2, delay: 0.09, duration: 0.06, volume: 0.012 }
      ],
      noise: step % 4 === 0 ? [{ delay: 0, duration: 0.05, volume: 0.006, filterFrequency: 560 }] : undefined
    };
  }

  const pulse = [196, 247, 294, 247][step % 4];
  return {
    type: "triangle",
    tones: [
      { frequency: pulse, delay: 0, duration: 0.06, volume: 0.012 },
      { frequency: pulse * 2, delay: 0.13, duration: 0.045, volume: 0.008 }
    ]
  };
}
