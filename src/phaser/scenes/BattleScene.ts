import Phaser from "phaser";
import { getCharacter } from "../../game/content/skills";
import type { SkillSlot } from "../../game/input/actions";
import { getEffectPaletteDefinition } from "../../game/progression/progression";
import { GameSimulation, WORLD_HEIGHT, WORLD_WIDTH } from "../../game/simulation/GameSimulation";
import type { CastGrade, CharacterId, CharacterSkinId, EffectPaletteId, FxEvent, SimulationInput, SoundId } from "../../game/simulation/types";
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
  private audioContext: AudioContext | null = null;

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
    this.drawGrid();

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
      this.hud.showCastResult(result.grade, cast.line);
    });
  }

  private debugCast(grade: Exclude<CastGrade, "Miss">): void {
    const response = this.simulation.castDebugGrade(grade);
    if (response.ok) {
      this.hud.showCastResult(grade, response.line);
    }
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
      const ttl = event.kind === "float-text" ? 0.75 : event.kind === "bolt" ? 0.2 : 0.34;
      this.viewFx.push({ event, age: 0, ttl });
    }
  }

  private drawGrid(): void {
    this.gridGraphics.clear();
    this.gridGraphics.fillStyle(0x080b13, 1);
    this.gridGraphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.drawLoopCityBlocks();
    this.drawStreetLayer();
    this.drawCityProps();

    this.gridGraphics.lineStyle(1, 0x293645, 0.34);
    for (let x = 0; x <= WORLD_WIDTH; x += 80) {
      this.gridGraphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += 80) {
      this.gridGraphics.lineBetween(0, y, WORLD_WIDTH, y);
    }

    this.gridGraphics.lineStyle(5, 0xff5ea8, 0.24);
    this.gridGraphics.strokeRect(32, 32, WORLD_WIDTH - 64, WORLD_HEIGHT - 64);
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

  private drawWorld(dt: number): void {
    const state = this.simulation.getState();
    const graphics = this.worldGraphics;
    graphics.clear();

    for (const trap of state.traps) {
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
      const hpWidth = enemy.type === "zero" ? 136 : enemy.type === "drum" || enemy.type === "mirror" ? 106 : enemy.type === "tank" ? 64 : 48;
      graphics.fillStyle(0x111622, 0.9);
      graphics.fillRect(enemy.x - hpWidth / 2, enemy.y - enemy.radius - 13, hpWidth, 5);
      graphics.fillStyle(0xb8ff5c, 0.9);
      graphics.fillRect(enemy.x - hpWidth / 2, enemy.y - enemy.radius - 13, hpWidth * hpRatio, 5);
    }

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
      } else if (event.kind === "float-text") {
        graphics.fillStyle(color, alpha);
        graphics.fillCircle(event.x, event.y - t * 44, 12 + t * 10);
      }

      if (fx.age < fx.ttl) {
        remaining.push(fx);
      }
    }

    this.viewFx = remaining;
  }

  private async resumeAudio(): Promise<void> {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      return;
    }
    if (!this.audioContext) {
      this.audioContext = new AudioCtor();
    }
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  private playSound(sound: SoundId, grade?: CastGrade): void {
    if (!this.audioContext || this.audioContext.state !== "running") {
      return;
    }

    const now = this.audioContext.currentTime;
    const config = soundConfig(String(sound), grade);
    for (const tone of config.tones) {
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.type = config.type;
      osc.frequency.setValueAtTime(tone.frequency, now + tone.delay);
      gain.gain.setValueAtTime(0.0001, now + tone.delay);
      gain.gain.exponentialRampToValueAtTime(tone.volume, now + tone.delay + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.delay + tone.duration);
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.start(now + tone.delay);
      osc.stop(now + tone.delay + tone.duration + 0.02);
    }
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

function soundConfig(
  sound: string,
  grade?: CastGrade
): { type: OscillatorType; tones: Array<{ frequency: number; delay: number; duration: number; volume: number }> } {
  if (sound === "perfect") {
    return {
      type: "sawtooth",
      tones: [
        { frequency: 440, delay: 0, duration: 0.09, volume: 0.09 },
        { frequency: 660, delay: 0.06, duration: 0.12, volume: 0.08 },
        { frequency: 990, delay: 0.13, duration: 0.18, volume: 0.06 }
      ]
    };
  }
  if (sound === "great") {
    return { type: "triangle", tones: [{ frequency: 620, delay: 0, duration: 0.16, volume: 0.07 }] };
  }
  if (sound === "dash") {
    return { type: "sawtooth", tones: [{ frequency: 220, delay: 0, duration: 0.1, volume: 0.045 }] };
  }
  if (sound === "enemy-down") {
    return {
      type: "square",
      tones: [
        { frequency: 360, delay: 0, duration: 0.06, volume: 0.045 },
        { frequency: 220, delay: 0.04, duration: 0.1, volume: 0.035 }
      ]
    };
  }
  if (sound === "reward") {
    return {
      type: "triangle",
      tones: [
        { frequency: 523, delay: 0, duration: 0.1, volume: 0.05 },
        { frequency: 784, delay: 0.08, duration: 0.12, volume: 0.05 }
      ]
    };
  }
  if (sound === "boss") {
    return { type: "sine", tones: [{ frequency: 96, delay: 0, duration: 0.24, volume: 0.085 }] };
  }
  if (sound === "prepare") {
    return { type: "triangle", tones: [{ frequency: 520, delay: 0, duration: 0.08, volume: 0.035 }] };
  }
  return {
    type: grade === "Normal" ? "triangle" : "sine",
    tones: [{ frequency: 480, delay: 0, duration: 0.11, volume: 0.045 }]
  };
}
