import type { SkillSlot } from "../input/actions";

export type CharacterId = "rio" | "maru" | "neon" | "cookie";
export type GameMode = "story" | "adventure" | "survival" | "boss-rush" | "training";
export type CoreId = "echo-core" | "rhythm-core" | "guard-core" | "rampage-core" | "stability-core" | "focus-core";
export type CharacterSkinId =
  | "rio-default"
  | "rio-racer"
  | "rio-ninja"
  | "maru-default"
  | "maru-knight"
  | "maru-pajama"
  | "neon-default"
  | "neon-hacker"
  | "neon-idol"
  | "cookie-default"
  | "cookie-patissier"
  | "cookie-witch";
export type EffectPaletteId = "classic" | "neon-pop" | "gold-rush" | "slime-soda";
export type GestureId =
  | "slash"
  | "thrust"
  | "rise"
  | "open-arms"
  | "cross-guard"
  | "palm-push"
  | "ground-slam"
  | "point"
  | "circle"
  | "wave"
  | "spread"
  | "heart"
  | "focus-triangle";
export type CastGrade = "Miss" | "Normal" | "Great" | "Perfect";
export type EnemyType = "runner" | "shooter" | "swarm" | "tank" | "drum" | "mirror" | "zero" | "dummy";
export type ProjectileOwner = "player" | "enemy";
export type SoundId = "prepare" | "normal" | "great" | "perfect" | "dash" | "hit" | "enemy-down" | "reward" | "boss";

export interface GestureResult {
  gestureId: GestureId;
  score: number;
  grade: CastGrade;
  confidence: number;
  reason: string;
}

export interface Vector2 {
  x: number;
  y: number;
}

export interface PlayerState extends Vector2 {
  radius: number;
  hp: number;
  maxHp: number;
  shield: number;
  level: number;
  gauge: number;
  maxGauge: number;
  facing: Vector2;
  dashCooldown: number;
  dashTime: number;
  dashBuffTime: number;
  invulnerableTime: number;
  hurtCooldown: number;
  attackTimer: number;
  comboPerfect: number;
  comboRangeBonusTime: number;
  overdriveTime: number;
  guardCharge: number;
  shieldWallTime: number;
  score: number;
  lastSkillId: string | null;
  sameSkillChain: number;
}

export interface EnemyState extends Vector2 {
  id: number;
  type: EnemyType;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  shootCooldown: number;
  pulseCooldown: number;
  markedTime: number;
  slowTime: number;
  hitFlash: number;
}

export interface ProjectileState extends Vector2 {
  id: number;
  owner: ProjectileOwner;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  ttl: number;
  color: number;
}

export type TrapKind = "noise-trap" | "sweet-field";

export interface TrapState extends Vector2 {
  id: number;
  kind: TrapKind;
  radius: number;
  damage: number;
  ttl: number;
  pulseTimer: number;
  color: number;
}

export type AllyKind = "slime" | "big-slime";

export interface AllyState extends Vector2 {
  id: number;
  kind: AllyKind;
  radius: number;
  ttl: number;
  speed: number;
  damage: number;
  attackCooldown: number;
  color: number;
}

export interface PreparedSkillState {
  slot: SkillSlot;
  startedAt: number;
  expiresAt: number;
}

export interface PlayerUpgrades {
  slashDamageMultiplier: number;
  perfectCooldownRefund: number;
  dashSkillDamageMultiplier: number;
  gaugeGainMultiplier: number;
  chainExtraTargets: number;
  basicAttackRateMultiplier: number;
  basicProjectileSpeedMultiplier: number;
  dashShield: number;
  overdriveDurationBonus: number;
  overdriveDamageMultiplier: number;
}

export interface GameState {
  time: number;
  mode: GameMode;
  characterId: CharacterId;
  paused: boolean;
  gameOver: boolean;
  victory: boolean;
  stageName: string;
  adventureStageIndex: number;
  adventureStageTotal: number;
  adventureStageCode: string;
  adventureStageGoal: string;
  adventureStageEnemyTotal: number;
  adventureStageStartTime: number;
  adventureStageStartScore: number;
  activeCoreId: CoreId;
  equippedSkinId: CharacterSkinId;
  effectPaletteId: EffectPaletteId;
  dailyChallengeId: string;
  modeTime: number;
  survivalNextRewardAt: number;
  survivalFinalBossSpawned: boolean;
  bossRushIndex: number;
  waveIndex: number;
  waveActive: boolean;
  spawnQueue: EnemyType[];
  spawnTimer: number;
  pendingRewardIds: string[];
  preparedSkill: PreparedSkillState | null;
  cooldowns: Record<SkillSlot, number>;
  player: PlayerState;
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  traps: TrapState[];
  allies: AllyState[];
  upgrades: PlayerUpgrades;
  message: string;
}

export type FxEvent =
  | {
      kind: "burst";
      x: number;
      y: number;
      radius: number;
      color: number;
      grade?: CastGrade;
    }
  | {
      kind: "slash";
      x: number;
      y: number;
      angle: number;
      length: number;
      color: number;
      grade: CastGrade;
    }
  | {
      kind: "bolt";
      points: Vector2[];
      color: number;
      grade: CastGrade;
    }
  | {
      kind: "float-text";
      x: number;
      y: number;
      text: string;
      color: number;
    }
  | {
      kind: "sound";
      sound: SoundId;
      grade?: CastGrade;
    }
  | {
      kind: "shake";
      intensity: number;
      duration: number;
    };

export interface SimulationInput {
  move: Vector2;
  dashPressed: boolean;
}

export interface CastResponse {
  ok: boolean;
  line: string;
}
