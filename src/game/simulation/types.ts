import type { SkillSlot } from "../input/actions";
import type { CharacterQuestUnlock } from "../progression/characterQuests";

export type CharacterId = "rio" | "maru" | "neon" | "cookie";
export type GameMode = "title" | "quick-demo" | "tutorial" | "story" | "adventure" | "survival" | "boss-rush" | "training";
export type Difficulty = "easy" | "normal" | "hard" | "pose-master";
export type PoseAssistLevel = "relaxed" | "normal" | "strict";
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
export type AchievementId =
  | "perfect-cast-10"
  | "perfect-cast-100"
  | "no-miss-stage-clear"
  | "boss-pose-perfect"
  | "rio-fast-clear"
  | "maru-shield-300"
  | "neon-marked-100"
  | "cookie-slime-100"
  | "survival-10"
  | "all-bosses"
  | "all-cores";
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
export type EnemyType =
  | "runner"
  | "shooter"
  | "swarm"
  | "tank"
  | "castBreaker"
  | "shieldNoise"
  | "anchorNoise"
  | "medicNoise"
  | "bombNoise"
  | "balloonClown"
  | "crystalReflector"
  | "drum"
  | "mirror"
  | "zero"
  | "dummy";
export type BossType = "balloonClown" | "crystalReflector" | "drum" | "mirror" | "zero";
export type ProjectileOwner = "player" | "enemy";
export type SoundId =
  | "prepare"
  | "normal"
  | "great"
  | "perfect"
  | "dash"
  | "hit"
  | "enemy-down"
  | "reward"
  | "boss"
  | "cast-start"
  | "cast-normal"
  | "cast-great"
  | "cast-perfect"
  | "rio-skill"
  | "maru-skill"
  | "neon-skill"
  | "cookie-skill"
  | "boss-break-start"
  | "boss-break-success"
  | "boss-break-fail"
  | "reward-common"
  | "reward-uncommon"
  | "reward-rare"
  | "reward-epic"
  | "reward-legendary"
  | "unlock"
  | "phase-change"
  | "build-complete";
export type UnlockItemType = "core" | "skin" | "effect";
export type StageRegion = "루프시티" | "놀이공원" | "미러 타워" | "제로 존" | "훈련장" | "보스 러시";
export type StageHazardKind = "rotator" | "mirror-reversal" | "stasis-drain";
export type SynergyTier = "basic" | "advanced" | "signature" | "mythic";

export interface UnlockedItem {
  type: UnlockItemType;
  id: CoreId | CharacterSkinId | EffectPaletteId;
  title: string;
  description: string;
}

export interface AchievementUnlock {
  id: AchievementId;
  title: string;
  description: string;
  rewardDescription?: string;
}

export interface GestureResult {
  gestureId: GestureId;
  score: number;
  grade: CastGrade;
  confidence: number;
  reason: string;
  breakdown?: GestureScoreBreakdown;
}

export interface GestureScoreBreakdown {
  positionScore: number;
  motionScore: number;
  speedScore: number;
  stabilityScore: number;
  sizeScore: number;
  tip: string;
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
  controlReverseTime: number;
  movementSlowTime: number;
  infiniteGaugeTime: number;
  score: number;
  lastSkillId: string | null;
  sameSkillChain: number;
  lastCastSkillId: string | null;
  lastCastGrade: Exclude<CastGrade, "Miss"> | null;
  castAnimTime: number;
}

export interface EnemyState extends Vector2 {
  id: number;
  type: EnemyType;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  facing: Vector2;
  phase: number;
  phaseTriggered: {
    phase2: boolean;
    phase3: boolean;
  };
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

export type TrapKind = "noise-trap" | "sweet-field" | "drum-warning";

export interface TrapState extends Vector2 {
  id: number;
  kind: TrapKind;
  radius: number;
  damage: number;
  ttl: number;
  pulseTimer: number;
  color: number;
}

export interface StageHazardState extends Vector2 {
  id: number;
  kind: StageHazardKind;
  radius: number;
  strength: number;
  phase: number;
  angle: number;
  cooldown: number;
  pulseTimer: number;
  activeTime: number;
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

export interface BossChallengeState {
  bossType: BossType;
  requiredGesture: GestureId;
  sequence: GestureId[];
  currentIndex: number;
  prompt: string;
  stepPrompts: string[];
  expiresAt: number;
  stepDuration: number;
  successEffect:
    | "balloon-deflate"
    | "crystal-reveal"
    | "drum-counter"
    | "drum-combo-counter"
    | "mirror-shatter"
    | "mirror-prison-break"
    | "zero-release"
    | "zero-final-release";
  failDamage: number;
}

export interface ActiveSynergyState {
  id: string;
  title: string;
  description: string;
  activeEffect: string;
  tier: SynergyTier;
}

export interface RunStats {
  kills: number;
  perfectCasts: number;
  greatCasts: number;
  normalCasts: number;
  misses: number;
  maxPerfectCombo: number;
  damageTaken: number;
  skillsUsed: number;
  rewardsChosen: string[];
  unlockedItems: UnlockedItem[];
  unlockedAchievements: AchievementUnlock[];
  characterQuestUnlocks: CharacterQuestUnlock[];
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
  dailyChallengeTitle: string;
  dailyChallengeCleared: boolean;
  bossPosePerfectCounters: number;
  shieldDamageAbsorbed: number;
  markedEnemyKills: number;
  slimesSummoned: number;
  maxSlimesMaintained: number;
  bossesDefeated: BossType[];
}

export interface DevDebugStats {
  dpsEstimate: number;
  bossChallengeSuccesses: number;
  bossChallengeFailures: number;
}

export interface TrainingMissionState {
  id: string;
  gestureId: GestureId;
  title: string;
  prompt: string;
  targetSuccesses: number;
  successes: number;
  attempts: number;
  perfects: number;
  completed: boolean;
  rewardKey: string;
}

export interface TrainingLastResult {
  gestureId: GestureId;
  score: number;
  grade: CastGrade;
  reason: string;
  breakdown?: GestureScoreBreakdown;
  at: number;
}

export interface TrainingState {
  missions: TrainingMissionState[];
  lastResult: TrainingLastResult | null;
  completedRewardKeys: string[];
}

export type TutorialStepId =
  | "move"
  | "dash"
  | "basic-attack"
  | "prepare-q"
  | "cast-skill"
  | "reward"
  | "boss-pose-break";

export interface TutorialStepState {
  id: TutorialStepId;
  title: string;
  prompt: string;
  hint: string;
  completed: boolean;
}

export interface TutorialState {
  steps: TutorialStepState[];
  currentStepIndex: number;
  moveSeconds: number;
  basicAttackHits: number;
  skillPrepared: boolean;
  skillCast: boolean;
  rewardChosen: boolean;
  bossChallengeCleared: boolean;
  completed: boolean;
}

export interface QuickDemoState {
  phaseIndex: number;
  rewardOffered: boolean;
  bossSpawned: boolean;
  bossChallengeStarted: boolean;
}

export interface PlayerUpgrades {
  globalDamageMultiplier: number;
  skillDamageMultiplier: number;
  slashDamageMultiplier: number;
  slashRangeMultiplier: number;
  slashWidthMultiplier: number;
  slashExtraBurstDamageMultiplier: number;
  perfectCooldownRefund: number;
  perfectGaugeBonus: number;
  cooldownMultiplier: number;
  missCooldownMultiplier: number;
  dashSkillDamageMultiplier: number;
  dashLengthMultiplier: number;
  dashStrikeWidthMultiplier: number;
  dashHeal: number;
  dashGaugeGain: number;
  gaugeGainMultiplier: number;
  scoreMultiplier: number;
  areaMultiplier: number;
  lowHpDamageBonus: number;
  shieldedDamageBonus: number;
  sameSkillDamageBonus: number;
  swarmDamageBonus: number;
  eliteDamageBonus: number;
  chainExtraTargets: number;
  chainDamageMultiplier: number;
  chainDecayMultiplier: number;
  basicAttackRateMultiplier: number;
  basicProjectileSpeedMultiplier: number;
  basicDamageMultiplier: number;
  dashShield: number;
  overdriveDurationBonus: number;
  overdriveDamageMultiplier: number;
  overdriveGaugeRefund: number;
  guardShieldMultiplier: number;
  guardChargeMultiplier: number;
  guardHeal: number;
  reflectDamageBonus: number;
  shieldPushRangeMultiplier: number;
  pushKnockbackMultiplier: number;
  earthDrumRadiusMultiplier: number;
  earthDrumDamageMultiplier: number;
  shieldWallRadiusMultiplier: number;
  shieldWallDurationBonus: number;
  shieldWallReflectBonus: number;
  markExtraTargets: number;
  markDurationBonus: number;
  markDamageMultiplier: number;
  markedDamageMultiplier: number;
  markedKillGaugeBonus: number;
  markedKillCooldownRefund: number;
  shadowCutExtraTargets: number;
  shadowCutDamageMultiplier: number;
  trapRadiusMultiplier: number;
  trapDamageMultiplier: number;
  trapTtlBonus: number;
  blackoutRadiusMultiplier: number;
  blackoutSlowBonus: number;
  enemySlowOnHitTime: number;
  jellyRadiusMultiplier: number;
  jellyDamageMultiplier: number;
  jellyHealBonus: number;
  jellySweetFieldRadius: number;
  slimeSummonBonus: number;
  slimeDamageMultiplier: number;
  slimeTtlBonus: number;
  sweetFieldRadiusMultiplier: number;
  sweetFieldHealBonus: number;
  slimePartyBonus: number;
  bigSlimeDamageMultiplier: number;
  bigSlimeTtlBonus: number;
}

export interface GameState {
  time: number;
  mode: GameMode;
  difficulty: Difficulty;
  poseAssistLevel: PoseAssistLevel;
  characterId: CharacterId;
  paused: boolean;
  gameOver: boolean;
  victory: boolean;
  stageName: string;
  objectiveText: string;
  objectiveDetail: string;
  objectiveProgress: number;
  objectiveIsUrgent: boolean;
  stageRegion: StageRegion;
  adventureStageIndex: number;
  adventureStageTotal: number;
  adventureStageCode: string;
  adventureStageGoal: string;
  adventureStageEnemyTotal: number;
  adventureStageStartTime: number;
  adventureStageStartScore: number;
  adventureStageStartMisses: number;
  activeCoreId: CoreId;
  equippedSkinId: CharacterSkinId;
  effectPaletteId: EffectPaletteId;
  dailyChallengeId: string;
  dailyChallengeTitle: string;
  dailyChallengeDescription: string;
  modeTime: number;
  survivalNextRewardAt: number;
  survivalFinalBossSpawned: boolean;
  bossRushIndex: number;
  waveIndex: number;
  waveActive: boolean;
  spawnQueue: EnemyType[];
  spawnTimer: number;
  pendingRewardIds: string[];
  rewardOfferHistoryIds: string[];
  rewardRerollsRemaining: number;
  rewardStacks: Record<string, number>;
  preparedSkill: PreparedSkillState | null;
  bossChallenge: BossChallengeState | null;
  cooldowns: Record<SkillSlot, number>;
  player: PlayerState;
  runStats: RunStats;
  debugStats: DevDebugStats;
  training: TrainingState;
  tutorial: TutorialState;
  quickDemo: QuickDemoState;
  activeSynergies: ActiveSynergyState[];
  stageHazards: StageHazardState[];
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
    }
  | {
      kind: "screen-flash";
      color: number;
      alpha: number;
      duration: number;
    }
  | {
      kind: "cut-in";
      title: string;
      subtitle?: string;
      color: number;
      duration: number;
    }
  | {
      kind: "zoom-pulse";
      zoom: number;
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
