import type { BossChallengeState, EnemyType } from "../types";

export interface EnemyStats {
  radius: number;
  hp: number;
  speedMin: number;
  speedMax: number;
}

export function makeSurvivalWave(wave: number): EnemyType[] {
  const count = Math.min(24, 7 + wave * 2);
  const pool: EnemyType[] =
    wave < 3
      ? ["runner", "runner", "swarm", "shooter"]
      : wave < 6
        ? ["runner", "swarm", "swarm", "shooter", "tank", "castBreaker", "bombNoise"]
        : wave < 9
          ? ["runner", "swarm", "shooter", "tank", "castBreaker", "shieldNoise", "anchorNoise", "bombNoise"]
          : ["runner", "swarm", "shooter", "tank", "castBreaker", "shieldNoise", "anchorNoise", "medicNoise", "bombNoise", "mirror"];
  const enemies: EnemyType[] = [];
  for (let index = 0; index < count; index += 1) {
    enemies.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  if (wave > 0 && wave % 4 === 0) {
    enemies.push(wave >= 8 ? "mirror" : "drum");
  }
  return enemies;
}

export function isBossEnemy(type: EnemyType): type is BossChallengeState["bossType"] {
  return type === "drum" || type === "mirror" || type === "zero";
}

export function contactDamageForEnemy(type: EnemyType): number {
  switch (type) {
    case "zero":
      return 13;
    case "mirror":
      return 9;
    case "tank":
    case "shieldNoise":
      return 10;
    case "bombNoise":
      return 12;
    case "castBreaker":
      return 7;
    case "runner":
      return 6;
    case "anchorNoise":
    case "medicNoise":
      return 5;
    default:
      return 4;
  }
}

export function enemyStats(type: EnemyType, waveScale: number): EnemyStats {
  switch (type) {
    case "dummy":
      return { radius: 34, hp: 500 * waveScale, speedMin: 0, speedMax: 0 };
    case "swarm":
      return { radius: 15, hp: 18 * waveScale, speedMin: 150, speedMax: 188 };
    case "castBreaker":
      return { radius: 22, hp: 34 * waveScale, speedMin: 150, speedMax: 178 };
    case "shieldNoise":
      return { radius: 30, hp: 86 * waveScale, speedMin: 54, speedMax: 70 };
    case "anchorNoise":
      return { radius: 28, hp: 72 * waveScale, speedMin: 48, speedMax: 64 };
    case "medicNoise":
      return { radius: 25, hp: 58 * waveScale, speedMin: 76, speedMax: 98 };
    case "bombNoise":
      return { radius: 23, hp: 32 * waveScale, speedMin: 92, speedMax: 122 };
    case "shooter":
      return { radius: 24, hp: 46 * waveScale, speedMin: 62, speedMax: 82 };
    case "tank":
      return { radius: 32, hp: 92 * waveScale, speedMin: 46, speedMax: 58 };
    case "drum":
      return { radius: 58, hp: 420 * waveScale, speedMin: 34, speedMax: 45 };
    case "mirror":
      return { radius: 52, hp: 460 * waveScale, speedMin: 64, speedMax: 86 };
    case "zero":
      return { radius: 72, hp: 680 * waveScale, speedMin: 24, speedMax: 36 };
    case "runner":
    default:
      return { radius: 21, hp: 28 * waveScale, speedMin: 105, speedMax: 135 };
  }
}

export function scoreForEnemy(type: EnemyType): number {
  switch (type) {
    case "dummy":
      return 0;
    case "swarm":
      return 45;
    case "shooter":
      return 130;
    case "castBreaker":
      return 140;
    case "shieldNoise":
      return 190;
    case "anchorNoise":
      return 170;
    case "medicNoise":
      return 180;
    case "bombNoise":
      return 115;
    case "tank":
      return 210;
    case "drum":
      return 1500;
    case "mirror":
      return 1800;
    case "zero":
      return 2600;
    case "runner":
    default:
      return 80;
  }
}

export function gaugeForEnemy(type: EnemyType): number {
  switch (type) {
    case "dummy":
      return 0;
    case "swarm":
      return 4;
    case "shooter":
      return 11;
    case "castBreaker":
      return 10;
    case "shieldNoise":
      return 14;
    case "anchorNoise":
      return 13;
    case "medicNoise":
      return 15;
    case "bombNoise":
      return 9;
    case "tank":
      return 16;
    case "drum":
      return 100;
    case "mirror":
      return 100;
    case "zero":
      return 100;
    case "runner":
    default:
      return 7;
  }
}
