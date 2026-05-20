import type { SkillSlot } from "../../input/actions";
import { clamp, distance, normalize } from "../math";
import type { BossChallengeState, CastGrade, CastResponse, EnemyState, FxEvent, GameState } from "../types";
import type { DamageEnemyOptions } from "./combatTypes";

export interface BossChallengeConfig {
  bossType: BossChallengeState["bossType"];
  requiredGesture?: BossChallengeState["requiredGesture"];
  sequence?: BossChallengeState["sequence"];
  prompt: string;
  stepPrompts?: string[];
  successEffect: BossChallengeState["successEffect"];
  failDamage: number;
  duration: number;
}

interface BossSystemContext {
  getState: () => GameState;
  pushFx: (event: FxEvent) => void;
  damageEnemy: (enemy: EnemyState, amount: number, color: number, options?: DamageEnemyOptions) => void;
  damagePlayer: (amount: number) => void;
  fireZeroMotionPulse: (enemy: EnemyState) => void;
  pushCutIn: (title: string, subtitle: string, color: number, duration?: number) => void;
  currentTutorialStepIs: (stepId: "boss-pose-break") => boolean;
  completeTutorialStep: (stepId: "boss-pose-break") => boolean;
  startTutorialBossPoseBreak: () => void;
}

export class BossSystem {
  constructor(private readonly context: BossSystemContext) {}

  startBossChallenge(enemy: EnemyState, challenge: BossChallengeConfig): boolean {
    const state = this.context.getState();
    if (state.bossChallenge || state.gameOver || state.victory || state.pendingRewardIds.length > 0) {
      return false;
    }

    const sequence = challenge.sequence ?? [challenge.requiredGesture ?? "slash"];
    const stepPrompts = challenge.stepPrompts ?? [challenge.prompt];
    state.preparedSkill = null;
    state.bossChallenge = {
      bossType: challenge.bossType,
      requiredGesture: sequence[0],
      sequence,
      currentIndex: 0,
      prompt: stepPrompts[0] ?? challenge.prompt,
      stepPrompts,
      expiresAt: state.time + challenge.duration,
      stepDuration: challenge.duration,
      successEffect: challenge.successEffect,
      failDamage: challenge.failDamage
    };
    state.message = "Boss Pose Break";
    this.context.pushFx({ kind: "sound", sound: "boss-break-start" });
    this.context.pushFx({ kind: "shake", intensity: 0.01, duration: 170 });
    this.context.pushFx({
      kind: "float-text",
      x: enemy.x,
      y: enemy.y - 104,
      text: "POSE BREAK",
      color: challenge.bossType === "drum" ? 0xffd166 : challenge.bossType === "mirror" ? 0x48f7ff : 0xc7b8ff
    });
    return true;
  }

  succeedBossChallenge(challenge: BossChallengeState, grade: Exclude<CastGrade, "Miss">): CastResponse {
    const state = this.context.getState();
    let line = "";
    if (challenge.successEffect === "drum-counter" || challenge.successEffect === "drum-combo-counter") {
      const reflected = this.resolveDrumChallenge(grade);
      if (challenge.successEffect === "drum-combo-counter") {
        const boss = this.findBoss("drum");
        if (boss) {
          boss.pulseCooldown = Math.max(boss.pulseCooldown, 5.5);
          this.context.damageEnemy(boss, grade === "Perfect" ? 240 : grade === "Great" ? 180 : 132, 0xffd166, { bypassFrontGuard: true });
          this.context.pushFx({ kind: "burst", x: boss.x, y: boss.y, radius: grade === "Perfect" ? 390 : 300, color: 0xffd166, grade });
        }
        line = grade === "Perfect" ? `더블 포즈 반격 Perfect! ${reflected}발 역반사` : `더블 포즈 반격 성공! ${reflected}발 역반사`;
      } else {
        line = grade === "Perfect" ? `리듬 반사 Perfect! ${reflected}발 역반사` : `리듬 반사 성공! ${reflected}발 역반사`;
      }
    } else if (challenge.successEffect === "mirror-shatter" || challenge.successEffect === "mirror-prison-break") {
      const shattered = this.resolveMirrorChallenge(grade);
      if (challenge.successEffect === "mirror-prison-break") {
        const boss = this.findBoss("mirror");
        if (boss) {
          boss.pulseCooldown = Math.max(boss.pulseCooldown, 5);
          state.player.controlReverseTime = 0;
          state.player.movementSlowTime = 0;
          this.context.damageEnemy(boss, grade === "Perfect" ? 215 : grade === "Great" ? 160 : 118, 0x48f7ff, { bypassFrontGuard: true });
        }
        line = grade === "Perfect" ? `거울 감옥 완전 파쇄! ${shattered}개 제거` : `거울 감옥 탈출! ${shattered}개 제거`;
      } else {
        line = grade === "Perfect" ? `거울 분신 완전 파쇄! ${shattered}개 제거` : `거울 분신 파쇄! ${shattered}개 제거`;
      }
    } else {
      this.resolveZeroChallenge(grade, challenge.successEffect === "zero-final-release");
      line =
        challenge.successEffect === "zero-final-release"
          ? grade === "Perfect"
            ? "최종 포즈 브레이크 Perfect! 제로 코어 붕괴"
            : "최종 포즈 브레이크 성공! 제로 코어 해방"
          : grade === "Perfect"
            ? "제로 모션 해방! 잠시 무한 게이지"
            : "제로 모션 해방! 코어 게이지 회복";
    }

    state.message = line;
    this.context.pushFx({
      kind: "float-text",
      x: state.player.x,
      y: state.player.y - 96,
      text: grade === "Perfect" ? "PERFECT COUNTER" : "COUNTER",
      color: grade === "Perfect" ? 0xffd166 : 0x48f7ff
    });
    if (grade === "Perfect") {
      state.runStats.bossPosePerfectCounters += 1;
      const counterColor = challenge.bossType === "drum" ? 0xffd166 : challenge.bossType === "mirror" ? 0x48f7ff : 0xc7b8ff;
      this.context.pushCutIn("PERFECT COUNTER", line, counterColor, 680);
      this.context.pushFx({ kind: "shake", intensity: 0.014, duration: 160 });
    }
    this.context.pushFx({ kind: "sound", sound: "boss-break-success", grade });
    if (this.context.currentTutorialStepIs("boss-pose-break")) {
      state.tutorial.bossChallengeCleared = true;
      this.context.completeTutorialStep("boss-pose-break");
    }
    return { ok: true, line };
  }

  failBossChallenge(challenge: BossChallengeState): CastResponse {
    const state = this.context.getState();
    const player = state.player;
    player.invulnerableTime = 0;
    player.hurtCooldown = 0;

    if (challenge.bossType === "mirror") {
      player.controlReverseTime = Math.max(player.controlReverseTime, 3.2);
      player.movementSlowTime = Math.max(player.movementSlowTime, 1.8);
      if (challenge.failDamage > 0) {
        this.context.damagePlayer(challenge.failDamage);
      }
      state.message = "거울 반전: 이동이 뒤틀립니다";
    } else if (challenge.bossType === "zero") {
      player.gauge = 0;
      this.context.damagePlayer(challenge.failDamage);
      state.message = "제로 모션: 코어 게이지가 비었습니다";
      const boss = this.findBoss(challenge.bossType);
      if (boss) {
        this.context.fireZeroMotionPulse(boss);
      }
    } else {
      this.context.damagePlayer(challenge.failDamage);
      state.message = "드럼 비트에 밀려났습니다";
    }

    if (this.context.currentTutorialStepIs("boss-pose-break")) {
      state.player.hp = Math.max(state.player.hp, 35);
      this.context.startTutorialBossPoseBreak();
      state.message = "다시 크로스 가드를 시도하세요";
    }

    this.context.pushFx({
      kind: "float-text",
      x: player.x,
      y: player.y - 92,
      text: "BREAK FAIL",
      color: 0xff5ea8
    });
    this.context.pushFx({ kind: "sound", sound: "boss-break-fail" });
    return { ok: true, line: state.message };
  }

  resolveDrumChallenge(grade: Exclude<CastGrade, "Miss">): number {
    const state = this.context.getState();
    const boss = this.findBoss("drum");
    const reflectedLimit = grade === "Perfect" ? 10 : grade === "Great" ? 7 : 5;
    let reflected = 0;

    if (boss) {
      boss.slowTime = Math.max(boss.slowTime, grade === "Perfect" ? 4 : grade === "Great" ? 3 : 2.2);
      boss.pulseCooldown = Math.max(boss.pulseCooldown, 4.5);
      this.context.damageEnemy(boss, grade === "Perfect" ? 180 : grade === "Great" ? 128 : 88, 0xffd166);
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
          this.context.damageEnemy(enemy, 54, 0xffd166);
        }
      }
      this.context.pushFx({ kind: "burst", x: boss.x, y: boss.y, radius: 310, color: 0xffd166, grade });
      this.context.pushFx({ kind: "shake", intensity: 0.018, duration: 240 });
    }

    return reflected;
  }

  resolveMirrorChallenge(grade: Exclude<CastGrade, "Miss">): number {
    const state = this.context.getState();
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
      this.context.damageEnemy(enemy, enemy.hp + 20, 0x48f7ff);
    }
    if (boss) {
      boss.pulseCooldown = Math.max(boss.pulseCooldown, 4);
      this.context.damageEnemy(boss, grade === "Perfect" ? 145 : grade === "Great" ? 105 : 72, 0x48f7ff);
      this.context.pushFx({ kind: "burst", x: boss.x, y: boss.y, radius: grade === "Perfect" ? 260 : 190, color: 0x48f7ff, grade });
    }
    if (grade === "Perfect") {
      state.projectiles = state.projectiles.filter((projectile) => projectile.owner !== "enemy" || distance(projectile, origin) > 540);
    }

    return clones.length;
  }

  resolveZeroChallenge(grade: Exclude<CastGrade, "Miss">, finalBreak = false): void {
    const state = this.context.getState();
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
      const damage = finalBreak ? (grade === "Perfect" ? 310 : grade === "Great" ? 230 : 165) : grade === "Perfect" ? 160 : grade === "Great" ? 116 : 78;
      this.context.damageEnemy(boss, damage, 0xc7b8ff, { bypassFrontGuard: true });
      this.context.pushFx({ kind: "burst", x: boss.x, y: boss.y, radius: finalBreak ? 430 : grade === "Perfect" ? 330 : 230, color: 0xc7b8ff, grade });
    }
    this.context.pushFx({ kind: "shake", intensity: grade === "Perfect" ? 0.02 : 0.012, duration: 240 });
  }

  private findBoss(type: BossChallengeState["bossType"]): EnemyState | null {
    return this.context.getState().enemies.find((enemy) => enemy.type === type) ?? null;
  }
}

export function getCurrentBossChallengeGesture(challenge: BossChallengeState): BossChallengeState["requiredGesture"] {
  return challenge.sequence[challenge.currentIndex] ?? challenge.requiredGesture;
}
