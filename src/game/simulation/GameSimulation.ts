import { ADVENTURE_STAGES } from "../content/adventure";
import { getAppliedDifficultyModifiers } from "../content/difficulty";
import { CHARACTER_ORDER, getCharacter, getSkillsForCharacter } from "../content/skills";
import { calculateActiveSynergies } from "../content/synergies";
import { createTrainingState } from "../content/training";
import { createTutorialState } from "../content/tutorial";
import type { MoveInput, SkillSlot } from "../input/actions";
import { CORES, DEFAULT_DAILY_MODIFIERS, getDefaultSkinId, type DailyChallengeModifiers } from "../progression/progression";
import type { ProgressionStore } from "../progression/progression";
import type { CharacterQuestUnlock } from "../progression/characterQuests";
import type { RunHistoryMetadata, RunHistoryStore } from "../progression/runHistory";
import { BossSystem, getCurrentBossChallengeGesture, type BossChallengeConfig } from "./systems/bossSystem";
import type { DamageEnemyOptions } from "./systems/combatTypes";
import { contactDamageForEnemy, enemyStats, gaugeForEnemy, isBossEnemy, makeSurvivalWave, scoreForEnemy } from "./systems/enemySystem";
import { applyReward as applyRewardToState, rewardSoundForRarity, rollRewards as rollRewardsForState } from "./systems/rewardSystem";
import { castTrainingDebugGrade, debugBreakdown, getNextTrainingGesture, recordTrainingGestureResult } from "./systems/trainingSystem";
import type {
  CastGrade,
  CastResponse,
  AllyState,
  AchievementUnlock,
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
  SoundId,
  StageHazardState,
  StageRegion,
  TutorialStepId,
  TrapState,
  Vector2
} from "./types";
import { clamp, distance, dot, normalize, perpendicularDistance, randomRange } from "./math";

export const WORLD_WIDTH = 2200;
export const WORLD_HEIGHT = 1400;

const wavePlans: EnemyType[][] = [
  ["runner", "runner", "runner", "runner", "swarm", "swarm", "shooter"],
  ["runner", "runner", "runner", "swarm", "swarm", "swarm", "shooter", "castBreaker"],
  ["runner", "runner", "swarm", "swarm", "shooter", "shooter", "shieldNoise", "tank"],
  ["runner", "swarm", "swarm", "shooter", "tank", "anchorNoise", "medicNoise", "bombNoise"],
  ["runner", "swarm", "shooter", "shieldNoise", "anchorNoise", "medicNoise", "bombNoise", "drum"]
];

const bossRushPlan: EnemyType[] = ["drum", "balloonClown", "crystalReflector", "mirror", "zero"];
const QUICK_DEMO_DURATION = 180;

interface QuickDemoPhasePlan {
  startsAt: number;
  title: string;
  message: string;
  region: StageRegion;
  enemies: EnemyType[];
}

const quickDemoPhases: QuickDemoPhasePlan[] = [
  {
    startsAt: 0,
    title: "3분 데모: 첫 움직임",
    message: "Q를 누르고 슬래시로 노이즈를 정리해요.",
    region: "루프시티",
    enemies: ["runner", "runner", "swarm", "runner", "swarm"]
  },
  {
    startsAt: 30,
    title: "3분 데모: 보상 빌드",
    message: "카드 1장을 고르고 웨이브를 돌파해요.",
    region: "루프시티",
    enemies: ["runner", "runner", "swarm", "shooter", "shooter", "tank", "runner"]
  },
  {
    startsAt: 80,
    title: "3분 데모: AR 캐스팅",
    message: "새 노이즈 등장! AR 가이드를 보고 크게 움직여요.",
    region: "미러 타워",
    enemies: ["castBreaker", "shieldNoise", "runner", "anchorNoise", "bombNoise", "medicNoise", "swarm", "shooter"]
  },
  {
    startsAt: 140,
    title: "3분 데모: 드럼 노이즈",
    message: "드럼 노이즈의 보스 포즈 브레이크를 막아요!",
    region: "루프시티",
    enemies: []
  }
];

interface DebugDamageSample {
  at: number;
  amount: number;
}

export class GameSimulation {
  private state: GameState;
  private nextEntityId = 1;
  private fxEvents: FxEvent[] = [];
  private selectedCharacterId: CharacterId = "rio";
  private selectedMode: GameMode = "title";
  private runReported = false;
  private debugDamageSamples: DebugDamageSample[] = [];
  private dailyModifiers: DailyChallengeModifiers = { ...DEFAULT_DAILY_MODIFIERS };
  private readonly bossSystem: BossSystem;
  private runTelemetryProvider: (() => RunHistoryMetadata) | null = null;

  constructor(
    private readonly progression?: ProgressionStore,
    private readonly runHistory?: RunHistoryStore
  ) {
    this.bossSystem = new BossSystem({
      getState: () => this.state,
      pushFx: (event) => this.fxEvents.push(event),
      damageEnemy: (enemy, amount, color, options) => this.damageEnemy(enemy, amount, color, options),
      damagePlayer: (amount) => this.damagePlayer(amount),
      fireZeroMotionPulse: (enemy) => this.fireZeroMotionPulse(enemy),
      pushCutIn: (title, subtitle, color, duration) => this.pushCutIn(title, subtitle, color, duration),
      currentTutorialStepIs: (stepId) => this.currentTutorialStepIs(stepId),
      completeTutorialStep: (stepId) => this.completeTutorialStep(stepId),
      startTutorialBossPoseBreak: () => this.startTutorialBossPoseBreak()
    });
    this.state = this.createInitialState();
    this.startMode();
    this.updateObjectiveState();
  }

  getState(): GameState {
    return this.state;
  }

  getCurrentSkills() {
    return getSkillsForCharacter(this.state.characterId);
  }

  setRunTelemetryProvider(provider: () => RunHistoryMetadata): void {
    this.runTelemetryProvider = provider;
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
    this.debugDamageSamples = [];
    this.state = this.createInitialState();
    this.startMode();
    this.updateObjectiveState();
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
    this.updateObjectiveState();

    if (state.mode === "title" || state.paused || state.gameOver || state.victory || state.pendingRewardIds.length > 0) {
      return;
    }

    state.time += step;
    state.modeTime += step;
    this.updateDebugStats();
    this.updateTimers(step);
    this.updatePreparedSkillExpiry();
    this.updateBossChallengeExpiry();
    this.updatePlayer(step, input);
    this.updateStageHazards(step);
    this.updateSynergyEffects(step);
    this.updateSpawning(step);
    this.updateSurvivalFlow();
    this.updateQuickDemoFlow();
    this.updateEnemies(step);
    this.updateTraps(step);
    this.updateAllies(step);
    this.updateProjectiles(step);
    this.updateBasicAttack(step);
    this.updateTutorial(step, input);
    this.checkWaveComplete();
    this.updateObjectiveState();
  }

  prepareSkill(slot: SkillSlot): CastResponse {
    const state = this.state;
    const skill = this.getCurrentSkills()[slot];

    if (state.mode === "title") {
      return { ok: false, line: "먼저 게임을 시작해요." };
    }
    if (state.paused || state.gameOver || state.victory || state.pendingRewardIds.length > 0) {
      return { ok: false, line: "지금은 포즈 캐스트를 쓸 수 없어요." };
    }
    if (state.preparedSkill) {
      return { ok: false, line: "이미 포즈를 읽고 있어요." };
    }
    if (state.bossChallenge) {
      return { ok: false, line: "먼저 보스 포즈를 막아야 해요!" };
    }
    if (state.mode === "tutorial") {
      const stepId = this.getCurrentTutorialStep()?.id;
      if (stepId !== "prepare-q" && stepId !== "cast-skill") {
        return { ok: false, line: "먼저 튜토리얼 목표를 끝내요." };
      }
      if (slot !== "Q") {
        return { ok: false, line: "이번엔 Q 스킬만 써요." };
      }
    }
    if (state.cooldowns[slot] > 0) {
      return { ok: false, line: `${skill.name} 쿨타임 ${state.cooldowns[slot].toFixed(1)}초` };
    }
    if (state.player.gauge < skill.gaugeCost) {
      return { ok: false, line: "코어 게이지가 부족해요." };
    }

    state.preparedSkill = {
      slot,
      startedAt: state.time,
      expiresAt: state.time + 1.55
    };
    state.message = skill.gestureLabel;
    this.fxEvents.push({ kind: "sound", sound: "cast-start" });
    if (slot === "Q") {
      state.tutorial.skillPrepared = true;
      this.completeTutorialStep("prepare-q");
    }
    return { ok: true, line: skill.gestureLabel };
  }

  castPreparedSkill(result: GestureResult): CastResponse {
    const state = this.state;
    const prepared = state.preparedSkill;
    if (!prepared) {
      return { ok: false, line: "먼저 스킬을 준비해요." };
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
      this.addCastProgressResult(this.progression?.recordCast(state.characterId, skill.id, result.grade));
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

    state.cooldowns[prepared.slot] = skill.cooldown * state.upgrades.cooldownMultiplier;
    state.player.gauge = clamp(state.player.gauge - skill.gaugeCost, 0, state.player.maxGauge);
    state.player.sameSkillChain = state.player.lastSkillId === skill.id ? Math.min(5, state.player.sameSkillChain + 1) : 1;
    state.player.lastSkillId = skill.id;
    state.player.lastCastSkillId = skill.id;
    state.player.lastCastGrade = result.grade;
    state.player.castAnimTime = skill.slot === "F" ? 1.25 : 0.82;

    if (result.grade === "Perfect") {
      state.player.comboPerfect += 1;
      state.runStats.maxPerfectCombo = Math.max(state.runStats.maxPerfectCombo, state.player.comboPerfect);
      if (this.hasSynergy("perfect-caster")) {
        state.player.score += Math.round((120 + state.player.comboPerfect * 24) * state.upgrades.scoreMultiplier);
        this.fxEvents.push({
          kind: "float-text",
          x: state.player.x,
          y: state.player.y - 124,
          text: "빌드 점수",
          color: 0xffd166
        });
      }
      if (this.hasSynergy("perfectionist")) {
        state.player.score += Math.round((180 + state.player.comboPerfect * 32) * state.upgrades.scoreMultiplier);
        state.player.gauge = clamp(state.player.gauge + 5, 0, state.player.maxGauge);
      }
      state.cooldowns[prepared.slot] *= 1 - state.upgrades.perfectCooldownRefund;
      if (this.hasSynergy("fast-hands-route")) {
        for (const slot of Object.keys(state.cooldowns) as SkillSlot[]) {
          state.cooldowns[slot] = Math.max(0, state.cooldowns[slot] - 0.45);
        }
        state.cooldowns[prepared.slot] *= 0.92;
      }
      if (state.activeCoreId === "rhythm-core") {
        state.player.gauge = clamp(state.player.gauge + 10, 0, state.player.maxGauge);
        state.upgrades.basicAttackRateMultiplier = Math.max(state.upgrades.basicAttackRateMultiplier, 1.18);
      }
      if (this.dailyModifiers.perfectGaugeGain > 0) {
        state.player.gauge = clamp(state.player.gauge + this.dailyModifiers.perfectGaugeGain, 0, state.player.maxGauge);
      }
      if (state.upgrades.perfectGaugeBonus > 0) {
        state.player.gauge = clamp(state.player.gauge + state.upgrades.perfectGaugeBonus, 0, state.player.maxGauge);
      }
      this.applyPerfectComboBonus();
      this.pushPerfectCastPresentation(skill.color);
    } else {
      state.player.comboPerfect = 0;
    }

    const dailySkillDamageMultiplier = this.getDailySkillCastDamageMultiplier(skill.gestureId, result.grade);
    const difficultySkillDamageMultiplier = result.grade === "Perfect" ? this.getDifficultyModifiers().perfectDamageMultiplier : 1;
    const originalSkillDamageMultiplier = state.upgrades.skillDamageMultiplier;
    state.upgrades.skillDamageMultiplier *= dailySkillDamageMultiplier * difficultySkillDamageMultiplier;
    this.resolveSkillEffect(skill.id, result.grade);
    state.upgrades.skillDamageMultiplier = originalSkillDamageMultiplier;
    this.applyPostSkillSynergy(skill.color);
    state.tutorial.skillCast = true;
    this.completeTutorialStep("cast-skill");
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
    this.addCastProgressResult(this.progression?.recordCast(state.characterId, skill.id, result.grade));

    const line =
      skill.slot === "F"
        ? result.grade === "Perfect"
          ? getCharacter(state.characterId).ultimateLine
          : `${skill.name} ${result.grade}`
        : result.grade === "Perfect"
          ? getCharacter(state.characterId).perfectLine
          : `${skill.name} ${result.grade}`;
    state.message = line;
    if (skill.slot === "F" && (result.grade === "Great" || result.grade === "Perfect")) {
      this.pushCutIn(skill.name.toUpperCase(), result.grade === "Perfect" ? getCharacter(state.characterId).ultimateLine : "궁극기 포즈 캐스트", skill.color, 640);
    }
    this.fxEvents.push({
      kind: "float-text",
      x: state.player.x,
      y: state.player.y - 68,
      text: result.grade,
      color: skill.color
    });
    this.fxEvents.push({ kind: "sound", sound: characterSkillSound(state.characterId), grade: result.grade });
    this.fxEvents.push({ kind: "sound", sound: castGradeSound(result.grade), grade: result.grade });
    return { ok: true, line };
  }

  castDebugGrade(grade: Exclude<CastGrade, "Miss">): CastResponse {
    if (this.state.bossChallenge) {
      const challenge = this.state.bossChallenge;
      return this.castBossChallenge({
        gestureId: getCurrentBossChallengeGesture(challenge),
        score: grade === "Perfect" ? 96 : grade === "Great" ? 82 : 58,
        grade,
        confidence: 1,
        reason: "debug input",
        breakdown: debugBreakdown(grade, "1/2/3 대체 입력으로 포즈를 테스트했어요.")
      });
    }

    const prepared = this.state.preparedSkill;
    if (!prepared) {
      if (this.state.mode === "training") {
        return this.castTrainingDebugGrade(grade);
      }
      return { ok: false, line: "먼저 스킬을 준비해요." };
    }

    return this.castPreparedSkill({
      gestureId: this.getCurrentSkills()[prepared.slot].gestureId,
      score: grade === "Perfect" ? 96 : grade === "Great" ? 82 : 58,
      grade,
      confidence: 1,
      reason: "debug input",
      breakdown: debugBreakdown(grade, "1/2/3 대체 입력으로 포즈를 테스트했어요.")
    });
  }

  castBossChallenge(result: GestureResult): CastResponse {
    const challenge = this.state.bossChallenge;
    if (!challenge) {
      return { ok: false, line: "진행 중인 보스 포즈가 없어요." };
    }

    const requiredGesture = getCurrentBossChallengeGesture(challenge);
    const grade: CastGrade = result.gestureId === requiredGesture ? result.grade : "Miss";
    if (grade === "Miss") {
      this.state.bossChallenge = null;
      return this.failBossChallenge(challenge);
    }

    if (challenge.currentIndex < challenge.sequence.length - 1) {
      challenge.currentIndex += 1;
      challenge.requiredGesture = getCurrentBossChallengeGesture(challenge);
      challenge.prompt = challenge.stepPrompts[challenge.currentIndex] ?? challenge.prompt;
      challenge.expiresAt = this.state.time + challenge.stepDuration;
      this.state.bossChallenge = challenge;
      this.state.message = `다음 포즈: ${challenge.prompt}`;
      this.fxEvents.push({
        kind: "float-text",
        x: this.state.player.x,
        y: this.state.player.y - 100,
        text: `NEXT ${challenge.currentIndex + 1}/${challenge.sequence.length}`,
        color: grade === "Perfect" ? 0xffd166 : 0x48f7ff
      });
      this.fxEvents.push({ kind: "sound", sound: "boss-break-success", grade });
      return { ok: true, line: this.state.message };
    }

    this.state.bossChallenge = null;
    return this.succeedBossChallenge(challenge, grade);
  }

  private castTrainingDebugGrade(grade: Exclude<CastGrade, "Miss">): CastResponse {
    return castTrainingDebugGrade(this.state, this.fxEvents, grade);
  }

  private getNextTrainingGesture(): GestureResult["gestureId"] {
    return getNextTrainingGesture(this.state);
  }

  private recordTrainingGestureResult(result: GestureResult): void {
    recordTrainingGestureResult(this.state, this.fxEvents, result);
  }

  chooseReward(rewardId: string): void {
    const state = this.state;
    if (!state.pendingRewardIds.includes(rewardId)) {
      return;
    }

    const reward = this.applyReward(rewardId);
    state.runStats.rewardsChosen.push(rewardId);
    this.updateSynergies();
    this.fxEvents.push({ kind: "sound", sound: rewardSoundForRarity(reward?.rarity ?? "common") });
    if (state.mode === "tutorial") {
      state.tutorial.rewardChosen = true;
    }
    state.pendingRewardIds = [];
    state.rewardOfferHistoryIds = [];
    this.continueAfterReward();
  }

  debugFillGauge(): CastResponse {
    const player = this.state.player;
    player.gauge = player.maxGauge;
    this.state.message = "DEV: 게이지 100";
    this.fxEvents.push({ kind: "float-text", x: player.x, y: player.y - 116, text: "GAUGE 100", color: 0x48f7ff });
    return { ok: true, line: "코어 게이지 100!" };
  }

  debugClearWave(): CastResponse {
    const state = this.state;
    if (state.mode === "training") {
      return { ok: false, line: "훈련장에서는 웨이브 클리어를 쓰지 않아요." };
    }
    state.spawnQueue = [];
    state.enemies = state.enemies.filter((enemy) => enemy.type === "dummy");
    state.projectiles = state.projectiles.filter((projectile) => projectile.owner === "player");
    state.bossChallenge = null;
    state.message = "DEV: 현재 웨이브 클리어";
    this.fxEvents.push({ kind: "float-text", x: state.player.x, y: state.player.y - 126, text: "WAVE CLEAR", color: 0xffd166 });
    return { ok: true, line: "현재 웨이브를 비웠어요." };
  }

  debugSpawnBoss(): CastResponse {
    const state = this.state;
    if (state.enemies.some((enemy) => isBossEnemy(enemy.type))) {
      return { ok: false, line: "이미 보스가 있어요." };
    }
    const bossType = this.getDebugBossType();
    this.spawnEnemy(bossType);
    state.waveActive = true;
    state.message = `DEV: ${bossType} 소환`;
    this.fxEvents.push({ kind: "sound", sound: "boss" });
    this.fxEvents.push({ kind: "float-text", x: state.player.x, y: state.player.y - 132, text: "BOSS SPAWN", color: 0xff5ea8 });
    return { ok: true, line: `${bossType} 보스 소환!` };
  }

  debugForceReward(): CastResponse {
    const state = this.state;
    if (state.pendingRewardIds.length > 0) {
      return { ok: false, line: "이미 보상 카드가 열려요." };
    }
    this.openRewardChoice(3);
    state.message = "DEV: 보상 카드 강제 표시";
    return { ok: true, line: "보상 카드 3장 오픈!" };
  }

  rerollRewards(): CastResponse {
    const state = this.state;
    if (state.pendingRewardIds.length === 0) {
      return { ok: false, line: "리롤할 카드가 없어요." };
    }
    if (state.rewardRerollsRemaining <= 0) {
      return { ok: false, line: "이번 런 리롤을 모두 썼어요." };
    }

    const isFree = state.rewardRerollsRemaining >= 2;
    const nextRewards = this.rollRewards(state.pendingRewardIds.length, state.rewardOfferHistoryIds);
    if (nextRewards.length === 0) {
      return { ok: false, line: "새 카드가 없어요." };
    }

    if (!isFree) {
      if (state.player.score >= 500) {
        state.player.score -= 500;
      } else if (state.player.gauge >= 20) {
        state.player.gauge = clamp(state.player.gauge - 20, 0, state.player.maxGauge);
      } else {
        return { ok: false, line: "리롤 비용이 부족합니다. 점수 500 또는 게이지 20이 필요합니다." };
      }
    }

    state.pendingRewardIds = nextRewards;
    state.rewardOfferHistoryIds = Array.from(new Set([...state.rewardOfferHistoryIds, ...nextRewards]));
    state.rewardRerollsRemaining -= 1;
    state.message = isFree ? "무료 리롤" : "유료 리롤";
    this.fxEvents.push({
      kind: "float-text",
      x: state.player.x,
      y: state.player.y - 116,
      text: "REROLL",
      color: 0xffd166
    });
    this.fxEvents.push({ kind: "sound", sound: "reward-common" });
    return { ok: true, line: isFree ? "무료 리롤 사용" : "리롤 비용 지불" };
  }

  private createInitialState(): GameState {
    const character = getCharacter(this.selectedCharacterId);
    const progress = this.progression?.getSnapshot();
    const daily = this.progression?.getDailyChallenge();
    const difficulty = progress?.selectedDifficulty ?? "normal";
    const poseAssistLevel = progress?.selectedPoseAssistLevel ?? "normal";
    this.dailyModifiers = { ...DEFAULT_DAILY_MODIFIERS, ...(daily?.modifiers ?? {}) };
    const activeCoreId = this.dailyModifiers.randomCore
      ? CORES[Math.floor(Math.random() * CORES.length)]?.id ?? "stability-core"
      : progress?.equippedCoreId ?? "stability-core";
    const equippedSkinId = progress?.equippedSkins[this.selectedCharacterId] ?? getDefaultSkinId(this.selectedCharacterId);
    const effectPaletteId = progress?.equippedEffectPaletteId ?? "classic";
    const characterLevel = progress?.characters[this.selectedCharacterId]?.level ?? 1;
    const maxHp = Math.round(character.hp * this.dailyModifiers.playerHpMultiplier);
    const state: GameState = {
      time: 0,
      mode: this.selectedMode,
      difficulty,
      poseAssistLevel,
      characterId: this.selectedCharacterId,
      paused: false,
      gameOver: false,
      victory: false,
      stageName: "루프시티 거리",
      objectiveText: "시작할 모드를 고르세요.",
      objectiveDetail: "튜토리얼, 훈련장, 모험을 선택할 수 있어요.",
      objectiveProgress: 0,
      objectiveIsUrgent: false,
      stageRegion: "루프시티",
      adventureStageIndex: 0,
      adventureStageTotal: ADVENTURE_STAGES.length,
      adventureStageCode: "",
      adventureStageGoal: "",
      adventureStageEnemyTotal: 0,
      adventureStageStartTime: 0,
      adventureStageStartScore: 0,
      adventureStageStartMisses: 0,
      activeCoreId,
      equippedSkinId,
      effectPaletteId,
      dailyChallengeId: daily?.id ?? "none",
      dailyChallengeTitle: daily?.title ?? "데일리 없음",
      dailyChallengeDescription: daily?.description ?? "",
      modeTime: 0,
      survivalNextRewardAt: 60,
      survivalFinalBossSpawned: false,
      bossRushIndex: 0,
      waveIndex: 0,
      waveActive: false,
      spawnQueue: [],
      spawnTimer: 0,
      pendingRewardIds: [],
      rewardOfferHistoryIds: [],
      rewardRerollsRemaining: 2,
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
        gauge: this.dailyModifiers.startingGauge,
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
        sameSkillChain: 0,
        lastCastSkillId: null,
        lastCastGrade: null,
        castAnimTime: 0
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
        unlockedAchievements: [],
        characterQuestUnlocks: [],
        xpGained: 0,
        levelBefore: characterLevel,
        levelAfter: characterLevel,
        dailyChallengeTitle: daily?.title ?? "데일리 없음",
        dailyChallengeCleared: false,
        bossPosePerfectCounters: 0,
        shieldDamageAbsorbed: 0,
        markedEnemyKills: 0,
        slimesSummoned: 0,
        maxSlimesMaintained: 0,
        bossesDefeated: []
      },
      debugStats: {
        dpsEstimate: 0,
        bossChallengeSuccesses: 0,
        bossChallengeFailures: 0
      },
      training: createTrainingState(),
      tutorial: createTutorialState(),
      quickDemo: {
        phaseIndex: -1,
        rewardOffered: false,
        bossSpawned: false,
        bossChallengeStarted: false
      },
      activeSynergies: [],
      stageHazards: [],
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
    this.applyDailyInitialModifiers(state);
    this.applyDifficultyInitialModifiers(state);

    return state;
  }

  private applyDailyInitialModifiers(state: GameState): void {
    const modifiers = this.dailyModifiers;
    state.upgrades.cooldownMultiplier *= modifiers.skillCooldownMultiplier;
    state.upgrades.missCooldownMultiplier *= modifiers.missCooldownMultiplier;
    state.upgrades.gaugeGainMultiplier *= modifiers.killGaugeMultiplier;
    state.upgrades.scoreMultiplier *= modifiers.enemyScoreMultiplier;
    state.upgrades.dashSkillDamageMultiplier += modifiers.dashSkillDamageBonus;
    state.upgrades.areaMultiplier *= modifiers.areaDamageMultiplier;
  }

  private applyDifficultyInitialModifiers(state: GameState): void {
    const modifiers = this.getDifficultyModifiers(state);
    state.upgrades.scoreMultiplier *= modifiers.scoreMultiplier;
    state.upgrades.missCooldownMultiplier *= modifiers.missCooldownMultiplier;
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
    state.player.castAnimTime = Math.max(0, state.player.castAnimTime - dt);
    state.player.shieldWallTime = Math.max(0, state.player.shieldWallTime - dt);
    state.player.controlReverseTime = Math.max(0, state.player.controlReverseTime - dt);
    state.player.movementSlowTime = Math.max(0, state.player.movementSlowTime - dt);
    state.player.infiniteGaugeTime = Math.max(0, state.player.infiniteGaugeTime - dt);
    if (state.player.infiniteGaugeTime > 0) {
      state.player.gauge = state.player.maxGauge;
    }
    if (state.mode === "tutorial" || state.mode === "training") {
      state.player.gauge = state.player.maxGauge;
      state.player.hp = state.mode === "training" ? Math.max(state.player.hp, state.player.maxHp) : Math.max(state.player.hp, 35);
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
        reason: "포즈 시간이 지났어요.",
        breakdown: debugBreakdown("Miss", "스킬 준비 후 바로 움직여요.")
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
      player.dashCooldown = 1.05 * this.dailyModifiers.dashCooldownMultiplier;
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
      this.completeTutorialStep("dash");
    }

    const baseSpeed = getCharacter(this.state.characterId).speed;
    const slowMultiplier = player.movementSlowTime > 0 ? 0.52 : 1;
    const speed = (player.dashTime > 0 ? 760 : player.overdriveTime > 0 ? baseSpeed + 55 : baseSpeed) * slowMultiplier;
    const direction = player.dashTime > 0 ? player.facing : move;
    player.x = clamp(player.x + direction.x * speed * dt, 48, WORLD_WIDTH - 48);
    player.y = clamp(player.y + direction.y * speed * dt, 48, WORLD_HEIGHT - 48);
  }

  private updateStageHazards(dt: number): void {
    const state = this.state;
    if (state.stageHazards.length === 0 || state.mode === "training") {
      return;
    }

    const player = state.player;
    for (const hazard of state.stageHazards) {
      hazard.cooldown = Math.max(0, hazard.cooldown - dt);
      hazard.pulseTimer += dt;

      if (hazard.kind === "rotator") {
        hazard.angle += dt * (0.95 + hazard.strength * 0.015);
      } else if (hazard.kind === "mirror-reversal") {
        hazard.angle -= dt * 0.72;
      } else {
        hazard.angle += dt * 0.42;
      }
      const active = isStageHazardActive(hazard, state.time);
      hazard.activeTime = active ? hazard.activeTime + dt : 0;

      const touching = distance(player, hazard) <= player.radius + hazard.radius;
      if (!touching) {
        continue;
      }

      if (hazard.kind === "rotator") {
        if (!active) {
          continue;
        }
        const radial = normalize({ x: player.x - hazard.x, y: player.y - hazard.y });
        const tangent = { x: -radial.y, y: radial.x };
        player.x = clamp(player.x + (tangent.x * 155 + radial.x * 34) * dt, 48, WORLD_WIDTH - 48);
        player.y = clamp(player.y + (tangent.y * 155 + radial.y * 34) * dt, 48, WORLD_HEIGHT - 48);
        if (hazard.cooldown <= 0) {
          hazard.cooldown = 0.9;
          this.damagePlayer(7);
          this.fxEvents.push({
            kind: "float-text",
            x: player.x,
            y: player.y - 72,
            text: "SPIN ZONE",
            color: 0xff5ea8
          });
        }
        continue;
      }

      if (hazard.kind === "mirror-reversal") {
        if (!active || hazard.cooldown > 0) {
          continue;
        }
        hazard.cooldown = 3.2;
        player.controlReverseTime = Math.max(player.controlReverseTime, 1.75);
        this.fxEvents.push({
          kind: "burst",
          x: player.x,
          y: player.y,
          radius: hazard.radius * 0.45,
          color: 0xc7b8ff
        });
        this.fxEvents.push({
          kind: "float-text",
          x: player.x,
          y: player.y - 76,
          text: "MIRROR FLIP",
          color: 0xc7b8ff
        });
        continue;
      }

      if (hazard.kind === "stasis-drain") {
        if (player.infiniteGaugeTime <= 0) {
          player.gauge = clamp(player.gauge - hazard.strength * dt, 0, player.maxGauge);
        }
        player.movementSlowTime = Math.max(player.movementSlowTime, 0.14);
        if (hazard.cooldown <= 0) {
          hazard.cooldown = 1.05;
          this.fxEvents.push({
            kind: "float-text",
            x: player.x,
            y: player.y - 80,
            text: "코어 드레인",
            color: 0x8c7aff
          });
        }
      }
    }
  }

  private updateSynergyEffects(dt: number): void {
    const state = this.state;
    if (this.hasSynergy("maru-oni-wall") && state.player.shield >= 50) {
      for (const enemy of state.enemies) {
        if (enemy.type === "dummy") {
          continue;
        }
        const dist = distance(state.player, enemy);
        if (dist > 0 && dist < state.player.radius + enemy.radius + 210) {
          const away = normalize({ x: enemy.x - state.player.x, y: enemy.y - state.player.y });
          enemy.x = clamp(enemy.x + away.x * 62 * dt, 28, WORLD_WIDTH - 28);
          enemy.y = clamp(enemy.y + away.y * 62 * dt, 28, WORLD_HEIGHT - 28);
          enemy.slowTime = Math.max(enemy.slowTime, 0.12);
        }
      }
    }

    const pulseTick = Math.floor(state.time * 2) !== Math.floor((state.time - dt) * 2);
    if (pulseTick && this.hasSynergy("maru-absolute-line") && state.player.shield >= 72) {
      for (const enemy of state.enemies) {
        if (enemy.type === "dummy" || distance(state.player, enemy) > state.player.radius + enemy.radius + 245) {
          continue;
        }
        const away = normalize({ x: enemy.x - state.player.x, y: enemy.y - state.player.y });
        enemy.x = clamp(enemy.x + away.x * 42, 28, WORLD_WIDTH - 28);
        enemy.y = clamp(enemy.y + away.y * 42, 28, WORLD_HEIGHT - 28);
        enemy.slowTime = Math.max(enemy.slowTime, 0.35);
        this.damageEnemy(enemy, 6, 0xffd166, { bypassFrontGuard: true });
      }
      this.fxEvents.push({ kind: "burst", x: state.player.x, y: state.player.y, radius: 245, color: 0xffd166, grade: "Great" });
    }

    if (pulseTick && this.hasSynergy("cookie-jelly-kingdom") && state.allies.length >= 6) {
      state.player.shield = Math.max(state.player.shield, Math.min(64, state.player.shield + 3));
      this.fxEvents.push({
        kind: "float-text",
        x: state.player.x,
        y: state.player.y - 104,
        text: "JELLY KINGDOM",
        color: 0x7dffb2
      });
    }
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
      this.setStageRegion("제로 존");
      state.spawnQueue.push("zero");
      state.waveActive = true;
      state.message = "제로 모션 난입";
      this.fxEvents.push({ kind: "sound", sound: "boss" });
      this.fxEvents.push({ kind: "shake", intensity: 0.018, duration: 320 });
    }

    if (state.modeTime >= state.survivalNextRewardAt && state.modeTime < 540) {
      state.survivalNextRewardAt += 60;
      this.openRewardChoice(3);
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

  private updateQuickDemoFlow(): void {
    const state = this.state;
    if (state.mode !== "quick-demo" || state.pendingRewardIds.length > 0 || state.gameOver || state.victory) {
      return;
    }

    let nextPhaseIndex = 0;
    for (let index = 0; index < quickDemoPhases.length; index += 1) {
      if (state.modeTime >= quickDemoPhases[index].startsAt) {
        nextPhaseIndex = index;
      }
    }
    if (nextPhaseIndex !== state.quickDemo.phaseIndex) {
      this.startQuickDemoPhase(nextPhaseIndex);
    }

    const activeBoss = state.enemies.find((enemy) => enemy.type === "drum");
    if (state.quickDemo.phaseIndex >= 3 && activeBoss && !state.quickDemo.bossChallengeStarted && state.modeTime >= 143 && !state.bossChallenge) {
      state.quickDemo.bossChallengeStarted = this.startBossChallenge(activeBoss, {
        bossType: "drum",
        requiredGesture: "cross-guard",
        prompt: "양팔을 X자로 모아 드럼 피날레를 막아요! 카메라가 없으면 1/2/3.",
        successEffect: "drum-counter",
        failDamage: 12,
        duration: 3.05
      });
      if (state.quickDemo.bossChallengeStarted) {
        activeBoss.pulseCooldown = Math.max(activeBoss.pulseCooldown, 5.2);
      }
    }

    if (state.quickDemo.bossSpawned && !activeBoss && state.spawnQueue.length === 0) {
      this.completeQuickDemo(true, "데모 완료");
      return;
    }

    if (state.modeTime >= QUICK_DEMO_DURATION) {
      this.completeQuickDemo(!activeBoss, activeBoss ? "데모 종료: 드럼 노이즈 생존" : "데모 완료");
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
      if (Math.abs(dir.x) + Math.abs(dir.y) > 0) {
        enemy.facing = dir;
      }
      if (isBossEnemy(enemy.type)) {
        this.updateBossPhase(enemy);
      }

      if (enemy.type === "dummy") {
        continue;
      } else if (enemy.type === "runner" || enemy.type === "swarm") {
        enemy.x += dir.x * enemy.speed * speedScale * dt;
        enemy.y += dir.y * enemy.speed * speedScale * dt;
      } else if (enemy.type === "castBreaker") {
        const desired = state.preparedSkill ? 2.45 : dist < 280 ? -0.25 : 0.7;
        enemy.x += dir.x * enemy.speed * speedScale * desired * dt;
        enemy.y += dir.y * enemy.speed * speedScale * desired * dt;
        if (state.preparedSkill && dist < enemy.radius + player.radius + 14) {
          state.preparedSkill = null;
          state.message = "캐스트 브레이커가 포즈를 끊었어요.";
          this.damagePlayer(5);
          enemy.slowTime = Math.max(enemy.slowTime, 0.7);
          enemy.pulseCooldown = 1.5;
          this.fxEvents.push({
            kind: "float-text",
            x: player.x,
            y: player.y - 86,
            text: "CAST BREAK",
            color: 0xff5ea8
          });
          this.fxEvents.push({ kind: "shake", intensity: 0.01, duration: 110 });
        }
      } else if (enemy.type === "shieldNoise") {
        const desired = dist < 210 ? -0.15 : dist > 360 ? 0.68 : 0.18;
        enemy.x += dir.x * enemy.speed * speedScale * desired * dt;
        enemy.y += dir.y * enemy.speed * speedScale * desired * dt;
      } else if (enemy.type === "anchorNoise") {
        const desired = dist < 360 ? -0.12 : dist > 520 ? 0.34 : 0;
        enemy.x += dir.x * enemy.speed * speedScale * desired * dt;
        enemy.y += dir.y * enemy.speed * speedScale * desired * dt;
        if (enemy.pulseCooldown <= 0) {
          this.spawnTrap({
            kind: "noise-trap",
            x: player.x + randomRange(-90, 90),
            y: player.y + randomRange(-90, 90),
            radius: 118,
            damage: 2.5,
            ttl: 4.8,
            color: 0x8c7aff
          });
          enemy.pulseCooldown = randomRange(4.2, 5.3);
          this.fxEvents.push({ kind: "float-text", x: enemy.x, y: enemy.y - 58, text: "ANCHOR", color: 0x8c7aff });
        }
      } else if (enemy.type === "medicNoise") {
        const desired = dist < 420 ? -0.5 : dist > 680 ? 0.4 : 0;
        const side = { x: -dir.y, y: dir.x };
        enemy.x += (dir.x * desired + side.x * 0.22) * enemy.speed * speedScale * dt;
        enemy.y += (dir.y * desired + side.y * 0.22) * enemy.speed * speedScale * dt;
        if (enemy.pulseCooldown <= 0) {
          const healed = this.healNearbyEnemies(enemy, 9, 300);
          enemy.pulseCooldown = healed > 0 ? 1.2 : 1.9;
        }
      } else if (enemy.type === "bombNoise") {
        enemy.x += dir.x * enemy.speed * speedScale * dt;
        enemy.y += dir.y * enemy.speed * speedScale * dt;
        if (dist < 86) {
          this.explodeBombNoise(enemy);
          continue;
        }
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
      } else if (enemy.type === "balloonClown") {
        const side = { x: -dir.y, y: dir.x };
        const desired = dist < 360 ? -0.28 : dist > 640 ? 0.58 : 0.08;
        const wobble = Math.sin(state.time * 2.4 + enemy.id) * 0.34;
        enemy.x += (dir.x * desired + side.x * wobble) * enemy.speed * speedScale * dt;
        enemy.y += (dir.y * desired + side.y * wobble) * enemy.speed * speedScale * dt;
        if (enemy.shootCooldown <= 0) {
          this.spawnPartyBombCircles(enemy, enemy.phase >= 3 ? 6 : enemy.phase >= 2 ? 4 : 3);
          enemy.shootCooldown = randomRange(enemy.phase >= 3 ? 2.3 : 3.1, enemy.phase >= 3 ? 3.1 : 4.2);
        }
        if (enemy.pulseCooldown <= 0) {
          this.performBalloonJump(enemy);
          this.startBalloonChallenge(enemy);
          enemy.pulseCooldown = randomRange(enemy.phase >= 3 ? 5.3 : 6.4, enemy.phase >= 3 ? 6.5 : 7.8);
        }
      } else if (enemy.type === "crystalReflector") {
        const side = { x: -dir.y, y: dir.x };
        const desired = dist < 420 ? -0.52 : dist > 720 ? 0.42 : 0.04;
        enemy.x += (dir.x * desired + side.x * 0.32) * enemy.speed * speedScale * dt;
        enemy.y += (dir.y * desired + side.y * 0.32) * enemy.speed * speedScale * dt;
        if (enemy.shootCooldown <= 0 && dist < 920) {
          this.fireCrystalLaser(enemy, dir);
          enemy.shootCooldown = randomRange(enemy.phase >= 3 ? 1.55 : 2.05, enemy.phase >= 3 ? 2.1 : 2.85);
        }
        if (enemy.pulseCooldown <= 0) {
          if (enemy.phase >= 2) {
            this.swapCrystalWithClone(enemy);
          }
          const challenged = this.startCrystalChallenge(enemy);
          if (!challenged && enemy.phase < 2) {
            this.spawnMirrorClone(enemy);
          }
          enemy.pulseCooldown = randomRange(enemy.phase >= 3 ? 5.5 : 6.6, enemy.phase >= 3 ? 6.6 : 8.2);
        }
      } else if (enemy.type === "drum") {
        const desired = dist < 520 ? -0.28 : dist > 720 ? 0.42 : 0;
        enemy.x += dir.x * enemy.speed * speedScale * desired * dt;
        enemy.y += dir.y * enemy.speed * speedScale * desired * dt;
        if (enemy.phase >= 2 && enemy.shootCooldown <= 0) {
          this.spawnDrumWarningCircles(enemy, enemy.phase >= 3 ? 5 : 3);
          enemy.shootCooldown = randomRange(enemy.phase >= 3 ? 2.4 : 3.4, enemy.phase >= 3 ? 3.2 : 4.3);
        }
        if (enemy.pulseCooldown <= 0) {
          this.fireDrumPulse(enemy);
          if (enemy.phase >= 3) {
            this.startDrumComboChallenge(enemy);
          } else {
            this.startBossChallenge(enemy, {
              bossType: "drum",
              requiredGesture: "cross-guard",
              prompt: "양팔을 X자로 모아 리듬을 반사해요!",
              successEffect: "drum-counter",
              failDamage: 18,
              duration: 2.25
            });
          }
          enemy.pulseCooldown = randomRange(6.4, 7.6);
        }
      } else if (enemy.type === "mirror") {
        const castingPressure = state.preparedSkill ? 1.6 : 1;
        const desired = dist < 430 ? -0.46 : dist > 690 ? 0.54 : 0.15;
        enemy.x += dir.x * enemy.speed * speedScale * desired * castingPressure * dt;
        enemy.y += dir.y * enemy.speed * speedScale * desired * castingPressure * dt;
        if (enemy.shootCooldown <= 0 && dist < 820) {
          if (enemy.phase >= 2) {
            this.fireMirrorCopiedSkill(enemy);
            enemy.shootCooldown = randomRange(enemy.phase >= 3 ? 1.05 : 1.25, enemy.phase >= 3 ? 1.55 : 1.9);
          } else {
            this.fireMirrorFan(enemy, dir);
            enemy.shootCooldown = randomRange(1.25, 1.8);
          }
        }
        if (enemy.pulseCooldown <= 0) {
          this.spawnMirrorClone(enemy);
          if (enemy.phase >= 3) {
            this.startMirrorPrisonChallenge(enemy);
          } else {
            this.startBossChallenge(enemy, {
              bossType: "mirror",
              requiredGesture: "slash",
              prompt: "손을 날카롭게 휘둘러 거울 분신을 깨세요",
              successEffect: "mirror-shatter",
              failDamage: 4,
              duration: 2.05
            });
          }
          enemy.pulseCooldown = randomRange(7.2, 8.6);
        }
      } else {
        const desired = dist < 470 ? -0.22 : dist > 660 ? 0.28 : 0;
        enemy.x += dir.x * enemy.speed * speedScale * desired * dt;
        enemy.y += dir.y * enemy.speed * speedScale * desired * dt;
        if (enemy.phase >= 2 && enemy.shootCooldown <= 0) {
          this.spawnZeroStasisHazards(enemy, enemy.phase >= 3 ? 2 : 1);
          enemy.shootCooldown = randomRange(enemy.phase >= 3 ? 4.2 : 5.2, enemy.phase >= 3 ? 5.2 : 6.4);
        }
        if (dist < 520) {
          player.gauge = clamp(player.gauge - 6 * dt, 0, player.maxGauge);
          player.dashCooldown = Math.max(player.dashCooldown, 0.15);
        }
        if (enemy.pulseCooldown <= 0) {
          const challenged =
            enemy.phase >= 3
              ? this.startZeroFinalChallenge(enemy)
              : this.startBossChallenge(enemy, {
                  bossType: "zero",
                  requiredGesture: "open-arms",
                  prompt: "양팔을 크게 벌려 정지장을 깨요!",
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

      if (!isBossEnemy(enemy.type) && dist < enemy.radius + player.radius && player.hurtCooldown <= 0) {
        this.damagePlayer(contactDamageForEnemy(enemy.type));
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
      if (trap.kind === "drum-warning") {
        if (trap.ttl <= 0) {
          if (distance(trap, state.player) < trap.radius + state.player.radius) {
            state.player.invulnerableTime = 0;
            state.player.hurtCooldown = 0;
            this.damagePlayer(trap.damage);
          }
          this.fxEvents.push({
            kind: "burst",
            x: trap.x,
            y: trap.y,
            radius: trap.radius * 1.2,
            color: trap.color,
            grade: "Great"
          });
          this.fxEvents.push({ kind: "shake", intensity: 0.009, duration: 100 });
          continue;
        }
        remaining.push(trap);
        continue;
      }
      if (trap.ttl <= 0) {
        continue;
      }

      if (trap.pulseTimer <= 0) {
        trap.pulseTimer = trap.kind === "sweet-field" ? 0.55 : 0.48;
        for (const enemy of [...state.enemies]) {
          if (distance(trap, enemy) < trap.radius + enemy.radius) {
            enemy.slowTime = Math.max(enemy.slowTime, trap.kind === "sweet-field" ? 1.25 : 0.7);
            let markBonus = enemy.markedTime > 0 ? 1.45 : 1;
            if (this.hasSynergy("neon-hacking-field") && enemy.markedTime > 0) {
              markBonus *= 1.22;
              const spillTarget = state.enemies
                .filter((item) => item.id !== enemy.id && item.type !== "dummy")
                .map((item) => ({ enemy: item, dist: distance(enemy, item) }))
                .filter((item) => item.dist < 210)
                .sort((a, b) => a.dist - b.dist)[0]?.enemy;
              if (spillTarget) {
                spillTarget.markedTime = Math.max(spillTarget.markedTime, 3.5);
              }
            }
            this.damageEnemy(enemy, trap.damage * markBonus, trap.color, { source: trap, bypassFrontGuard: true });
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
    const slimePartyChef = this.hasSynergy("cookie-slime-party-chef") && state.allies.length >= 5;
    const jellyKingdom = this.hasSynergy("cookie-jelly-kingdom") && state.allies.length >= 6;
    const allyTempo = jellyKingdom ? 1.52 : slimePartyChef ? 1.35 : 1;

    for (const ally of state.allies) {
      ally.ttl -= dt;
      ally.attackCooldown = Math.max(0, ally.attackCooldown - dt * allyTempo);
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
          this.damageEnemy(target, ally.damage * (jellyKingdom ? 1.18 : 1), ally.color, { source: ally, sourceAllyKind: ally.kind });
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
          this.registerTutorialBasicAttackHit();
          this.damageEnemy(hit, projectile.damage, projectile.color, { source: projectile });
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

    const basicExpert = this.hasSynergy("basic-attack-expert");
    const attackInterval = 0.48 / state.upgrades.basicAttackRateMultiplier / (basicExpert ? 1.14 : 1);
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
      damage: character.basicDamage * state.upgrades.basicDamageMultiplier * this.getGlobalDamageMultiplier() * (basicExpert ? 1.12 : 1),
      radius: 7 + Math.max(0, state.upgrades.basicProjectileSpeedMultiplier - 1) * 6,
      ttl: 1.2,
      color: character.basicColor
    });

    if (basicExpert && Math.random() < 0.34) {
      const sideAngle = Math.atan2(direction.y, direction.x) + randomRange(-0.22, 0.22);
      this.spawnProjectile({
        owner: "player",
        x: player.x + Math.cos(sideAngle) * 24,
        y: player.y + Math.sin(sideAngle) * 24,
        direction: { x: Math.cos(sideAngle), y: Math.sin(sideAngle) },
        speed: 720 * state.upgrades.basicProjectileSpeedMultiplier,
        damage: character.basicDamage * 0.58 * state.upgrades.basicDamageMultiplier * this.getGlobalDamageMultiplier(),
        radius: 5,
        ttl: 1.1,
        color: 0xffd166
      });
    }

    if (player.overdriveTime > 0) {
      this.damageEnemy(target, 7 * state.upgrades.overdriveDamageMultiplier, 0xd7ff3f, { sourceSkillId: "thunder-overdrive" });
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
    if (state.mode === "tutorial" || state.mode === "training" || state.mode === "survival" || state.mode === "quick-demo") {
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
      this.addUnlockedAchievements(clearResult?.unlockedAchievements ?? []);
      this.addCharacterQuestUnlocks(clearResult?.characterQuestUnlocks ?? []);
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

      this.openRewardChoice(3);
      state.message = clearResult ? `${state.adventureStageCode} ${clearResult.grade} CLEAR` : `${state.adventureStageCode} CLEAR`;
      this.fxEvents.push({
        kind: "float-text",
        x: state.player.x,
        y: state.player.y - 118,
        text: "STAGE CLEAR",
        color: 0xffd166
      });
      this.fxEvents.push({ kind: "sound", sound: "reward-rare" });
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

      this.openRewardChoice(3);
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

    this.openRewardChoice(3);
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
      hpRatio: state.player.hp / state.player.maxHp,
      misses: Math.max(0, state.runStats.misses - state.adventureStageStartMisses),
      characterId: state.characterId
    }) ?? null;
  }

  private setStageRegion(region: StageRegion): void {
    this.state.stageRegion = region;
    this.state.stageHazards = this.createStageHazards(region);
  }

  private createStageHazards(region: StageRegion): StageHazardState[] {
    if (region === "놀이공원") {
      return [
        this.createStageHazard("rotator", WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 178, 12, 0),
        this.createStageHazard("rotator", WORLD_WIDTH / 2 - 440, WORLD_HEIGHT / 2 + 210, 126, 9, 1.7),
        this.createStageHazard("rotator", WORLD_WIDTH / 2 + 470, WORLD_HEIGHT / 2 - 210, 118, 8, 3.1)
      ];
    }

    if (region === "미러 타워") {
      return [
        this.createStageHazard("mirror-reversal", WORLD_WIDTH / 2 - 310, WORLD_HEIGHT / 2 - 130, 150, 1, 0.3),
        this.createStageHazard("mirror-reversal", WORLD_WIDTH / 2 + 330, WORLD_HEIGHT / 2 + 150, 146, 1, 2.1)
      ];
    }

    if (region === "제로 존") {
      return [
        this.createStageHazard("stasis-drain", WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 196, 11, 0),
        this.createStageHazard("stasis-drain", WORLD_WIDTH / 2 - 500, WORLD_HEIGHT / 2 - 250, 138, 7, 1.4),
        this.createStageHazard("stasis-drain", WORLD_WIDTH / 2 + 500, WORLD_HEIGHT / 2 + 248, 138, 7, 2.8)
      ];
    }

    return [];
  }

  private createStageHazard(
    kind: StageHazardState["kind"],
    x: number,
    y: number,
    radius: number,
    strength: number,
    phase: number
  ): StageHazardState {
    return {
      id: this.nextEntityId++,
      kind,
      x,
      y,
      radius,
      strength,
      phase,
      angle: phase,
      cooldown: 0,
      pulseTimer: 0,
      activeTime: 0
    };
  }

  private updateObjectiveState(): void {
    const state = this.state;
    const setObjective = (text: string, detail: string, progress: number, urgent = false) => {
      state.objectiveText = text;
      state.objectiveDetail = detail;
      state.objectiveProgress = clamp(progress, 0, 100);
      state.objectiveIsUrgent = urgent || state.objectiveProgress >= 90;
    };

    if (state.mode === "title") {
      setObjective("시작할 모드를 고르세요.", "튜토리얼, 훈련장, 모험을 선택할 수 있어요.", 0);
      return;
    }

    if (state.pendingRewardIds.length > 0) {
      setObjective("보상 카드 1장을 고르세요.", "이번 런의 빌드 방향을 정해요.", 100, true);
      return;
    }

    if (state.victory) {
      setObjective("클리어!", "기록, XP, 새 해금을 확인해요.", 100);
      return;
    }

    if (state.gameOver) {
      setObjective("재도전 준비", "다시 도전하거나 허브로 돌아갈 수 있어요.", 0);
      return;
    }

    const bossType = this.getActiveObjectiveBossType();
    if (bossType) {
      const boss = state.enemies.find((enemy) => enemy.type === bossType);
      const bossProgress = boss ? ((boss.maxHp - Math.max(0, boss.hp)) / Math.max(1, boss.maxHp)) * 100 : 0;
      const challengeDetail = state.bossChallenge
        ? `보스 포즈: ${gestureObjectiveLabel(state.bossChallenge.requiredGesture)}로 패턴을 끊어요.`
        : "큰 패턴 전 보스 포즈 신호를 봐요.";
      setObjective(`${bossDisplayName(bossType)} 처치`, challengeDetail, bossProgress, Boolean(state.bossChallenge) || bossProgress >= 70);
      return;
    }

    if (state.mode === "tutorial") {
      const step = state.tutorial.steps[state.tutorial.currentStepIndex];
      const completed = state.tutorial.steps.filter((item) => item.completed).length;
      const progress = (completed / Math.max(1, state.tutorial.steps.length)) * 100;
      setObjective(
        step ? step.title : "튜토리얼 완료",
        step ? step.prompt : "포즈 캐스트 흐름을 익혔어요.",
        progress,
        progress >= 85
      );
      return;
    }

    if (state.mode === "training") {
      const mission = state.training.missions.find((item) => !item.completed) ?? state.training.missions[state.training.missions.length - 1];
      const totalTargets = state.training.missions.reduce((sum, item) => sum + item.targetSuccesses, 0);
      const totalSuccesses = state.training.missions.reduce((sum, item) => sum + Math.min(item.successes, item.targetSuccesses), 0);
      const progress = totalTargets > 0 ? (totalSuccesses / totalTargets) * 100 : 0;
      setObjective(
        mission ? `${gestureObjectiveLabel(mission.gestureId)} 5회 성공` : "포즈 미션 완료",
        mission ? `${mission.title} · ${Math.min(mission.successes, mission.targetSuccesses)}/${mission.targetSuccesses} · ${mission.prompt}` : "모든 연습 미션 완료!",
        progress,
        Boolean(mission && !mission.completed && mission.successes >= mission.targetSuccesses - 1)
      );
      return;
    }

    if (state.mode === "quick-demo") {
      const remainingSeconds = Math.max(0, QUICK_DEMO_DURATION - state.modeTime);
      const phase = quickDemoPhases[Math.max(0, Math.min(state.quickDemo.phaseIndex, quickDemoPhases.length - 1))];
      const phaseLabel =
        state.quickDemo.phaseIndex <= 0
          ? "Q를 누르고 슬래시 포즈를 해요."
          : state.quickDemo.phaseIndex === 1
            ? "보상 카드 1장을 고르고 웨이브를 정리해요."
            : state.quickDemo.phaseIndex === 2
              ? "새 적을 상대하며 AR 가이드를 확인해요."
              : "드럼 노이즈의 보스 포즈 브레이크를 막아요!";
      setObjective(
        "3분 안에 핵심 재미를 체험해요.",
        `${phase?.message ?? phaseLabel} · 남은 시간 ${formatObjectiveTime(remainingSeconds)} · ${phaseLabel}`,
        (state.modeTime / QUICK_DEMO_DURATION) * 100,
        remainingSeconds <= 20 || state.quickDemo.phaseIndex >= 3
      );
      return;
    }

    if (state.mode === "survival") {
      const targetSeconds = 600;
      const remainingSeconds = Math.max(0, targetSeconds - state.modeTime);
      const progress = (state.modeTime / targetSeconds) * 100;
      const rewardDetail =
        state.modeTime >= state.survivalNextRewardAt - 8
          ? "곧 보상 카드가 도착해요."
          : `다음 보상까지 ${formatObjectiveTime(Math.max(0, state.survivalNextRewardAt - state.modeTime))}`;
      setObjective(
        "10분 동안 생존해요.",
        `남은 시간 ${formatObjectiveTime(remainingSeconds)} · Wave ${state.waveIndex} · ${rewardDetail}`,
        progress,
        remainingSeconds <= 60 || state.modeTime >= state.survivalNextRewardAt - 8
      );
      return;
    }

    if (state.mode === "boss-rush") {
      const current = Math.min(Math.max(1, state.bossRushIndex), bossRushPlan.length);
      const nextBoss = bossRushPlan[Math.min(current - 1, bossRushPlan.length - 1)];
      setObjective(
        "보스 러시를 돌파해요.",
        `${current}/${bossRushPlan.length} · ${bossDisplayName(nextBoss)} 준비`,
        ((current - 1) / Math.max(1, bossRushPlan.length)) * 100,
        current >= bossRushPlan.length
      );
      return;
    }

    if (state.mode === "adventure") {
      const remaining = state.spawnQueue.length + state.enemies.length;
      const total = Math.max(1, state.adventureStageEnemyTotal);
      const progress = ((total - remaining) / total) * 100;
      setObjective(
        state.adventureStageGoal || "현재 스테이지를 클리어해요.",
        `AREA ${state.adventureStageCode} · ${state.stageName} · 남은 노이즈 ${remaining}`,
        progress,
        remaining <= 2
      );
      return;
    }

    const currentWave = Math.max(1, state.waveIndex);
    const totalWaves = wavePlans.length;
    const currentPlan = wavePlans[Math.max(0, Math.min(currentWave - 1, totalWaves - 1))] ?? [];
    const remaining = state.spawnQueue.length + state.enemies.length;
    const waveProgress = currentPlan.length > 0 ? (currentPlan.length - remaining) / currentPlan.length : 1;
    const progress = ((currentWave - 1 + clamp(waveProgress, 0, 1)) / totalWaves) * 100;
    setObjective(
      "5개의 웨이브를 돌파해요.",
      `Wave ${currentWave}/${totalWaves} · 남은 노이즈 ${remaining}`,
      progress,
      currentWave >= totalWaves && remaining <= 2
    );
  }

  private getActiveObjectiveBossType(): BossChallengeState["bossType"] | null {
    const activeBoss = this.state.enemies.find((enemy) => isBossEnemy(enemy.type));
    if (activeBoss && isBossEnemy(activeBoss.type)) {
      return activeBoss.type;
    }

    return null;
  }

  private startMode(): void {
    if (this.state.mode === "title") {
      this.startTitle();
      return;
    }
    if (this.state.mode === "tutorial") {
      this.startTutorial();
      return;
    }
    if (this.state.mode === "training") {
      this.startTraining();
      return;
    }
    if (this.state.mode === "quick-demo") {
      this.startQuickDemo();
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

  private startTitle(): void {
    const state = this.state;
    state.waveActive = false;
    state.spawnQueue = [];
    state.spawnTimer = 0;
    state.stageName = "무브캐스터즈 데모";
    this.setStageRegion("루프시티");
    state.player.x = WORLD_WIDTH / 2;
    state.player.y = WORLD_HEIGHT / 2;
    state.player.gauge = Math.max(state.player.gauge, 60);
    state.message = "타이틀";
    state.enemies = [];
    state.projectiles = [];
    state.traps = [];
    state.allies = [];
    state.preparedSkill = null;
    state.bossChallenge = null;
  }

  private startQuickDemo(): void {
    const state = this.state;
    state.stageName = "3분 데모";
    this.setStageRegion("루프시티");
    state.modeTime = 0;
    state.waveIndex = 0;
    state.bossRushIndex = 0;
    state.survivalFinalBossSpawned = false;
    state.survivalNextRewardAt = 60;
    state.quickDemo = {
      phaseIndex: -1,
      rewardOffered: false,
      bossSpawned: false,
      bossChallengeStarted: false
    };
    state.waveActive = false;
    state.spawnQueue = [];
    state.spawnTimer = 0;
    state.pendingRewardIds = [];
    state.rewardOfferHistoryIds = [];
    state.rewardRerollsRemaining = Math.max(state.rewardRerollsRemaining, 1);
    state.player.x = WORLD_WIDTH / 2;
    state.player.y = WORLD_HEIGHT / 2;
    state.player.hp = state.player.maxHp;
    state.player.shield = Math.max(state.player.shield, 18);
    state.player.gauge = state.player.maxGauge;
    state.enemies = [];
    state.projectiles = [];
    state.traps = [];
    state.allies = [];
    state.preparedSkill = null;
    state.bossChallenge = null;
    state.message = "3분 데모 시작";
    this.startQuickDemoPhase(0);
    this.pushCutIn("3분 데모", "Q 스킬, 보상 카드, AR 포즈, 보스 카운터까지 빠르게!", 0x48f7ff, 720);
    this.fxEvents.push({ kind: "sound", sound: "cast-start" });
  }

  private startQuickDemoPhase(phaseIndex: number): void {
    const state = this.state;
    const phase = quickDemoPhases[phaseIndex];
    if (!phase) {
      return;
    }

    state.quickDemo.phaseIndex = phaseIndex;
    state.stageName = phase.title;
    this.setStageRegion(phase.region);
    state.waveIndex = phaseIndex + 1;
    state.message = phase.message;
    state.player.gauge = clamp(state.player.gauge + (phaseIndex === 0 ? 100 : 36), 0, state.player.maxGauge);
    state.projectiles = state.projectiles.filter((projectile) => projectile.owner === "player");

    if (phaseIndex === 1 && !state.quickDemo.rewardOffered) {
      state.spawnQueue = [...phase.enemies].sort(() => Math.random() - 0.5);
      state.spawnTimer = 0.18;
      state.waveActive = true;
      state.quickDemo.rewardOffered = true;
      this.openRewardChoice(3);
      this.fxEvents.push({ kind: "float-text", x: state.player.x, y: state.player.y - 118, text: "BUILD PICK", color: 0xffd166 });
      this.fxEvents.push({ kind: "sound", sound: "reward-rare" });
      return;
    }

    if (phaseIndex === 3) {
      state.enemies = state.enemies.filter((enemy) => isBossEnemy(enemy.type));
      state.spawnQueue = [];
      state.waveActive = true;
      if (!state.quickDemo.bossSpawned) {
        state.quickDemo.bossSpawned = true;
        this.spawnEnemy("drum");
        const boss = state.enemies.find((enemy) => enemy.type === "drum");
        if (boss) {
          boss.maxHp = Math.min(boss.maxHp, 360);
          boss.hp = boss.maxHp;
          boss.phase = 2;
          boss.pulseCooldown = 1.2;
          boss.shootCooldown = 1.8;
          boss.slowTime = 0.4;
          state.quickDemo.bossChallengeStarted = this.startBossChallenge(boss, {
            bossType: "drum",
            requiredGesture: "cross-guard",
            prompt: "양팔을 X자로 모아 드럼 피날레를 막아요! 카메라가 없으면 1/2/3.",
            successEffect: "drum-counter",
            failDamage: 12,
            duration: 3.05
          });
          if (state.quickDemo.bossChallengeStarted) {
            boss.pulseCooldown = 5.2;
          }
        }
      }
      this.fxEvents.push({ kind: "float-text", x: state.player.x, y: state.player.y - 132, text: "MINI BOSS", color: 0xffd166 });
      this.fxEvents.push({ kind: "sound", sound: "boss" });
      return;
    }

    state.spawnQueue.push(...[...phase.enemies].sort(() => Math.random() - 0.5));
    state.waveActive = true;
    state.spawnTimer = Math.min(state.spawnTimer, 0.18);
    this.fxEvents.push({
      kind: "float-text",
      x: state.player.x,
      y: state.player.y - 116,
      text: phaseIndex === 2 ? "CAMERA AR" : "DEMO START",
      color: phaseIndex === 2 ? 0xff5ea8 : 0x48f7ff
    });
  }

  private completeQuickDemo(victory: boolean, message: string): void {
    const state = this.state;
    if (state.victory || state.gameOver) {
      return;
    }

    state.victory = victory;
    state.gameOver = !victory;
    state.message = message;
    state.preparedSkill = null;
    state.bossChallenge = null;
    state.spawnQueue = [];
    state.waveActive = false;
    this.recordRunEnd(victory);
    this.fxEvents.push({
      kind: "burst",
      x: state.player.x,
      y: state.player.y,
      radius: victory ? 270 : 190,
      color: victory ? 0xb8ff5c : 0xff5ea8,
      grade: victory ? "Perfect" : "Normal"
    });
    this.pushCutIn(victory ? "데모 완료" : "데모 실패", message, victory ? 0xb8ff5c : 0xff5ea8, 760);
  }

  private startTutorial(): void {
    const state = this.state;
    state.waveActive = false;
    state.spawnQueue = [];
    state.spawnTimer = 0;
    state.stageName = "포즈 브레이크 튜토리얼";
    this.setStageRegion("루프시티");
    state.player.x = WORLD_WIDTH / 2;
    state.player.y = WORLD_HEIGHT / 2;
    state.player.gauge = state.player.maxGauge;
    state.player.hp = state.player.maxHp;
    state.message = "튜토리얼 시작";
    state.tutorial = createTutorialState();
    state.enemies = [];
    state.projectiles = [];
    state.traps = [];
    state.allies = [];
    this.setupTutorialStep();
    this.fxEvents.push({
      kind: "float-text",
      x: state.player.x,
      y: state.player.y - 112,
      text: "TUTORIAL",
      color: 0x48f7ff
    });
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
    this.setStageRegion(stage.region);
    state.adventureStageCode = stage.code;
    state.adventureStageGoal = stage.goal;
    state.adventureStageEnemyTotal = stage.enemies.length;
    state.adventureStageStartTime = state.modeTime;
    state.adventureStageStartScore = state.player.score;
    state.adventureStageStartMisses = state.runStats.misses;
    state.waveIndex = state.adventureStageIndex + 1;
    state.spawnQueue = this.applyDailySpawnModifiers([...stage.enemies]);
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
    this.fxEvents.push({ kind: "sound", sound: stage.enemies.some((enemy) => isBossEnemy(enemy)) ? "boss" : "reward-common" });
  }

  private startTraining(): void {
    const state = this.state;
    state.waveActive = false;
    state.spawnQueue = [];
    state.spawnTimer = 0;
    state.stageName = "훈련장";
    this.setStageRegion("훈련장");
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
      facing: { x: 1, y: 0 },
      phase: 1,
      phaseTriggered: { phase2: false, phase3: false },
      shootCooldown: 0,
      pulseCooldown: 0,
      markedTime: 0,
      slowTime: 0,
      hitFlash: 0
    }));
  }

  private updateTutorial(dt: number, input: SimulationInput): void {
    const state = this.state;
    if (state.mode !== "tutorial" || state.tutorial.completed) {
      return;
    }

    const step = this.getCurrentTutorialStep();
    if (!step) {
      this.completeTutorial();
      return;
    }

    if (step.id === "move") {
      const moving = Math.abs(input.move.x) + Math.abs(input.move.y) > 0.2;
      state.tutorial.moveSeconds = moving ? state.tutorial.moveSeconds + dt : Math.max(0, state.tutorial.moveSeconds - dt * 0.35);
      if (state.tutorial.moveSeconds >= 0.8) {
        this.completeTutorialStep("move");
      }
      return;
    }

    if (step.id === "basic-attack" && state.enemies.length === 0) {
      this.spawnTutorialBasicTarget();
      return;
    }

    if (step.id === "cast-skill" && state.enemies.length < 2) {
      this.spawnTutorialSkillTargets();
      return;
    }

    if (step.id === "boss-pose-break" && !state.bossChallenge && !state.tutorial.bossChallengeCleared) {
      this.startTutorialBossPoseBreak();
    }
  }

  private completeTutorialStep(stepId: TutorialStepId): boolean {
    const state = this.state;
    if (state.mode !== "tutorial" || state.tutorial.completed) {
      return false;
    }

    const step = this.getCurrentTutorialStep();
    if (!step || step.id !== stepId || step.completed) {
      return false;
    }

    step.completed = true;
    state.tutorial.currentStepIndex += 1;
    state.message = `${step.title} 완료`;
    this.fxEvents.push({
      kind: "float-text",
      x: state.player.x,
      y: state.player.y - 116,
      text: "STEP CLEAR",
      color: 0xb8ff5c
    });
    this.fxEvents.push({ kind: "sound", sound: "reward-common" });

    if (state.tutorial.currentStepIndex >= state.tutorial.steps.length) {
      this.completeTutorial();
      return true;
    }

    this.setupTutorialStep();
    return true;
  }

  private setupTutorialStep(): void {
    const state = this.state;
    const step = this.getCurrentTutorialStep();
    if (!step) {
      return;
    }

    state.message = step.prompt;
    if (step.id === "basic-attack") {
      state.enemies = [];
      state.projectiles = [];
      state.player.attackTimer = 0.08;
      this.spawnTutorialBasicTarget();
      return;
    }

    if (step.id === "prepare-q") {
      state.player.gauge = state.player.maxGauge;
      state.cooldowns.Q = 0;
      state.message = "Q를 눌러 스파크 슬래시 준비";
      return;
    }

    if (step.id === "cast-skill") {
      state.player.gauge = state.player.maxGauge;
      state.cooldowns.Q = 0;
      this.spawnTutorialSkillTargets();
      return;
    }

    if (step.id === "reward") {
      this.openRewardChoice(3);
      state.message = "첫 보상 카드를 골라요.";
      return;
    }

    if (step.id === "boss-pose-break") {
      state.pendingRewardIds = [];
      state.rewardOfferHistoryIds = [];
      state.projectiles = [];
      state.traps = [];
      state.enemies = [];
      this.startTutorialBossPoseBreak();
    }
  }

  private getCurrentTutorialStep() {
    return this.state.tutorial.steps[this.state.tutorial.currentStepIndex] ?? null;
  }

  private currentTutorialStepIs(stepId: TutorialStepId): boolean {
    return this.state.mode === "tutorial" && this.getCurrentTutorialStep()?.id === stepId;
  }

  private registerTutorialBasicAttackHit(): void {
    const state = this.state;
    if (!this.currentTutorialStepIs("basic-attack")) {
      return;
    }
    state.tutorial.basicAttackHits += 1;
    this.completeTutorialStep("basic-attack");
  }

  private spawnTutorialBasicTarget(): void {
    const player = this.state.player;
    this.spawnTutorialEnemy("dummy", player.x + 320, player.y - 20, 180);
  }

  private spawnTutorialSkillTargets(): void {
    const state = this.state;
    const player = state.player;
    const existingTargets = state.enemies.filter((enemy) => enemy.type === "dummy");
    if (existingTargets.length >= 3) {
      return;
    }
    state.enemies = state.enemies.filter((enemy) => enemy.type !== "dummy");
    this.spawnTutorialEnemy("dummy", player.x + 330, player.y, 420);
    this.spawnTutorialEnemy("dummy", player.x + 430, player.y - 84, 420);
    this.spawnTutorialEnemy("dummy", player.x + 430, player.y + 84, 420);
  }

  private startTutorialBossPoseBreak(): void {
    const state = this.state;
    let boss = this.findBoss("drum");
    if (!boss) {
      const player = state.player;
      boss = this.spawnTutorialEnemy("drum", player.x + 340, player.y, 680);
    }
    boss.pulseCooldown = Math.max(boss.pulseCooldown, 5);
    this.startBossChallenge(boss, {
      bossType: "drum",
      sequence: ["cross-guard"],
      prompt: "양팔을 X자로 모아 리듬 폭격을 막아요!",
      stepPrompts: ["크로스 가드: 양팔을 X자로 모아요"],
      successEffect: "drum-counter",
      failDamage: 8,
      duration: 3.4
    });
  }

  private spawnTutorialEnemy(type: EnemyType, x: number, y: number, hpOverride?: number): EnemyState {
    const stats = enemyStats(type, 1);
    const enemy: EnemyState = {
      id: this.nextEntityId++,
      type,
      x: clamp(x, 90, WORLD_WIDTH - 90),
      y: clamp(y, 90, WORLD_HEIGHT - 90),
      radius: stats.radius,
      hp: hpOverride ?? stats.hp,
      maxHp: hpOverride ?? stats.hp,
      speed: type === "dummy" ? 0 : randomRange(stats.speedMin, stats.speedMax),
      facing: normalize({ x: this.state.player.x - x, y: this.state.player.y - y }),
      phase: 1,
      phaseTriggered: { phase2: false, phase3: false },
      shootCooldown: type === "drum" ? 3.6 : 0,
      pulseCooldown: type === "drum" ? 5 : 0,
      markedTime: 0,
      slowTime: 0,
      hitFlash: 0
    };
    this.state.enemies.push(enemy);
    this.addUnlockedAchievements(this.progression?.recordEnemySeen(type) ?? []);
    return enemy;
  }

  private applyDailySpawnModifiers(queue: EnemyType[]): EnemyType[] {
    if (this.state.mode === "tutorial" || this.state.mode === "training") {
      return queue;
    }

    const next = [...queue];
    if (this.dailyModifiers.swarmSpawnBonus > 0) {
      const extraSwarms = Math.max(1, Math.floor(queue.length * this.dailyModifiers.swarmSpawnBonus * 0.45));
      for (let index = 0; index < extraSwarms; index += 1) {
        next.push("swarm");
      }
    }

    if (this.dailyModifiers.mirrorZeroSpawnBonus > 0) {
      const disruptors: EnemyType[] = ["castBreaker", "shieldNoise", "anchorNoise"];
      const extraDisruptors = Math.max(1, Math.floor(queue.length * this.dailyModifiers.mirrorZeroSpawnBonus * 0.28));
      for (let index = 0; index < extraDisruptors; index += 1) {
        next.push(disruptors[(this.state.waveIndex + index) % disruptors.length]);
      }
    }

    return next;
  }

  private completeTutorial(): void {
    const state = this.state;
    if (state.tutorial.completed) {
      return;
    }
    state.tutorial.completed = true;
    state.tutorial.bossChallengeCleared = true;
    state.bossChallenge = null;
    state.preparedSkill = null;
    state.pendingRewardIds = [];
    state.rewardOfferHistoryIds = [];
    state.victory = true;
    state.message = "튜토리얼 완료";
    state.player.score += 850;
    this.progression?.markTutorialCompleted();
    this.recordRunEnd(true);
    this.fxEvents.push({
      kind: "burst",
      x: state.player.x,
      y: state.player.y,
      radius: 260,
      color: 0xffd166,
      grade: "Perfect"
    });
    this.fxEvents.push({
      kind: "float-text",
      x: state.player.x,
      y: state.player.y - 148,
      text: "TUTORIAL CLEAR",
      color: 0xffd166
    });
  }

  private startNextWave(): void {
    const state = this.state;
    if (state.waveIndex >= wavePlans.length) {
      state.victory = true;
      this.recordRunEnd(true);
      return;
    }

    state.spawnQueue = this.applyDailySpawnModifiers([...wavePlans[state.waveIndex]]).sort(() => Math.random() - 0.5);
    state.waveIndex += 1;
    state.stageName = state.waveIndex < 5 ? "루프시티 거리" : "드럼 노이즈";
    this.setStageRegion("루프시티");
    state.waveActive = true;
    state.spawnTimer = 0.25;
    state.player.gauge = clamp(state.player.gauge + 18, 0, state.player.maxGauge);
    state.message = `Wave ${state.waveIndex}`;
  }

  private startSurvival(): void {
    const state = this.state;
    state.stageName = "루프시티 생존";
    this.setStageRegion("루프시티");
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
    state.spawnQueue.push(...this.applyDailySpawnModifiers(makeSurvivalWave(state.waveIndex)));
    state.waveActive = true;
    state.spawnTimer = Math.min(state.spawnTimer, 0.2);
    state.message = `Survival ${state.waveIndex}`;
  }

  private startBossRush(): void {
    const state = this.state;
    state.stageName = "보스 러시";
    this.setStageRegion("보스 러시");
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
    this.setStageRegion(stageRegionForBoss(boss));
    state.spawnQueue = [boss];
    state.bossRushIndex += 1;
    state.waveIndex = state.bossRushIndex;
    state.waveActive = true;
    state.spawnTimer = 0.2;
    state.player.gauge = clamp(state.player.gauge + 35, 0, state.player.maxGauge);
    state.message = bossDisplayName(boss);
  }

  private continueAfterReward(): void {
    if (this.state.mode === "tutorial") {
      this.completeTutorialStep("reward");
      return;
    }
    if (this.state.mode === "quick-demo") {
      this.state.waveActive = true;
      this.state.message = "3분 데모 재개";
      this.state.player.gauge = clamp(this.state.player.gauge + 20, 0, this.state.player.maxGauge);
      return;
    }
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
    const isBoss = isBossEnemy(type);
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
    const difficultyModifiers = this.getDifficultyModifiers();
    const hpMultiplier = isBoss ? this.dailyModifiers.bossHpMultiplier : this.dailyModifiers.enemyHpMultiplier;
    const hp = Math.round(stats.hp * hpMultiplier * difficultyModifiers.enemyHpMultiplier);
    const enemy: EnemyState = {
      id: this.nextEntityId++,
      type,
      x,
      y,
      radius: stats.radius,
      hp,
      maxHp: hp,
      speed: randomRange(stats.speedMin, stats.speedMax) * this.dailyModifiers.enemySpeedMultiplier * difficultyModifiers.enemySpeedMultiplier,
      facing: normalize({ x: this.state.player.x - x, y: this.state.player.y - y }),
      phase: 1,
      phaseTriggered: { phase2: false, phase3: false },
      shootCooldown: randomRange(0.6, 1.6),
      pulseCooldown: randomRange(1.3, 2.2),
      markedTime: 0,
      slowTime: 0,
      hitFlash: 0
    };
    this.state.enemies.push(enemy);
    this.addUnlockedAchievements(this.progression?.recordEnemySeen(type) ?? []);
    if (isBossEnemy(type)) {
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
    this.updateMaxSlimesMaintained();
  }

  private updateMaxSlimesMaintained(): void {
    this.state.runStats.maxSlimesMaintained = Math.max(this.state.runStats.maxSlimesMaintained, this.state.allies.length);
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
        this.damageEnemy(enemy, damage, skill.color, { sourceSkillId: skill.id });
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
        this.damageEnemy(enemy, damage, skill.color, { sourceSkillId: skill.id });
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
    const maxTargets =
      (grade === "Perfect" ? 7 : grade === "Great" ? 5 : 3) +
      state.upgrades.chainExtraTargets +
      comboBonus +
      (this.hasSynergy("rio-chain-master") ? 2 : 0);
    let damage = skill.damageByGrade[grade] * state.upgrades.chainDamageMultiplier * this.getSkillDamageMultiplier();
    if (this.hasSynergy("rio-chain-master")) {
      damage *= 1.08;
    }
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
        this.damageEnemy(enemy, damage, skill.color, { sourceSkillId: skill.id });
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
          this.damageEnemy(enemy, damage * 1.9, skill.color, { sourceSkillId: skill.id });
          enemy.slowTime = Math.max(enemy.slowTime, 1.4);
        }
      }
      this.addCharacterQuestUnlocks(this.progression?.recordCharacterQuestProgress("neon", "neon-trap-overlaps", 1, "add") ?? []);
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
        this.damageEnemy(enemy, damage, skill.color, { sourceSkillId: skill.id });
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
    state.runStats.slimesSummoned += count;
    this.addCharacterQuestUnlocks(this.progression?.recordCharacterQuestProgress("cookie", "cookie-slimes-summoned", count, "add") ?? []);

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
    state.runStats.slimesSummoned += 1;
    this.addCharacterQuestUnlocks(this.progression?.recordCharacterQuestProgress("cookie", "cookie-slimes-summoned", 1, "add") ?? []);

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
    state.runStats.slimesSummoned += smallCount;
    this.addCharacterQuestUnlocks(this.progression?.recordCharacterQuestProgress("cookie", "cookie-slimes-summoned", smallCount, "add") ?? []);

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
        text: "코어 +",
        color: 0xb8ff5c
      });
    }
    if (player.comboPerfect === 3) {
      player.comboRangeBonusTime = 8;
      this.fxEvents.push({
        kind: "float-text",
        x: player.x,
        y: player.y - 106,
        text: "범위 강화",
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
    const coreRunaway = this.hasSynergy("core-runaway") && this.state.player.gauge >= 90 ? 1.14 : 1;
    const areaSweeper = this.hasSynergy("area-sweeper") ? 1.07 : 1;
    const rioChainMaster = this.state.characterId === "rio" && this.hasSynergy("rio-chain-master") ? 1.04 : 1;
    return this.getGlobalDamageMultiplier() * this.state.upgrades.skillDamageMultiplier * coreRunaway * areaSweeper * rioChainMaster;
  }

  private getDailySkillCastDamageMultiplier(gestureId: GestureResult["gestureId"], grade: CastGrade): number {
    const perfect = grade === "Perfect" ? this.dailyModifiers.perfectDamageMultiplier : 1;
    const oneHand = isOneHandGesture(gestureId) ? this.dailyModifiers.oneHandSkillDamageMultiplier : 1;
    return perfect * oneHand;
  }

  private updateDebugStats(): void {
    const cutoff = this.state.time - 5;
    this.debugDamageSamples = this.debugDamageSamples.filter((sample) => sample.at >= cutoff);
    const totalDamage = this.debugDamageSamples.reduce((sum, sample) => sum + sample.amount, 0);
    this.state.debugStats.dpsEstimate = totalDamage / 5;
  }

  private getDebugBossType(): EnemyType {
    if (this.state.stageRegion === "놀이공원") {
      return "balloonClown";
    }
    if (this.state.stageRegion === "미러 타워") {
      return "crystalReflector";
    }
    if (this.state.stageRegion === "제로 존") {
      return "zero";
    }
    if (this.state.mode === "boss-rush") {
      return bossRushPlan[Math.min(this.state.bossRushIndex, bossRushPlan.length - 1)] ?? "drum";
    }
    return "drum";
  }

  private pushPerfectCastPresentation(color: number): void {
    this.fxEvents.push({ kind: "screen-flash", color, alpha: 0.24, duration: 150 });
    this.fxEvents.push({ kind: "zoom-pulse", zoom: 1.045, duration: 150 });
    this.fxEvents.push({ kind: "shake", intensity: 0.006, duration: 70 });
  }

  private pushCutIn(title: string, subtitle: string, color: number, duration = 600): void {
    this.fxEvents.push({ kind: "cut-in", title, subtitle, color, duration });
    this.fxEvents.push({ kind: "screen-flash", color, alpha: 0.2, duration: 180 });
    this.fxEvents.push({ kind: "zoom-pulse", zoom: 1.075, duration: 220 });
  }

  private updateSynergies(): void {
    const state = this.state;
    const previousIds = new Set(state.activeSynergies.map((synergy) => synergy.id));
    state.activeSynergies = calculateActiveSynergies(state.characterId, state.runStats.rewardsChosen);
    const newlyCompleted = state.activeSynergies.filter((synergy) => !previousIds.has(synergy.id));
    for (const synergy of newlyCompleted) {
      const color = synergyTierColor(synergy.tier);
      this.fxEvents.push({
        kind: "float-text",
        x: state.player.x,
        y: state.player.y - 138,
        text: "BUILD COMPLETE",
        color
      });
      this.fxEvents.push({
        kind: "float-text",
        x: state.player.x,
        y: state.player.y - 106,
        text: synergy.title,
        color: synergy.tier === "mythic" ? 0xff5ea8 : 0x48f7ff
      });
      this.pushCutIn("BUILD COMPLETE", `${synergy.title} · ${synergy.tier.toUpperCase()}`, color, synergy.tier === "mythic" ? 760 : 620);
      this.fxEvents.push({ kind: "sound", sound: "build-complete" });
    }
  }

  private hasSynergy(id: string): boolean {
    return this.state.activeSynergies.some((synergy) => synergy.id === id);
  }

  private applyPostSkillSynergy(color: number): void {
    const state = this.state;
    if (!this.hasSynergy("rio-delivery-route") || state.player.dashBuffTime <= 0) {
      return;
    }

    const targets = [...state.enemies]
      .filter((enemy) => enemy.type !== "dummy")
      .map((enemy) => ({ enemy, dist: distance(state.player, enemy) }))
      .filter((item) => item.dist < 620)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 2);

    for (const { enemy } of targets) {
      this.damageEnemy(enemy, 22 * this.getGlobalDamageMultiplier(), color, { bypassFrontGuard: true });
      this.fxEvents.push({
        kind: "bolt",
        points: [
          { x: state.player.x, y: state.player.y },
          { x: enemy.x, y: enemy.y }
        ],
        color: 0xd7ff3f,
        grade: "Great"
      });
    }

    if (targets.length > 0) {
      this.fxEvents.push({
        kind: "float-text",
        x: state.player.x,
        y: state.player.y - 112,
        text: "DELIVERY BOLT",
        color: 0xd7ff3f
      });
    }

    if (this.hasSynergy("rio-chain-master")) {
      const extra = this.findNearestEnemy(state.player, 720);
      if (extra) {
        this.damageEnemy(extra, 16 * this.getGlobalDamageMultiplier(), 0xd7ff3f, { bypassFrontGuard: true });
        this.fxEvents.push({
          kind: "bolt",
          points: [
            { x: state.player.x, y: state.player.y },
            { x: extra.x, y: extra.y }
          ],
          color: 0xd7ff3f,
          grade: "Great"
        });
      }
    }
  }

  private updateBossPhase(enemy: EnemyState): void {
    const ratio = enemy.hp / enemy.maxHp;
    if (ratio <= 0.6 && !enemy.phaseTriggered.phase2) {
      enemy.phaseTriggered.phase2 = true;
      enemy.phase = Math.max(enemy.phase, 2);
      this.triggerBossPhase(enemy, 2);
    }
    if (ratio <= 0.25 && !enemy.phaseTriggered.phase3) {
      enemy.phaseTriggered.phase3 = true;
      enemy.phase = 3;
      this.triggerBossPhase(enemy, 3);
    }
  }

  private triggerBossPhase(enemy: EnemyState, phase: 2 | 3): void {
    const color = bossAccentColor(enemy.type);
    const title = `${bossDisplayName(enemy.type)} PHASE ${phase}`;
    this.state.message = title;
    enemy.shootCooldown = 0.2;
    enemy.pulseCooldown = phase === 3 ? 0.25 : Math.min(enemy.pulseCooldown, 1.2);
    enemy.slowTime = Math.max(enemy.slowTime, 0.9);
    this.fxEvents.push({
      kind: "float-text",
      x: enemy.x,
      y: enemy.y - 132,
      text: `PHASE ${phase}`,
      color
    });
    this.fxEvents.push({ kind: "burst", x: enemy.x, y: enemy.y, radius: phase === 3 ? 330 : 240, color, grade: phase === 3 ? "Perfect" : "Great" });
    this.fxEvents.push({ kind: "shake", intensity: phase === 3 ? 0.022 : 0.015, duration: phase === 3 ? 320 : 220 });
    this.fxEvents.push({ kind: "sound", sound: "phase-change" });

    if (enemy.type === "drum") {
      this.spawnDrumWarningCircles(enemy, phase === 3 ? 5 : 4);
      if (phase === 3) {
        this.startDrumComboChallenge(enemy);
      }
    } else if (enemy.type === "balloonClown") {
      if (phase === 2) {
        this.spawnBalloonSplit(enemy, 5);
        this.spawnPartyBombCircles(enemy, 5);
      } else {
        this.spawnBalloonSplit(enemy, 7);
        this.startBalloonChallenge(enemy);
      }
    } else if (enemy.type === "crystalReflector") {
      if (phase === 2) {
        this.spawnMirrorClone(enemy);
        this.swapCrystalWithClone(enemy);
      } else {
        this.startCrystalChallenge(enemy);
        this.fireCrystalLaser(enemy, normalize({ x: this.state.player.x - enemy.x, y: this.state.player.y - enemy.y }));
      }
    } else if (enemy.type === "mirror") {
      if (phase === 2) {
        this.fireMirrorCopiedSkill(enemy);
      } else {
        this.startMirrorPrisonChallenge(enemy);
      }
    } else if (enemy.type === "zero") {
      this.spawnZeroStasisHazards(enemy, phase === 3 ? 3 : 2);
      if (phase === 3) {
        this.startZeroFinalChallenge(enemy);
      }
    }
  }

  private spawnDrumWarningCircles(enemy: EnemyState, count: number): void {
    const player = this.state.player;
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + this.state.time * 0.6;
      const aimed = index === 0;
      const x = aimed ? player.x : enemy.x + Math.cos(angle) * randomRange(150, 430);
      const y = aimed ? player.y : enemy.y + Math.sin(angle) * randomRange(120, 340);
      this.spawnTrap({
        kind: "drum-warning",
        x,
        y,
        radius: enemy.phase >= 3 ? 122 : 104,
        damage: enemy.phase >= 3 ? 18 : 14,
        ttl: enemy.phase >= 3 ? 1.05 : 1.25,
        color: 0xff7a2f
      });
    }
    this.fxEvents.push({ kind: "float-text", x: enemy.x, y: enemy.y - 98, text: "BEAT DROP", color: 0xff7a2f });
  }

  private spawnPartyBombCircles(enemy: EnemyState, count: number): void {
    const player = this.state.player;
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + randomRange(-0.3, 0.3);
      const aimed = index % 3 === 0;
      this.spawnTrap({
        kind: "drum-warning",
        x: aimed ? player.x + randomRange(-70, 70) : enemy.x + Math.cos(angle) * randomRange(150, 460),
        y: aimed ? player.y + randomRange(-70, 70) : enemy.y + Math.sin(angle) * randomRange(120, 360),
        radius: enemy.phase >= 3 ? 118 : 98,
        damage: enemy.phase >= 3 ? 17 : 13,
        ttl: enemy.phase >= 3 ? 0.95 : 1.18,
        color: 0xff8ac8
      });
    }
    this.fxEvents.push({ kind: "float-text", x: enemy.x, y: enemy.y - 98, text: "PARTY BOMB", color: 0xff8ac8 });
    this.fxEvents.push({ kind: "sound", sound: "boss-break-start" });
  }

  private performBalloonJump(enemy: EnemyState): void {
    const player = this.state.player;
    const oldX = enemy.x;
    const oldY = enemy.y;
    const angle = randomRange(0, Math.PI * 2);
    const landingDistance = randomRange(110, enemy.phase >= 3 ? 210 : 170);
    enemy.x = clamp(player.x + Math.cos(angle) * landingDistance, 90, WORLD_WIDTH - 90);
    enemy.y = clamp(player.y + Math.sin(angle) * landingDistance, 90, WORLD_HEIGHT - 90);
    const shockRadius = enemy.phase >= 3 ? 220 : 175;
    if (distance(enemy, player) < shockRadius + player.radius) {
      this.damagePlayer(enemy.phase >= 3 ? 17 : 12);
      player.movementSlowTime = Math.max(player.movementSlowTime, 0.75);
    }
    this.fxEvents.push({ kind: "slash", x: oldX, y: oldY, angle: Math.atan2(enemy.y - oldY, enemy.x - oldX), length: distance({ x: oldX, y: oldY }, enemy), color: 0xff8ac8, grade: "Great" });
    this.fxEvents.push({ kind: "burst", x: enemy.x, y: enemy.y, radius: shockRadius, color: 0xff8ac8, grade: enemy.phase >= 3 ? "Perfect" : "Great" });
    this.fxEvents.push({ kind: "float-text", x: enemy.x, y: enemy.y - 96, text: "RUBBER JUMP", color: 0xffd166 });
    this.fxEvents.push({ kind: "shake", intensity: 0.012, duration: 150 });
  }

  private spawnBalloonSplit(enemy: EnemyState, count: number): void {
    const state = this.state;
    for (let index = 0; index < count; index += 1) {
      const type: EnemyType = index % 2 === 0 ? "bombNoise" : "swarm";
      const stats = enemyStats(type, 1 + this.state.waveIndex * 0.05);
      const difficultyModifiers = this.getDifficultyModifiers();
      const angle = (Math.PI * 2 * index) / count + randomRange(-0.18, 0.18);
      const hp = Math.round(stats.hp * this.dailyModifiers.enemyHpMultiplier * difficultyModifiers.enemyHpMultiplier);
      const add: EnemyState = {
        id: this.nextEntityId++,
        type,
        x: clamp(enemy.x + Math.cos(angle) * randomRange(70, 150), 28, WORLD_WIDTH - 28),
        y: clamp(enemy.y + Math.sin(angle) * randomRange(70, 150), 28, WORLD_HEIGHT - 28),
        radius: stats.radius,
        hp,
        maxHp: hp,
        speed: randomRange(stats.speedMin, stats.speedMax) * this.dailyModifiers.enemySpeedMultiplier * difficultyModifiers.enemySpeedMultiplier,
        facing: normalize({ x: state.player.x - enemy.x, y: state.player.y - enemy.y }),
        phase: 1,
        phaseTriggered: { phase2: false, phase3: false },
        shootCooldown: randomRange(0.3, 1),
        pulseCooldown: randomRange(0.7, 1.8),
        markedTime: 0,
        slowTime: 0,
        hitFlash: 0
      };
      state.enemies.push(add);
    }
    this.fxEvents.push({ kind: "burst", x: enemy.x, y: enemy.y, radius: 220, color: 0xff8ac8, grade: "Great" });
    this.fxEvents.push({ kind: "float-text", x: enemy.x, y: enemy.y - 112, text: "BALLOON SPLIT", color: 0xff8ac8 });
  }

  private fireMirrorCopiedSkill(enemy: EnemyState): void {
    const player = this.state.player;
    const copied = player.lastSkillId ?? "spark-slash";
    const dir = normalize({ x: player.x - enemy.x, y: player.y - enemy.y });
    const angle = Math.atan2(dir.y, dir.x);

    if (copied.includes("slash") || copied.includes("cut") || copied.includes("push")) {
      const length = 720;
      const width = 110;
      if (distance(enemy, player) < length && perpendicularDistance(player, enemy, dir) < width) {
        player.movementSlowTime = Math.max(player.movementSlowTime, 0.9);
        this.damagePlayer(enemy.phase >= 3 ? 13 : 10);
      }
      this.fxEvents.push({ kind: "slash", x: enemy.x, y: enemy.y, angle, length, color: 0xc7b8ff, grade: enemy.phase >= 3 ? "Perfect" : "Great" });
    } else if (copied.includes("trap") || copied.includes("field") || copied.includes("bomb")) {
      this.spawnTrap({
        kind: "noise-trap",
        x: player.x + randomRange(-80, 80),
        y: player.y + randomRange(-80, 80),
        radius: enemy.phase >= 3 ? 168 : 132,
        damage: enemy.phase >= 3 ? 8 : 5,
        ttl: 4,
        color: 0xc7b8ff
      });
    } else {
      this.spawnProjectile({
        owner: "enemy",
        x: enemy.x + dir.x * 46,
        y: enemy.y + dir.y * 46,
        direction: dir,
        speed: enemy.phase >= 3 ? 560 : 460,
        damage: enemy.phase >= 3 ? 12 : 9,
        radius: enemy.phase >= 3 ? 12 : 9,
        ttl: 3,
        color: 0xc7b8ff
      });
      this.fxEvents.push({
        kind: "bolt",
        points: [
          { x: enemy.x, y: enemy.y },
          { x: player.x, y: player.y }
        ],
        color: 0x48f7ff,
        grade: "Great"
      });
    }

    this.state.message = `미러 카피: ${copied}`;
    this.fxEvents.push({ kind: "float-text", x: enemy.x, y: enemy.y - 94, text: "MIRROR COPY", color: 0xc7b8ff });
  }

  private spawnZeroStasisHazards(enemy: EnemyState, count: number): void {
    const existing = this.state.stageHazards.filter((hazard) => hazard.kind === "stasis-drain").length;
    const capacity = Math.max(0, 7 - existing);
    const total = Math.min(count, capacity);
    for (let index = 0; index < total; index += 1) {
      const angle = (Math.PI * 2 * index) / Math.max(1, total) + this.state.time;
      const source = index === 0 ? this.state.player : enemy;
      this.state.stageHazards.push(
        this.createStageHazard(
          "stasis-drain",
          clamp(source.x + Math.cos(angle) * randomRange(120, 260), 120, WORLD_WIDTH - 120),
          clamp(source.y + Math.sin(angle) * randomRange(100, 240), 120, WORLD_HEIGHT - 120),
          enemy.phase >= 3 ? 168 : 138,
          enemy.phase >= 3 ? 12 : 8,
          this.state.time + index
        )
      );
    }
    if (total > 0) {
      this.fxEvents.push({ kind: "float-text", x: enemy.x, y: enemy.y - 98, text: "STASIS FIELD", color: 0xc7b8ff });
    }
  }

  private startDrumComboChallenge(enemy: EnemyState): boolean {
    return this.startBossChallenge(enemy, {
      bossType: "drum",
      sequence: ["cross-guard", "palm-push"],
      prompt: "크로스 가드 후 팜 푸시로 피날레를 밀어요!",
      stepPrompts: ["양팔을 X자로 모아 막아요", "손바닥을 앞으로 밀어 반격해요"],
      successEffect: "drum-combo-counter",
      failDamage: 24,
      duration: 2.1
    });
  }

  private startBalloonChallenge(enemy: EnemyState): boolean {
    return this.startBossChallenge(enemy, {
      bossType: "balloonClown",
      requiredGesture: "circle",
      prompt: "손으로 큰 원을 그려 풍선을 빼요!",
      successEffect: "balloon-deflate",
      failDamage: 16,
      duration: 2.15
    });
  }

  private startCrystalChallenge(enemy: EnemyState): boolean {
    return this.startBossChallenge(enemy, {
      bossType: "crystalReflector",
      requiredGesture: "focus-triangle",
      prompt: "양손 삼각형으로 본체를 드러내요!",
      successEffect: "crystal-reveal",
      failDamage: 13,
      duration: 2.25
    });
  }

  private startMirrorPrisonChallenge(enemy: EnemyState): boolean {
    return this.startBossChallenge(enemy, {
      bossType: "mirror",
      sequence: ["slash", "focus-triangle"],
      prompt: "슬래시 후 삼각 포커스로 감옥을 깨요!",
      stepPrompts: ["손을 날카롭게 휘둘러요", "양손 삼각형으로 핵을 조준해요"],
      successEffect: "mirror-prison-break",
      failDamage: 8,
      duration: 2.05
    });
  }

  private startZeroFinalChallenge(enemy: EnemyState): boolean {
    const ultimateGesture = this.getCurrentSkills().F.gestureId;
    return this.startBossChallenge(enemy, {
      bossType: "zero",
      sequence: ["open-arms", "rise", ultimateGesture],
      prompt: "오픈 암, 라이즈, 궁극기 포즈로 제로 코어를 해방해요!",
      stepPrompts: ["양팔을 크게 벌려 정지장을 찢어요", "손을 위로 들어 코어를 끌어올려요", "궁극기 포즈로 마무리해요"],
      successEffect: "zero-final-release",
      failDamage: 28,
      duration: 2.25
    });
  }

  private startBossChallenge(
    enemy: EnemyState,
    challenge: BossChallengeConfig
  ): boolean {
    const modifiers = this.getDifficultyModifiers();
    return this.bossSystem.startBossChallenge(enemy, {
      ...challenge,
      duration: Math.max(1.15, challenge.duration + modifiers.bossChallengeTimeBonus)
    });
  }

  private succeedBossChallenge(challenge: BossChallengeState, grade: Exclude<CastGrade, "Miss">): CastResponse {
    this.state.debugStats.bossChallengeSuccesses += 1;
    return this.bossSystem.succeedBossChallenge(challenge, grade);
  }

  private failBossChallenge(challenge: BossChallengeState): CastResponse {
    this.state.debugStats.bossChallengeFailures += 1;
    return this.bossSystem.failBossChallenge(challenge);
  }

  private resolveDrumChallenge(grade: Exclude<CastGrade, "Miss">): number {
    return this.bossSystem.resolveDrumChallenge(grade);
  }

  private resolveMirrorChallenge(grade: Exclude<CastGrade, "Miss">): number {
    return this.bossSystem.resolveMirrorChallenge(grade);
  }

  private resolveZeroChallenge(grade: Exclude<CastGrade, "Miss">, finalBreak = false): void {
    this.bossSystem.resolveZeroChallenge(grade, finalBreak);
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
        facing: normalize({ x: state.player.x - enemy.x, y: state.player.y - enemy.y }),
        phase: 1,
        phaseTriggered: { phase2: false, phase3: false },
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

  private fireCrystalLaser(enemy: EnemyState, direction: Vector2): void {
    const player = this.state.player;
    const dir = normalize(direction);
    const length = enemy.phase >= 3 ? 980 : 820;
    const width = enemy.phase >= 3 ? 76 : 58;
    const hitPlayer = distance(enemy, player) < length && perpendicularDistance(player, enemy, dir) < width;

    if (hitPlayer) {
      this.damagePlayer(enemy.phase >= 3 ? 16 : 11);
      player.controlReverseTime = Math.max(player.controlReverseTime, enemy.phase >= 3 ? 1.25 : 0.65);
    }

    this.fxEvents.push({
      kind: "slash",
      x: enemy.x,
      y: enemy.y,
      angle: Math.atan2(dir.y, dir.x),
      length,
      color: 0x48f7ff,
      grade: enemy.phase >= 3 ? "Perfect" : "Great"
    });
    this.fxEvents.push({ kind: "float-text", x: enemy.x, y: enemy.y - 92, text: "MIRROR LASER", color: 0x48f7ff });
  }

  private swapCrystalWithClone(enemy: EnemyState): void {
    let clone = this.state.enemies
      .filter((item) => item.id !== enemy.id && (item.type === "runner" || item.type === "swarm" || item.type === "shieldNoise"))
      .map((item) => ({ enemy: item, range: distance(item, enemy) }))
      .filter((item) => item.range < 720)
      .sort((a, b) => a.range - b.range)[0]?.enemy;

    if (!clone) {
      this.spawnMirrorClone(enemy);
      clone = this.state.enemies
        .filter((item) => item.id !== enemy.id && (item.type === "runner" || item.type === "swarm"))
        .map((item) => ({ enemy: item, range: distance(item, enemy) }))
        .sort((a, b) => a.range - b.range)[0]?.enemy;
    }

    if (!clone) {
      return;
    }

    const oldX = enemy.x;
    const oldY = enemy.y;
    enemy.x = clone.x;
    enemy.y = clone.y;
    clone.x = oldX;
    clone.y = oldY;
    enemy.slowTime = Math.max(enemy.slowTime, 0.35);
    this.fxEvents.push({ kind: "burst", x: enemy.x, y: enemy.y, radius: 170, color: 0x48f7ff, grade: "Great" });
    this.fxEvents.push({ kind: "burst", x: clone.x, y: clone.y, radius: 110, color: 0xc7b8ff, grade: "Normal" });
    this.fxEvents.push({ kind: "float-text", x: enemy.x, y: enemy.y - 94, text: "PRISM SWAP", color: 0x48f7ff });
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

  private healNearbyEnemies(source: EnemyState, amount: number, radius: number): number {
    let healed = 0;
    for (const enemy of this.state.enemies) {
      if (enemy.id === source.id || enemy.type === "dummy" || enemy.hp <= 0 || enemy.hp >= enemy.maxHp) {
        continue;
      }
      if (distance(source, enemy) > radius + enemy.radius) {
        continue;
      }
      enemy.hp = clamp(enemy.hp + amount, 0, enemy.maxHp);
      healed += 1;
      this.fxEvents.push({
        kind: "bolt",
        points: [
          { x: source.x, y: source.y },
          { x: enemy.x, y: enemy.y }
        ],
        color: 0x7dffb2,
        grade: "Normal"
      });
    }

    if (healed > 0) {
      this.fxEvents.push({ kind: "burst", x: source.x, y: source.y, radius, color: 0x7dffb2 });
      this.fxEvents.push({ kind: "float-text", x: source.x, y: source.y - 58, text: "REPAIR", color: 0x7dffb2 });
    }
    return healed;
  }

  private explodeBombNoise(enemy: EnemyState): void {
    if (!this.state.enemies.some((item) => item.id === enemy.id)) {
      return;
    }

    const radius = 168;
    this.state.enemies = this.state.enemies.filter((item) => item.id !== enemy.id);
    if (distance(enemy, this.state.player) < radius + this.state.player.radius) {
      this.damagePlayer(13);
    }

    for (const other of [...this.state.enemies]) {
      if (distance(enemy, other) < radius + other.radius) {
        other.slowTime = Math.max(other.slowTime, 0.55);
        this.damageEnemy(other, 22, 0xffd166, { source: enemy, bypassFrontGuard: true });
      }
    }

    this.fxEvents.push({
      kind: "burst",
      x: enemy.x,
      y: enemy.y,
      radius,
      color: 0xffd166,
      grade: "Great"
    });
    this.fxEvents.push({ kind: "shake", intensity: 0.012, duration: 140 });
    this.fxEvents.push({ kind: "sound", sound: "hit" });
  }

  private damageEnemy(enemy: EnemyState, amount: number, color: number, options: DamageEnemyOptions = {}): void {
    const wasMarked = enemy.markedTime > 0;
    const typeMultiplier =
      (enemy.type === "runner" || enemy.type === "swarm" ? 1 + this.state.upgrades.swarmDamageBonus : 1) *
      (enemy.type === "tank" || isBossEnemy(enemy.type) ? 1 + this.state.upgrades.eliteDamageBonus : 1) *
      (isBossEnemy(enemy.type) && this.hasSynergy("dangerous-choice") ? 1.1 : 1);
    const finalAmount = this.applyEnemyDefense(enemy, amount * typeMultiplier, options);
    enemy.hp -= finalAmount;
    this.debugDamageSamples.push({ at: this.state.time, amount: Math.max(0, finalAmount) });
    this.updateDebugStats();
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
      if (enemy.type === "bombNoise") {
        this.explodeBombNoise(enemy);
        this.state.runStats.kills += 1;
        if (wasMarked) {
          this.state.runStats.markedEnemyKills += 1;
        }
        this.recordCharacterQuestKill(enemy, options);
        this.state.player.score += Math.round(
          scoreForEnemy(enemy.type) * this.getDailyEnemyScoreMultiplier(enemy.type) * this.state.upgrades.scoreMultiplier
        );
        this.state.player.gauge = clamp(this.state.player.gauge + gaugeForEnemy(enemy.type) * this.state.upgrades.gaugeGainMultiplier, 0, this.state.player.maxGauge);
        return;
      }
      this.state.enemies = this.state.enemies.filter((item) => item.id !== enemy.id);
      this.state.runStats.kills += 1;
      if (wasMarked) {
        this.state.runStats.markedEnemyKills += 1;
      }
      if (isBossEnemy(enemy.type) && !this.state.runStats.bossesDefeated.includes(enemy.type)) {
        this.state.runStats.bossesDefeated.push(enemy.type);
      }
      this.recordCharacterQuestKill(enemy, options);
      this.state.player.score += Math.round(
        scoreForEnemy(enemy.type) * this.getDailyEnemyScoreMultiplier(enemy.type) * this.state.upgrades.scoreMultiplier
      );
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
      if (wasMarked && this.hasSynergy("neon-glitch-executor")) {
        const nextTarget = this.findNearestEnemy(enemy, 460);
        if (nextTarget && nextTarget.id !== enemy.id) {
          nextTarget.markedTime = Math.max(nextTarget.markedTime, 5.5);
          nextTarget.slowTime = Math.max(nextTarget.slowTime, 0.45);
          this.fxEvents.push({
            kind: "bolt",
            points: [
              { x: enemy.x, y: enemy.y },
              { x: nextTarget.x, y: nextTarget.y }
            ],
            color: 0xff5ea8,
            grade: "Great"
          });
          this.fxEvents.push({
            kind: "float-text",
            x: nextTarget.x,
            y: nextTarget.y - 54,
            text: "MARK SHIFT",
            color: 0xff5ea8
          });
        }
      }
      if (this.hasSynergy("area-sweeper")) {
        const blastRadius = 145;
        let splashed = 0;
        for (const other of [...this.state.enemies]) {
          if (other.id === enemy.id || distance(enemy, other) > blastRadius + other.radius) {
            continue;
          }
          splashed += 1;
          other.slowTime = Math.max(other.slowTime, 0.35);
          this.damageEnemy(other, 12, 0x48f7ff, { source: enemy, bypassFrontGuard: true });
        }
        if (splashed > 0) {
          this.fxEvents.push({ kind: "burst", x: enemy.x, y: enemy.y, radius: blastRadius, color: 0x48f7ff, grade: "Great" });
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

  private recordCharacterQuestKill(enemy: EnemyState, options: DamageEnemyOptions): void {
    const characterId = this.state.characterId;
    const unlocks: CharacterQuestUnlock[] = [];

    if (characterId === "rio" && options.sourceSkillId === "lightning-dash") {
      unlocks.push(...(this.progression?.recordCharacterQuestProgress("rio", "rio-lightning-dash-kills", 1, "add") ?? []));
    }

    if (isBossEnemy(enemy.type)) {
      if (characterId === "rio" && (this.state.player.overdriveTime > 0 || options.sourceSkillId === "thunder-overdrive")) {
        unlocks.push(...(this.progression?.recordCharacterQuestProgress("rio", "rio-overdrive-boss", 1, "complete") ?? []));
      }
      if (characterId === "neon" && options.sourceSkillId === "blackout") {
        unlocks.push(...(this.progression?.recordCharacterQuestProgress("neon", "neon-blackout-boss", 1, "complete") ?? []));
      }
      if (characterId === "cookie" && options.sourceAllyKind === "big-slime") {
        unlocks.push(...(this.progression?.recordCharacterQuestProgress("cookie", "cookie-big-slime-boss", 1, "complete") ?? []));
      }
    }

    this.addCharacterQuestUnlocks(unlocks);
  }

  private applyEnemyDefense(enemy: EnemyState, amount: number, options: DamageEnemyOptions): number {
    if (enemy.type === "crystalReflector") {
      if (options.bypassFrontGuard || enemy.markedTime > 0) {
        return amount * 1.2;
      }

      const source = options.source ?? this.state.player;
      const attackDirection = normalize({ x: source.x - enemy.x, y: source.y - enemy.y });
      const frontal = dot(enemy.facing, attackDirection) > 0.42;
      if (!frontal) {
        return amount * 1.12;
      }

      if (enemy.hitFlash <= 0.04) {
        this.fxEvents.push({ kind: "float-text", x: enemy.x, y: enemy.y - 68, text: "REFLECT", color: 0x48f7ff });
        if (distance(enemy, this.state.player) < 760) {
          this.damagePlayer(3);
        }
      }
      return amount * 0.28;
    }

    if (enemy.type !== "shieldNoise") {
      return amount;
    }

    if (options.bypassFrontGuard) {
      return amount * 1.22;
    }

    const source = options.source ?? this.state.player;
    const attackDirection = normalize({ x: source.x - enemy.x, y: source.y - enemy.y });
    const frontal = dot(enemy.facing, attackDirection) > 0.48;
    if (!frontal) {
      return amount * 1.15;
    }

    if (enemy.pulseCooldown <= 0.12) {
      this.fxEvents.push({ kind: "float-text", x: enemy.x, y: enemy.y - 58, text: "BLOCK", color: 0x48f7ff });
      enemy.pulseCooldown = 0.35;
    }
    return amount * 0.42;
  }

  private damagePlayer(amount: number): void {
    if (this.state.mode === "training") {
      return;
    }
    const player = this.state.player;
    if (player.invulnerableTime > 0 || player.hurtCooldown > 0) {
      return;
    }

    if (this.hasSynergy("survival-caster")) {
      player.shield = Math.max(player.shield, 18);
      player.gauge = clamp(player.gauge + 6, 0, player.maxGauge);
      amount *= 0.92;
    }
    if (this.hasSynergy("dangerous-choice") && player.hp / player.maxHp < 0.42) {
      player.shield = Math.max(player.shield, 24);
      amount *= 0.9;
    }

    const hpBefore = player.hp;
    const shieldBefore = player.shield;
    const shieldDamage = Math.min(player.shield, amount);
    player.shield -= shieldDamage;
    player.hp = clamp(player.hp - (amount - shieldDamage), 0, player.maxHp);
    this.state.runStats.shieldDamageAbsorbed += Math.round(shieldDamage);
    if (this.state.mode === "tutorial") {
      player.hp = Math.max(player.hp, 35);
    }
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
    this.state.runStats.dailyChallengeCleared = victory && this.state.mode !== "tutorial" && this.state.mode !== "quick-demo";
    this.runHistory?.recordFromState(this.state, victory, {
      ...(this.runTelemetryProvider?.() ?? {}),
      endReason: victory ? "victory" : this.state.player.hp <= 0 ? "player-defeated" : "run-ended"
    });
    const summary = this.progression?.recordRun({
      characterId: this.state.characterId,
      mode: this.state.mode,
      victory,
      score: this.state.player.score,
      seconds: this.state.modeTime || this.state.time,
      hpRatio: this.state.player.hp / this.state.player.maxHp,
      bossClear: victory && this.state.mode !== "survival" && this.state.mode !== "tutorial" && this.state.mode !== "quick-demo",
      misses: this.state.runStats.misses,
      bossPosePerfectCounters: this.state.runStats.bossPosePerfectCounters,
      shieldDamageAbsorbed: this.state.runStats.shieldDamageAbsorbed,
      markedEnemyKills: this.state.runStats.markedEnemyKills,
      slimesSummoned: this.state.runStats.slimesSummoned,
      maxSlimesMaintained: this.state.runStats.maxSlimesMaintained,
      bossesDefeated: this.state.runStats.bossesDefeated
    });
    if (!summary) {
      return;
    }

    this.state.runStats.xpGained = summary.xpGained;
    this.state.runStats.levelBefore = summary.levelBefore;
    this.state.runStats.levelAfter = summary.levelAfter;
    this.state.runStats.unlockedItems = summary.unlockedItems;
    this.addUnlockedAchievements(summary.unlockedAchievements);
    this.addCharacterQuestUnlocks(summary.characterQuestUnlocks);
    this.state.player.level = summary.levelAfter;
    this.fxEvents.push({
      kind: "float-text",
      x: this.state.player.x,
      y: this.state.player.y - 132,
      text: summary.levelAfter > summary.levelBefore ? `LV ${summary.levelAfter}` : `XP +${summary.xpGained}`,
      color: summary.levelAfter > summary.levelBefore ? 0xffd166 : 0x48f7ff
    });
  }

  private getDailyEnemyScoreMultiplier(type: EnemyType): number {
    return isBossEnemy(type) ? this.dailyModifiers.bossScoreMultiplier : 1;
  }

  private getDifficultyModifiers(state = this.state) {
    return getAppliedDifficultyModifiers(state.difficulty, state.mode);
  }

  private addUnlockedAchievements(achievements: AchievementUnlock[]): void {
    for (const achievement of achievements) {
      if (this.state.runStats.unlockedAchievements.some((item) => item.id === achievement.id)) {
        continue;
      }
      this.state.runStats.unlockedAchievements.push(achievement);
      this.fxEvents.push({
        kind: "float-text",
        x: this.state.player.x,
        y: this.state.player.y - 154,
        text: "ACHIEVEMENT",
        color: 0xffd166
      });
      this.fxEvents.push({
        kind: "float-text",
        x: this.state.player.x,
        y: this.state.player.y - 122,
        text: achievement.title,
        color: 0x48f7ff
      });
      this.fxEvents.push({ kind: "sound", sound: "unlock" });
    }
  }

  private addCastProgressResult(result?: { unlockedAchievements: AchievementUnlock[]; characterQuestUnlocks: CharacterQuestUnlock[] }): void {
    if (!result) {
      return;
    }
    this.addUnlockedAchievements(result.unlockedAchievements);
    this.addCharacterQuestUnlocks(result.characterQuestUnlocks);
  }

  private addCharacterQuestUnlocks(unlocks: CharacterQuestUnlock[]): void {
    for (const unlock of unlocks) {
      if (this.state.runStats.characterQuestUnlocks.some((item) => item.objectiveId === unlock.objectiveId)) {
        continue;
      }
      this.state.runStats.characterQuestUnlocks.push(unlock);
      this.fxEvents.push({
        kind: "float-text",
        x: this.state.player.x,
        y: this.state.player.y - 176,
        text: unlock.completedLine ? "QUEST LINE CLEAR" : "QUEST CLEAR",
        color: unlock.completedLine ? 0xffd166 : 0x48f7ff
      });
      this.fxEvents.push({
        kind: "float-text",
        x: this.state.player.x,
        y: this.state.player.y - 142,
        text: unlock.objectiveTitle,
        color: unlock.completedLine ? 0xff5ea8 : 0xb8ff5c
      });
      if (unlock.completedLine) {
        this.pushCutIn("QUEST COMPLETE", `${unlock.questTitle} · ${unlock.rewardText}`, 0xffd166, 720);
      }
      this.fxEvents.push({ kind: "sound", sound: "unlock" });
    }
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

  private openRewardChoice(count: number): void {
    const rewardIds = this.rollRewards(count);
    this.state.pendingRewardIds = rewardIds;
    this.state.rewardOfferHistoryIds = [...rewardIds];
  }

  private rollRewards(count: number, excludedIds: string[] = []): string[] {
    return rollRewardsForState(this.state, count, excludedIds);
  }

  private applyReward(rewardId: string) {
    return applyRewardToState(this.state, rewardId);
  }

  moveInputFromBooleans(left: boolean, right: boolean, up: boolean, down: boolean): MoveInput {
    return {
      x: (right ? 1 : 0) - (left ? 1 : 0),
      y: (down ? 1 : 0) - (up ? 1 : 0)
    };
  }
}

function castGradeSound(grade: CastGrade): SoundId {
  if (grade === "Perfect") {
    return "cast-perfect";
  }
  if (grade === "Great") {
    return "cast-great";
  }
  if (grade === "Normal") {
    return "cast-normal";
  }
  return "hit";
}

function characterSkillSound(characterId: CharacterId): SoundId {
  switch (characterId) {
    case "maru":
      return "maru-skill";
    case "neon":
      return "neon-skill";
    case "cookie":
      return "cookie-skill";
    case "rio":
    default:
      return "rio-skill";
  }
}

function bossDisplayName(type: EnemyType): string {
  switch (type) {
    case "balloonClown":
      return "풍선 광대";
    case "crystalReflector":
      return "크리스탈 리플렉터";
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

function formatObjectiveTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(wholeSeconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (wholeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function gestureObjectiveLabel(gestureId: GestureResult["gestureId"]): string {
  switch (gestureId) {
    case "slash":
      return "Slash";
    case "thrust":
      return "Thrust";
    case "rise":
      return "Rise";
    case "open-arms":
      return "Open Arms";
    case "cross-guard":
      return "Cross Guard";
    case "palm-push":
      return "Palm Push";
    case "ground-slam":
      return "Ground Slam";
    case "point":
      return "Point";
    case "circle":
      return "Circle";
    case "wave":
      return "Wave";
    case "spread":
      return "Spread";
    case "heart":
      return "Heart";
    case "focus-triangle":
      return "Focus Triangle";
    default:
      return "Pose";
  }
}

function isOneHandGesture(gestureId: GestureResult["gestureId"]): boolean {
  return (
    gestureId === "slash" ||
    gestureId === "thrust" ||
    gestureId === "rise" ||
    gestureId === "circle" ||
    gestureId === "point" ||
    gestureId === "wave"
  );
}

function stageRegionForBoss(type: EnemyType): StageRegion {
  switch (type) {
    case "balloonClown":
      return "놀이공원";
    case "crystalReflector":
    case "mirror":
      return "미러 타워";
    case "zero":
      return "제로 존";
    case "drum":
    default:
      return "루프시티";
  }
}

function bossAccentColor(type: EnemyType): number {
  switch (type) {
    case "balloonClown":
      return 0xff8ac8;
    case "crystalReflector":
      return 0x48f7ff;
    case "drum":
      return 0xffd166;
    case "mirror":
      return 0xc7b8ff;
    case "zero":
      return 0xc7b8ff;
    default:
      return 0xffd166;
  }
}

function synergyTierColor(tier: GameState["activeSynergies"][number]["tier"]): number {
  switch (tier) {
    case "mythic":
      return 0xff5ea8;
    case "signature":
      return 0xffd166;
    case "advanced":
      return 0x48f7ff;
    case "basic":
    default:
      return 0xb8ff5c;
  }
}

function isStageHazardActive(hazard: StageHazardState, time: number): boolean {
  if (hazard.kind === "rotator") {
    return Math.sin(time * 1.75 + hazard.phase) > -0.25;
  }
  if (hazard.kind === "mirror-reversal") {
    return ((time + hazard.phase) % 4.8) < 1.18;
  }
  return true;
}

function isGuardSkill(skillId: string): boolean {
  return skillId === "dokkaebi-guard" || skillId === "giant-shield-wall" || skillId === "shield-push";
}
