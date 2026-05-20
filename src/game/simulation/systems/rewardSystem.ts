import { REWARDS, getRewardDefinition, type RewardDefinition, type RewardRarity } from "../../content/rewards";
import { clamp } from "../math";
import type { GameState, SoundId } from "../types";

export function rollRewards(state: GameState, count: number, excludedIds: string[] = []): string[] {
  const selected: RewardDefinition[] = [];
  const excluded = new Set(excludedIds);
  const isAvailable = (reward: RewardDefinition) =>
    (reward.characterId === null || reward.characterId === state.characterId) &&
    (state.rewardStacks[reward.id] ?? 0) < reward.maxStacks &&
    !excluded.has(reward.id) &&
    !selected.some((item) => item.id === reward.id);

  while (selected.length < count) {
    const characterPool = REWARDS.filter((reward) => reward.characterId === state.characterId && isAvailable(reward));
    const allPool = REWARDS.filter(isAvailable);
    if (allPool.length === 0) {
      break;
    }

    const preferCharacterCard = characterPool.length > 0 && Math.random() < 0.45;
    selected.push(pickWeightedReward(preferCharacterCard ? characterPool : allPool));
  }

  return selected.map((reward) => reward.id);
}

export function applyReward(state: GameState, rewardId: string): RewardDefinition | undefined {
  const reward = getRewardDefinition(rewardId);
  if (!reward) {
    return undefined;
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

  return reward;
}

export function pickWeightedReward(pool: RewardDefinition[]): RewardDefinition {
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

export function rarityWeight(rarity: RewardRarity): number {
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

export function rewardSoundForRarity(rarity: RewardRarity): SoundId {
  switch (rarity) {
    case "legendary":
      return "reward-legendary";
    case "epic":
      return "reward-epic";
    case "rare":
      return "reward-rare";
    case "uncommon":
      return "reward-uncommon";
    case "common":
    default:
      return "reward-common";
  }
}
