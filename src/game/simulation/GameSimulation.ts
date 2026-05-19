import { REWARDS } from "../content/rewards";
import { ADVENTURE_STAGES } from "../content/adventure";
import { CHARACTER_ORDER, getCharacter, getSkillsForCharacter } from "../content/skills";
import type { MoveInput, SkillSlot } from "../input/actions";
import { getDefaultSkinId } from "../progression/progression";
import type { ProgressionStore } from "../progression/progression";
import type {
  CastGrade,
  CastResponse,
  AllyState,
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

    if (result.grade === "Miss") {
      state.cooldowns[prepared.slot] = skill.cooldown * (state.activeCoreId === "stability-core" ? 0.16 : 0.3);
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

    state.cooldowns[prepared.slot] = skill.cooldown * (state.dailyChallengeId === "unstable-core" ? 1.15 : 1);
    state.player.gauge = clamp(state.player.gauge - skill.gaugeCost, 0, state.player.maxGauge);
    state.player.sameSkillChain = state.player.lastSkillId === skill.id ? Math.min(5, state.player.sameSkillChain + 1) : 1;
    state.player.lastSkillId = skill.id;

    if (result.grade === "Perfect") {
      state.player.comboPerfect += 1;
      state.cooldowns[prepared.slot] *= 1 - state.upgrades.perfectCooldownRefund;
      if (state.activeCoreId === "rhythm-core") {
        state.player.gauge = clamp(state.player.gauge + 10, 0, state.player.maxGauge);
        state.upgrades.basicAttackRateMultiplier = Math.max(state.upgrades.basicAttackRateMultiplier, 1.18);
      }
      if (state.dailyChallengeId === "perfect-surge") {
        state.player.gauge = clamp(state.player.gauge + 12, 0, state.player.maxGauge);
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
    const prepared = this.state.preparedSkill;
    if (!prepared) {
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

  chooseReward(rewardId: string): void {
    const state = this.state;
    if (!state.pendingRewardIds.includes(rewardId)) {
      return;
    }

    this.applyReward(rewardId);
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
      preparedSkill: null,
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
        score: 0,
        lastSkillId: null,
        sameSkillChain: 0
      },
      enemies: [],
      projectiles: [],
      traps: [],
      allies: [],
      upgrades: {
        slashDamageMultiplier: 1,
        perfectCooldownRefund: 0,
        dashSkillDamageMultiplier: 1,
        gaugeGainMultiplier: 1,
        chainExtraTargets: 0,
        basicAttackRateMultiplier: 1,
        basicProjectileSpeedMultiplier: 1,
        dashShield: 0,
        overdriveDurationBonus: 0,
        overdriveDamageMultiplier: 1
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

  private updatePlayer(dt: number, input: SimulationInput): void {
    const player = this.state.player;
    const move = normalize(input.move);
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
    const speed = player.dashTime > 0 ? 760 : player.overdriveTime > 0 ? baseSpeed + 55 : baseSpeed;
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
          enemy.pulseCooldown = randomRange(2.4, 3.1);
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
          enemy.pulseCooldown = randomRange(5.6, 7.2);
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
          this.fireZeroMotionPulse(enemy);
          enemy.pulseCooldown = randomRange(2.8, 3.7);
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
      damage: character.basicDamage * this.getGlobalDamageMultiplier(),
      radius: 7,
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
    const range = (grade === "Perfect" ? 780 : grade === "Great" ? 690 : 610) * rangeBonus;
    const width = (grade === "Perfect" ? 112 : grade === "Great" ? 88 : 70) * rangeBonus;
    let damage = skill.damageByGrade[grade] * state.upgrades.slashDamageMultiplier * this.getGlobalDamageMultiplier();
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
          this.damageEnemy(enemy, damage * 0.35, skill.color);
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
    const length = grade === "Perfect" ? 360 : grade === "Great" ? 310 : 250;
    let damage = skill.damageByGrade[grade] * this.getGlobalDamageMultiplier();
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
      if (forward > -30 && forward < length + 60 && perpendicularDistance(enemy, start, direction) < 92) {
        this.damageEnemy(enemy, damage, skill.color);
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
    let damage = skill.damageByGrade[grade] * this.getGlobalDamageMultiplier();
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
      damage *= 0.92;
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
    const radius = grade === "Perfect" ? 620 : grade === "Great" ? 510 : 420;
    const damage = skill.damageByGrade[grade] * this.getGlobalDamageMultiplier();

    player.overdriveTime = Math.max(player.overdriveTime, duration);
    player.invulnerableTime = Math.max(player.invulnerableTime, 0.8);
    player.shield = Math.max(player.shield, grade === "Perfect" ? 36 : 22);

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
    const shieldGain = grade === "Perfect" ? 46 : grade === "Great" ? 34 : 24;
    const radius = grade === "Perfect" ? 220 : grade === "Great" ? 170 : 130;
    player.shield = Math.max(player.shield, shieldGain);
    player.guardCharge = Math.max(player.guardCharge, shieldGain + skill.damageByGrade[grade]);
    player.invulnerableTime = Math.max(player.invulnerableTime, grade === "Perfect" ? 1 : 0.55);

    for (const projectile of state.projectiles) {
      if (projectile.owner === "enemy" && distance(projectile, player) < radius) {
        projectile.owner = "player";
        projectile.vx *= -1.25;
        projectile.vy *= -1.25;
        projectile.color = skill.color;
        projectile.damage += grade === "Perfect" ? 18 : 9;
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
    const range = grade === "Perfect" ? 520 : grade === "Great" ? 440 : 360;
    const width = grade === "Perfect" ? 145 : grade === "Great" ? 118 : 94;
    const reflected = player.guardCharge * (grade === "Perfect" ? 0.9 : 0.55);
    const damage = (skill.damageByGrade[grade] + reflected) * this.getGlobalDamageMultiplier();

    for (const enemy of [...state.enemies]) {
      const toEnemy = { x: enemy.x - player.x, y: enemy.y - player.y };
      const forward = dot(toEnemy, direction);
      if (forward > -30 && forward < range && perpendicularDistance(enemy, player, direction) < width) {
        enemy.x = clamp(enemy.x + direction.x * (grade === "Perfect" ? 180 : 120), 28, WORLD_WIDTH - 28);
        enemy.y = clamp(enemy.y + direction.y * (grade === "Perfect" ? 180 : 120), 28, WORLD_HEIGHT - 28);
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
    const radius = grade === "Perfect" ? 430 : grade === "Great" ? 345 : 270;
    const damage = skill.damageByGrade[grade] * this.getGlobalDamageMultiplier();

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
    const radius = grade === "Perfect" ? 520 : grade === "Great" ? 430 : 340;
    const duration = grade === "Perfect" ? 9 : grade === "Great" ? 7 : 5.5;
    const damage = skill.damageByGrade[grade] * this.getGlobalDamageMultiplier();

    player.shield = Math.max(player.shield, grade === "Perfect" ? 72 : 50);
    player.shieldWallTime = Math.max(player.shieldWallTime, duration);
    player.invulnerableTime = Math.max(player.invulnerableTime, 1);

    for (const projectile of state.projectiles) {
      if (projectile.owner === "enemy" && distance(projectile, player) < radius) {
        projectile.owner = "player";
        projectile.vx *= -1.45;
        projectile.vy *= -1.45;
        projectile.damage += damage;
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
    const maxTargets = grade === "Perfect" ? 3 : grade === "Great" ? 2 : 1;
    const targets = [...state.enemies]
      .sort((a, b) => distance(player, a) - distance(player, b))
      .slice(0, maxTargets);

    for (const target of targets) {
      target.markedTime = grade === "Perfect" ? 9 : grade === "Great" ? 7 : 5;
      target.slowTime = Math.max(target.slowTime, grade === "Perfect" ? 1.2 : 0.7);
      this.damageEnemy(target, skill.damageByGrade[grade] * this.getGlobalDamageMultiplier(), skill.color);
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
        ? marked.slice(0, grade === "Perfect" ? 5 : grade === "Great" ? 3 : 2)
        : this.findNearestEnemy(player, 780)
          ? [this.findNearestEnemy(player, 780) as EnemyState]
          : [];
    const start = { x: player.x, y: player.y };
    const damage = skill.damageByGrade[grade] * this.getGlobalDamageMultiplier();

    for (const target of targets) {
      const markedBonus = target.markedTime > 0 ? 1.55 : 1;
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
    const radius = grade === "Perfect" ? 250 : grade === "Great" ? 205 : 165;
    const damage = skill.damageByGrade[grade] * this.getGlobalDamageMultiplier();
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
      ttl: grade === "Perfect" ? 8 : grade === "Great" ? 6.5 : 5,
      color: skill.color
    });
  }

  private castBlackout(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().F;
    const radius = grade === "Perfect" ? 980 : grade === "Great" ? 820 : 680;
    const damage = skill.damageByGrade[grade] * this.getGlobalDamageMultiplier();

    player.invulnerableTime = Math.max(player.invulnerableTime, grade === "Perfect" ? 1.4 : 0.8);
    for (const enemy of [...state.enemies]) {
      if (distance(player, enemy) < radius) {
        enemy.markedTime = Math.max(enemy.markedTime, grade === "Perfect" ? 10 : 7);
        enemy.slowTime = Math.max(enemy.slowTime, grade === "Perfect" ? 4.8 : 3.2);
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
    const radius = grade === "Perfect" ? 310 : grade === "Great" ? 245 : 190;
    const damage = skill.damageByGrade[grade] * this.getGlobalDamageMultiplier();

    for (const enemy of [...state.enemies]) {
      if (distance(enemy, origin) < radius + enemy.radius) {
        this.damageEnemy(enemy, damage, skill.color);
        enemy.slowTime = Math.max(enemy.slowTime, 0.5);
      }
    }

    if (grade === "Perfect") {
      player.hp = clamp(player.hp + 8, 0, player.maxHp);
      player.shield = Math.max(player.shield, 14);
    }

    this.fxEvents.push({ kind: "burst", x: origin.x, y: origin.y, radius, color: skill.color, grade });
    this.fxEvents.push({ kind: "shake", intensity: grade === "Perfect" ? 0.012 : 0.007, duration: 120 });
  }

  private castSlimeSummon(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().E;
    const count = grade === "Perfect" ? 4 : grade === "Great" ? 3 : 2;

    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + randomRange(-0.28, 0.28);
      this.spawnAlly({
        kind: "slime",
        x: player.x + Math.cos(angle) * 62,
        y: player.y + Math.sin(angle) * 62,
        radius: 17,
        ttl: grade === "Perfect" ? 20 : grade === "Great" ? 16 : 12,
        speed: 185,
        damage: skill.damageByGrade[grade] * this.getGlobalDamageMultiplier(),
        color: skill.color
      });
    }

    this.fxEvents.push({ kind: "burst", x: player.x, y: player.y, radius: 150, color: skill.color, grade });
  }

  private castSweetField(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().R;
    const radius = grade === "Perfect" ? 360 : grade === "Great" ? 300 : 240;
    this.spawnTrap({
      kind: "sweet-field",
      x: player.x,
      y: player.y,
      radius,
      damage: skill.damageByGrade[grade] * this.getGlobalDamageMultiplier(),
      ttl: grade === "Perfect" ? 9 : grade === "Great" ? 7 : 5.5,
      color: skill.color
    });
    player.hp = clamp(player.hp + (grade === "Perfect" ? 16 : grade === "Great" ? 10 : 6), 0, player.maxHp);
    player.shield = Math.max(player.shield, grade === "Perfect" ? 26 : 14);
  }

  private castSlimeParty(grade: Exclude<CastGrade, "Miss">): void {
    const state = this.state;
    const player = state.player;
    const skill = this.getCurrentSkills().F;
    const radius = grade === "Perfect" ? 620 : grade === "Great" ? 510 : 420;
    const damage = skill.damageByGrade[grade] * this.getGlobalDamageMultiplier();

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
      ttl: grade === "Perfect" ? 16 : grade === "Great" ? 12 : 9,
      speed: 135,
      damage: damage * 0.55,
      color: skill.color
    });

    const smallCount = grade === "Perfect" ? 5 : grade === "Great" ? 3 : 2;
    for (let index = 0; index < smallCount; index += 1) {
      const angle = (Math.PI * 2 * index) / smallCount;
      this.spawnAlly({
        kind: "slime",
        x: player.x + Math.cos(angle) * 92,
        y: player.y + Math.sin(angle) * 92,
        radius: 17,
        ttl: 14,
        speed: 195,
        damage: 18,
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
      player.gauge = clamp(player.gauge + 10 * this.state.upgrades.gaugeGainMultiplier, 0, player.maxGauge);
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
    const rampage =
      this.state.activeCoreId === "rampage-core" && player.hp / player.maxHp < 0.45
        ? 1.35
        : 1;
    return overdrive * focus * rampage;
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
    enemy.hp -= amount;
    enemy.hitFlash = 0.12;
    this.fxEvents.push({
      kind: "burst",
      x: enemy.x,
      y: enemy.y,
      radius: clamp(amount * 1.4, 20, 96),
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
      this.state.player.score += Math.round(scoreForEnemy(enemy.type) * (this.state.dailyChallengeId === "accelerated-noise" ? 1.2 : 1));
      this.state.player.gauge = clamp(
        this.state.player.gauge + gaugeForEnemy(enemy.type) * this.state.upgrades.gaugeGainMultiplier,
        0,
        this.state.player.maxGauge
      );
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

    const shieldDamage = Math.min(player.shield, amount);
    player.shield -= shieldDamage;
    player.hp = clamp(player.hp - (amount - shieldDamage), 0, player.maxHp);
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
      seconds: this.state.modeTime || this.state.time
    });
    if (!summary) {
      return;
    }

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
    const available = REWARDS.map((reward) => reward.id).sort(() => Math.random() - 0.5);
    return available.slice(0, count);
  }

  private applyReward(rewardId: string): void {
    const state = this.state;
    switch (rewardId) {
      case "forked-slash":
        state.upgrades.slashDamageMultiplier += 0.2;
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
        state.upgrades.dashShield = Math.max(state.upgrades.dashShield, 18);
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
        state.upgrades.gaugeGainMultiplier += 0.25;
        state.player.gauge = clamp(state.player.gauge + 18, 0, state.player.maxGauge);
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
