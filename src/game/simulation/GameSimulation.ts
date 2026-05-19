import { REWARDS, getRewardDefinition, type RewardDefinition, type RewardRarity } from "../content/rewards";
import { ADVENTURE_STAGES } from "../content/adventure";
import { CHARACTER_ORDER, getCharacter, getSkillsForCharacter } from "../content/skills";
import { createTrainingState } from "../content/training";
import type { MoveInput, SkillSlot } from "../input/actions";
import { getDefaultSkinId } from "../progression/progression";
import type { ProgressionStore } from "../progression/progression";
import type {
  CastGrade,
  CastResponse,
  AllyState,
  BossChallengeState,
  CharacterId,
  EnemyState,
  EnemyType,
  FxEvent,
  GameState,
  GameMode,
  GestureResult,
  ProjectileState,
  SimulationInput,
  TrapState,
  Vector2
} from "./types";
import { clamp, distance, dot, normalize, perpendicularDistance, randomRange } from "./math";

export const WORLD_WIDTH = 2200;
export const WORLD_HEIGHT = 1400;

const wavePlans: EnemyType[][] = [
  ["runner", "runner", "runner", "runner", "swarm", "swarm", "shooter"],
  ["runner", "runner", "runner", "swarm", "swarm", "swarm", "shooter", "tank"],
  ["runner", "runner", "runner", "runner", "swarm", "swarm", "shooter", "shooter", "tank"],
  ["runner", "runner", "swarm", "swarm", "swarm", "shooter", "shooter", "tank", "tank"],
  ["runner", "runner", "swarm", "swarm", "shooter", "tank", "drum"]
];

const bossRushPlan: EnemyType[] = ["drum", "mirror", "zero"];

export class GameSimulation {
  private state: GameState;
  private nextEntityId = 1;
  private fxEvents: FxEvent[] = [];
  private selectedCharacterId: CharacterId = "rio";
  private selectedMode: GameMode = "story";
  private runReported = false;

  constructor(private readonly progression?: ProgressionStore) {
    this.state = this.createInitialState();
    this.startMode();
  }

  getState(): GameState {
    return this.state;
  }

  getCurrentSkills() {
    return getSkillsForCharacter(this.state.characterId);
  }

  drainFxEvents(): FxEvent[] {
    const events = this.fxEvents;
    this.fxEvents = [];
    return events;
  }

  reset(): void {
    this.nextEntityId = 1;
    this.fxEvents = [];
    this.runReported = false;
    this.state = this.createInitialState();
    this.startMode();
  }

  switchCharacter(characterId?: CharacterId): void {
    const currentIndex = CHARACTER_ORDER.indexOf(this.selectedCharacterId);
    this.selectedCharacterId = characterId ?? CHARACTER_ORDER[(currentIndex + 1) % CHARACTER_ORDER.length];
    this.reset();
  }

  setMode(mode: GameMode): void {
    this.selectedMode = mode;
    this.reset();
  }

  setPaused(paused: boolean): void {
    if (this.state.gameOver || this.state.victory || this.state.pendingRewardIds.length > 0) {
      return;
    }
    this.state.paused = paused;
  }

  togglePaused(): void {
    this.setPaused(!this.state.paused);
  }

  update(dt: number, input: SimulationInput): void {
    const state = this.state;
    const step = clamp(dt, 0, 1 / 30);

    if (state.paused || state.gameOver || state.victory || state.pendingRewardIds.length > 0) {
      return;
    }

    state.time += step;
    state.modeTime += step;
    this.updateTimers(step);
    this.updatePreparedSkillExpiry();
    this.updateBossChallengeExpiry();
    this.updatePlayer(step, input);
    this.updateSpawning(step);
    this.updateSurvivalFlow();
    this.updateEnemies(step);
    this.updateTraps(step);
    this.updateAllies(step);
    this.updateProjectiles(step);
    this.updateBasicAttack(step);
    this.checkWaveComplete();
  }

  prepareSkill(slot: SkillSlot): CastResponse {
    const state = this.state;
    const skill = this.getCurrentSkills()[slot];

    if (state.paused || state.gameOver || state.victory || state.pendingRewardIds.length > 0) {
      return { ok: false, line: "지금은 시전할 수 없습니다." };
    }
    if (state.preparedSkill) {
      return { ok: false, line: "이미 포즈를 읽는 중입니다." };
    }
    if (state.bossChallenge) {
      return { ok: false, line: "보스 포즈 브레이크가 우선입니다." };
    }
    if (state.cooldowns[slot] > 0) {
      return { ok: false, line: `${skill.name} 쿨타임 ${state.cooldowns[slot].toFixed(1)}초` };
    }
    if (state.player.gauge < skill.gaugeCost) {
      return { ok: false, line: "스킬 게이지가 부족합니다." };
    }

    state.preparedSkill = {
      slot,
      startedAt: state.time,
      expiresAt: state.time + 1.55
    };
    state.message = skill.gestureLabel;
    this.fxEvents.push({ kind: "sound", sound: "prepare" });
    return { ok: true, line: skill.gestureLabel };
  }

  castPreparedSkill(result: GestureResult): CastResponse {
    const state = this.state;
    const prepared = state.preparedSkill;
    if (!prepared) {
      return { ok: false, line: "준비된 스킬이 없습니다." };
    }

    const skill = this.getCurrentSkills()[prepared.slot];
    state.preparedSkill = null;
    state.runStats.skillsUsed += 1;
    this.recordTrainingGestureResult(result);
    if (result.grade === "Perfect") {
      state.runStats.perfectCasts += 1;
    } else if (result.grade === "Great") {
      state.runStats.greatCasts += 1;
    } else if (result.grade === "Normal") {
      state.runStats.normalCasts += 1;
    } else {
      state.runStats.misses += 1;
    }

    if (result.grade === "Miss") {
      state.cooldowns[prepared.slot] = skill.cooldown * (state.activeCoreId === "stability-core" ? 0.16 : 0.3) * state.upgrades.missCooldownMultiplier;
      state.player.comboPerfect = 0;
      state.player.sameSkillChain = 0;
      this.progression?.recordCast(state.characterId, skill.id, result.grade);
      state.message = getCharacter(state.characterId).failureLine;
      this.fxEvents.push({
        kind: "float-text",
        x: state.player.x,
        y: state.player.y - 56,
        text: "MISS",
        color: 0xff6b8a
      });
      this.fxEvents.push({ kind: "sound", sound: "hit" });
      return { ok: true, line: state.message };
    }

    state.cooldowns[prepared.slot] = skill.cooldown * (state.dailyChallengeId === "unstable-core" ? 1.15 : 1) * state.upgrades.cooldownMultiplier;
    state.player.gauge = clamp(state.player.gauge - skill.gaugeCost, 0, state.player.maxGauge);
    state.player.sameSkillChain = state.player.lastSkillId === skill.id ? Math.min(5, state.player.sameSkillChain + 1) : 1;
    state.player.lastSkillId = skill.id;

    if (result.grade === "Perfect") {
      state.player.comboPerfect += 1;
      state.runStats.maxPerfectCombo = Math.max(state.runStats.maxPerfectCombo, state.player.comboPerfect);
      state.cooldowns[prepared.slot] *= 1 - state.upgrades.perfectCooldownRefund;
      if (state.activeCoreId === "rhythm-core") {
        state.player.gauge = clamp(state.player.gauge + 10, 0, state.player.maxGauge);
        state.upgrades.basicAttackRateMultiplier = Math.max(state.upgrades.basicAttackRateMultiplier, 1.18);
      }
      if (state.dailyChallengeId === "perfect-surge") {
        state.player.gauge = clamp(state.player.gauge + 12, 0, state.player.maxGauge);
      }
      if (state.upgrades.perfectGaugeBonus > 0) {
        state.player.gauge = clamp(state.player.gauge + state.upgrades.perfectGaugeBonus, 0, state.player.maxGauge);
      }
      this.applyPerfectComboBonus();
    } else {
      state.player.comboPerfect = 0;
    }

    this.resolveSkillEffect(skill.id, result.grade);
    if (state.activeCoreId === "echo-core" && Math.random() < (result.grade === "Perfect" ? 0.22 : 0.14)) {
      this.resolveSkillEffect(skill.id, "Normal");
      this.fxEvents.push({
        kind: "float-text",
        x: state.player.x,
        y: state.player.y - 104,
        text: "ECHO",
        color: skill.color
      });
    }
    if (state.activeCoreId === "guard-core" && isGuardSkill(skill.id)) {
      state.player.shield = Math.max(state.player.shield, result.grade === "Perfect" ? 30 : 18);
    }
    this.progression?.recordCast(state.characterId, skill.id, result.grade);

    const line =
      skill.slot === "F"
        ? result.grade === "Perfect"
          ? getCharacter(state.characterId).ultimateLine
          : `${skill.name} ${result.grade}`
        : result.grade === "Perfect"
          ? getCharacter(state.characterId).perfectLine
          : `${skill.name} ${result.grade}`;
    state.message = line;
    this.fxEvents.push({
      kind: "float-text",
      x: state.player.x,
      y: state.player.y - 68,
      text: result.grade,
      color: skill.color
    });
    this.fxEvents.push({
      kind: "sound",
      sound: result.grade === "Perfect" ? "perfect" : result.grade === "Great" ? "great" : "normal",
      grade: result.grade
    });
    return { ok: true, line };
  }

  castDebugGrade(grade: Exclude<CastGrade, "Miss">): CastResponse {
    if (this.state.bossChallenge) {
      const challenge = this.state.bossChallenge;
      return this.castBossChallenge({
        gestureId: challenge.requiredGesture,
        score: grade === "Perfect" ? 96 : grade === "Great" ? 82 : 58,
        grade,
        confidence: 1,
        reason: "debug input"
      });
    }

    const prepared = this.state.preparedSkill;
    if (!prepared) {
      if (this.state.mode === "training") {
        return this.castTrainingDebugGrade(grade);
      }
      return { ok: false, line: "준비된 스킬이 없습니다." };
    }

    return this.castPreparedSkill({
      gestureId: this.getCurrentSkills()[prepared.slot].gestureId,
      score: grade === "Perfect" ? 96 : grade === "Great" ? 82 : 58,
      grade,
      confidence: 1,
      reason: "debug input"
    });
  }

  castBossChallenge(result: GestureResult): CastResponse {
    const challenge = this.state.bossChallenge;
    if (!challenge) {
      return { ok: false, line: "진행 중인 보스 포즈 브레이크가 없습니다." };
    }

    this.state.bossChallenge = null;
    const grade: CastGrade = result.gestureId === challenge.requiredGesture ? result.grade : "Miss";
    if (grade === "Miss") {
      return this.failBossChallenge(challenge);
    }

    return this.succeedBossChallenge(challenge, grade);
  }

  private castTrainingDebugGrade(grade: Exclude<CastGrade, "Miss">): CastResponse {
    const gestureId = this.getNextTrainingGesture();
    const result: GestureResult = {
      gestureId,
      score: grade === "Perfect" ? 96 : grade === "Great" ? 82 : 58,
      grade,
      confidence: 1,
      reason: "debug input"
    };
    this.recordTrainingGestureResult(result);
    this.state.runStats.skillsUsed += 1;
    this.state.runStats[grade === "Perfect" ? "perfectCasts" : grade === "Great" ? "greatCasts" : "normalCasts"] += 1;
    if (grade === "Perfect") {
      this.state.player.comboPerfect += 1;
      this.state.runStats.maxPerfectCombo = Math.max(this.state.runStats.maxPerfectCombo, this.state.player.comboPerfect);
    } else {
      this.state.player.comboPerfect = 0;
    }
    this.state.message = `훈련 ${gestureId} ${grade}`;
    this.fxEvents.push({
      kind: "float-text",
      x: this.state.player.x,
      y: this.state.player.y - 86,
      text: grade,
      color: grade === "Perfect" ? 0xffd166 : grade === "Great" ? 0xb8ff5c : 0x48f7ff
    });
    this.fxEvents.push({ kind: "sound", sound: grade === "Perfect" ? "perfect" : grade === "Great" ? "great" : "normal", grade });
    return { ok: true, line: this.state.message };
  }

  private getNextTrainingGesture(): GestureResult["gestureId"] {
    return this.state.training.missions.find((mission) => !mission.completed)?.gestureId ?? this.state.training.missions[0]?.gestureId ?? "slash";
  }

  private recordTrainingGestureResult(result: GestureResult): void {
    const state = this.state;
    if (state.mode !== "training") {
      return;
    }

    state.training.lastResult = {
      gestureId: result.gestureId,
      score: result.score,
      grade: result.grade,
      reason: result.reason,
      at: state.time
    };

    const mission = state.training.missions.find((item) => item.gestureId === result.gestureId);
    if (!mission) {
      return;
    }

    const wasCompleted = mission.completed;
    mission.attempts += 1;
    if (result.grade === "Perfect") {
      mission.perfects += 1;
    }
    if (result.grade !== "Miss") {
      mission.successes = Math.min(mission.targetSuccesses, mission.successes + 1);
      mission.completed = mission.successes >= mission.targetSuccesses;
    }

    if (!wasCompleted && mission.completed) {
      state.training.completedRewardKeys.push(mission.rewardKey);
      this.fxEvents.push({
        kind: "float-text",
        x: state.player.x,
        y: state.player.y - 126,
        text: `${mission.title} COMPLETE`,
        color: 0xffd166
      });
      this.fxEvents.push({ kind: "sound", sound: "reward" });
    }
  }

  chooseReward(rewardId: string): void {
    const state = this.state;
    if (!state.pendingRewardIds.includes(rewardId)) {
      return;
    }

    this.applyReward(rewardId);
    state.runStats.rewardsChosen.push(rewardId);
    state.pendingRewardIds = [];
    this.continueAfterReward();
  }

  private createInitialState(): GameState {
    const character = getCharacter(this.selectedCharacterId);
    const progress = this.progression?.getSnapshot();
    const daily = this.progression?.getDailyChallenge();
    const activeCoreId = progress?.equippedCoreId ?? "stability-core";
    const equippedSkinId = progress?.equippedSkins[this.selectedCharacterId] ?? getDefaultSkinId(this.selectedCharacterId);
    const effectPaletteId = progress?.equippedEffectPaletteId ?? "classic";
    const characterLevel = progress?.characters[this.selectedCharacterId]?.level ?? 1;
    const maxHp = Math.round(character.hp * (daily?.id === "close-call" ? 0.78 : 1));
    const state: GameState = {
      time: 0,
      mode: this.selectedMode,
      characterId: this.selectedCharacterId,
      paused: false,
      gameOver: false,
      victory: false,
      stageName: "루프시티 거리",
      adventureStageIndex: 0,
      adventureStageTotal: ADVENTURE_STAGES.length,
      adventureStageCode: "",
      adventureStageGoal: "",
      adventureStageEnemyTotal: 0,
      adventureStageStartTime: 0,
      adventureStageStartScore: 0,
      activeCoreId,
      equippedSkinId,
      effectPaletteId,
      dailyChallengeId: daily?.id ?? "none",
      modeTime: 0,
      survivalNextRewardAt: 60,
      survivalFinalBossSpawned: false,
      bossRushIndex: 0,
      waveIndex: 0,
      waveActive: false,
      spawnQueue: [],
      spawnTimer: 0,
      pendingRewardIds: [],
      rewardStacks: {},
      preparedSkill: null,
      bossChallenge: null,
      cooldowns: { Q: 0, E: 0, R: 0, F: 0 },
      player: {
        x: WORLD_WIDTH / 2,
        y: WORLD_HEIGHT / 2,
        radius: 24,
        hp: maxHp,
        maxHp,
        shield: 0,
        level: characterLevel,
        gauge: 82,
        maxGauge: 100,
        facing: { x: 1, y: 0 },
        dashCooldown: 0,
        dashTime: 0,
        dashBuffTime: 0,
        invulnerableTime: 0,
        hurtCooldown: 0,
        attackTimer: 0.2,
        comboPerfect: 0,
        comboRangeBonusTime: 0,
        overdriveTime: 0,
        guardCharge: 0,
        shieldWallTime: 0,
        controlReverseTime: 0,
        movementSlowTime: 0,
        infiniteGaugeTime: 0,
        score: 0,
        lastSkillId: null,
        sameSkillChain: 0
      },
      runStats: {
        kills: 0,
        perfectCasts: 0,
        greatCasts: 0,
        normalCasts: 0,
        misses: 0,
        maxPerfectCombo: 0,
        damageTaken: 0,
        skillsUsed: 0,
        rewardsChosen: [],
        unlockedItems: [],
        xpGained: 0,
        levelBefore: characterLevel,
        levelAfter: characterLevel
      },
      training: createTrainingState(),
      enemies: [],
      projectiles: [],
      traps: [],
      allies: [],
      upgrades: {
        globalDamageMultiplier: 1,
        skillDamageMultiplier: 1,
        slashDamageMultiplier: 1,
        slashRangeMultiplier: 1,
        slashWidthMultiplier: 1,
        slashExtraBurstDamageMultiplier: 1,
        perfectCooldownRefund: 0,
        perfectGaugeBonus: 0,
        cooldownMultiplier: 1,
        missCooldownMultiplier: 1,
        dashSkillDamageMultiplier: 1,
        dashLengthMultiplier: 1,
        dashStrikeWidthMultiplier: 1,
        dashHeal: 0,
        dashGaugeGain: 0,
        gaugeGainMultiplier: 1,
        scoreMultiplier: 1,
        areaMultiplier: 1,
        lowHpDamageBonus: 0,
        shieldedDamageBonus: 0,
        sameSkillDamageBonus: 0,
        swarmDamageBonus: 0,
        eliteDamageBonus: 0,
        chainExtraTargets: 0,
        chainDamageMultiplier: 1,
        chainDecayMultiplier: 0.92,
        basicAttackRateMultiplier: 1,
        basicProjectileSpeedMultiplier: 1,
        basicDamageMultiplier: 1,
        dashShield: 0,
        overdriveDurationBonus: 0,
        overdriveDamageMultiplier: 1,
        overdriveGaugeRefund: 0,
        guardShieldMultiplier: 1,
        guardChargeMultiplier: 1,
        guardHeal: 0,
        reflectDamageBonus: 0,
        shieldPushRangeMultiplier: 1,
        pushKnockbackMultiplier: 1,
        earthDrumRadiusMultiplier: 1,
        earthDrumDamageMultiplier: 1,
        shieldWallRadiusMultiplier: 1,
        shieldWallDurationBonus: 0,
        shieldWallReflectBonus: 0,
        markExtraTargets: 0,
        markDurationBonus: 0,
        markDamageMultiplier: 1,
        markedDamageMultiplier: 1,
        markedKillGaugeBonus: 0,
        markedKillCooldownRefund: 0,
        shadowCutExtraTargets: 0,
        shadowCutDamageMultiplier: 1,
        trapRadiusMultiplier: 1,
        trapDamageMultiplier: 1,
        trapTtlBonus: 0,
        blackoutRadiusMultiplier: 1,
        blackoutSlowBonus: 0,
        enemySlowOnHitTime: 0,
        jellyRadiusMultiplier: 1,
        jellyDamageMultiplier: 1,
        jellyHealBonus: 0,
        jellySweetFieldRadius: 0,
        slimeSummonBonus: 0,
        slimeDamageMultiplier: 1,
        slimeTtlBonus: 0,
        sweetFieldRadiusMultiplier: 1,
        sweetFieldHealBonus: 0,
        slimePartyBonus: 0,
        bigSlimeDamageMultiplier: 1,
        bigSlimeTtlBonus: 0
      },
      message: "Loop City"
    };

    if (state.activeCoreId === "guard-core") {
      state.player.shield = 18;
    }
    if (state.activeCoreId === "rhythm-core") {
      state.upgrades.basicAttackRateMultiplier += 0.08;
    }
    if (state.dailyChallengeId === "unstable-core") {
      state.upgrades.gaugeGainMultiplier += 0.35;
    }
    if (state.dailyChallengeId === "close-call") {
      state.upgrades.dashSkillDamageMultiplier += 0.35;
    }

    return state;
  }

  private updateTimers(dt: number): void {
    const state = this.state;
    for (const slot of Object.keys(state.cooldowns) as SkillSlot[]) {
      state.cooldowns[slot] = Math.max(0, state.cooldowns[slot] - dt);
    }

    state.player.dashCooldown = Math.max(0, state.player.dashCooldown - dt);
    state.player.dashTime = Math.max(0, state.player.dashTime - dt);
    state.player.dashBuffTime = Math.max(0, state.player.dashBuffTime - dt);
    state.player.invulnerableTime = Math.max(0, state.player.invulnerableTime - dt);
    state.player.hurtCooldown = Math.max(0, state.player.hurtCooldown - dt);
    state.player.comboRangeBonusTime = Math.max(0, state.player.comboRangeBonusTime - dt);
    state.player.overdriveTime = Math.max(0, state.player.overdriveTime - dt);
    state.player.shieldWallTime = Math.max(0, state.player.shieldWallTime - dt);
    state.player.controlReverseTime = Math.max(0, state.player.controlReverseTime - dt);
    state.player.movementSlowTime = Math.max(0, state.player.movementSlowTime - dt);
    state.player.infiniteGaugeTime = Math.max(0, state.player.infiniteGaugeTime - dt);
    if (state.player.infiniteGaugeTime > 0) {
      state.player.gauge = state.player.maxGauge;
    }
    if (state.mode === "training") {
      state.player.gauge = state.player.maxGauge;
      state.player.hp = Math.max(state.player.hp, state.player.maxHp);
    }

    for (const enemy of state.enemies) {
      enemy.shootCooldown = Math.max(0, enemy.shootCooldown - dt);
      enemy.pulseCooldown = Math.max(0, enemy.pulseCooldown - dt);
      enemy.markedTime = Math.max(0, enemy.markedTime - dt);
      enemy.slowTime = Math.max(0, enemy.slowTime - dt);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
    }
  }

  private updatePreparedSkillExpiry(): void {
    const prepared = this.state.preparedSkill;
    if (prepared && this.state.time > prepared.expiresAt) {
      this.castPreparedSkill({
        gestureId: this.getCurrentSkills()[prepared.slot].gestureId,
        score: 0,
        grade: "Miss",
        confidence: 0,
        reason: "포즈 시간이 지났습니다."
      });
    }
  }

  private updateBossChallengeExpiry(): void {
    const challenge = this.state.bossChallenge;
    if (challenge && this.state.time > challenge.expiresAt) {
      this.state.bossChallenge = null;
      this.failBossChallenge(challenge);
    }
  }

  private updatePlayer(dt: number, input: SimulationInput): void {
    const player = this.state.player;
    const rawMove = normalize(input.move);
    const move =
      player.controlReverseTime > 0
        ? { x: -rawMove.x, y: -rawMove.y }
        : rawMove;
    if (Math.abs(move.x) + Math.abs(move.y) > 0) {
      player.facing = move;
    }

    if (input.dashPressed && player.dashCooldown <= 0) {
      const dashDirection = Math.abs(move.x) + Math.abs(move.y) > 0 ? move : player.facing;
      player.facing = dashDirection;
      player.dashTime = 0.16;
      player.dashCooldown = 1.05;
      player.invulnerableTime = 0.24;
      player.dashBuffTime = 2;
      if (this.state.upgrades.dashShield > 0) {
        player.shield = Math.max(player.shield, this.state.upgrades.dashShield * 0.45);
      }
      if (this.state.upgrades.dashHeal > 0) {
        player.hp = clamp(player.hp + this.state.upgrades.dashHeal, 0, player.maxHp);
      }
      if (this.state.upgrades.dashGaugeGain > 0) {
        player.gauge = clamp(player.gauge + this.state.upgrades.dashGaugeGain, 0, player.maxGauge);
      }
      this.fxEvents.push({
        kind: "burst",
        x: player.x,
        y: player.y,
        radius: 64,
        color: 0xffd166
      });
      this.fxEvents.push({ kind: "sound", sound: "dash" });
    }

    const baseSpeed = getCharacter(this.state.characterId).speed;
    const slowMultiplier = player.movementSlowTime > 0 ? 0.52 : 1;
    const speed = (player.dashTime > 0 ? 760 : player.overdriveTime > 0 ? baseSpeed + 55 : baseSpeed) * slowMultiplier;
    const direction = player.dashTime > 0 ? player.facing : move;
    player.x = clamp(player.x + direction.x * speed * dt, 48, WORLD_WIDTH - 48);
    player.y = clamp(player.y + direction.y * speed * dt, 48, WORLD_HEIGHT - 48);
  }

  private updateSpawning(dt: number): void {
    const state = this.state;
    if (!state.waveActive || state.spawnQueue.length === 0) {
      return;
    }

    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      const type = state.spawnQueue.shift();
      if (type) {
        this.spawnEnemy(type);
      }
      state.spawnTimer = Math.max(0.28, 0.82 - state.waveIndex * 0.08);
    }
  }

  private updateSurvivalFlow(): void {
    const state = this.state;
    if (state.mode !== "survival" || state.pendingRewardIds.length > 0 || state.gameOver || state.victory) {
      return;
    }

    if (!state.survivalFinalBossSpawned && state.modeTime >= 540) {
      state.survivalFinalBossSpawned = true;
      state.stageName = "제로 존";
      state.spawnQueue.push("zero");
      state.waveActive = true;
      state.message = "제로 모션 난입";
      this.fxEvents.push({ kind: "sound", sound: "boss" });
      this.fxEvents.push({ kind: "shake", intensity: 0.018, duration: 320 });
    }

    if (state.modeTime >= state.survivalNextRewardAt && state.modeTime < 540) {
      state.survivalNextRewardAt += 60;
      state.pendingRewardIds = this.rollRewards(3);
      state.message = "생존 보상";
      return;
    }

    if (state.modeTime >= 600 && state.spawnQueue.length === 0 && state.enemies.length === 0) {
      state.victory = true;
      state.message = "10분 생존 완료";
      this.recordRunEnd(true);
      this.fxEvents.push({ kind: "burst", x: state.player.x, y: state.player.y, radius: 260, color: 0xb8ff5c, grade: "Perfect" });
      return;
    }

    if (!state.survivalFinalBossSpawned && state.spawnQueue.length === 0 && state.enemies.length < 9) {
      this.startSurvivalWave();
    }
  }

  private updateEnemies(dt: number): void {
    const state = this.state;
    const player = state.player;

    for (const enemy of state.enemies) {
      const toPlayer = { x: player.x - enemy.x, y: player.y - enemy.y };
      const dir = normalize(toPlayer);
      const dist = distance(enemy, player);
      const speedScale = enemy.slowTime > 0 ? 0.46 : 1;

      if (enemy.type === "dummy") {
        continue;
      } else if (enemy.type === "runner" || enemy.type === "swarm") {
        enemy.x += dir.x * enemy.speed * speedScale * dt;
        enemy.y += dir.y * enemy.speed * speedScale * dt;
      } else if (enemy.type === "shooter") {
        const desired = dist < 360 ? -1 : dist > 560 ? 1 : 0.2;
        enemy.x += dir.x * enemy.speed * speedScale * desired * dt;
        enemy.y += dir.y * enemy.speed * speedScale * desired * dt;
        if (enemy.shootCooldown <= 0 && dist < 760) {
          this.spawnProjectile({
            owner: "enemy",
            x: enemy.x,
            y: enemy.y,
            direction: dir,
            speed: 430,
            damage: 7,
            radius: 8,
            ttl: 3,
            color: 0xff5ea8
          });
          enemy.shootCooldown = randomRange(1.45, 2.2);
        }
      } else if (enemy.type === "tank") {
        enemy.x += dir.x * enemy.speed * speedScale * dt;
        enemy.y += dir.y * enemy.speed * speedScale * dt;
      } else if (enemy.type === "drum") {
        const desired = dist < 520 ? -0.28 : dist > 720 ? 0.42 : 0;
        enemy.x += dir.x * enemy.speed * speedScale * desired * dt;
        enemy.y += dir.y * enemy.speed * speedScale * desired * dt;
        if (enemy.pulseCooldown <= 0) {
          this.fireDrumPulse(enemy);
          this.startBossChallenge(enemy, {
            bossType: "drum",
            requiredGesture: "cross-guard",
            prompt: "팔을 X자로 교차해 리듬 반사를 카운터하세요",
            successEffect: "drum-counter",
            failDamage: 18,
            duration: 2.25
          });
          enemy.pulseCooldown = randomRange(6.4, 7.6);
        }
      } else if (enemy.type === "mirror") {
        const castingPressure = state.preparedSkill ? 1.6 : 1;
        const desired = dist < 430 ? -0.46 : dist > 690 ? 0.54 : 0.15;
        enemy.x += dir.x * enemy.speed * speedScale * desired * castingPressure * dt;
        enemy.y += dir.y * enemy.speed * speedScale * desired * castingPressure * dt;
        if (enemy.shootCooldown <= 0 && dist < 820) {
          this.fireMirrorFan(enemy, dir);
          enemy.shootCooldown = randomRange(1.25, 1.8);
        }
        if (enemy.pulseCooldown <= 0) {
          this.spawnMirrorClone(enemy);
          this.startBossChallenge(enemy, {
            bossType: "mirror",
            requiredGesture: "slash",
            prompt: "손을 날카롭게 휘둘러 거울 분신을 깨세요",
            successEffect: "mirror-shatter",
            failDamage: 4,
            duration: 2.05
          });
          enemy.pulseCooldown = randomRange(7.2, 8.6);
        }
      } else {
        const desired = dist < 470 ? -0.22 : dist > 660 ? 0.28 : 0;
        enemy.x += dir.x * enemy.speed * speedScale * desired * dt;
        enemy.y += dir.y * enemy.speed * speedScale * desired * dt;
        if (dist < 520) {
          player.gauge = clamp(player.gauge - 6 * dt, 0, player.maxGauge);
          player.dashCooldown = Math.max(player.dashCooldown, 0.15);
        }
        if (enemy.pulseCooldown <= 0) {
          const challenged = this.startBossChallenge(enemy, {
            bossType: "zero",
            requiredGesture: "open-arms",
            prompt: "양팔을 크게 벌려 제로 모션의 정지장을 깨세요",
            successEffect: "zero-release",
            failDamage: 22,
            duration: 2.45
          });
          if (!challenged) {
            this.fireZeroMotionPulse(enemy);
          }
          enemy.pulseCooldown = randomRange(6.7, 8.1);
        }
      }

      enemy.x = clamp(enemy.x, 28, WORLD_WIDTH - 28);
      enemy.y = clamp(enemy.y, 28, WORLD_HEIGHT - 28);

      if (enemy.type !== "drum" && dist < enemy.radius + player.radius && player.hurtCooldown <= 0) {
        this.damagePlayer(enemy.type === "zero" ? 13 : enemy.type === "mirror" ? 9 : enemy.type === "tank" ? 10 : enemy.type === "runner" ? 6 : 4);
        player.x = clamp(player.x + dir.x * -38, 48, WORLD_WIDTH - 48);
        player.y = clamp(player.y + dir.y * -38, 48, WORLD_HEIGHT - 48);
      }
    }
  }

  private updateTraps(dt: number): void {
    const state = this.state;
    const remaining: TrapState[] = [];

    for (const trap of state.traps) {
      trap.ttl -= dt;
      trap.pulseTimer -= dt;
      if (trap.ttl <= 0) {
        continue;
      }

      if (trap.pulseTimer <= 0) {
        trap.pulseTimer = trap.kind === "sweet-field" ? 0.55 : 0.48;
        for (const enemy of [...state.enemies]) {
          if (distance(trap, enemy) < trap.radius + enemy.radius) {
            enemy.slowTime = Math.max(enemy.slowTime, trap.kind === "sweet-field" ? 1.25 : 0.7);
            const markBonus = enemy.markedTime > 0 ? 1.45 : 1;
            this.damageEnemy(enemy, trap.damage * markBonus, trap.color);
          }
        }

        if (trap.kind === "sweet-field" && distance(trap, state.player) < trap.radius) {
          state.player.hp = clamp(state.player.hp + 3, 0, state.player.maxHp);
          state.player.shield = Math.max(state.player.shield, 8);
        }

        this.fxEvents.push({
          kind: "burst",
          x: trap.x,
          y: trap.y,
          radius: trap.radius,
          color: trap.color
        });
      }

      remaining.push(trap);
    }

    state.traps = remaining;
  }

  private updateAllies(dt: number): void {
    const state = this.state;
    const remaining: AllyState[] = [];

    for (const ally of state.allies) {
      ally.ttl -= dt;
      ally.attackCooldown = Math.max(0, ally.attackCooldown - dt);
      if (ally.ttl <= 0) {
        continue;
      }

      const target = this.findNearestEnemy(ally, ally.kind === "big-slime" ? 720 : 560);
      if (target) {
        const direction = normalize({ x: target.x - ally.x, y: target.y - ally.y });
        ally.x = clamp(ally.x + direction.x * ally.speed * dt, 36, WORLD_WIDTH - 36);
        ally.y = clamp(ally.y + direction.y * ally.speed * dt, 36, WORLD_HEIGHT - 36);

        if (distance(ally, target) < ally.radius + target.radius + 12 && ally.attackCooldown <= 0) {
          target.slowTime = Math.max(target.slowTime, ally.kind === "big-slime" ? 1.1 : 0.55);
          this.damageEnemy(target, ally.damage, ally.color);
          ally.attackCooldown = ally.kind === "big-slime" ? 0.42 : 0.62;
          this.fxEvents.push({
            kind: "burst",
            x: target.x,
            y: target.y,
            radius: ally.kind === "big-slime" ? 84 : 42,
            color: ally.color
          });
        }
      } else {
        const home = state.player;
        const distanceToPlayer = distance(ally, home);
        if (distanceToPlayer > 120) {
          const direction = normalize({ x: home.x - ally.x, y: home.y - ally.y });
          ally.x += direction.x * ally.speed * 0.45 * dt;
          ally.y += direction.y * ally.speed * 0.45 * dt;
        }
      }

      remaining.push(ally);
    }

    state.allies = remaining;
  }

  private updateProjectiles(dt: number): void {
    const state = this.state;
    const remaining: ProjectileState[] = [];

    for (const projectile of state.projectiles) {
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.ttl -= dt;
      if (projectile.ttl <= 0) {
        continue;
      }

      if (projectile.owner === "player") {
        const hit = state.enemies.find((enemy) => distance(projectile, enemy) < projectile.radius + enemy.radius);
        if (hit) {
          this.damageEnemy(hit, projectile.damage, projectile.color);
          continue;
        }
      } else if (state.player.shieldWallTime > 0 && distance(projectile, state.player) < state.player.radius + 165) {
        const away = normalize({ x: projectile.x - state.player.x, y: projectile.y - state.player.y });
        projectile.owner = "player";
        projectile.vx = away.x * Math.max(360, Math.abs(projectile.vx) * 1.2);
        projectile.vy = away.y * Math.max(360, Math.abs(projectile.vy) * 1.2);
        projectile.damage += 18;
        projectile.color = getCharacter(state.characterId).color;
      } else if (distance(projectile, state.player) < projectile.radius + state.player.radius) {
        this.damagePlayer(projectile.damage);
        continue;
      }

      if (projectile.x > -80 && projectile.x < WORLD_WIDTH + 80 && projectile.y > -80 && projectile.y < WORLD_HEIGHT + 80) {
        remaining.push(projectile);
      }
    }

    state.projectiles = remaining;
  }

  private updateBasicAttack(dt: number): void {
    const state = this.state;
    const player = state.player;
    player.attackTimer -= dt;
    if (player.attackTimer > 0) {
      return;
    }

    const attackInterval = 0.48 / state.upgrades.basicAttackRateMultiplier;
    player.attackTimer = attackInterval;

    const target = this.findNearestEnemy(player, 620);
    if (!target) {
      return;
    }

    const direction = normalize({ x: target.x - player.x, y: target.y - player.y });
    const character = getCharacter(state.characterId);
    this.spawnProjectile({
      owner: "player",
      x: player.x + direction.x * 28,
      y: player.y + direction.y * 28,
      direction,
      speed: 660 * state.upgrades.basicProjectileSpeedMultiplier,
      damage: character.basicDamage * state.upgrades.basicDamageMultiplier * this.getGlobalDamageMultiplier(),
      radius: 7 + Math.max(0, state.upgrades.basicProjectileSpeedMultiplier - 1) * 6,
      ttl: 1.2,
      color: character.basicColor
    });

    if (player.overdriveTime > 0) {
      this.damageEnemy(target, 7 * state.upgrades.overdriveDamageMultiplier, 0xd7ff3f);
      this.fxEvents.push({
        kind: "bolt",
        points: [
          { x: player.x, y: player.y },
          { x: target.x, y: target.y }
        ],
        color: 0xd7ff3f,
        grade: "Great"
      });
    }
  }

  private checkWaveComplete(): void {
    const state = this.state;
    if (state.mode === "training" || state.mode === "survival") {
      return;
    }
    if (!state.waveActive || state.spawnQueue.length > 0 || state.enemies.length > 0) {
      return;
    }

    state.waveActive = false;
    state.bossChallenge = null;
    state.projectiles = state.projectiles.filter((projectile) => projectile.owner === "player");

    if (state.mode === "adventure") {
      const clearResult = this.recordAdventureStageClear();
      const finalStageCleared = state.adventureStageIndex >= ADVENTURE_STAGES.length - 1;
      if (finalStageCleared) {
        state.victory = true;
        state.message = clearResult ? `Adventure ${clearResult.grade} Clear` : "Adventure cleared";
        this.recordRunEnd(true);
        this.fxEvents.push({
          kind: "burst",
          x: state.player.x,
          y: state.player.y,
          radius: 280,
          color: 0xffd166,
          grade: "Perfect"
        });
        return;
      }

      state.pendingRewardIds = this.rollRewards(3);
      state.message = clearResult ? `${state.adventureStageCode} ${clearResult.grade} CLEAR` : `${state.adventureStageCode} CLEAR`;
      this.fxEvents.push({
        kind: "float-text",
        x: state.player.x,
        y: state.player.y - 118,
        text: "STAGE CLEAR",
        color: 0xffd166
      });
      this.fxEvents.push({ kind: "sound", sound: "reward" });
      return;
    }

    if (state.mode === "boss-rush") {
      if (state.bossRushIndex >= bossRushPlan.length) {
        state.victory = true;
        state.message = "Boss Rush cleared";
        this.recordRunEnd(true);
        this.fxEvents.push({
          kind: "burst",
          x: state.player.x,
          y: state.player.y,
          radius: 260,
          color: 0xb8ff5c,
          grade: "Perfect"
        });
        return;
      }

      state.pendingRewardIds = this.rollRewards(3);
      state.message = "다음 보스 준비";
      return;
    }

    if (state.waveIndex >= wavePlans.length) {
      state.victory = true;
      state.message = "Loop City cleared";
      this.recordRunEnd(true);
      this.fxEvents.push({
        kind: "burst",
        x: state.player.x,
        y: state.player.y,
        radius: 220,
        color: 0xb8ff5c,
        grade: "Perfect"
      });
      return;
    }

    state.pendingRewardIds = this.rollRewards(3);
    state.message = "보상 선택";
  }

  private recordAdventureStageClear() {
    const state = this.state;
    const stage = ADVENTURE_STAGES[state.adventureStageIndex];
    if (!stage) {
      return null;
    }
    return this.progression?.recordAdventureStageClear({
      stageId: stage.id,
      score: Math.max(0, state.player.score - state.adventureStageStartScore),
      seconds: Math.max(1, state.modeTime - state.adventureStageStartTime),
      hpRatio: state.player.hp / state.player.maxHp
    }) ?? null;
  }

  private startMode(): void {
    if (this.state.mode === "training") {
      this.startTraining();
      return;
    }
    if (this.state.mode === "adventure") {
      this.startAdventure();
      return;
    }
    if (this.state.mode === "survival") {
      this.startSurvival();
      return;
    }
    if (this.state.mode === "boss-rush") {
      this.startBossRush();
      return;
    }
    this.startNextWave();
  }

  private startAdventure(): void {
    const state = this.state;
    state.waveIndex = 0;
    state.adventureStageIndex = this.progression?.getSelectedAdventureStageIndex() ?? 0;
    state.adventureStageTotal = ADVENTURE_STAGES.length;
    state.player.gauge = clamp(state.player.gauge + 18, 0, state.player.maxGauge);
    this.startAdventureStage();
  }

  private startAdventureStage(): void {
    const state = this.state;
    const stage = ADVENTURE_STAGES[state.adventureStageIndex];
    if (!stage) {
      state.victory = true;
      this.recordRunEnd(true);
      return;
    }

    state.stageName = stage.title;
    state.adventureStageCode = stage.code;
    state.adventureStageGoal = stage.goal;
    state.adventureStageEnemyTotal = stage.enemies.length;
    state.adventureStageStartTime = state.modeTime;
    state.adventureStageStartScore = state.player.score;
    state.waveIndex = state.adventureStageIndex + 1;
    state.spawnQueue = [...stage.enemies];
    state.waveActive = true;
    state.spawnTimer = 0.2;
    state.projectiles = state.projectiles.filter((projectile) => projectile.owner === "player");
    state.traps = [];
    state.message = stage.startMessage;
    state.player.gauge = clamp(state.player.gauge + 16, 0, state.player.maxGauge);
    this.fxEvents.push({
      kind: "float-text",
      x: state.player.x,
      y: state.player.y - 122,
      text: `AREA ${stage.code}`,
      color: 0xffd166
    });
    this.fxEvents.push({ kind: "sound", sound: stage.enemies.some((enemy) => enemy === "drum" || enemy === "mirror" || enemy === "zero") ? "boss" : "reward" });
  }

  private startTraining(): void {
    const state = this.state;
    state.waveActive = false;
    state.spawnQueue = [];
    state.spawnTimer = 0;
    state.stageName = "훈련장";
    state.player.gauge = state.player.maxGauge;
    state.player.hp = state.player.maxHp;
    state.message = "훈련장";

    const positions: Vector2[] = [
      { x: WORLD_WIDTH / 2 + 260, y: WORLD_HEIGHT / 2 },
      { x: WORLD_WIDTH / 2 - 260, y: WORLD_HEIGHT / 2 - 120 },
      { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 + 240 }
    ];
    state.enemies = positions.map((position) => ({
      id: this.nextEntityId++,
      type: "dummy",
      x: position.x,
      y: position.y,
      radius: 34,
      hp: 500,
      maxHp: 500,
      speed: 0,
      shootCooldown: 0,
      pulseCooldown: 0,
      markedTime: 0,
      slowTime: 0,
      hitFlash: 0
    }));
  }

  private startNextWave(): void {
    const state = this.state;
    if (state.waveIndex >= wavePlans.length) {
      state.victory = true;
      this.recordRunEnd(true);
      return;
    }

    state.spawnQueue = [...wavePlans[state.waveIndex]].sort(() => Math.random() - 0.5);
    state.waveIndex += 1;
    state.stageName = state.waveIndex < 5 ? "루프시티 거리" : "드럼 노이즈";
    state.waveActive = true;
    state.spawnTimer = 0.25;
    state.player.gauge = clamp(state.player.gauge + 18, 0, state.player.maxGauge);
    state.message = `Wave ${state.waveIndex}`;
  }

  private startSurvival(): void {
    const state = this.state;
    state.stageName = "루프시티 생존";
    state.waveIndex = 0;
    state.modeTime = 0;
    state.survivalNextRewardAt = 60;
    state.survivalFinalBossSpawned = false;
    state.player.gauge = state.player.maxGauge;
    this.startSurvivalWave();
  }

  private startSurvivalWave(): void {
    const state = this.state;
    state.waveIndex += 1;
    state.spawnQueue.push(...makeSurvivalWave(state.waveIndex));
    state.waveActive = true;
    state.spawnTimer = Math.min(state.spawnTimer, 0.2);
    state.message = `Survival ${state.waveIndex}`;
  }

  private startBossRush(): void {
    const state = this.state;
    state.stageName = "보스 러시";
    state.waveIndex = 0;
    state.bossRushIndex = 0;
    state.player.gauge = state.player.maxGauge;
    this.startNextBossRushBoss();
  }

  private startNextBossRushBoss(): void {
    const state = this.state;
    if (state.bossRushIndex >= bossRushPlan.length) {
      state.victory = true;
      this.recordRunEnd(true);
      return;
    }

    const boss = bossRushPlan[state.bossRushIndex];
    state.spawnQueue = [boss];
    state.bossRushIndex += 1;
    state.waveIndex = state.bossRushIndex;
    state.waveActive = true;
    state.spawnTimer = 0.2;
    state.player.gauge = clamp(state.player.gauge + 35, 0, state.player.maxGauge);
    state.message = bossDisplayName(boss);
  }

  private continueAfterReward(): void {
    if (this.state.mode === "adventure") {
      this.state.adventureStageIndex = Math.min(this.state.adventureStageIndex + 1, ADVENTURE_STAGES.length);
      this.startAdventureStage();
      return;
    }
    if (this.state.mode === "survival") {
      this.state.waveActive = true;
      this.state.message = "생존 재개";
      return;
    }
    if (this.state.mode === "boss-rush") {
      this.startNextBossRushBoss();
      return;
    }
    this.startNextWave();
  }

  private spawnEnemy(type: EnemyType): void {
    const side = Math.floor(Math.random() * 4);
    const margin = 70;
    const isBoss = type === "drum" || type === "mirror" || type === "zero";
    const x = isBoss
      ? clamp(this.state.player.x + randomRange(250, 340), margin, WORLD_WIDTH - margin)
      : side === 0
        ? margin
        : side === 1
          ? WORLD_WIDTH - margin
          : randomRange(margin, WORLD_WIDTH - margin);
    const y = isBoss
      ? clamp(this.state.player.y + randomRange(-20, 80), margin, WORLD_HEIGHT - margin)
      : side === 2
        ? margin
        : side === 3
          ? WORLD_HEIGHT - margin
          : randomRange(margin, WORLD_HEIGHT - margin);
    const waveScale = 1 + (this.state.waveIndex - 1) * 0.15;
    const stats = enemyStats(type, waveScale);
    const enemy: EnemyState = {
      id: this.nextEntityId++,
      type,
      x,
      y,
      radius: stats.radius,
      hp: stats.hp,
      maxHp: stats.hp,
      speed: randomRange(stats.speedMin, stats.speedMax),
      shootCooldown: randomRange(0.6, 1.6),
      pulseCooldown: randomRange(1.3, 2.2),
      markedTime: 0,
      slowTime: 0,
      hitFlash: 0
    };
    this.state.enemies.push(enemy);
    this.progression?.recordEnemySeen(type);
    if (this.state.dailyChallengeId === "accelerated-noise") {
      enemy.speed *= 1.22;
    }
    if (type === "drum" || type === "mirror" || type === "zero") {
      this.state.message = bossDisplayName(type);
      this.fxEvents.push({ kind: "sound", sound: "boss" });
      this.fxEvents.push({ kind: "shake", intensity: type === "zero" ? 0.018 : 0.012, duration: 240 });
    }
  }

  private spawnProjectile(config: {
    owner: "player" | "enemy";
    x: number;
    y: number;
    direction: Vector2;
    speed: number;
    damage: number;
    radius: number;
    ttl: number;
    color: number;
  }): void {
    this.state.projectiles.push({
      id: this.nextEntityId++,
      owner: config.owner,
      x: config.x,
      y: config.y,
      vx: config.direction.x * config.speed,
      vy: config.direction.y * config.speed,
      radius: config.radius,
      damage: config.damage,
      ttl: config.ttl,
      color: config.color
    });
  }

  private spawnTrap(config: {
    kind: TrapState["kind"];
    x: number;
    y: number;
    radius: number;
    damage: number;
    ttl: number;
    color: number;
  }): void {
    this.state.traps.push({
      id: this.nextEntityId++,
      kind: config.kind,
      x: clamp(config.x, 64, WORLD_WIDTH - 64),
      y: clamp(config.y, 64, WORLD_HEIGHT - 64),
      radius: config.radius,
      damage: config.damage,
      ttl: config.ttl,
      pulseTimer: 0.05,
      color: config.color
    });
  }

  private spawnAlly(config: {
    kind: AllyState["kind"];
    x: number;
    y: number;
    radius: number;
    ttl: number;
    speed: number;
    damage: number;
    color: number;
  }): void {
    this.state.allies.push({
      id: this.nextEntityId++,
      kind: config.kind,
      x: clamp(config.x, 48, WORLD_WIDTH - 48),
      y: clamp(config.y, 48, WORLD_HEIGHT - 48),
      radius: config.radius,
      ttl: config.ttl,
      speed: config.speed,
      damage: config.damage,
      attackCooldown: 0.15,
      color: config.color
    });
  }

  private resolveSkillEffect(skillId: string, grade: Exclude<CastGrade, "Miss">): void {
    if (skillId === "spark-slash") {
      this.castSparkSlash(grade);
    } else if (skillId === "lightning-dash") {
      this.castLightningDash(grade);
    } else if (skillId === "chain-bolt") {
      this.castChainBolt(grade);
    } else if (skillId === "thunder-overdrive") {
      this.castThunderOverdrive(grade);
    } else if (skillId === "dokkaebi-guard") {
      this.castDokkaebiGuard(grade);
    } else if (skillId === "shield-push") {
      this.castShieldPush(grade);
    } else if (skillId === "earth-drum") {
      this.castEarthDrum(grade);
    } else if (skillId === "giant-shield-wall") {
      this.castGiantShieldWall(grade);
    } else if (skillId === "glitch-mark") {
      this.castGlitchMark(grade);
    } else if (skillId === "shadow-cut") {
      this.castShadowCut(grade);
    } else if (skillId === "noise-trap") {
      this.castNoiseTrap(grade);
    } else if (skillId === "blackout") {
      this.castBlackout(grade);
    } else if (skillId === "jelly-bomb") {
      this.castJellyBomb(grade);
    } else if (skillId === "slime-summon") {
      this.castSlimeSummon(grade);
    } else if (skillId === "sweet-field") {
      this.castSweetField(grade);
    } else {
      this.castSlimeParty(grade);
    }
  }

  private castSparkSlash(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().Q;
    const direction = player.facing;
    const rangeBonus = player.comboRangeBonusTime > 0 ? 1.24 : 1;
    const range = (grade === "Perfect" ? 780 : grade === "Great" ? 690 : 610) * rangeBonus * state.upgrades.areaMultiplier * state.upgrades.slashRangeMultiplier;
    const width = (grade === "Perfect" ? 112 : grade === "Great" ? 88 : 70) * rangeBonus * state.upgrades.areaMultiplier * state.upgrades.slashWidthMultiplier;
    let damage = skill.damageByGrade[grade] * state.upgrades.slashDamageMultiplier * this.getSkillDamageMultiplier();
    if (player.dashBuffTime > 0) {
      damage *= state.upgrades.dashSkillDamageMultiplier;
    }

    let hits = 0;
    for (const enemy of [...state.enemies]) {
      const toEnemy = { x: enemy.x - player.x, y: enemy.y - player.y };
      const forward = dot(toEnemy, direction);
      if (forward > -20 && forward < range && perpendicularDistance(enemy, player, direction) < width) {
        hits += 1;
        this.damageEnemy(enemy, damage, skill.color);
      }
    }

    this.fxEvents.push({
      kind: "slash",
      x: player.x,
      y: player.y,
      angle: Math.atan2(direction.y, direction.x),
      length: range,
      color: skill.color,
      grade
    });
    this.fxEvents.push({ kind: "shake", intensity: grade === "Perfect" ? 0.012 : 0.006, duration: 130 });

    if (grade === "Perfect" && state.upgrades.slashDamageMultiplier > 1 && hits > 0) {
      for (const enemy of [...state.enemies].slice(0, 3)) {
        if (distance(enemy, player) < range + 120) {
          this.damageEnemy(enemy, damage * 0.35 * state.upgrades.slashExtraBurstDamageMultiplier, skill.color);
        }
      }
    }
  }

  private castLightningDash(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().E;
    const direction = player.facing;
    const start = { x: player.x, y: player.y };
    const length = (grade === "Perfect" ? 360 : grade === "Great" ? 310 : 250) * state.upgrades.dashLengthMultiplier;
    const hitWidth = 92 * state.upgrades.areaMultiplier * state.upgrades.dashStrikeWidthMultiplier;
    let damage = skill.damageByGrade[grade] * this.getSkillDamageMultiplier();
    if (player.dashBuffTime > 0) {
      damage *= state.upgrades.dashSkillDamageMultiplier;
    }

    player.x = clamp(player.x + direction.x * length, 48, WORLD_WIDTH - 48);
    player.y = clamp(player.y + direction.y * length, 48, WORLD_HEIGHT - 48);
    player.invulnerableTime = Math.max(player.invulnerableTime, grade === "Perfect" ? 0.65 : 0.32);
    if (state.upgrades.dashShield > 0) {
      player.shield = Math.max(player.shield, state.upgrades.dashShield);
    }

    for (const enemy of [...state.enemies]) {
      const toEnemy = { x: enemy.x - start.x, y: enemy.y - start.y };
      const forward = dot(toEnemy, direction);
      if (forward > -30 && forward < length + 60 && perpendicularDistance(enemy, start, direction) < hitWidth) {
        this.damageEnemy(enemy, damage, skill.color);
        if (state.upgrades.dashGaugeGain > 0) {
          player.gauge = clamp(player.gauge + state.upgrades.dashGaugeGain * 0.5, 0, player.maxGauge);
        }
      }
    }

    this.fxEvents.push({
      kind: "bolt",
      points: [start, { x: player.x, y: player.y }],
      color: skill.color,
      grade
    });
    this.fxEvents.push({ kind: "shake", intensity: grade === "Perfect" ? 0.01 : 0.006, duration: 110 });
  }

  private castChainBolt(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().R;
    const comboBonus = player.comboRangeBonusTime > 0 ? 2 : 0;
    const maxTargets = (grade === "Perfect" ? 7 : grade === "Great" ? 5 : 3) + state.upgrades.chainExtraTargets + comboBonus;
    let damage = skill.damageByGrade[grade] * state.upgrades.chainDamageMultiplier * this.getSkillDamageMultiplier();
    if (player.dashBuffTime > 0) {
      damage *= state.upgrades.dashSkillDamageMultiplier;
    }

    const targets: EnemyState[] = [];
    let origin: Vector2 = player;
    const available = [...state.enemies];

    while (targets.length < maxTargets && available.length > 0) {
      available.sort((a, b) => distance(origin, a) - distance(origin, b));
      const next = available.shift();
      if (!next || distance(origin, next) > 620) {
        break;
      }
      targets.push(next);
      origin = next;
    }

    const points: Vector2[] = [{ x: player.x, y: player.y }];
    for (const target of targets) {
      points.push({ x: target.x, y: target.y });
      this.damageEnemy(target, damage, skill.color);
      damage *= state.upgrades.chainDecayMultiplier;
    }

    this.fxEvents.push({
      kind: "bolt",
      points,
      color: skill.color,
      grade
    });
    this.fxEvents.push({
      kind: "burst",
      x: player.x,
      y: player.y,
      radius: grade === "Perfect" ? 120 : 82,
      color: skill.color,
      grade
    });
    this.fxEvents.push({ kind: "shake", intensity: grade === "Perfect" ? 0.014 : 0.007, duration: 140 });
  }

  private castThunderOverdrive(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().F;
    const duration = (grade === "Perfect" ? 12 : grade === "Great" ? 9.5 : 7) + state.upgrades.overdriveDurationBonus;
    const radius = (grade === "Perfect" ? 620 : grade === "Great" ? 510 : 420) * state.upgrades.areaMultiplier;
    const damage = skill.damageByGrade[grade] * this.getSkillDamageMultiplier();

    player.overdriveTime = Math.max(player.overdriveTime, duration);
    player.invulnerableTime = Math.max(player.invulnerableTime, 0.8);
    player.shield = Math.max(player.shield, grade === "Perfect" ? 36 : 22);
    if (state.upgrades.overdriveGaugeRefund > 0) {
      player.gauge = clamp(player.gauge + state.upgrades.overdriveGaugeRefund, 0, player.maxGauge);
    }

    for (const enemy of [...state.enemies]) {
      if (distance(player, enemy) < radius) {
        this.damageEnemy(enemy, damage, skill.color);
      }
    }

    this.fxEvents.push({
      kind: "burst",
      x: player.x,
      y: player.y,
      radius,
      color: skill.color,
      grade
    });
    this.fxEvents.push({
      kind: "float-text",
      x: player.x,
      y: player.y - 92,
      text: "OVERDRIVE",
      color: skill.color
    });
    this.fxEvents.push({ kind: "shake", intensity: grade === "Perfect" ? 0.02 : 0.014, duration: 260 });
  }

  private castDokkaebiGuard(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().Q;
    const shieldGain = (grade === "Perfect" ? 46 : grade === "Great" ? 34 : 24) * state.upgrades.guardShieldMultiplier;
    const radius = (grade === "Perfect" ? 220 : grade === "Great" ? 170 : 130) * state.upgrades.areaMultiplier;
    player.shield = Math.max(player.shield, shieldGain);
    player.guardCharge = Math.max(player.guardCharge, (shieldGain + skill.damageByGrade[grade]) * state.upgrades.guardChargeMultiplier);
    player.invulnerableTime = Math.max(player.invulnerableTime, grade === "Perfect" ? 1 : 0.55);
    if (state.upgrades.guardHeal > 0) {
      player.hp = clamp(player.hp + state.upgrades.guardHeal, 0, player.maxHp);
    }

    for (const projectile of state.projectiles) {
      if (projectile.owner === "enemy" && distance(projectile, player) < radius) {
        projectile.owner = "player";
        projectile.vx *= -1.25;
        projectile.vy *= -1.25;
        projectile.color = skill.color;
        projectile.damage += (grade === "Perfect" ? 18 : 9) + state.upgrades.reflectDamageBonus;
      }
    }

    this.fxEvents.push({
      kind: "burst",
      x: player.x,
      y: player.y,
      radius,
      color: skill.color,
      grade
    });
    this.fxEvents.push({
      kind: "float-text",
      x: player.x,
      y: player.y - 88,
      text: "GUARD",
      color: skill.color
    });
    this.fxEvents.push({ kind: "shake", intensity: 0.008, duration: 120 });
  }

  private castShieldPush(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().E;
    const direction = player.facing;
    const range = (grade === "Perfect" ? 520 : grade === "Great" ? 440 : 360) * state.upgrades.areaMultiplier * state.upgrades.shieldPushRangeMultiplier;
    const width = (grade === "Perfect" ? 145 : grade === "Great" ? 118 : 94) * state.upgrades.areaMultiplier;
    const reflected = player.guardCharge * (grade === "Perfect" ? 0.9 : 0.55);
    const damage = (skill.damageByGrade[grade] + reflected) * this.getSkillDamageMultiplier();
    const knockback = (grade === "Perfect" ? 180 : 120) * state.upgrades.pushKnockbackMultiplier;

    for (const enemy of [...state.enemies]) {
      const toEnemy = { x: enemy.x - player.x, y: enemy.y - player.y };
      const forward = dot(toEnemy, direction);
      if (forward > -30 && forward < range && perpendicularDistance(enemy, player, direction) < width) {
        enemy.x = clamp(enemy.x + direction.x * knockback, 28, WORLD_WIDTH - 28);
        enemy.y = clamp(enemy.y + direction.y * knockback, 28, WORLD_HEIGHT - 28);
        this.damageEnemy(enemy, damage, skill.color);
      }
    }

    player.guardCharge = 0;
    this.fxEvents.push({
      kind: "slash",
      x: player.x,
      y: player.y,
      angle: Math.atan2(direction.y, direction.x),
      length: range,
      color: skill.color,
      grade
    });
    this.fxEvents.push({ kind: "shake", intensity: grade === "Perfect" ? 0.016 : 0.01, duration: 170 });
  }

  private castEarthDrum(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().R;
    const radius = (grade === "Perfect" ? 430 : grade === "Great" ? 345 : 270) * state.upgrades.areaMultiplier * state.upgrades.earthDrumRadiusMultiplier;
    const damage = skill.damageByGrade[grade] * state.upgrades.earthDrumDamageMultiplier * this.getSkillDamageMultiplier();

    for (const enemy of [...state.enemies]) {
      const dist = distance(player, enemy);
      if (dist < radius) {
        const away = normalize({ x: enemy.x - player.x, y: enemy.y - player.y });
        enemy.x = clamp(enemy.x + away.x * (grade === "Perfect" ? 150 : 90), 28, WORLD_WIDTH - 28);
        enemy.y = clamp(enemy.y + away.y * (grade === "Perfect" ? 150 : 90), 28, WORLD_HEIGHT - 28);
        this.damageEnemy(enemy, damage * (1 - dist / radius * 0.25), skill.color);
      }
    }

    this.fxEvents.push({
      kind: "burst",
      x: player.x,
      y: player.y,
      radius,
      color: skill.color,
      grade
    });
    this.fxEvents.push({ kind: "shake", intensity: grade === "Perfect" ? 0.019 : 0.012, duration: 220 });
  }

  private castGiantShieldWall(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().F;
    const radius = (grade === "Perfect" ? 520 : grade === "Great" ? 430 : 340) * state.upgrades.areaMultiplier * state.upgrades.shieldWallRadiusMultiplier;
    const duration = (grade === "Perfect" ? 9 : grade === "Great" ? 7 : 5.5) + state.upgrades.shieldWallDurationBonus;
    const damage = skill.damageByGrade[grade] * this.getSkillDamageMultiplier();

    player.shield = Math.max(player.shield, grade === "Perfect" ? 72 : 50);
    player.shieldWallTime = Math.max(player.shieldWallTime, duration);
    player.invulnerableTime = Math.max(player.invulnerableTime, 1);

    for (const projectile of state.projectiles) {
      if (projectile.owner === "enemy" && distance(projectile, player) < radius) {
        projectile.owner = "player";
        projectile.vx *= -1.45;
        projectile.vy *= -1.45;
        projectile.damage += damage + state.upgrades.reflectDamageBonus + state.upgrades.shieldWallReflectBonus;
        projectile.color = skill.color;
      }
    }

    for (const enemy of [...state.enemies]) {
      if (distance(player, enemy) < radius * 0.72) {
        this.damageEnemy(enemy, damage, skill.color);
      }
    }

    this.fxEvents.push({
      kind: "burst",
      x: player.x,
      y: player.y,
      radius,
      color: skill.color,
      grade
    });
    this.fxEvents.push({
      kind: "float-text",
      x: player.x,
      y: player.y - 96,
      text: "SHIELD WALL",
      color: skill.color
    });
    this.fxEvents.push({ kind: "shake", intensity: grade === "Perfect" ? 0.017 : 0.011, duration: 240 });
  }

  private castGlitchMark(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().Q;
    const maxTargets = (grade === "Perfect" ? 3 : grade === "Great" ? 2 : 1) + state.upgrades.markExtraTargets;
    const targets = [...state.enemies]
      .sort((a, b) => distance(player, a) - distance(player, b))
      .slice(0, maxTargets);

    for (const target of targets) {
      target.markedTime = (grade === "Perfect" ? 9 : grade === "Great" ? 7 : 5) + state.upgrades.markDurationBonus;
      target.slowTime = Math.max(target.slowTime, grade === "Perfect" ? 1.2 : 0.7);
      this.damageEnemy(target, skill.damageByGrade[grade] * state.upgrades.markDamageMultiplier * this.getSkillDamageMultiplier(), skill.color);
      this.fxEvents.push({
        kind: "bolt",
        points: [
          { x: player.x, y: player.y },
          { x: target.x, y: target.y }
        ],
        color: skill.color,
        grade
      });
      this.fxEvents.push({
        kind: "float-text",
        x: target.x,
        y: target.y - 50,
        text: "MARK",
        color: skill.color
      });
    }

    if (targets.length === 0) {
      this.fxEvents.push({ kind: "burst", x: player.x, y: player.y, radius: 80, color: skill.color, grade });
    }
  }

  private castShadowCut(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().E;
    const marked = state.enemies.filter((enemy) => enemy.markedTime > 0);
    const targets =
      marked.length > 0
        ? marked.slice(0, (grade === "Perfect" ? 5 : grade === "Great" ? 3 : 2) + state.upgrades.shadowCutExtraTargets)
        : this.findNearestEnemy(player, 780)
          ? [this.findNearestEnemy(player, 780) as EnemyState]
          : [];
    const start = { x: player.x, y: player.y };
    const damage = skill.damageByGrade[grade] * state.upgrades.shadowCutDamageMultiplier * this.getSkillDamageMultiplier();

    for (const target of targets) {
      const markedBonus = target.markedTime > 0 ? 1.55 * state.upgrades.markedDamageMultiplier : 1;
      this.damageEnemy(target, damage * markedBonus, skill.color);
      target.markedTime = Math.max(0, target.markedTime - 3);
      target.slowTime = Math.max(target.slowTime, 0.8);
      this.fxEvents.push({
        kind: "slash",
        x: target.x,
        y: target.y,
        angle: Math.atan2(target.y - player.y, target.x - player.x),
        length: 160,
        color: skill.color,
        grade
      });
    }

    if (targets[0]) {
      const away = normalize({ x: player.x - targets[0].x, y: player.y - targets[0].y });
      player.x = clamp(targets[0].x + away.x * 92, 48, WORLD_WIDTH - 48);
      player.y = clamp(targets[0].y + away.y * 92, 48, WORLD_HEIGHT - 48);
      player.invulnerableTime = Math.max(player.invulnerableTime, grade === "Perfect" ? 0.7 : 0.4);
      this.fxEvents.push({ kind: "bolt", points: [start, { x: player.x, y: player.y }], color: skill.color, grade });
    }

    this.fxEvents.push({ kind: "shake", intensity: grade === "Perfect" ? 0.014 : 0.008, duration: 130 });
  }

  private castNoiseTrap(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().R;
    const target = this.findNearestEnemy(player, 720);
    const origin = target ?? {
      x: player.x + player.facing.x * 230,
      y: player.y + player.facing.y * 230
    };
    const radius = (grade === "Perfect" ? 250 : grade === "Great" ? 205 : 165) * state.upgrades.areaMultiplier * state.upgrades.trapRadiusMultiplier;
    const damage = skill.damageByGrade[grade] * state.upgrades.trapDamageMultiplier * this.getSkillDamageMultiplier();
    const overlapping = state.traps.filter((trap) => trap.kind === "noise-trap" && distance(trap, origin) < radius);

    if (overlapping.length > 0) {
      const blastRadius = radius * 1.55;
      for (const enemy of [...state.enemies]) {
        if (distance(enemy, origin) < blastRadius + enemy.radius) {
          this.damageEnemy(enemy, damage * 1.9, skill.color);
          enemy.slowTime = Math.max(enemy.slowTime, 1.4);
        }
      }
      state.traps = state.traps.filter((trap) => !overlapping.includes(trap));
      this.fxEvents.push({ kind: "burst", x: origin.x, y: origin.y, radius: blastRadius, color: skill.color, grade });
      this.fxEvents.push({ kind: "shake", intensity: 0.015, duration: 160 });
      return;
    }

    this.spawnTrap({
      kind: "noise-trap",
      x: origin.x,
      y: origin.y,
      radius,
      damage,
      ttl: (grade === "Perfect" ? 8 : grade === "Great" ? 6.5 : 5) + state.upgrades.trapTtlBonus,
      color: skill.color
    });
  }

  private castBlackout(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().F;
    const radius = (grade === "Perfect" ? 980 : grade === "Great" ? 820 : 680) * state.upgrades.areaMultiplier * state.upgrades.blackoutRadiusMultiplier;
    const damage = skill.damageByGrade[grade] * this.getSkillDamageMultiplier();

    player.invulnerableTime = Math.max(player.invulnerableTime, grade === "Perfect" ? 1.4 : 0.8);
    for (const enemy of [...state.enemies]) {
      if (distance(player, enemy) < radius) {
        enemy.markedTime = Math.max(enemy.markedTime, grade === "Perfect" ? 10 : 7);
        enemy.slowTime = Math.max(enemy.slowTime, (grade === "Perfect" ? 4.8 : 3.2) + state.upgrades.blackoutSlowBonus);
        this.damageEnemy(enemy, damage, skill.color);
      }
    }

    this.fxEvents.push({ kind: "burst", x: player.x, y: player.y, radius, color: skill.color, grade });
    this.fxEvents.push({
      kind: "float-text",
      x: player.x,
      y: player.y - 94,
      text: "BLACKOUT",
      color: 0xc7b8ff
    });
    this.fxEvents.push({ kind: "shake", intensity: grade === "Perfect" ? 0.021 : 0.014, duration: 250 });
  }

  private castJellyBomb(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().Q;
    const target = this.findNearestEnemy(player, 760);
    const origin = target ?? {
      x: player.x + player.facing.x * 320,
      y: player.y + player.facing.y * 320
    };
    const radius = (grade === "Perfect" ? 310 : grade === "Great" ? 245 : 190) * state.upgrades.areaMultiplier * state.upgrades.jellyRadiusMultiplier;
    const damage = skill.damageByGrade[grade] * state.upgrades.jellyDamageMultiplier * this.getSkillDamageMultiplier();

    for (const enemy of [...state.enemies]) {
      if (distance(enemy, origin) < radius + enemy.radius) {
        this.damageEnemy(enemy, damage, skill.color);
        enemy.slowTime = Math.max(enemy.slowTime, 0.5);
      }
    }

    if (grade === "Perfect") {
      player.hp = clamp(player.hp + 8 + state.upgrades.jellyHealBonus, 0, player.maxHp);
      player.shield = Math.max(player.shield, 14);
    }
    if (state.upgrades.jellySweetFieldRadius > 0) {
      this.spawnTrap({
        kind: "sweet-field",
        x: origin.x,
        y: origin.y,
        radius: state.upgrades.jellySweetFieldRadius,
        damage: 6 * state.upgrades.jellyDamageMultiplier,
        ttl: 4.5,
        color: 0x7dffb2
      });
    }

    this.fxEvents.push({ kind: "burst", x: origin.x, y: origin.y, radius, color: skill.color, grade });
    this.fxEvents.push({ kind: "shake", intensity: grade === "Perfect" ? 0.012 : 0.007, duration: 120 });
  }

  private castSlimeSummon(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().E;
    const count = (grade === "Perfect" ? 4 : grade === "Great" ? 3 : 2) + state.upgrades.slimeSummonBonus;

    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + randomRange(-0.28, 0.28);
      this.spawnAlly({
        kind: "slime",
        x: player.x + Math.cos(angle) * 62,
        y: player.y + Math.sin(angle) * 62,
        radius: 17,
        ttl: (grade === "Perfect" ? 20 : grade === "Great" ? 16 : 12) + state.upgrades.slimeTtlBonus,
        speed: 185,
        damage: skill.damageByGrade[grade] * state.upgrades.slimeDamageMultiplier * this.getSkillDamageMultiplier(),
        color: skill.color
      });
    }

    this.fxEvents.push({ kind: "burst", x: player.x, y: player.y, radius: 150, color: skill.color, grade });
  }

  private castSweetField(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().R;
    const radius = (grade === "Perfect" ? 360 : grade === "Great" ? 300 : 240) * state.upgrades.areaMultiplier * state.upgrades.sweetFieldRadiusMultiplier;
    this.spawnTrap({
      kind: "sweet-field",
      x: player.x,
      y: player.y,
      radius,
      damage: skill.damageByGrade[grade] * this.getSkillDamageMultiplier(),
      ttl: grade === "Perfect" ? 9 : grade === "Great" ? 7 : 5.5,
      color: skill.color
    });
    player.hp = clamp(player.hp + (grade === "Perfect" ? 16 : grade === "Great" ? 10 : 6) + state.upgrades.sweetFieldHealBonus, 0, player.maxHp);
    player.shield = Math.max(player.shield, grade === "Perfect" ? 26 : 14);
  }

  private castSlimeParty(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().F;
    const radius = (grade === "Perfect" ? 620 : grade === "Great" ? 510 : 420) * state.upgrades.areaMultiplier;
    const damage = skill.damageByGrade[grade] * this.getSkillDamageMultiplier();

    for (const enemy of [...state.enemies]) {
      if (distance(player, enemy) < radius + enemy.radius) {
        this.damageEnemy(enemy, damage, skill.color);
        enemy.slowTime = Math.max(enemy.slowTime, 1.2);
      }
    }

    this.spawnAlly({
      kind: "big-slime",
      x: player.x + player.facing.x * 90,
      y: player.y + player.facing.y * 90,
      radius: 42,
      ttl: (grade === "Perfect" ? 16 : grade === "Great" ? 12 : 9) + state.upgrades.bigSlimeTtlBonus + state.upgrades.slimeTtlBonus,
      speed: 135,
      damage: damage * 0.55 * state.upgrades.bigSlimeDamageMultiplier * state.upgrades.slimeDamageMultiplier,
      color: skill.color
    });

    const smallCount = (grade === "Perfect" ? 5 : grade === "Great" ? 3 : 2) + state.upgrades.slimePartyBonus;
    for (let index = 0; index < smallCount; index += 1) {
      const angle = (Math.PI * 2 * index) / smallCount;
      this.spawnAlly({
        kind: "slime",
        x: player.x + Math.cos(angle) * 92,
        y: player.y + Math.sin(angle) * 92,
        radius: 17,
        ttl: 14 + state.upgrades.slimeTtlBonus,
        speed: 195,
        damage: 18 * state.upgrades.slimeDamageMultiplier,
        color: 0x7dffb2
      });
    }

    this.fxEvents.push({ kind: "burst", x: player.x, y: player.y, radius, color: skill.color, grade });
    this.fxEvents.push({
      kind: "float-text",
      x: player.x,
      y: player.y - 96,
      text: "SLIME PARTY",
      color: skill.color
    });
    this.fxEvents.push({ kind: "shake", intensity: grade === "Perfect" ? 0.02 : 0.013, duration: 240 });
  }

  private applyPerfectComboBonus(): void {
    const player = this.state.player;
    if (player.comboPerfect === 2) {
      player.gauge = clamp(player.gauge + (10 + this.state.upgrades.perfectGaugeBonus) * this.state.upgrades.gaugeGainMultiplier, 0, player.maxGauge);
      this.fxEvents.push({
        kind: "float-text",
        x: player.x,
        y: player.y - 92,
        text: "CORE +",
        color: 0xb8ff5c
      });
    }
    if (player.comboPerfect === 3) {
      player.comboRangeBonusTime = 8;
      this.fxEvents.push({
        kind: "float-text",
        x: player.x,
        y: player.y - 106,
        text: "RANGE UP",
        color: 0x48f7ff
      });
    }
    if (player.comboPerfect === 5) {
      const comboLines: Record<CharacterId, string> = {
        rio: "나 따라올 수 있으면 따라와 봐!",
        maru: "무서워도... 도망치진 않아!",
        neon: "네 움직임, 나쁘지 않아.",
        cookie: "맛은 보장 못 해!"
      };
      this.state.message = comboLines[this.state.characterId];
      this.fxEvents.push({
        kind: "float-text",
        x: player.x,
        y: player.y - 120,
        text: getCharacter(this.state.characterId).name,
        color: getCharacter(this.state.characterId).color
      });
    }
    if (player.comboPerfect === 7) {
      player.overdriveTime = Math.max(player.overdriveTime, 5);
      this.fxEvents.push({
        kind: "burst",
        x: player.x,
        y: player.y,
        radius: 180,
        color: 0xd7ff3f,
        grade: "Perfect"
      });
    }
  }

  private getGlobalDamageMultiplier(): number {
    const player = this.state.player;
    const overdrive = player.overdriveTime > 0 ? 1.28 * this.state.upgrades.overdriveDamageMultiplier : 1;
    const focus = this.state.activeCoreId === "focus-core" ? 1 + Math.max(0, player.sameSkillChain - 1) * 0.11 : 1;
    const sameSkill = 1 + Math.max(0, player.sameSkillChain - 1) * this.state.upgrades.sameSkillDamageBonus;
    const lowHp = player.hp / player.maxHp < 0.45 ? 1 + this.state.upgrades.lowHpDamageBonus : 1;
    const shielded = player.shield > 0 ? 1 + this.state.upgrades.shieldedDamageBonus : 1;
    const rampage =
      this.state.activeCoreId === "rampage-core" && player.hp / player.maxHp < 0.45
        ? 1.35
        : 1;
    return this.state.upgrades.globalDamageMultiplier * overdrive * focus * sameSkill * lowHp * shielded * rampage;
  }

  private getSkillDamageMultiplier(): number {
    return this.getGlobalDamageMultiplier() * this.state.upgrades.skillDamageMultiplier;
  }

  private startBossChallenge(
    enemy: EnemyState,
    challenge: Omit<BossChallengeState, "expiresAt"> & { duration: number }
  ): boolean {
    const state = this.state;
    if (state.bossChallenge || state.gameOver || state.victory || state.pendingRewardIds.length > 0) {
      return false;
    }

    state.preparedSkill = null;
    state.bossChallenge = {
      bossType: challenge.bossType,
      requiredGesture: challenge.requiredGesture,
      prompt: challenge.prompt,
      expiresAt: state.time + challenge.duration,
      successEffect: challenge.successEffect,
      failDamage: challenge.failDamage
    };
    state.message = "Boss Pose Break";
    this.fxEvents.push({ kind: "sound", sound: "boss" });
    this.fxEvents.push({ kind: "shake", intensity: 0.01, duration: 170 });
    this.fxEvents.push({
      kind: "float-text",
      x: enemy.x,
      y: enemy.y - 104,
      text: "POSE BREAK",
      color: challenge.bossType === "drum" ? 0xffd166 : challenge.bossType === "mirror" ? 0x48f7ff : 0xc7b8ff
    });
    return true;
  }

  private succeedBossChallenge(challenge: BossChallengeState, grade: Exclude<CastGrade, "Miss">): CastResponse {
    const state = this.state;
    let line = "";
    if (challenge.successEffect === "drum-counter") {
      const reflected = this.resolveDrumChallenge(grade);
      line = grade === "Perfect" ? `리듬 반사 Perfect! ${reflected}발 역반사` : `리듬 반사 성공! ${reflected}발 역반사`;
    } else if (challenge.successEffect === "mirror-shatter") {
      const shattered = this.resolveMirrorChallenge(grade);
      line = grade === "Perfect" ? `거울 분신 완전 파쇄! ${shattered}개 제거` : `거울 분신 파쇄! ${shattered}개 제거`;
    } else {
      this.resolveZeroChallenge(grade);
      line = grade === "Perfect" ? "제로 모션 해방! 잠시 무한 게이지" : "제로 모션 해방! 코어 게이지 회복";
    }

    state.message = line;
    this.fxEvents.push({
      kind: "float-text",
      x: state.player.x,
      y: state.player.y - 96,
      text: grade === "Perfect" ? "PERFECT COUNTER" : "COUNTER",
      color: grade === "Perfect" ? 0xffd166 : 0x48f7ff
    });
    this.fxEvents.push({ kind: "sound", sound: grade === "Perfect" ? "perfect" : "great", grade });
    return { ok: true, line };
  }

  private failBossChallenge(challenge: BossChallengeState): CastResponse {
    const state = this.state;
    const player = state.player;
    player.invulnerableTime = 0;
    player.hurtCooldown = 0;

    if (challenge.bossType === "mirror") {
      player.controlReverseTime = Math.max(player.controlReverseTime, 3.2);
      player.movementSlowTime = Math.max(player.movementSlowTime, 1.8);
      if (challenge.failDamage > 0) {
        this.damagePlayer(challenge.failDamage);
      }
      state.message = "거울 반전: 이동이 뒤틀립니다";
    } else if (challenge.bossType === "zero") {
      player.gauge = 0;
      this.damagePlayer(challenge.failDamage);
      state.message = "제로 모션: 코어 게이지가 비었습니다";
      const boss = this.findBoss(challenge.bossType);
      if (boss) {
        this.fireZeroMotionPulse(boss);
      }
    } else {
      this.damagePlayer(challenge.failDamage);
      state.message = "드럼 비트에 밀려났습니다";
    }

    this.fxEvents.push({
      kind: "float-text",
      x: player.x,
      y: player.y - 92,
      text: "BREAK FAIL",
      color: 0xff5ea8
    });
    this.fxEvents.push({ kind: "sound", sound: "hit" });
    return { ok: true, line: state.message };
  }

  private resolveDrumChallenge(grade: Exclude<CastGrade, "Miss">): number {
    const state = this.state;
    const boss = this.findBoss("drum");
    const reflectedLimit = grade === "Perfect" ? 10 : grade === "Great" ? 7 : 5;
    let reflected = 0;

    if (boss) {
      boss.slowTime = Math.max(boss.slowTime, grade === "Perfect" ? 4 : grade === "Great" ? 3 : 2.2);
      boss.pulseCooldown = Math.max(boss.pulseCooldown, 4.5);
      this.damageEnemy(boss, grade === "Perfect" ? 180 : grade === "Great" ? 128 : 88, 0xffd166);
    }

    for (const projectile of state.projectiles) {
      if (reflected >= reflectedLimit || projectile.owner !== "enemy") {
        continue;
      }
      if (distance(projectile, state.player) > 760) {
        continue;
      }
      const target = boss ?? state.player;
      const dir = normalize({ x: target.x - projectile.x, y: target.y - projectile.y });
      projectile.owner = "player";
      projectile.vx = dir.x * (grade === "Perfect" ? 620 : 520);
      projectile.vy = dir.y * (grade === "Perfect" ? 620 : 520);
      projectile.damage = grade === "Perfect" ? 28 : grade === "Great" ? 22 : 17;
      projectile.ttl = Math.max(projectile.ttl, 1.4);
      projectile.color = 0xfff0a3;
      reflected += 1;
    }

    if (boss && grade === "Perfect") {
      for (const enemy of [...state.enemies]) {
        if (enemy.id !== boss.id && distance(enemy, boss) < 260) {
          this.damageEnemy(enemy, 54, 0xffd166);
        }
      }
      this.fxEvents.push({ kind: "burst", x: boss.x, y: boss.y, radius: 310, color: 0xffd166, grade });
      this.fxEvents.push({ kind: "shake", intensity: 0.018, duration: 240 });
    }

    return reflected;
  }

  private resolveMirrorChallenge(grade: Exclude<CastGrade, "Miss">): number {
    const state = this.state;
    const boss = this.findBoss("mirror");
    const origin = boss ?? state.player;
    const limit = grade === "Perfect" ? 8 : grade === "Great" ? 5 : 3;
    const clones = [...state.enemies]
      .filter((enemy) => enemy.type === "runner" || enemy.type === "swarm")
      .map((enemy) => ({ enemy, range: distance(enemy, origin) }))
      .filter((item) => item.range < 760)
      .sort((a, b) => a.range - b.range)
      .slice(0, limit);

    for (const { enemy } of clones) {
      this.damageEnemy(enemy, enemy.hp + 20, 0x48f7ff);
    }
    if (boss) {
      boss.pulseCooldown = Math.max(boss.pulseCooldown, 4);
      this.damageEnemy(boss, grade === "Perfect" ? 145 : grade === "Great" ? 105 : 72, 0x48f7ff);
      this.fxEvents.push({ kind: "burst", x: boss.x, y: boss.y, radius: grade === "Perfect" ? 260 : 190, color: 0x48f7ff, grade });
    }
    if (grade === "Perfect") {
      state.projectiles = state.projectiles.filter((projectile) => projectile.owner !== "enemy" || distance(projectile, origin) > 540);
    }

    return clones.length;
  }

  private resolveZeroChallenge(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const boss = this.findBoss("zero");
    player.gauge = clamp(player.gauge + (grade === "Perfect" ? player.maxGauge : grade === "Great" ? 70 : 48), 0, player.maxGauge);
    if (grade === "Perfect") {
      player.infiniteGaugeTime = Math.max(player.infiniteGaugeTime, 4.2);
      for (const slot of Object.keys(state.cooldowns) as SkillSlot[]) {
        state.cooldowns[slot] = Math.max(0, state.cooldowns[slot] - 2.5);
      }
    }
    if (boss) {
      boss.pulseCooldown = Math.max(boss.pulseCooldown, 5);
      this.damageEnemy(boss, grade === "Perfect" ? 160 : grade === "Great" ? 116 : 78, 0xc7b8ff);
      this.fxEvents.push({ kind: "burst", x: boss.x, y: boss.y, radius: grade === "Perfect" ? 330 : 230, color: 0xc7b8ff, grade });
    }
    this.fxEvents.push({ kind: "shake", intensity: grade === "Perfect" ? 0.02 : 0.012, duration: 240 });
  }

  private findBoss(type: BossChallengeState["bossType"]): EnemyState | null {
    return this.state.enemies.find((enemy) => enemy.type === type) ?? null;
  }

  private fireDrumPulse(enemy: EnemyState): void {
    const count = 14;
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count;
      this.spawnProjectile({
        owner: "enemy",
        x: enemy.x + Math.cos(angle) * 42,
        y: enemy.y + Math.sin(angle) * 42,
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        speed: 260,
        damage: 9,
        radius: 10,
        ttl: 3.8,
        color: 0xffd166
      });
    }
    this.fxEvents.push({
      kind: "burst",
      x: enemy.x,
      y: enemy.y,
      radius: 190,
      color: 0xffd166,
      grade: "Great"
    });
    this.fxEvents.push({ kind: "sound", sound: "boss" });
  }

  private fireMirrorFan(enemy: EnemyState, direction: Vector2): void {
    const baseAngle = Math.atan2(direction.y, direction.x);
    for (let index = -2; index <= 2; index += 1) {
      const angle = baseAngle + index * 0.18;
      this.spawnProjectile({
        owner: "enemy",
        x: enemy.x + Math.cos(angle) * 42,
        y: enemy.y + Math.sin(angle) * 42,
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        speed: 340 + Math.abs(index) * 28,
        damage: 8,
        radius: 8,
        ttl: 3,
        color: index === 0 ? 0x48f7ff : 0xff5ea8
      });
    }
    this.fxEvents.push({ kind: "burst", x: enemy.x, y: enemy.y, radius: 92, color: 0xff5ea8, grade: "Great" });
  }

  private spawnMirrorClone(enemy: EnemyState): void {
    const state = this.state;
    if (state.enemies.filter((item) => item.type === "swarm").length > 12) {
      return;
    }

    for (let index = 0; index < 2; index += 1) {
      const angle = randomRange(0, Math.PI * 2);
      const clone: EnemyState = {
        id: this.nextEntityId++,
        type: index === 0 ? "runner" : "swarm",
        x: clamp(enemy.x + Math.cos(angle) * 92, 28, WORLD_WIDTH - 28),
        y: clamp(enemy.y + Math.sin(angle) * 92, 28, WORLD_HEIGHT - 28),
        radius: index === 0 ? 18 : 14,
        hp: index === 0 ? 24 : 16,
        maxHp: index === 0 ? 24 : 16,
        speed: index === 0 ? 150 : 188,
        shootCooldown: 0,
        pulseCooldown: 0,
        markedTime: 0,
        slowTime: 0,
        hitFlash: 0
      };
      state.enemies.push(clone);
    }

    this.fxEvents.push({ kind: "burst", x: enemy.x, y: enemy.y, radius: 140, color: 0xc7b8ff, grade: "Normal" });
    this.fxEvents.push({ kind: "float-text", x: enemy.x, y: enemy.y - 78, text: "COPY", color: 0xc7b8ff });
  }

  private fireZeroMotionPulse(enemy: EnemyState): void {
    const state = this.state;
    const count = 18;
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + Math.sin(state.time * 2) * 0.08;
      this.spawnProjectile({
        owner: "enemy",
        x: enemy.x + Math.cos(angle) * 54,
        y: enemy.y + Math.sin(angle) * 54,
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        speed: index % 2 === 0 ? 220 : 300,
        damage: 10,
        radius: 11,
        ttl: 4.4,
        color: 0xc7b8ff
      });
    }

    if (distance(enemy, state.player) < 780) {
      state.player.gauge = clamp(state.player.gauge - 18, 0, state.player.maxGauge);
      this.fxEvents.push({ kind: "float-text", x: state.player.x, y: state.player.y - 92, text: "CORE DRAIN", color: 0xc7b8ff });
    }

    this.fxEvents.push({ kind: "burst", x: enemy.x, y: enemy.y, radius: 250, color: 0xc7b8ff, grade: "Perfect" });
    this.fxEvents.push({ kind: "shake", intensity: 0.014, duration: 180 });
  }

  private damageEnemy(enemy: EnemyState, amount: number, color: number): void {
    const wasMarked = enemy.markedTime > 0;
    const typeMultiplier =
      (enemy.type === "runner" || enemy.type === "swarm" ? 1 + this.state.upgrades.swarmDamageBonus : 1) *
      (enemy.type === "tank" || enemy.type === "drum" || enemy.type === "mirror" || enemy.type === "zero" ? 1 + this.state.upgrades.eliteDamageBonus : 1);
    const finalAmount = amount * typeMultiplier;
    enemy.hp -= finalAmount;
    enemy.hitFlash = 0.12;
    if (this.state.upgrades.enemySlowOnHitTime > 0) {
      enemy.slowTime = Math.max(enemy.slowTime, this.state.upgrades.enemySlowOnHitTime);
    }
    this.fxEvents.push({
      kind: "burst",
      x: enemy.x,
      y: enemy.y,
      radius: clamp(finalAmount * 1.4, 20, 96),
      color
    });

    if (enemy.hp <= 0) {
      if (enemy.type === "dummy") {
        enemy.hp = enemy.maxHp;
        this.fxEvents.push({
          kind: "float-text",
          x: enemy.x,
          y: enemy.y - 24,
          text: "RESET",
          color
        });
        return;
      }
      this.state.enemies = this.state.enemies.filter((item) => item.id !== enemy.id);
      this.state.runStats.kills += 1;
      this.state.player.score += Math.round(scoreForEnemy(enemy.type) * (this.state.dailyChallengeId === "accelerated-noise" ? 1.2 : 1) * this.state.upgrades.scoreMultiplier);
      this.state.player.gauge = clamp(
        this.state.player.gauge + gaugeForEnemy(enemy.type) * this.state.upgrades.gaugeGainMultiplier,
        0,
        this.state.player.maxGauge
      );
      if (wasMarked && (this.state.upgrades.markedKillGaugeBonus > 0 || this.state.upgrades.markedKillCooldownRefund > 0)) {
        this.state.player.gauge = clamp(this.state.player.gauge + this.state.upgrades.markedKillGaugeBonus, 0, this.state.player.maxGauge);
        for (const slot of Object.keys(this.state.cooldowns) as SkillSlot[]) {
          this.state.cooldowns[slot] = Math.max(0, this.state.cooldowns[slot] - this.state.upgrades.markedKillCooldownRefund);
        }
      }
      this.fxEvents.push({
        kind: "float-text",
        x: enemy.x,
        y: enemy.y - 24,
        text: "+",
        color: 0xb8ff5c
      });
      this.fxEvents.push({ kind: "sound", sound: "enemy-down" });
    }
  }

  private damagePlayer(amount: number): void {
    if (this.state.mode === "training") {
      return;
    }
    const player = this.state.player;
    if (player.invulnerableTime > 0 || player.hurtCooldown > 0) {
      return;
    }

    const hpBefore = player.hp;
    const shieldBefore = player.shield;
    const shieldDamage = Math.min(player.shield, amount);
    player.shield -= shieldDamage;
    player.hp = clamp(player.hp - (amount - shieldDamage), 0, player.maxHp);
    this.state.runStats.damageTaken += Math.round(Math.max(0, shieldBefore - player.shield) + Math.max(0, hpBefore - player.hp));
    player.hurtCooldown = 0.7;
    this.fxEvents.push({
      kind: "burst",
      x: player.x,
      y: player.y,
      radius: 76,
      color: 0xff5ea8
    });
    this.fxEvents.push({ kind: "shake", intensity: 0.008, duration: 90 });

    if (player.hp <= 0) {
      this.state.gameOver = true;
      this.state.message = "Noise overwhelmed";
      this.recordRunEnd(false);
    }
  }

  private recordRunEnd(victory: boolean): void {
    if (this.runReported || this.state.mode === "training") {
      return;
    }
    this.runReported = true;
    const summary = this.progression?.recordRun({
      characterId: this.state.characterId,
      mode: this.state.mode,
      victory,
      score: this.state.player.score,
      seconds: this.state.modeTime || this.state.time,
      hpRatio: this.state.player.hp / this.state.player.maxHp,
      bossClear: victory && this.state.mode !== "survival"
    });
    if (!summary) {
      return;
    }

    this.state.runStats.xpGained = summary.xpGained;
    this.state.runStats.levelBefore = summary.levelBefore;
    this.state.runStats.levelAfter = summary.levelAfter;
    this.state.runStats.unlockedItems = summary.unlockedItems;
    this.state.player.level = summary.levelAfter;
    this.fxEvents.push({
      kind: "float-text",
      x: this.state.player.x,
      y: this.state.player.y - 132,
      text: summary.levelAfter > summary.levelBefore ? `LV ${summary.levelAfter}` : `XP +${summary.xpGained}`,
      color: summary.levelAfter > summary.levelBefore ? 0xffd166 : 0x48f7ff
    });
  }

  private findNearestEnemy(origin: Vector2, maxDistance: number): EnemyState | null {
    let best: EnemyState | null = null;
    let bestDistance = maxDistance;
    for (const enemy of this.state.enemies) {
      const current = distance(origin, enemy);
      if (current < bestDistance) {
        best = enemy;
        bestDistance = current;
      }
    }
    return best;
  }

  private rollRewards(count: number): string[] {
    const selected: RewardDefinition[] = [];
    const isAvailable = (reward: RewardDefinition) =>
      (reward.characterId === null || reward.characterId === this.state.characterId) &&
      (this.state.rewardStacks[reward.id] ?? 0) < reward.maxStacks &&
      !selected.some((item) => item.id === reward.id);

    while (selected.length < count) {
      const characterPool = REWARDS.filter((reward) => reward.characterId === this.state.characterId && isAvailable(reward));
      const allPool = REWARDS.filter(isAvailable);
      if (allPool.length === 0) {
        break;
      }

      const preferCharacterCard = characterPool.length > 0 && Math.random() < 0.45;
      selected.push(pickWeightedReward(preferCharacterCard ? characterPool : allPool));
    }

    return selected.map((reward) => reward.id);
  }

  private applyReward(rewardId: string): void {
    const state = this.state;
    const reward = getRewardDefinition(rewardId);
    if (!reward) {
      return;
    }

    state.rewardStacks[rewardId] = (state.rewardStacks[rewardId] ?? 0) + 1;
    switch (rewardId) {
      case "forked-slash":
        state.upgrades.slashDamageMultiplier += 0.2;
        state.upgrades.slashExtraBurstDamageMultiplier += 0.2;
        break;
      case "perfect-tempo":
        state.upgrades.perfectCooldownRefund = Math.max(state.upgrades.perfectCooldownRefund, 0.35);
        break;
      case "runner-current":
        state.upgrades.dashSkillDamageMultiplier += 0.25;
        break;
      case "noise-absorb":
        state.upgrades.gaugeGainMultiplier += 0.45;
        break;
      case "chain-overload":
        state.upgrades.chainExtraTargets += 2;
        break;
      case "spark-hands":
        state.upgrades.basicAttackRateMultiplier += 0.18;
        state.upgrades.basicProjectileSpeedMultiplier += 0.1;
        break;
      case "delivery-guard":
        state.upgrades.dashShield += 18;
        break;
      case "charged-heart":
        state.player.maxHp += 20;
        state.player.hp = clamp(state.player.hp + 20, 0, state.player.maxHp);
        break;
      case "overdrive-loop":
        state.upgrades.overdriveDurationBonus += 2;
        state.upgrades.overdriveDamageMultiplier += 0.15;
        break;
      case "combo-battery":
        state.upgrades.perfectGaugeBonus += 10;
        state.player.gauge = clamp(state.player.gauge + 18, 0, state.player.maxGauge);
        break;
      case "motion-resonance":
        state.upgrades.globalDamageMultiplier += 0.12;
        break;
      case "core-pocket":
        state.player.maxGauge += 20;
        state.player.gauge = clamp(state.player.gauge + 20, 0, state.player.maxGauge);
        break;
      case "quick-reset":
        state.upgrades.cooldownMultiplier *= 0.92;
        break;
      case "cast-amplifier":
        state.upgrades.skillDamageMultiplier += 0.16;
        break;
      case "wide-gesture":
        state.upgrades.areaMultiplier *= 1.1;
        break;
      case "safe-failure":
        state.upgrades.missCooldownMultiplier *= 0.65;
        break;
      case "last-stand":
        state.upgrades.lowHpDamageBonus += 0.28;
        break;
      case "kinetic-heal":
        state.upgrades.dashHeal += 2;
        state.upgrades.dashShield += 5;
        break;
      case "shield-spark":
        state.upgrades.shieldedDamageBonus += 0.18;
        break;
      case "focus-route":
        state.upgrades.sameSkillDamageBonus += 0.08;
        break;
      case "rapid-reload":
        state.upgrades.basicAttackRateMultiplier += 0.25;
        break;
      case "battery-heart":
        state.player.maxHp += 10;
        state.player.hp = clamp(state.player.hp + 10, 0, state.player.maxHp);
        state.player.maxGauge += 10;
        state.player.gauge = clamp(state.player.gauge + 10, 0, state.player.maxGauge);
        break;
      case "perfect-discipline":
        state.upgrades.perfectGaugeBonus += 8;
        break;
      case "wave-cleaner":
        state.upgrades.swarmDamageBonus += 0.24;
        break;
      case "elite-hunter":
        state.upgrades.eliteDamageBonus += 0.22;
        break;
      case "score-hunter":
        state.upgrades.scoreMultiplier += 0.2;
        state.player.gauge = clamp(state.player.gauge + 10, 0, state.player.maxGauge);
        break;
      case "thunder-fork":
        state.upgrades.chainDamageMultiplier += 0.18;
        state.upgrades.chainDecayMultiplier = Math.min(0.98, state.upgrades.chainDecayMultiplier + 0.03);
        break;
      case "courier-boosters":
        state.upgrades.dashLengthMultiplier *= 1.2;
        state.upgrades.dashStrikeWidthMultiplier *= 1.1;
        break;
      case "blue-afterimage":
        state.upgrades.slashRangeMultiplier *= 1.16;
        state.upgrades.slashWidthMultiplier *= 1.12;
        break;
      case "static-routing":
        state.upgrades.chainExtraTargets += 1;
        state.upgrades.chainDamageMultiplier += 0.08;
        break;
      case "voltage-rush":
        state.upgrades.dashSkillDamageMultiplier += 0.2;
        break;
      case "air-splitting-slash":
        state.upgrades.slashDamageMultiplier += 0.14;
        state.upgrades.slashExtraBurstDamageMultiplier += 0.25;
        break;
      case "lightning-parcel":
        state.upgrades.dashSkillDamageMultiplier += 0.2;
        state.upgrades.dashGaugeGain += 4;
        break;
      case "overdrive-battery":
        state.upgrades.overdriveGaugeRefund += 12;
        state.upgrades.overdriveDurationBonus += 1;
        break;
      case "oni-brace":
        state.upgrades.guardShieldMultiplier *= 1.25;
        break;
      case "rebound-practice":
        state.upgrades.reflectDamageBonus += 12;
        state.upgrades.guardChargeMultiplier += 0.18;
        break;
      case "fortress-heart":
        state.upgrades.shieldedDamageBonus += 0.22;
        break;
      case "push-wave":
        state.upgrades.shieldPushRangeMultiplier *= 1.15;
        state.upgrades.pushKnockbackMultiplier *= 1.3;
        break;
      case "ground-resonance":
        state.upgrades.earthDrumRadiusMultiplier *= 1.18;
        state.upgrades.earthDrumDamageMultiplier += 0.1;
        break;
      case "wall-tax":
        state.upgrades.shieldWallDurationBonus += 1.5;
        state.upgrades.shieldWallReflectBonus += 15;
        break;
      case "guardian-oath":
        state.upgrades.guardHeal += 4;
        break;
      case "shield-carpenter":
        state.player.maxHp += 15;
        state.player.hp = clamp(state.player.hp + 15, 0, state.player.maxHp);
        state.upgrades.guardShieldMultiplier *= 1.1;
        state.upgrades.dashShield += 6;
        break;
      case "mark-cache":
        state.upgrades.markExtraTargets += 1;
        break;
      case "glitch-refund":
        state.upgrades.markedKillCooldownRefund += 0.35;
        state.upgrades.markedKillGaugeBonus += 5;
        break;
      case "trap-stack":
        state.upgrades.trapRadiusMultiplier *= 1.14;
        state.upgrades.trapTtlBonus += 1;
        break;
      case "silent-execute":
        state.upgrades.shadowCutDamageMultiplier += 0.22;
        state.upgrades.markedDamageMultiplier += 0.12;
        break;
      case "blackout-script":
        state.upgrades.blackoutRadiusMultiplier *= 1.12;
        state.upgrades.blackoutSlowBonus += 1.2;
        break;
      case "mirror-bug":
        state.upgrades.markDurationBonus += 2;
        state.upgrades.markDamageMultiplier += 0.12;
        break;
      case "cut-through":
        state.upgrades.shadowCutExtraTargets += 1;
        break;
      case "system-lag":
        state.upgrades.enemySlowOnHitTime += 0.35;
        break;
      case "extra-slime":
        state.upgrades.slimeSummonBonus += 1;
        break;
      case "jelly-splash":
        state.upgrades.jellyRadiusMultiplier *= 1.14;
        state.upgrades.jellyDamageMultiplier += 0.1;
        break;
      case "sweet-recovery":
        state.upgrades.jellyHealBonus += 5;
        state.upgrades.sweetFieldHealBonus += 5;
        break;
      case "slime-chef":
        state.upgrades.slimeDamageMultiplier += 0.18;
        state.upgrades.slimeTtlBonus += 2;
        break;
      case "party-leftovers":
        state.upgrades.slimePartyBonus += 2;
        break;
      case "sticky-syrup":
        state.upgrades.enemySlowOnHitTime += 0.45;
        state.upgrades.sweetFieldRadiusMultiplier *= 1.08;
        break;
      case "bouncing-bomb":
        state.upgrades.jellySweetFieldRadius += 80;
        break;
      case "giant-recipe":
        state.upgrades.bigSlimeDamageMultiplier += 0.25;
        state.upgrades.bigSlimeTtlBonus += 2;
        break;
      default:
        break;
    }
    this.fxEvents.push({ kind: "sound", sound: "reward" });
  }

  moveInputFromBooleans(left: boolean, right: boolean, up: boolean, down: boolean): MoveInput {
    return {
      x: (right ? 1 : 0) - (left ? 1 : 0),
      y: (down ? 1 : 0) - (up ? 1 : 0)
    };
  }
}

function pickWeightedReward(pool: RewardDefinition[]): RewardDefinition {
  const totalWeight = pool.reduce((sum, reward) => sum + rarityWeight(reward.rarity), 0);
  let roll = Math.random() * totalWeight;
  for (const reward of pool) {
    roll -= rarityWeight(reward.rarity);
    if (roll <= 0) {
      return reward;
    }
  }
  return pool[pool.length - 1];
}

function rarityWeight(rarity: RewardRarity): number {
  switch (rarity) {
    case "legendary":
      return 0.08;
    case "epic":
      return 0.18;
    case "rare":
      return 0.42;
    case "uncommon":
      return 0.74;
    case "common":
    default:
      return 1;
  }
}

function makeSurvivalWave(wave: number): EnemyType[] {
  const count = Math.min(24, 7 + wave * 2);
  const pool: EnemyType[] =
    wave < 3
      ? ["runner", "runner", "swarm", "shooter"]
      : wave < 6
        ? ["runner", "swarm", "swarm", "shooter", "tank"]
        : ["runner", "swarm", "shooter", "tank", "mirror"];
  const enemies: EnemyType[] = [];
  for (let index = 0; index < count; index += 1) {
    enemies.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  if (wave > 0 && wave % 4 === 0) {
    enemies.push(wave >= 8 ? "mirror" : "drum");
  }
  return enemies;
}

function bossDisplayName(type: EnemyType): string {
  switch (type) {
    case "drum":
      return "드럼 노이즈";
    case "mirror":
      return "아이리스, 거울의 마녀";
    case "zero":
      return "제로 모션";
    default:
      return "노이즈";
  }
}

function isGuardSkill(skillId: string): boolean {
  return skillId === "dokkaebi-guard" || skillId === "giant-shield-wall" || skillId === "shield-push";
}

function enemyStats(type: EnemyType, waveScale: number): { radius: number; hp: number; speedMin: number; speedMax: number } {
  switch (type) {
    case "dummy":
      return { radius: 34, hp: 500 * waveScale, speedMin: 0, speedMax: 0 };
    case "swarm":
      return { radius: 15, hp: 18 * waveScale, speedMin: 150, speedMax: 188 };
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

function scoreForEnemy(type: EnemyType): number {
  switch (type) {
    case "dummy":
      return 0;
    case "swarm":
      return 45;
    case "shooter":
      return 130;
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

function gaugeForEnemy(type: EnemyType): number {
  switch (type) {
    case "dummy":
      return 0;
    case "swarm":
      return 4;
    case "shooter":
      return 11;
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
