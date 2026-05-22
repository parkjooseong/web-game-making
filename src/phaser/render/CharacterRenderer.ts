import Phaser from "phaser";
import { getCharacter } from "../../game/content/skills";
import { getEffectPaletteDefinition } from "../../game/progression/progression";
import type { CharacterId, GameState, PlayerState } from "../../game/simulation/types";
import { CHARACTER_VISUALS, getCharacterVisualColors, type CharacterVisualColors } from "./CharacterVisuals";

interface MotionSample {
  x: number;
  y: number;
  timeMs: number;
}

interface MotionInfo {
  speed: number;
  moving: number;
}

interface Point {
  x: number;
  y: number;
}

export class CharacterRenderer {
  private lastSample: MotionSample | null = null;

  reset(): void {
    this.lastSample = null;
  }

  drawPlayer(graphics: Phaser.GameObjects.Graphics, state: GameState, timeMs: number): void {
    const player = state.player;
    const character = getCharacter(state.characterId);
    const visual = CHARACTER_VISUALS[state.characterId];
    const colors = getCharacterVisualColors(state.characterId, state.equippedSkinId, character.color);
    const effectPalette = getEffectPaletteDefinition(state.effectPaletteId);
    const facingAngle = Math.atan2(player.facing.y, player.facing.x);
    const motion = this.updateMotion(player, timeMs);
    const dashCharge = player.dashTime > 0 ? 1 : player.dashBuffTime > 0 ? 0.62 : 0;
    const moving = Math.max(motion.moving, dashCharge);
    const idle = Math.sin(timeMs * 0.0042 * visual.idleRate);
    const glowColor = player.overdriveTime > 0 ? effectPalette.secondary : player.invulnerableTime > 0 ? 0xffd166 : effectPalette.primary;
    const castPower = player.castAnimTime > 0 && player.lastCastSkillId ? clamp(player.castAnimTime / 0.82, 0, 1) : 0;

    graphics.fillStyle(0x05070d, 0.86);
    graphics.fillEllipse(player.x + 5, player.y + 54, visual.shadowWidth * (1 + moving * 0.16), visual.shadowHeight);

    if (moving > 0.08 || player.overdriveTime > 0) {
      this.drawMovementTrail(graphics, state.characterId, player, facingAngle, moving, idle, colors);
    }

    if (player.overdriveTime > 0 || player.infiniteGaugeTime > 0 || player.invulnerableTime > 0 || state.preparedSkill) {
      const intensity = player.overdriveTime > 0 || player.infiniteGaugeTime > 0 ? 1 : state.preparedSkill ? 0.66 : 0.42;
      this.drawCharacterGlow(graphics, state.characterId, player, timeMs, glowColor, effectPalette.secondary, intensity);
    }

    if (player.overdriveTime > 0 || player.infiniteGaugeTime > 0) {
      this.drawOverdriveSignature(graphics, state.characterId, player, facingAngle, colors, effectPalette.primary, effectPalette.secondary, timeMs);
    }

    if (castPower > 0) {
      this.drawCastMotionBack(graphics, state, player, facingAngle, castPower, colors, effectPalette.primary, effectPalette.secondary, timeMs);
    }

    switch (state.characterId) {
      case "rio":
        this.drawRio(graphics, player, facingAngle, moving, idle, colors);
        break;
      case "maru":
        this.drawMaru(graphics, player, facingAngle, moving, idle, colors);
        break;
      case "neon":
        this.drawNeon(graphics, player, facingAngle, moving, idle, colors, timeMs);
        break;
      case "cookie":
        this.drawCookie(graphics, player, facingAngle, moving, idle, colors, timeMs);
        break;
    }

    if (castPower > 0) {
      this.drawCastMotionFront(graphics, state, player, facingAngle, castPower, colors, effectPalette.primary, effectPalette.secondary, timeMs);
      if (player.lastCastGrade === "Perfect") {
        this.drawPerfectPoseSignature(graphics, state.characterId, player, facingAngle, castPower, colors, effectPalette.primary, effectPalette.secondary, timeMs);
      }
    }

    this.drawStateRings(graphics, player, effectPalette.primary, effectPalette.secondary, timeMs);
  }

  private updateMotion(player: PlayerState, timeMs: number): MotionInfo {
    if (!this.lastSample) {
      this.lastSample = { x: player.x, y: player.y, timeMs };
      return { speed: 0, moving: 0 };
    }

    const elapsed = Math.max(16, timeMs - this.lastSample.timeMs) / 1000;
    const dx = player.x - this.lastSample.x;
    const dy = player.y - this.lastSample.y;
    const speed = Math.sqrt(dx * dx + dy * dy) / elapsed;
    this.lastSample = { x: player.x, y: player.y, timeMs };
    return { speed, moving: clamp(speed / 320, 0, 1) };
  }

  private drawMovementTrail(
    graphics: Phaser.GameObjects.Graphics,
    characterId: CharacterId,
    player: PlayerState,
    angle: number,
    moving: number,
    idle: number,
    colors: CharacterVisualColors
  ): void {
    if (characterId === "rio") {
      for (let index = 0; index < 3; index += 1) {
        const base = pointAt(player.x, player.y + 5, angle + Math.PI, 36 + index * 27);
        const side = (index % 2 === 0 ? 1 : -1) * (16 + moving * 10);
        const mid = localPoint(base.x, base.y, angle, -18, side);
        const end = pointAt(base.x, base.y, angle + Math.PI, 32 + moving * 24);
        graphics.lineStyle(8 - index * 1.8, index === 1 ? colors.trim : colors.accent, 0.5 * moving);
        graphics.lineBetween(player.x - Math.cos(angle) * 10, player.y + 22, mid.x, mid.y);
        graphics.lineBetween(mid.x, mid.y, end.x, end.y);
      }
      for (let index = 0; index < 4; index += 1) {
        const shard = localPoint(player.x, player.y + 18, angle, -42 - index * 24, (index % 2 === 0 ? 1 : -1) * (26 + index * 5));
        graphics.fillStyle(index % 2 === 0 ? colors.accent : colors.trim, 0.32 * moving);
        graphics.fillTriangle(
          shard.x,
          shard.y - 14,
          shard.x + Math.cos(angle + Math.PI) * (28 + index * 3),
          shard.y + 2,
          shard.x - Math.sin(angle) * 12,
          shard.y + 15
        );
      }
      return;
    }

    if (characterId === "maru") {
      for (let index = 0; index < 4; index += 1) {
        const puff = pointAt(player.x, player.y + 42, angle + Math.PI, 28 + index * 17);
        graphics.fillStyle(index % 2 === 0 ? colors.trim : colors.accent, 0.22 * moving);
        graphics.fillCircle(puff.x + Math.sin(index + idle) * 9, puff.y + Math.cos(index) * 6, 12 - index * 1.8);
      }
      graphics.lineStyle(3, colors.trim, 0.28 * moving);
      graphics.strokeCircle(player.x, player.y + 8, 60 + moving * 10);
      graphics.lineStyle(4, colors.accent, 0.24 * moving);
      graphics.strokeRoundedRect(player.x - 45, player.y - 31, 90, 88, 28);
      graphics.fillStyle(colors.shoe, 0.22 * moving);
      graphics.fillCircle(player.x - Math.cos(angle) * 52, player.y + 46, 18);
      return;
    }

    if (characterId === "neon") {
      const back = pointAt(player.x, player.y, angle + Math.PI, 34);
      for (let index = 0; index < 8; index += 1) {
        const offset = localPoint(back.x, back.y, angle, -index * 10, (index % 2 === 0 ? -1 : 1) * (12 + index * 2));
        graphics.fillStyle(index % 3 === 0 ? colors.accent : colors.trim, 0.34 * moving);
        graphics.fillRect(offset.x, offset.y - 24 + index * 4, 14 + (index % 2) * 10, 4 + (index % 3) * 2);
      }
      this.fillPolygon(graphics, [
        localPoint(back.x, back.y, angle, -34, -34),
        localPoint(back.x, back.y, angle, -72, 0),
        localPoint(back.x, back.y, angle, -28, 38)
      ], colors.trim, 0.14 * moving, colors.accent, 2, 0.2 * moving);
      return;
    }

    for (let index = 0; index < 5; index += 1) {
      const drop = pointAt(player.x, player.y + 30, angle + Math.PI, 26 + index * 14);
      graphics.fillStyle(index % 2 === 0 ? colors.accent : colors.trim, 0.3 * moving);
      graphics.fillEllipse(drop.x + Math.sin(idle + index) * 10, drop.y + Math.cos(index) * 5, 18 - index * 2, 12 - index);
    }
    graphics.fillStyle(colors.trim, 0.28 * moving);
    this.fillHeart(graphics, player.x - Math.cos(angle) * 44 + 24, player.y - 18, 7 + moving * 3);
    graphics.fillStyle(colors.accent, 0.22 * moving);
    graphics.fillCircle(player.x - Math.cos(angle) * 58 - 18, player.y + 12, 9);
  }

  private drawCharacterGlow(
    graphics: Phaser.GameObjects.Graphics,
    characterId: CharacterId,
    player: PlayerState,
    timeMs: number,
    primary: number,
    secondary: number,
    intensity: number
  ): void {
    const pulse = Math.sin(timeMs * 0.012) * 0.5 + 0.5;
    if (characterId === "rio") {
      graphics.lineStyle(4, primary, 0.32 * intensity);
      graphics.strokeCircle(player.x, player.y + 2, 54 + pulse * 10);
      graphics.lineStyle(3, secondary, 0.46 * intensity);
      this.drawZigZag(graphics, [
        { x: player.x - 42, y: player.y - 36 },
        { x: player.x - 14, y: player.y - 18 },
        { x: player.x - 32, y: player.y + 8 },
        { x: player.x + 32, y: player.y - 12 },
        { x: player.x + 9, y: player.y + 34 }
      ]);
      return;
    }

    if (characterId === "maru") {
      graphics.lineStyle(5, primary, 0.32 * intensity);
      graphics.strokeCircle(player.x, player.y + 6, 64 + pulse * 8);
      graphics.lineStyle(3, secondary, 0.22 * intensity);
      graphics.strokeRoundedRect(player.x - 52, player.y - 54, 104, 116, 34);
      return;
    }

    if (characterId === "neon") {
      graphics.lineStyle(3, primary, 0.42 * intensity);
      graphics.strokeTriangle(player.x, player.y - 84 - pulse * 6, player.x - 66, player.y + 52, player.x + 66, player.y + 52);
      graphics.lineStyle(2, secondary, 0.34 * intensity);
      graphics.lineBetween(player.x - 56, player.y - 18, player.x + 54, player.y - 18 + pulse * 8);
      graphics.lineBetween(player.x - 32, player.y + 39, player.x + 68, player.y + 28);
      return;
    }

    graphics.lineStyle(4, primary, 0.28 * intensity);
    graphics.strokeCircle(player.x - 18, player.y - 5, 44 + pulse * 7);
    graphics.strokeCircle(player.x + 19, player.y + 20, 38 + pulse * 6);
    graphics.fillStyle(secondary, 0.22 * intensity);
    this.fillHeart(graphics, player.x + 43, player.y - 42, 11);
  }

  private drawRio(
    graphics: Phaser.GameObjects.Graphics,
    player: PlayerState,
    angle: number,
    moving: number,
    idle: number,
    colors: CharacterVisualColors
  ): void {
    const x = player.x;
    const y = player.y + idle * 1.5;
    const facing = Math.abs(player.facing.x) > 0.2 ? Math.sign(player.facing.x) : 1;
    const lean = facing * (7 + moving * 9);
    const hand = pointAt(x + lean, y - 8, angle, 45);
    const packX = x - facing * 27;

    this.fillPolygon(graphics, [
      { x: packX - 16, y: y - 15 },
      { x: packX + 19, y: y - 21 },
      { x: packX + 24, y: y + 31 },
      { x: packX - 11, y: y + 37 }
    ], 0x071018, 0.76);
    this.fillPolygon(graphics, [
      { x: packX - 12, y: y - 12 },
      { x: packX + 16, y: y - 17 },
      { x: packX + 20, y: y + 27 },
      { x: packX - 8, y: y + 32 }
    ], colors.trim, 0.94, colors.accent, 2, 0.6);

    this.drawRioLeg(graphics, x - 16 + lean * 0.25, y + 31, -7, colors, moving);
    this.drawRioLeg(graphics, x + 13 + lean * 0.4, y + 31, 8, colors, moving);

    this.fillPolygon(graphics, [
      { x: x - 26 + lean * 0.4, y: y - 22 },
      { x: x + 21 + lean, y: y - 26 },
      { x: x + 31 + lean * 0.6, y: y + 27 },
      { x: x - 19 + lean * 0.1, y: y + 39 }
    ], 0x071018, 0.88);
    this.fillPolygon(graphics, [
      { x: x - 21 + lean * 0.4, y: y - 20 },
      { x: x + 18 + lean, y: y - 23 },
      { x: x + 25 + lean * 0.58, y: y + 24 },
      { x: x - 15 + lean * 0.1, y: y + 34 }
    ], colors.jacket, 1, 0xf6fbff, 2, 0.22);
    this.fillPolygon(graphics, [
      { x: x - 4 + lean * 0.42, y: y - 17 },
      { x: x + 14 + lean * 0.82, y: y - 17 },
      { x: x + 7 + lean * 0.5, y: y + 28 }
    ], 0x0b1220, 0.88, colors.accent, 2, 0.74);
    graphics.lineStyle(3, colors.trim, 0.92);
    graphics.lineBetween(x - 18 + lean * 0.35, y + 5, x + 24 + lean * 0.65, y - 4);

    graphics.lineStyle(11, 0x071018, 0.78);
    graphics.lineBetween(x + 19 + lean * 0.75, y - 16, hand.x, hand.y);
    graphics.lineStyle(7, colors.jacket, 1);
    graphics.lineBetween(x + 19 + lean * 0.75, y - 16, hand.x, hand.y);
    graphics.fillStyle(colors.trim, 1);
    graphics.fillRoundedRect(hand.x - 14, hand.y - 9, 30, 18, 6);
    graphics.lineStyle(3, colors.accent, 0.96);
    this.drawZigZag(graphics, [
      pointAt(hand.x, hand.y, angle + 2.8, 15),
      { x: hand.x, y: hand.y },
      pointAt(hand.x, hand.y, angle - 0.2, 28),
      pointAt(hand.x, hand.y, angle + 0.12, 43)
    ]);
    graphics.lineStyle(8, 0x071018, 0.76);
    graphics.lineBetween(x - 21 + lean * 0.4, y - 11, x - 39 + lean * 0.2, y + 11);
    graphics.lineStyle(5, colors.jacket, 1);
    graphics.lineBetween(x - 21 + lean * 0.4, y - 11, x - 39 + lean * 0.2, y + 11);

    graphics.fillStyle(colors.skin, 1);
    graphics.fillRoundedRect(x - 7 + lean * 0.72, y - 43, 19, 19, 7);
    graphics.fillStyle(0x071018, 0.9);
    graphics.fillEllipse(x + lean, y - 51, 48, 45);
    graphics.fillStyle(colors.skin, 1);
    graphics.fillEllipse(x + lean, y - 51, 40, 38);
    graphics.fillStyle(colors.hair, 1);
    graphics.fillTriangle(x - 22 + lean, y - 63, x + 3 + lean, y - 91, x + 7 + lean, y - 61);
    graphics.fillTriangle(x - 9 + lean, y - 68, x + 26 + lean, y - 84, x + 13 + lean, y - 51);
    graphics.fillTriangle(x + 8 + lean, y - 62, x + 42 + lean, y - 66, x + 17 + lean, y - 44);
    graphics.fillStyle(colors.accent, 0.9);
    graphics.fillTriangle(x - 5 + lean, y - 88, x + 11 + lean, y - 66, x - 2 + lean, y - 64);
    this.drawEyes(graphics, x + lean, y - 50, colors.accent, 0.96, true);
    graphics.lineStyle(2, 0x071018, 0.75);
    graphics.lineBetween(x - 4 + lean, y - 40, x + 10 + lean, y - 41);
  }

  private drawMaru(
    graphics: Phaser.GameObjects.Graphics,
    player: PlayerState,
    angle: number,
    moving: number,
    idle: number,
    colors: CharacterVisualColors
  ): void {
    const x = player.x;
    const y = player.y + idle * 0.8;
    const shield = pointAt(x, y + 1, angle, 20 + moving * 4);

    graphics.fillStyle(0x071018, 0.82);
    graphics.fillEllipse(x, y + 18, 74, 78);
    graphics.fillStyle(colors.jacket, 1);
    graphics.fillEllipse(x, y + 15, 66, 70);
    graphics.lineStyle(3, 0xf6fbff, 0.24);
    graphics.strokeEllipse(x, y + 15, 66, 70);
    graphics.fillStyle(colors.pants, 0.92);
    graphics.fillEllipse(x - 21, y + 49, 24, 14);
    graphics.fillEllipse(x + 21, y + 49, 24, 14);
    graphics.fillStyle(colors.trim, 0.8);
    graphics.fillCircle(x, y + 13, 9);

    graphics.fillStyle(0x071018, 0.86);
    graphics.fillCircle(x, y - 34, 31);
    graphics.fillStyle(colors.skin, 1);
    graphics.fillCircle(x, y - 35, 27);
    graphics.fillStyle(0x071018, 0.85);
    graphics.fillTriangle(x - 16, y - 54, x - 39, y - 80, x - 26, y - 45);
    graphics.fillTriangle(x + 16, y - 54, x + 39, y - 80, x + 26, y - 45);
    graphics.fillStyle(colors.accent, 0.96);
    graphics.fillTriangle(x - 15, y - 57, x - 33, y - 76, x - 24, y - 45);
    graphics.fillTriangle(x + 15, y - 57, x + 33, y - 76, x + 24, y - 45);
    graphics.fillStyle(colors.hair, 0.98);
    graphics.fillEllipse(x, y - 56, 48, 23);
    this.drawEyes(graphics, x, y - 36, colors.trim, 1, false);
    graphics.lineStyle(2, 0x071018, 0.7);
    graphics.lineBetween(x - 8, y - 24, x + 8, y - 24);

    this.drawMaruShield(graphics, shield.x, shield.y + 8, 96, 112, colors);
  }

  private drawNeon(
    graphics: Phaser.GameObjects.Graphics,
    player: PlayerState,
    angle: number,
    moving: number,
    idle: number,
    colors: CharacterVisualColors,
    timeMs: number
  ): void {
    const x = player.x;
    const y = player.y + idle * 1.1;
    const flicker = Math.sin(timeMs * 0.055) * 3;
    const blade = pointAt(x, y - 14, angle, 50 + moving * 8);

    this.fillPolygon(graphics, [
      { x, y: y - 99 },
      { x: x - 48, y: y - 33 },
      { x: x - 35, y: y + 52 },
      { x: x - 7, y: y + 22 },
      { x: x + 25, y: y + 63 },
      { x: x + 50, y: y - 31 }
    ], 0x071018, 0.92);
    this.fillPolygon(graphics, [
      { x, y: y - 88 },
      { x: x - 37, y: y - 29 },
      { x: x - 24, y: y + 40 },
      { x: x - 1, y: y + 17 },
      { x: x + 20, y: y + 50 },
      { x: x + 38, y: y - 29 }
    ], colors.jacket, 0.98, colors.trim, 2, 0.56);
    this.fillPolygon(graphics, [
      { x: x - 15, y: y - 29 },
      { x: x + 16, y: y - 29 },
      { x: x + 8, y: y + 31 },
      { x: x - 8, y: y + 31 }
    ], colors.pants, 0.94);

    graphics.fillStyle(0x071018, 0.9);
    graphics.fillEllipse(x, y - 47, 51, 46);
    graphics.fillStyle(colors.skin, 0.94);
    graphics.fillEllipse(x, y - 43, 38, 32);
    graphics.fillStyle(0x071018, 0.95);
    graphics.fillRoundedRect(x - 21, y - 47, 42, 14, 5);
    graphics.lineStyle(4, colors.trim, 0.92);
    graphics.lineBetween(x - 22, y - 41, x + 22, y - 41);
    graphics.lineStyle(2, colors.accent, 0.86);
    graphics.lineBetween(x - 17, y - 37, x + 17, y - 37);

    graphics.lineStyle(9, 0x071018, 0.78);
    graphics.lineBetween(x + 18, y - 20, blade.x, blade.y);
    graphics.lineStyle(5, colors.jacket, 1);
    graphics.lineBetween(x + 18, y - 20, blade.x, blade.y);
    this.fillPolygon(graphics, [
      pointAt(blade.x, blade.y, angle - 2.45, 10),
      pointAt(blade.x, blade.y, angle, 35),
      pointAt(blade.x, blade.y, angle + 2.45, 10)
    ], colors.accent, 0.94, 0xf6fbff, 1.4, 0.5);

    graphics.lineStyle(2, colors.trim, 0.72);
    graphics.lineBetween(x - 45 + flicker, y - 19, x - 15 + flicker, y - 19);
    graphics.lineBetween(x + 18 - flicker, y + 36, x + 49 - flicker, y + 36);
    graphics.fillStyle(colors.accent, 0.62);
    graphics.fillRect(x - 52 + flicker, y + 9, 18, 5);
    graphics.fillRect(x + 31 - flicker, y - 66, 24, 5);
  }

  private drawCookie(
    graphics: Phaser.GameObjects.Graphics,
    player: PlayerState,
    angle: number,
    moving: number,
    idle: number,
    colors: CharacterVisualColors,
    timeMs: number
  ): void {
    const x = player.x;
    const y = player.y + idle * 2.8;
    const wobble = Math.sin(timeMs * 0.01) * 3;
    const ladle = pointAt(x + 19, y - 4, angle, 49);
    const slimeX = x + 48 + Math.sin(timeMs * 0.006) * 4;
    const slimeY = y + 42 + Math.abs(Math.sin(timeMs * 0.007)) * 7;

    graphics.fillStyle(0x071018, 0.72);
    graphics.fillRoundedRect(x - 48, y - 2, 34, 52, 12);
    graphics.fillStyle(colors.pants, 0.95);
    graphics.fillRoundedRect(x - 44, y + 1, 27, 46, 10);
    graphics.fillStyle(colors.trim, 0.92);
    graphics.fillEllipse(x - 30, y + 3, 30, 12);

    graphics.fillStyle(0x071018, 0.84);
    graphics.fillEllipse(x, y + 15, 78, 78);
    graphics.fillStyle(colors.jacket, 1);
    graphics.fillEllipse(x, y + 12, 68, 70);
    graphics.fillStyle(0xf6fbff, 0.86);
    graphics.fillRoundedRect(x - 21, y - 9, 42, 53, 16);
    graphics.lineStyle(3, colors.trim, 0.74);
    graphics.lineBetween(x - 14, y + 2, x + 14, y + 2);
    graphics.fillStyle(colors.accent, 0.9);
    graphics.fillCircle(x, y + 17, 7);
    this.fillHeart(graphics, x + 23, y + 5, 7);

    graphics.lineStyle(10, 0x071018, 0.8);
    graphics.lineBetween(x + 23, y - 3, ladle.x, ladle.y);
    graphics.lineStyle(5, colors.trim, 1);
    graphics.lineBetween(x + 23, y - 3, ladle.x, ladle.y);
    graphics.fillStyle(colors.trim, 1);
    graphics.fillEllipse(ladle.x, ladle.y, 22, 17);
    graphics.fillStyle(0xf6fbff, 0.45);
    graphics.fillCircle(ladle.x - 4, ladle.y - 4, 4);

    graphics.fillStyle(0x071018, 0.9);
    graphics.fillCircle(x, y - 41, 28);
    graphics.fillStyle(colors.skin, 1);
    graphics.fillCircle(x, y - 42, 24);
    graphics.fillStyle(colors.hair, 0.96);
    graphics.fillEllipse(x, y - 54, 52, 26);
    this.drawEyes(graphics, x, y - 42, colors.accent, 1, false);
    graphics.lineStyle(2, 0x071018, 0.7);
    graphics.lineBetween(x - 8, y - 31, x + 9, y - 29);

    this.drawChefHat(graphics, x, y - 77 + wobble, colors);
    this.drawSlimeBuddy(graphics, slimeX, slimeY, colors, wobble, moving);
  }

  private drawCastMotionBack(
    graphics: Phaser.GameObjects.Graphics,
    state: GameState,
    player: PlayerState,
    angle: number,
    power: number,
    colors: CharacterVisualColors,
    primary: number,
    secondary: number,
    timeMs: number
  ): void {
    const gradeBoost = castGradeBoost(player.lastCastGrade);
    const pulse = Math.sin(timeMs * 0.025) * 0.5 + 0.5;
    const x = player.x;
    const y = player.y;
    const skillId = player.lastCastSkillId;

    if (state.characterId === "rio" && skillId === "lightning-dash") {
      const head = pointAt(x, y, angle, 122 * gradeBoost);
      const tail = pointAt(x, y, angle + Math.PI, 98 * gradeBoost);
      const side = 26 + 20 * power;
      this.fillPolygon(graphics, [
        localPoint(tail.x, tail.y, angle, 0, -side * 0.52),
        localPoint(x, y - 4, angle, 24, -side),
        localPoint(head.x, head.y, angle, 0, 0),
        localPoint(x, y + 5, angle, 24, side),
        localPoint(tail.x, tail.y, angle, 0, side * 0.52)
      ], colors.accent, 0.26 * power, colors.trim, 3, 0.48 * power);
      graphics.lineStyle(7, colors.accent, 0.5 * power);
      this.drawZigZag(graphics, [tail, localPoint(x, y, angle, -18, -28), localPoint(x, y, angle, 26, 20), head]);
      return;
    }

    if (state.characterId === "rio" && skillId === "chain-bolt") {
      const orb = { x: x + Math.cos(angle) * 18, y: y - 112 * gradeBoost };
      graphics.lineStyle(5, colors.accent, 0.42 * power);
      graphics.strokeCircle(orb.x, orb.y, 38 * gradeBoost);
      graphics.lineStyle(3, colors.trim, 0.55 * power);
      for (let index = 0; index < 6; index += 1) {
        const a = timeMs * 0.006 + (Math.PI * 2 * index) / 6;
        this.drawZigZag(graphics, [
          orb,
          pointAt(orb.x, orb.y, a, 34 * gradeBoost),
          pointAt(orb.x, orb.y, a + 0.22, 64 * gradeBoost)
        ]);
      }
      graphics.fillStyle(colors.trim, 0.5 * power);
      graphics.fillCircle(orb.x, orb.y, 16 * gradeBoost);
      return;
    }

    if (state.characterId === "rio" && skillId === "thunder-overdrive") {
      this.drawRioLightningWing(graphics, x, y, -1, colors.accent, secondary, power, gradeBoost);
      this.drawRioLightningWing(graphics, x, y, 1, colors.accent, secondary, power, gradeBoost);
      return;
    }

    if (state.characterId === "maru" && skillId === "dokkaebi-guard") {
      graphics.lineStyle(8, colors.trim, 0.34 * power);
      graphics.strokeCircle(x, y + 4, (100 + pulse * 16) * gradeBoost);
      this.drawMaruShield(graphics, x, y + 8, 118 * gradeBoost, 132 * gradeBoost, colors);
      graphics.lineStyle(4, colors.accent, 0.7 * power);
      graphics.strokeCircle(x, y + 4, 34 * gradeBoost);
      return;
    }

    if (state.characterId === "maru" && skillId === "earth-drum") {
      graphics.lineStyle(6, colors.accent, 0.38 * power);
      graphics.strokeCircle(x, y + 42, 92 * gradeBoost);
      graphics.lineStyle(3, colors.trim, 0.5 * power);
      for (let index = 0; index < 8; index += 1) {
        const a = (Math.PI * 2 * index) / 8;
        const start = pointAt(x, y + 42, a, 32 * gradeBoost);
        const end = pointAt(x, y + 42, a, 92 * gradeBoost);
        graphics.lineBetween(start.x, start.y, end.x, end.y);
      }
      this.fillPolygon(graphics, [
        { x: x - 38 * gradeBoost, y: y - 8 },
        { x: x + 38 * gradeBoost, y: y - 8 },
        { x: x + 21 * gradeBoost, y: y + 58 },
        { x: x - 21 * gradeBoost, y: y + 58 }
      ], colors.trim, 0.18 * power, colors.accent, 3, 0.34 * power);
      return;
    }

    if (state.characterId === "maru" && skillId === "giant-shield-wall") {
      this.drawMaruShield(graphics, x, y - 5, 182 * gradeBoost, 214 * gradeBoost, colors);
      graphics.lineStyle(6, primary, 0.36 * power);
      graphics.strokeCircle(x, y, 188 * gradeBoost);
      graphics.lineStyle(3, colors.accent, 0.42 * power);
      graphics.strokeCircle(x, y, 126 * gradeBoost);
      return;
    }

    if (state.characterId === "neon" && skillId === "shadow-cut") {
      for (let index = 0; index < 7; index += 1) {
        const offset = pointAt(x, y, angle + Math.PI, 18 + index * 16);
        graphics.fillStyle(index % 2 === 0 ? colors.trim : colors.accent, (0.34 - index * 0.032) * power);
        graphics.fillRect(offset.x - 24 + ((index % 3) - 1) * 10, offset.y - 58 + index * 7, 48 - index * 3, 8);
        graphics.fillRect(offset.x - 12 - index * 3, offset.y + 18 - index * 4, 38, 7);
      }
      graphics.lineStyle(3, colors.accent, 0.56 * power);
      graphics.lineBetween(x - Math.cos(angle) * 88, y - Math.sin(angle) * 88, x + Math.cos(angle) * 104, y + Math.sin(angle) * 104);
      return;
    }

    if (state.characterId === "neon" && skillId === "noise-trap") {
      const center = pointAt(x, y + 16, angle, 46 * gradeBoost);
      graphics.lineStyle(4, colors.trim, 0.46 * power);
      graphics.strokeCircle(center.x, center.y, 74 * gradeBoost);
      graphics.lineStyle(2, colors.accent, 0.52 * power);
      graphics.strokeTriangle(center.x, center.y - 78 * gradeBoost, center.x - 70 * gradeBoost, center.y + 44 * gradeBoost, center.x + 70 * gradeBoost, center.y + 44 * gradeBoost);
      for (let index = 0; index < 10; index += 1) {
        const p = pointAt(center.x, center.y, timeMs * 0.004 + index * 0.63, 42 + (index % 3) * 14);
        graphics.fillStyle(index % 2 === 0 ? colors.accent : colors.trim, 0.42 * power);
        graphics.fillRect(p.x - 9, p.y - 4, 18 + (index % 2) * 8, 5);
      }
      return;
    }

    if (state.characterId === "neon" && skillId === "blackout") {
      graphics.fillStyle(0x05070d, 0.54 * power);
      graphics.fillEllipse(x, y - 3, 150 * gradeBoost, 172 * gradeBoost);
      graphics.lineStyle(4, colors.trim, 0.34 * power);
      graphics.strokeTriangle(x, y - 132 * gradeBoost, x - 96 * gradeBoost, y + 72 * gradeBoost, x + 96 * gradeBoost, y + 72 * gradeBoost);
      for (let index = 0; index < 16; index += 1) {
        graphics.fillStyle(index % 3 === 0 ? colors.accent : colors.trim, 0.36 * power);
        graphics.fillRect(x - 88 + ((index * 29) % 176), y - 92 + ((index * 47) % 170), 10 + (index % 4) * 9, 4 + (index % 3) * 3);
      }
      return;
    }

    if (state.characterId === "cookie" && skillId === "slime-party") {
      graphics.fillStyle(colors.accent, 0.34 * power);
      graphics.fillEllipse(x, y + 8, 178 * gradeBoost, 132 * gradeBoost);
      graphics.fillStyle(0xf6fbff, 0.24 * power);
      graphics.fillEllipse(x - 38, y - 28, 58, 18);
      graphics.fillStyle(0x071018, 0.52 * power);
      graphics.fillCircle(x - 25, y + 4, 6);
      graphics.fillCircle(x + 24, y + 4, 6);
      graphics.lineStyle(4, 0x071018, 0.44 * power);
      graphics.lineBetween(x - 22, y + 29, x + 22, y + 29);
    }

    if (state.characterId === "cookie" && skillId === "sweet-field") {
      graphics.fillStyle(colors.accent, 0.22 * power);
      graphics.fillEllipse(x, y + 38, 168 * gradeBoost, 98 * gradeBoost);
      graphics.lineStyle(4, colors.trim, 0.48 * power);
      graphics.strokeCircle(x - 30, y + 22, 34 * gradeBoost);
      graphics.strokeCircle(x + 34, y + 36, 28 * gradeBoost);
      graphics.fillStyle(colors.trim, 0.32 * power);
      this.fillHeart(graphics, x + 5, y - 32, 14 * gradeBoost);
      for (let index = 0; index < 8; index += 1) {
        const p = pointAt(x, y + 28, index * 0.78 + timeMs * 0.002, 38 + (index % 3) * 18);
        graphics.fillCircle(p.x, p.y, 6 + (index % 2) * 3);
      }
    }
  }

  private drawCastMotionFront(
    graphics: Phaser.GameObjects.Graphics,
    state: GameState,
    player: PlayerState,
    angle: number,
    power: number,
    colors: CharacterVisualColors,
    primary: number,
    secondary: number,
    timeMs: number
  ): void {
    const gradeBoost = castGradeBoost(player.lastCastGrade);
    const x = player.x;
    const y = player.y;
    const skillId = player.lastCastSkillId;

    if (state.characterId === "rio" && skillId === "spark-slash") {
      const start = localPoint(x, y - 12, angle, 26, -42);
      const end = localPoint(x, y - 12, angle, 138 * gradeBoost, 36);
      graphics.lineStyle(13, 0x071018, 0.58 * power);
      graphics.lineBetween(start.x, start.y, end.x, end.y);
      graphics.lineStyle(8, colors.accent, 0.95 * power);
      graphics.lineBetween(start.x, start.y, end.x, end.y);
      graphics.lineStyle(4, colors.trim, 0.88 * power);
      this.drawZigZag(graphics, [start, localPoint(x, y - 12, angle, 65, -8), localPoint(x, y - 12, angle, 96, 24), end]);
      graphics.fillStyle(colors.trim, 0.94 * power);
      graphics.fillEllipse(start.x - Math.sin(angle) * 8, start.y + Math.cos(angle) * 8, 34, 16);
      return;
    }

    if (state.characterId === "rio" && skillId === "chain-bolt") {
      const hand = { x: x + Math.cos(angle) * 22, y: y - 85 * gradeBoost };
      graphics.lineStyle(8, 0x071018, 0.48 * power);
      graphics.lineBetween(x + 16, y - 18, hand.x, hand.y);
      graphics.lineStyle(5, colors.accent, 0.9 * power);
      graphics.lineBetween(x + 16, y - 18, hand.x, hand.y);
      graphics.fillStyle(colors.trim, 0.9 * power);
      graphics.fillCircle(hand.x, hand.y, 17 * gradeBoost);
      graphics.lineStyle(3, colors.trim, 0.72 * power);
      this.drawZigZag(graphics, [
        { x: hand.x - 28, y: hand.y - 18 },
        { x: hand.x - 4, y: hand.y - 35 },
        { x: hand.x - 12, y: hand.y - 4 },
        { x: hand.x + 28, y: hand.y - 26 }
      ]);
      return;
    }

    if (state.characterId === "rio" && skillId === "thunder-overdrive") {
      graphics.lineStyle(5, colors.accent, 0.86 * power);
      graphics.strokeCircle(x, y - 6, 76 * gradeBoost);
      graphics.fillStyle(colors.accent, 0.88 * power);
      graphics.fillTriangle(x - 10, y - 104, x + 20, y - 50, x - 2, y - 48);
      graphics.fillTriangle(x + 9, y - 86, x - 22, y - 24, x + 4, y - 29);
      return;
    }

    if (state.characterId === "maru" && skillId === "shield-push") {
      const shield = pointAt(x, y + 2, angle, 72 * gradeBoost);
      this.drawMaruShield(graphics, shield.x, shield.y, 108 * gradeBoost, 126 * gradeBoost, colors);
      graphics.lineStyle(5, colors.trim, 0.64 * power);
      graphics.lineBetween(x, y + 12, shield.x, shield.y);
      graphics.lineStyle(3, primary, 0.46 * power);
      graphics.strokeCircle(shield.x + Math.cos(angle) * 34, shield.y + Math.sin(angle) * 34, 54 * gradeBoost);
      return;
    }

    if (state.characterId === "maru" && skillId === "earth-drum") {
      const fistLeft = localPoint(x, y + 2, angle, 22, -28);
      const fistRight = localPoint(x, y + 2, angle, 22, 28);
      graphics.lineStyle(8, colors.jacket, 0.95 * power);
      graphics.lineBetween(x - 18, y - 18, fistLeft.x, fistLeft.y + 42 * gradeBoost);
      graphics.lineBetween(x + 18, y - 18, fistRight.x, fistRight.y + 42 * gradeBoost);
      graphics.fillStyle(colors.accent, 0.92 * power);
      graphics.fillCircle(fistLeft.x, fistLeft.y + 42 * gradeBoost, 14 * gradeBoost);
      graphics.fillCircle(fistRight.x, fistRight.y + 42 * gradeBoost, 14 * gradeBoost);
      graphics.lineStyle(4, colors.trim, 0.62 * power);
      graphics.strokeCircle(x, y + 58, 76 * gradeBoost);
      graphics.lineBetween(x - 72 * gradeBoost, y + 58, x - 32 * gradeBoost, y + 44);
      graphics.lineBetween(x + 32 * gradeBoost, y + 44, x + 72 * gradeBoost, y + 58);
      return;
    }

    if (state.characterId === "maru" && skillId === "giant-shield-wall") {
      graphics.fillStyle(colors.accent, 0.9 * power);
      graphics.fillCircle(x, y - 8, 12 * gradeBoost);
      graphics.lineStyle(5, colors.trim, 0.74 * power);
      graphics.lineBetween(x - 52 * gradeBoost, y - 8, x + 52 * gradeBoost, y - 8);
      graphics.lineBetween(x, y - 64 * gradeBoost, x, y + 50 * gradeBoost);
      return;
    }

    if (state.characterId === "neon" && skillId === "glitch-mark") {
      const hand = pointAt(x, y - 14, angle, 56);
      const end = pointAt(hand.x, hand.y, angle, 260 * gradeBoost);
      graphics.lineStyle(8, 0x071018, 0.52 * power);
      graphics.lineBetween(hand.x, hand.y, end.x, end.y);
      graphics.lineStyle(3, colors.trim, 0.95 * power);
      graphics.lineBetween(hand.x, hand.y, end.x, end.y);
      graphics.fillStyle(colors.accent, 0.8 * power);
      graphics.fillCircle(end.x, end.y, 10 * gradeBoost);
      for (let index = 0; index < 4; index += 1) {
        const p = pointAt(hand.x, hand.y, angle, 58 + index * 42);
        graphics.fillRect(p.x - 10, p.y - 4 + (index % 2) * 8, 22, 4);
      }
      return;
    }

    if (state.characterId === "neon" && skillId === "noise-trap") {
      const hand = pointAt(x, y - 18, angle, 45);
      graphics.lineStyle(5, colors.trim, 0.62 * power);
      graphics.strokeCircle(hand.x, hand.y, 34 * gradeBoost);
      graphics.lineStyle(2, colors.accent, 0.85 * power);
      graphics.strokeTriangle(hand.x, hand.y - 34 * gradeBoost, hand.x - 34 * gradeBoost, hand.y + 25 * gradeBoost, hand.x + 34 * gradeBoost, hand.y + 25 * gradeBoost);
      graphics.fillStyle(colors.accent, 0.82 * power);
      graphics.fillRect(hand.x - 26, hand.y - 4, 52, 7);
      graphics.fillRect(hand.x - 4, hand.y - 26, 8, 52);
      return;
    }

    if (state.characterId === "neon" && skillId === "blackout") {
      graphics.fillStyle(0x071018, 0.42 * power);
      graphics.fillRoundedRect(x - 42, y - 84, 84, 142, 18);
      graphics.lineStyle(2, secondary, 0.5 * power);
      graphics.strokeCircle(x, y - 8, 94 * gradeBoost);
      return;
    }

    if (state.characterId === "cookie" && skillId === "jelly-bomb") {
      const pot = localPoint(x, y - 4, angle, 34, -38);
      const bomb = pointAt(pot.x, pot.y - 18, angle, 48 * gradeBoost);
      graphics.fillStyle(0x071018, 0.82 * power);
      graphics.fillEllipse(pot.x, pot.y, 56, 34);
      graphics.fillStyle(colors.pants, 0.9 * power);
      graphics.fillEllipse(pot.x, pot.y - 2, 48, 26);
      graphics.fillStyle(colors.accent, 0.92 * power);
      graphics.fillEllipse(bomb.x, bomb.y, 44 * gradeBoost, 36 * gradeBoost);
      graphics.fillStyle(0xf6fbff, 0.36 * power);
      graphics.fillEllipse(bomb.x - 11, bomb.y - 9, 16, 7);
      graphics.lineStyle(3, colors.trim, 0.72 * power);
      graphics.strokeCircle(bomb.x, bomb.y, 29 * gradeBoost);
      return;
    }

    if (state.characterId === "cookie" && skillId === "slime-summon") {
      for (let index = 0; index < 5; index += 1) {
        const angleOffset = (Math.PI * 2 * index) / 5 + timeMs * 0.002;
        const p = pointAt(x, y + 18, angleOffset, 44 + index * 5);
        this.drawSlimeBuddy(graphics, p.x, p.y, colors, Math.sin(timeMs * 0.01 + index) * 3, power);
      }
      return;
    }

    if (state.characterId === "cookie" && skillId === "sweet-field") {
      const spread = pointAt(x, y + 2, angle, 50);
      graphics.lineStyle(7, colors.trim, 0.68 * power);
      graphics.lineBetween(x - 18, y - 18, spread.x, spread.y - 30);
      graphics.lineBetween(x + 18, y - 18, spread.x, spread.y + 28);
      graphics.fillStyle(colors.accent, 0.62 * power);
      graphics.fillEllipse(spread.x, spread.y, 82 * gradeBoost, 46 * gradeBoost);
      graphics.fillStyle(0xf6fbff, 0.34 * power);
      graphics.fillEllipse(spread.x - 17, spread.y - 10, 28, 9);
      graphics.fillStyle(colors.trim, 0.86 * power);
      this.fillHeart(graphics, spread.x + 24, spread.y - 24, 10 * gradeBoost);
      return;
    }

    if (state.characterId === "cookie" && skillId === "slime-party") {
      graphics.fillStyle(colors.trim, 0.88 * power);
      this.fillHeart(graphics, x + 58, y - 76, 18 * gradeBoost);
      graphics.lineStyle(4, colors.trim, 0.72 * power);
      graphics.strokeCircle(x, y + 8, 112 * gradeBoost);
    }
  }

  private drawOverdriveSignature(
    graphics: Phaser.GameObjects.Graphics,
    characterId: CharacterId,
    player: PlayerState,
    angle: number,
    colors: CharacterVisualColors,
    primary: number,
    secondary: number,
    timeMs: number
  ): void {
    const pulse = Math.sin(timeMs * 0.018) * 0.5 + 0.5;
    const x = player.x;
    const y = player.y;

    if (characterId === "rio") {
      this.drawRioLightningWing(graphics, x, y, -1, colors.accent, secondary, 0.6 + pulse * 0.18, 0.9);
      this.drawRioLightningWing(graphics, x, y, 1, colors.accent, secondary, 0.6 + pulse * 0.18, 0.9);
      graphics.lineStyle(5, colors.trim, 0.54);
      this.drawZigZag(graphics, [
        { x: x - 18, y: y + 44 },
        { x: x - 10, y: y + 70 + pulse * 8 },
        { x: x + 2, y: y + 50 },
        { x: x + 16, y: y + 75 + pulse * 6 }
      ]);
      return;
    }

    if (characterId === "maru") {
      graphics.lineStyle(6, primary, 0.34);
      graphics.strokeRoundedRect(x - 78 - pulse * 4, y - 78 - pulse * 4, 156 + pulse * 8, 166 + pulse * 8, 42);
      graphics.lineStyle(3, secondary, 0.36);
      for (let index = 0; index < 6; index += 1) {
        const a = timeMs * 0.0018 + (Math.PI * 2 * index) / 6;
        const from = pointAt(x, y + 3, a, 46);
        const to = pointAt(x, y + 3, a, 90 + pulse * 8);
        graphics.lineBetween(from.x, from.y, to.x, to.y);
      }
      graphics.fillStyle(colors.accent, 0.42);
      graphics.fillCircle(x, y - 1, 18 + pulse * 5);
      return;
    }

    if (characterId === "neon") {
      graphics.fillStyle(0x05070d, 0.28);
      graphics.fillTriangle(x, y - 130, x - 108, y + 78, x + 108, y + 78);
      graphics.lineStyle(3, primary, 0.38);
      graphics.strokeTriangle(x, y - 126 - pulse * 9, x - 108, y + 74, x + 108, y + 74);
      for (let index = 0; index < 18; index += 1) {
        const gx = x - 88 + ((index * 31 + Math.floor(timeMs * 0.08)) % 176);
        const gy = y - 90 + ((index * 47) % 168);
        graphics.fillStyle(index % 3 === 0 ? colors.accent : colors.trim, 0.32);
        graphics.fillRect(gx, gy, 10 + (index % 4) * 8, 4 + (index % 3) * 2);
      }
      return;
    }

    graphics.fillStyle(colors.accent, 0.2);
    graphics.fillEllipse(x, y + 20, 182 + pulse * 20, 132 + pulse * 12);
    graphics.lineStyle(4, primary, 0.36);
    graphics.strokeCircle(x - 46, y - 20, 40 + pulse * 8);
    graphics.strokeCircle(x + 50, y + 8, 48 + pulse * 8);
    graphics.fillStyle(colors.trim, 0.5);
    this.fillHeart(graphics, x, y - 83, 15 + pulse * 4);
    this.drawSlimeBuddy(graphics, x + Math.cos(angle + 1.7) * 78, y + 48, colors, pulse * 5, 1);
  }

  private drawPerfectPoseSignature(
    graphics: Phaser.GameObjects.Graphics,
    characterId: CharacterId,
    player: PlayerState,
    angle: number,
    power: number,
    colors: CharacterVisualColors,
    primary: number,
    secondary: number,
    timeMs: number
  ): void {
    const x = player.x;
    const y = player.y;
    const pulse = Math.sin(timeMs * 0.024) * 0.5 + 0.5;

    if (characterId === "rio") {
      graphics.lineStyle(5, colors.trim, 0.7 * power);
      graphics.strokeCircle(x + Math.cos(angle) * 16, y - 26, 72 + pulse * 8);
      graphics.fillStyle(colors.accent, 0.88 * power);
      graphics.fillTriangle(x - 7, y - 114, x + 18, y - 61, x - 2, y - 63);
      graphics.fillTriangle(x + 12, y - 94, x - 18, y - 35, x + 5, y - 40);
      graphics.lineStyle(4, secondary, 0.72 * power);
      this.drawZigZag(graphics, [
        localPoint(x, y - 22, angle, -58, -42),
        localPoint(x, y - 22, angle, -10, -8),
        localPoint(x, y - 22, angle, -34, 20),
        localPoint(x, y - 22, angle, 58, -10)
      ]);
      return;
    }

    if (characterId === "maru") {
      graphics.lineStyle(6, colors.accent, 0.72 * power);
      graphics.strokeCircle(x, y + 1, 90 + pulse * 9);
      graphics.lineStyle(4, colors.trim, 0.82 * power);
      graphics.strokeRoundedRect(x - 57, y - 58, 114, 122, 32);
      graphics.fillStyle(colors.accent, 0.74 * power);
      graphics.fillCircle(x, y - 1, 14 + pulse * 4);
      graphics.lineStyle(4, primary, 0.66 * power);
      graphics.lineBetween(x - 46, y - 1, x + 46, y - 1);
      graphics.lineBetween(x, y - 48, x, y + 45);
      return;
    }

    if (characterId === "neon") {
      graphics.lineStyle(4, colors.trim, 0.78 * power);
      graphics.strokeTriangle(x, y - 112, x - 78, y + 45, x + 78, y + 45);
      graphics.lineStyle(2, colors.accent, 0.9 * power);
      graphics.lineBetween(x - 70, y - 28, x + 73, y - 21);
      graphics.lineBetween(x - 48, y + 33, x + 66, y + 12);
      for (let index = 0; index < 12; index += 1) {
        graphics.fillStyle(index % 2 === 0 ? colors.accent : colors.trim, 0.56 * power);
        graphics.fillRect(x - 72 + ((index * 23) % 144), y - 72 + ((index * 37) % 116), 18 + (index % 3) * 8, 5);
      }
      return;
    }

    graphics.fillStyle(colors.trim, 0.78 * power);
    this.fillHeart(graphics, x, y - 82, 20 + pulse * 4);
    graphics.lineStyle(4, secondary, 0.56 * power);
    graphics.strokeCircle(x, y - 2, 84 + pulse * 8);
    graphics.fillStyle(colors.accent, 0.46 * power);
    graphics.fillCircle(x - 58, y - 34, 16);
    graphics.fillCircle(x + 61, y + 18, 14);
    graphics.fillCircle(x + 31, y - 58, 10);
  }

  private drawStateRings(
    graphics: Phaser.GameObjects.Graphics,
    player: PlayerState,
    primary: number,
    secondary: number,
    timeMs: number
  ): void {
    if (player.shield > 0) {
      graphics.lineStyle(3, 0xb8ff5c, 0.8);
      graphics.strokeCircle(player.x, player.y, player.radius + 18);
    }
    if (player.shieldWallTime > 0) {
      graphics.lineStyle(5, primary, 0.5);
      graphics.strokeCircle(player.x, player.y, 165 + Math.sin(timeMs * 0.014) * 8);
    }
    if (player.overdriveTime > 0) {
      graphics.lineStyle(4, secondary, 0.58);
      graphics.strokeCircle(player.x, player.y, player.radius + 30 + Math.sin(timeMs * 0.018) * 6);
    }
  }

  private drawRioLeg(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    skew: number,
    colors: CharacterVisualColors,
    moving: number
  ): void {
    this.fillPolygon(graphics, [
      { x: x - 8, y: y - 4 },
      { x: x + 10, y: y - 2 },
      { x: x + 8 + skew, y: y + 31 },
      { x: x - 10 + skew, y: y + 30 }
    ], 0x071018, 0.85);
    this.fillPolygon(graphics, [
      { x: x - 5, y: y - 2 },
      { x: x + 7, y },
      { x: x + 5 + skew, y: y + 27 },
      { x: x - 7 + skew, y: y + 27 }
    ], colors.pants, 1);
    graphics.fillStyle(colors.shoe, 1);
    graphics.fillEllipse(x + skew, y + 33, 27, 10);
    if (moving > 0.35) {
      graphics.fillStyle(colors.accent, 0.62);
      graphics.fillTriangle(x + skew - 5, y + 38, x + skew + 7, y + 38, x + skew, y + 57);
    }
  }

  private drawMaruShield(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    colors: CharacterVisualColors
  ): void {
    this.fillPolygon(graphics, [
      { x: x - width * 0.46, y: y - height * 0.42 },
      { x: x + width * 0.46, y: y - height * 0.42 },
      { x: x + width * 0.42, y: y + height * 0.14 },
      { x, y: y + height * 0.52 },
      { x: x - width * 0.42, y: y + height * 0.14 }
    ], 0x071018, 0.88);
    this.fillPolygon(graphics, [
      { x: x - width * 0.39, y: y - height * 0.35 },
      { x: x + width * 0.39, y: y - height * 0.35 },
      { x: x + width * 0.35, y: y + height * 0.1 },
      { x, y: y + height * 0.42 },
      { x: x - width * 0.35, y: y + height * 0.1 }
    ], colors.pants, 1, 0xf6fbff, 2, 0.24);
    graphics.lineStyle(7, colors.trim, 0.95);
    graphics.strokeCircle(x, y - 4, 24);
    graphics.lineStyle(4, colors.accent, 0.92);
    graphics.lineBetween(x - 25, y - 4, x + 25, y - 4);
    graphics.lineBetween(x, y - 30, x, y + 25);
    graphics.fillStyle(colors.accent, 0.96);
    graphics.fillCircle(x, y - 4, 8);
  }

  private drawChefHat(graphics: Phaser.GameObjects.Graphics, x: number, y: number, colors: CharacterVisualColors): void {
    graphics.fillStyle(0x071018, 0.72);
    graphics.fillCircle(x - 22, y + 4, 15);
    graphics.fillCircle(x, y - 4, 19);
    graphics.fillCircle(x + 22, y + 4, 15);
    graphics.fillStyle(0xf6fbff, 0.96);
    graphics.fillCircle(x - 22, y + 2, 13);
    graphics.fillCircle(x, y - 6, 17);
    graphics.fillCircle(x + 22, y + 2, 13);
    graphics.fillRoundedRect(x - 31, y + 9, 62, 15, 7);
    graphics.lineStyle(2, colors.trim, 0.48);
    graphics.lineBetween(x - 20, y + 10, x - 17, y + 21);
    graphics.lineBetween(x, y + 7, x, y + 22);
    graphics.lineBetween(x + 20, y + 10, x + 17, y + 21);
  }

  private drawSlimeBuddy(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    colors: CharacterVisualColors,
    wobble: number,
    moving: number
  ): void {
    graphics.fillStyle(0x071018, 0.76);
    graphics.fillEllipse(x, y + 4, 39, 28);
    graphics.fillStyle(colors.accent, 0.95);
    graphics.fillEllipse(x, y, 35 + wobble * 0.5, 27 + moving * 3);
    graphics.fillStyle(0xf6fbff, 0.28);
    graphics.fillEllipse(x - 9, y - 7, 12, 5);
    graphics.fillStyle(0x071018, 0.82);
    graphics.fillCircle(x - 7, y - 1, 2.8);
    graphics.fillCircle(x + 8, y - 1, 2.8);
    graphics.lineStyle(2, 0x071018, 0.62);
    graphics.lineBetween(x - 5, y + 6, x + 6, y + 6);
  }

  private drawRioLightningWing(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    side: -1 | 1,
    primary: number,
    secondary: number,
    power: number,
    gradeBoost: number
  ): void {
    const root = { x: x + side * 18, y: y - 24 };
    const outer = { x: x + side * 126 * gradeBoost, y: y - 92 * gradeBoost };
    const lower = { x: x + side * 96 * gradeBoost, y: y + 18 * gradeBoost };
    graphics.lineStyle(9, 0x071018, 0.42 * power);
    this.drawZigZag(graphics, [root, outer, { x: x + side * 72 * gradeBoost, y: y - 36 * gradeBoost }, lower]);
    graphics.lineStyle(5, primary, 0.86 * power);
    this.drawZigZag(graphics, [root, outer, { x: x + side * 72 * gradeBoost, y: y - 36 * gradeBoost }, lower]);
    graphics.lineStyle(3, secondary, 0.64 * power);
    graphics.lineBetween(root.x, root.y, x + side * 146 * gradeBoost, y - 16);
  }

  private drawEyes(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    iris: number,
    alpha: number,
    sharp: boolean
  ): void {
    if (sharp) {
      graphics.fillStyle(0x071018, 0.88 * alpha);
      graphics.fillTriangle(x - 16, y - 3, x - 4, y - 1, x - 16, y + 5);
      graphics.fillTriangle(x + 16, y - 3, x + 4, y - 1, x + 16, y + 5);
      graphics.fillStyle(iris, 0.9 * alpha);
      graphics.fillCircle(x - 10, y + 1, 2.2);
      graphics.fillCircle(x + 10, y + 1, 2.2);
      return;
    }
    graphics.fillStyle(0x071018, 0.84 * alpha);
    graphics.fillRoundedRect(x - 16, y - 5, 8, 11, 4);
    graphics.fillRoundedRect(x + 8, y - 5, 8, 11, 4);
    graphics.fillStyle(iris, 0.9 * alpha);
    graphics.fillRoundedRect(x - 13, y - 3, 3, 6, 2);
    graphics.fillRoundedRect(x + 11, y - 3, 3, 6, 2);
    graphics.fillStyle(0xf6fbff, 0.82 * alpha);
    graphics.fillCircle(x - 11.5, y - 2, 1.3);
    graphics.fillCircle(x + 12.5, y - 2, 1.3);
  }

  private fillHeart(graphics: Phaser.GameObjects.Graphics, x: number, y: number, size: number): void {
    graphics.fillCircle(x - size * 0.35, y - size * 0.2, size * 0.38);
    graphics.fillCircle(x + size * 0.35, y - size * 0.2, size * 0.38);
    graphics.fillTriangle(x - size * 0.75, y, x + size * 0.75, y, x, y + size * 0.95);
  }

  private drawZigZag(graphics: Phaser.GameObjects.Graphics, points: Point[]): void {
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      graphics.lineBetween(from.x, from.y, to.x, to.y);
    }
  }

  private fillPolygon(
    graphics: Phaser.GameObjects.Graphics,
    points: Point[],
    color: number,
    alpha = 1,
    strokeColor?: number,
    strokeWeight = 2,
    strokeAlpha = 1
  ): void {
    if (points.length < 3) {
      return;
    }
    graphics.fillStyle(color, alpha);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      graphics.lineTo(points[index].x, points[index].y);
    }
    graphics.closePath();
    graphics.fillPath();
    if (strokeColor !== undefined) {
      graphics.lineStyle(strokeWeight, strokeColor, strokeAlpha);
      graphics.beginPath();
      graphics.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) {
        graphics.lineTo(points[index].x, points[index].y);
      }
      graphics.closePath();
      graphics.strokePath();
    }
  }
}

function pointAt(x: number, y: number, angle: number, distance: number): Point {
  return {
    x: x + Math.cos(angle) * distance,
    y: y + Math.sin(angle) * distance
  };
}

function localPoint(x: number, y: number, angle: number, forward: number, side: number): Point {
  return {
    x: x + Math.cos(angle) * forward + Math.cos(angle + Math.PI / 2) * side,
    y: y + Math.sin(angle) * forward + Math.sin(angle + Math.PI / 2) * side
  };
}

function castGradeBoost(grade: PlayerState["lastCastGrade"]): number {
  if (grade === "Perfect") {
    return 1.24;
  }
  if (grade === "Great") {
    return 1.1;
  }
  return 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
