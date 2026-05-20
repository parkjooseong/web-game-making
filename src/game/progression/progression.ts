import { ADVENTURE_STAGES } from "../content/adventure";
import { CHARACTER_ORDER, getSkillsForCharacter } from "../content/skills";
import type {
  AchievementId,
  AchievementUnlock,
  BossType,
  CastGrade,
  CharacterId,
  CharacterSkinId,
  CoreId,
  EffectPaletteId,
  EnemyType,
  GameMode,
  UnlockedItem
} from "../simulation/types";
import {
  ACHIEVEMENTS,
  createAchievementUnlock,
  getAchievementProgress,
  type AchievementProgress
} from "./achievements";
import { UNLOCK_CONDITIONS, isUnlockConditionMet } from "./unlocks";

export interface CoreDefinition {
  id: CoreId;
  title: string;
  shortLabel: string;
  description: string;
}

export interface CharacterProgress {
  xp: number;
  level: number;
  runs: number;
  victories: number;
  perfectCasts: number;
}

export interface SkillProgress {
  uses: number;
  perfects: number;
  level: number;
}

export interface DailyChallenge {
  id: string;
  title: string;
  description: string;
  dateKey: string;
  modifiers: DailyChallengeModifiers;
}

export interface DailyChallengeModifiers {
  playerHpMultiplier: number;
  startingGauge: number;
  enemySpeedMultiplier: number;
  enemyHpMultiplier: number;
  enemyScoreMultiplier: number;
  skillCooldownMultiplier: number;
  perfectDamageMultiplier: number;
  perfectGaugeGain: number;
  missCooldownMultiplier: number;
  killGaugeMultiplier: number;
  dashCooldownMultiplier: number;
  dashSkillDamageBonus: number;
  swarmSpawnBonus: number;
  areaDamageMultiplier: number;
  bossHpMultiplier: number;
  bossScoreMultiplier: number;
  oneHandSkillDamageMultiplier: number;
  randomCore: boolean;
  mirrorZeroSpawnBonus: number;
}

export interface SkinDefinition {
  id: CharacterSkinId;
  characterId: CharacterId;
  title: string;
  shortLabel: string;
  description: string;
  themeColor: string;
}

export interface EffectPaletteDefinition {
  id: EffectPaletteId;
  title: string;
  shortLabel: string;
  description: string;
  primary: number;
  secondary: number;
  uiColor: string;
}

export interface StoryEntry {
  id: string;
  characterId: CharacterId;
  title: string;
  requiredLevel: number;
  body: string;
}

export interface NoiseCodexEntry {
  enemyType: EnemyType;
  title: string;
  role: string;
  weakness: string;
  description: string;
}

export type AdventureGrade = "C" | "B" | "A" | "S";

export interface AdventureStageProgress {
  clears: number;
  bestScore: number;
  bestSeconds: number;
  bestGrade: AdventureGrade | null;
}

export interface RunSummary {
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
  unlockedItems: UnlockedItem[];
  unlockedAchievements: AchievementUnlock[];
}

export interface AdventureStageClearResult extends AdventureStageProgress {
  grade: AdventureGrade;
  isNewBest: boolean;
  unlockedAchievements: AchievementUnlock[];
}

export interface UnlockStats {
  storyVictories: number;
  maruBossClears: number;
  lowHpVictories: number;
}

export interface AchievementStats {
  noMissStageClears: number;
  bossPosePerfectCounters: number;
  rioFastClears: number;
  maruShieldDamageAbsorbed: number;
  neonMarkedKills: number;
  cookieSlimesSummoned: number;
  survivalTenMinuteClears: number;
  defeatedBossTypes: BossType[];
}

export interface ProgressSnapshot {
  tutorialCompleted: boolean;
  unlockStats: UnlockStats;
  achievementStats: AchievementStats;
  achievements: Record<AchievementId, AchievementProgress>;
  characters: Record<CharacterId, CharacterProgress>;
  skills: Record<string, SkillProgress>;
  unlockedCoreIds: CoreId[];
  equippedCoreId: CoreId;
  unlockedSkinIds: CharacterSkinId[];
  equippedSkins: Record<CharacterId, CharacterSkinId>;
  unlockedEffectPaletteIds: EffectPaletteId[];
  equippedEffectPaletteId: EffectPaletteId;
  discoveredEnemyTypes: EnemyType[];
  selectedAdventureStageId: string;
  adventureStages: Record<string, AdventureStageProgress>;
  daily: DailyChallenge;
}

const STORAGE_KEY = "movecasters.pose-break.progress.v1";

const defaultUnlockedCoreIds: CoreId[] = ["stability-core"];
const defaultUnlockedSkinIds: CharacterSkinId[] = ["rio-default", "maru-default", "neon-default", "cookie-default"];
const defaultUnlockedEffectPaletteIds: EffectPaletteId[] = ["classic"];

export const CORES: CoreDefinition[] = [
  {
    id: "echo-core",
    title: "에코 코어",
    shortLabel: "ECHO",
    description: "스킬이 낮은 확률로 Normal 등급 잔향을 한 번 더 발동합니다."
  },
  {
    id: "rhythm-core",
    title: "리듬 코어",
    shortLabel: "RHYTHM",
    description: "Perfect Cast 때 코어 게이지와 기본 공격 템포를 추가로 얻습니다."
  },
  {
    id: "guard-core",
    title: "가드 코어",
    shortLabel: "GUARD",
    description: "방어형 스킬 사용 후 보호막을 얻고, 전투 시작 보호막이 증가합니다."
  },
  {
    id: "rampage-core",
    title: "폭주 코어",
    shortLabel: "RAGE",
    description: "체력이 낮을수록 모든 피해량이 증가합니다."
  },
  {
    id: "stability-core",
    title: "안정 코어",
    shortLabel: "STABLE",
    description: "포즈 인식 실패 시 잃는 쿨타임과 게이지 손실을 줄입니다."
  },
  {
    id: "focus-core",
    title: "집중 코어",
    shortLabel: "FOCUS",
    description: "같은 스킬을 연속 시전하면 피해량이 점점 증가합니다."
  }
];

export const SKINS: SkinDefinition[] = [
  {
    id: "rio-default",
    characterId: "rio",
    title: "번개 배달부",
    shortLabel: "BOLT",
    description: "리오의 기본 배달 재킷. 번개 궤적이 가장 선명하게 보입니다.",
    themeColor: "#48f7ff"
  },
  {
    id: "rio-racer",
    characterId: "rio",
    title: "네온 레이서",
    shortLabel: "RACE",
    description: "루프시티 도로를 가르는 레이서 슈트. 대시 잔상이 더 날렵해집니다.",
    themeColor: "#ffd166"
  },
  {
    id: "rio-ninja",
    characterId: "rio",
    title: "사이버 닌자",
    shortLabel: "NINJA",
    description: "어두운 전투복과 라임 번개 포인트가 섞인 은밀한 스타일입니다.",
    themeColor: "#b8ff5c"
  },
  {
    id: "maru-default",
    characterId: "maru",
    title: "도깨비 방패",
    shortLabel: "ONI",
    description: "마루의 기본 수호자 복장. 둥근 실루엣과 도깨비 뿔이 강조됩니다.",
    themeColor: "#8c7aff"
  },
  {
    id: "maru-knight",
    characterId: "maru",
    title: "기사 방패",
    shortLabel: "KNIGHT",
    description: "금속 갑주와 큰 문장 방패로 반격 캐릭터성이 또렷해집니다.",
    themeColor: "#7dffb2"
  },
  {
    id: "maru-pajama",
    characterId: "maru",
    title: "곰돌이 잠옷",
    shortLabel: "PAJAMA",
    description: "부드럽고 귀여운 잠옷 스타일. 그래도 방패는 단단합니다.",
    themeColor: "#ffb3d9"
  },
  {
    id: "neon-default",
    characterId: "neon",
    title: "글리치 암살자",
    shortLabel: "GLITCH",
    description: "네온의 기본 후드 코트. 분홍 글리치 라인이 손짓을 따라 흔들립니다.",
    themeColor: "#ff5ea8"
  },
  {
    id: "neon-hacker",
    characterId: "neon",
    title: "해커 코트",
    shortLabel: "HACK",
    description: "차가운 시안 회로 무늬와 긴 코트로 해킹 판타지를 강화합니다.",
    themeColor: "#48f7ff"
  },
  {
    id: "neon-idol",
    characterId: "neon",
    title: "글리치 아이돌",
    shortLabel: "IDOL",
    description: "무대 조명처럼 번지는 핑크와 퍼플 포인트의 변칙 스타일입니다.",
    themeColor: "#c7b8ff"
  },
  {
    id: "cookie-default",
    characterId: "cookie",
    title: "슬라임 연금술사",
    shortLabel: "SLIME",
    description: "쿠키의 기본 젤리 코트. 소환수와 잘 어울리는 통통한 색감입니다.",
    themeColor: "#ff7ad9"
  },
  {
    id: "cookie-patissier",
    characterId: "cookie",
    title: "파티셰",
    shortLabel: "CAKE",
    description: "크림 셰프 모자와 민트 포인트. 젤리 폭탄이 디저트처럼 보입니다.",
    themeColor: "#7dffb2"
  },
  {
    id: "cookie-witch",
    characterId: "cookie",
    title: "마녀 요리사",
    shortLabel: "WITCH",
    description: "보라색 조리 망토와 별빛 냄비 장식으로 장난스러움을 살립니다.",
    themeColor: "#b68cff"
  }
];

export const EFFECT_PALETTES: EffectPaletteDefinition[] = [
  {
    id: "classic",
    title: "클래식 코어",
    shortLabel: "BASE",
    description: "캐릭터별 기본 스킬 색을 유지합니다.",
    primary: 0x48f7ff,
    secondary: 0xffd166,
    uiColor: "#48f7ff"
  },
  {
    id: "neon-pop",
    title: "네온 팝",
    shortLabel: "POP",
    description: "핑크와 시안이 강하게 튀는 방송 친화 팔레트입니다.",
    primary: 0xff5ea8,
    secondary: 0x48f7ff,
    uiColor: "#ff5ea8"
  },
  {
    id: "gold-rush",
    title: "골드 러시",
    shortLabel: "GOLD",
    description: "Perfect Cast 연출이 금빛으로 번지는 화려한 이펙트 스킨입니다.",
    primary: 0xffd166,
    secondary: 0xd7ff3f,
    uiColor: "#ffd166"
  },
  {
    id: "slime-soda",
    title: "슬라임 소다",
    shortLabel: "SODA",
    description: "민트와 라임 계열 잔광으로 장판과 소환 연출이 더 부드러워집니다.",
    primary: 0x7dffb2,
    secondary: 0xb8ff5c,
    uiColor: "#7dffb2"
  }
];

export const STORY_ENTRIES: StoryEntry[] = [
  {
    id: "rio-1",
    characterId: "rio",
    title: "긴급 배송",
    requiredLevel: 1,
    body: "리오는 멈춘 도시를 가로질러 사람들에게 물자와 짧은 농담을 배달합니다."
  },
  {
    id: "rio-2",
    characterId: "rio",
    title: "번개보다 빠른 책임감",
    requiredLevel: 3,
    body: "건방진 말투 뒤에는 늦지 않겠다는 약속이 있습니다. Perfect Cast가 쌓일수록 리오는 더 과감해집니다."
  },
  {
    id: "maru-1",
    characterId: "maru",
    title: "작은 방패 장인",
    requiredLevel: 1,
    body: "마루는 무섭다고 말하면서도 늘 제일 앞에 섭니다. 방패는 겁을 숨기는 도구가 아니라, 함께 서는 이유입니다."
  },
  {
    id: "maru-2",
    characterId: "maru",
    title: "도깨비 문장",
    requiredLevel: 3,
    body: "방패의 문장은 막아낸 충격을 기억합니다. 반격이 강할수록 마루의 목소리도 단단해집니다."
  },
  {
    id: "neon-1",
    characterId: "neon",
    title: "삭제할 수 없는 오류",
    requiredLevel: 1,
    body: "네온은 노이즈의 언어를 읽습니다. 조용히 손짓하면 시스템의 빈틈이 드러납니다."
  },
  {
    id: "neon-2",
    characterId: "neon",
    title: "계획한 실수",
    requiredLevel: 3,
    body: "실수처럼 보이는 순간이 사실은 함정일 때가 있습니다. 네온은 그 사실을 끝까지 인정하지 않습니다."
  },
  {
    id: "cookie-1",
    characterId: "cookie",
    title: "폭발하는 레시피",
    requiredLevel: 1,
    body: "쿠키에게 전투는 요리입니다. 맛은 보장 못 해도, 화면이 즐거워지는 건 확실합니다."
  },
  {
    id: "cookie-2",
    characterId: "cookie",
    title: "슬라임 친구들",
    requiredLevel: 3,
    body: "작은 슬라임들이 많아질수록 쿠키는 더 신납니다. 문제는 가끔 본인도 몇 마리인지 모른다는 점입니다."
  }
];

export const NOISE_CODEX: NoiseCodexEntry[] = [
  {
    enemyType: "runner",
    title: "노이즈 러너",
    role: "돌진형",
    weakness: "스파크 슬래시, 넉백",
    description: "빠르게 접근해 몸통박치기를 시도합니다. 몰아서 한 줄로 세우면 리오의 Q가 가장 빛납니다."
  },
  {
    enemyType: "shooter",
    title: "노이즈 슈터",
    role: "원거리 탄막",
    weakness: "대시, 가드",
    description: "일정 거리를 유지하며 탄환을 쏩니다. 캐스팅 전에 위치를 바꾸면 빈틈이 커집니다."
  },
  {
    enemyType: "swarm",
    title: "노이즈 스웜",
    role: "군집 압박",
    weakness: "광역기, 장판",
    description: "작고 많이 몰려옵니다. Perfect Cast 광역 이펙트의 손맛을 확인하기 좋은 표적입니다."
  },
  {
    enemyType: "tank",
    title: "노이즈 탱커",
    role: "고체력 전열",
    weakness: "표식, 연쇄 피해",
    description: "느리지만 오래 버팁니다. 게이지를 채운 뒤 강한 포즈 스킬로 정리하는 편이 좋습니다."
  },
  {
    enemyType: "castBreaker",
    title: "캐스트 브레이커",
    role: "시전 방해",
    weakness: "선제 처치, 대시 거리 조절",
    description: "포즈를 준비하는 순간 속도를 올려 달려듭니다. 닿으면 캐스팅을 끊으니 스킬 버튼을 누르기 전에 먼저 밀어내세요."
  },
  {
    enemyType: "shieldNoise",
    title: "실드 노이즈",
    role: "정면 방어",
    weakness: "후방 공격, 측면 이동, 장판",
    description: "항상 플레이어 쪽으로 방패면을 돌립니다. 정면 공격은 크게 줄어드니 장판을 깔거나 대시로 각도를 바꾸는 편이 좋습니다."
  },
  {
    enemyType: "anchorNoise",
    title: "앵커 노이즈",
    role: "지역 봉쇄",
    weakness: "빠른 접근, 원거리 폭딜",
    description: "플레이어 발밑 주변에 둔화 장판을 고정합니다. 오래 방치하면 좋은 캐스팅 위치가 점점 사라집니다."
  },
  {
    enemyType: "medicNoise",
    title: "메딕 노이즈",
    role: "지원 회복",
    weakness: "우선 처치, 표식 집중",
    description: "주변 노이즈를 조금씩 수리합니다. 탱커나 실드 노이즈 뒤에 숨어 있으면 전투가 길어집니다."
  },
  {
    enemyType: "bombNoise",
    title: "봄 노이즈",
    role: "자폭 압박",
    weakness: "원거리 처치, 넉백",
    description: "가까워지거나 처치될 때 폭발합니다. 무리를 향해 터뜨리면 위험이 기회로 바뀝니다."
  },
  {
    enemyType: "drum",
    title: "드럼 노이즈",
    role: "1지역 보스",
    weakness: "타이밍 대시, 광역 반격",
    description: "리듬 충격파를 둥글게 뿌립니다. 공격 사이에 포즈 브레이크를 꽂으면 무대가 뒤집힙니다."
  },
  {
    enemyType: "mirror",
    title: "아이리스",
    role: "거울 보스",
    weakness: "스킬 다양화",
    description: "분신과 반사 패턴으로 플레이어의 루틴을 흔듭니다. 같은 손버릇만 반복하면 압박이 커집니다."
  },
  {
    enemyType: "zero",
    title: "제로 모션",
    role: "최종 보스",
    weakness: "게이지 관리, Perfect Cast",
    description: "움직임과 코어 게이지를 빼앗습니다. 지금까지 익힌 동작을 종합해 반격해야 합니다."
  }
];

export const DEFAULT_DAILY_MODIFIERS: DailyChallengeModifiers = {
  playerHpMultiplier: 1,
  startingGauge: 82,
  enemySpeedMultiplier: 1,
  enemyHpMultiplier: 1,
  enemyScoreMultiplier: 1,
  skillCooldownMultiplier: 1,
  perfectDamageMultiplier: 1,
  perfectGaugeGain: 0,
  missCooldownMultiplier: 1,
  killGaugeMultiplier: 1,
  dashCooldownMultiplier: 1,
  dashSkillDamageBonus: 0,
  swarmSpawnBonus: 0,
  areaDamageMultiplier: 1,
  bossHpMultiplier: 1,
  bossScoreMultiplier: 1,
  oneHandSkillDamageMultiplier: 1,
  randomCore: false,
  mirrorZeroSpawnBonus: 0
};

type DailyChallengeSeed = Omit<DailyChallenge, "dateKey" | "modifiers"> & {
  modifiers: Partial<DailyChallengeModifiers>;
};

const DAILY_POOL: DailyChallengeSeed[] = [
  {
    id: "accelerated-noise",
    title: "가속 노이즈",
    description: "적 이동 속도가 상승하지만 처치 점수가 크게 증가합니다.",
    modifiers: {
      enemySpeedMultiplier: 1.18,
      enemyScoreMultiplier: 1.25
    }
  },
  {
    id: "perfect-surge",
    title: "퍼펙트 서지",
    description: "Perfect Cast가 더 강해지고 코어 게이지를 추가로 회복합니다.",
    modifiers: {
      perfectDamageMultiplier: 1.12,
      perfectGaugeGain: 12
    }
  },
  {
    id: "unstable-core",
    title: "불안정 코어",
    description: "스킬 쿨타임이 길어지는 대신 적 처치 게이지 회복량이 증가합니다.",
    modifiers: {
      skillCooldownMultiplier: 1.15,
      killGaugeMultiplier: 1.35
    }
  },
  {
    id: "close-call",
    title: "아슬아슬 배달",
    description: "시작 체력이 낮아지지만 대시 후 스킬 피해량이 증가합니다.",
    modifiers: {
      playerHpMultiplier: 0.78,
      dashSkillDamageBonus: 0.35,
      enemyScoreMultiplier: 1.12
    }
  },
  {
    id: "pose-master",
    title: "포즈 마스터",
    description: "Perfect Cast 피해가 크게 증가하지만 Miss 쿨타임 패널티도 커집니다.",
    modifiers: {
      perfectDamageMultiplier: 1.35,
      missCooldownMultiplier: 1.45,
      enemyScoreMultiplier: 1.18
    }
  },
  {
    id: "no-gauge-start",
    title: "노 게이지 스타트",
    description: "코어 게이지 0으로 시작하지만 적 처치 게이지 회복량이 크게 증가합니다.",
    modifiers: {
      startingGauge: 0,
      killGaugeMultiplier: 1.75,
      enemyScoreMultiplier: 1.16
    }
  },
  {
    id: "swarm-party",
    title: "스웜 파티",
    description: "스웜이 더 많이 등장하지만 광역 스킬 피해가 증가합니다.",
    modifiers: {
      swarmSpawnBonus: 0.36,
      areaDamageMultiplier: 1.25,
      enemyScoreMultiplier: 1.12
    }
  },
  {
    id: "boss-rush-day",
    title: "보스 러시 데이",
    description: "보스 체력이 증가하지만 보스 처치 점수가 크게 증가합니다.",
    modifiers: {
      bossHpMultiplier: 1.25,
      bossScoreMultiplier: 1.7,
      perfectDamageMultiplier: 1.08
    }
  },
  {
    id: "one-hand-caster",
    title: "원 핸드 캐스터",
    description: "한 손 제스처 스킬이 강화되지만 전체 쿨타임이 약간 길어집니다.",
    modifiers: {
      oneHandSkillDamageMultiplier: 1.28,
      skillCooldownMultiplier: 1.06,
      enemyScoreMultiplier: 1.1
    }
  },
  {
    id: "random-core",
    title: "랜덤 코어",
    description: "매 판 임의의 모션 코어를 장착하고 처치 점수 보너스를 얻습니다.",
    modifiers: {
      randomCore: true,
      enemyScoreMultiplier: 1.18
    }
  },
  {
    id: "moving-day",
    title: "무빙 데이",
    description: "대시 쿨타임이 짧아지지만 적 이동 속도도 상승합니다.",
    modifiers: {
      dashCooldownMultiplier: 0.72,
      enemySpeedMultiplier: 1.16,
      dashSkillDamageBonus: 0.2,
      enemyScoreMultiplier: 1.12
    }
  },
  {
    id: "glitch-day",
    title: "글리치 데이",
    description: "미러/제로 계열 방해 적이 늘어나지만 처치 점수가 증가합니다.",
    modifiers: {
      mirrorZeroSpawnBonus: 0.38,
      enemyScoreMultiplier: 1.22,
      missCooldownMultiplier: 1.12
    }
  }
];

export class ProgressionStore {
  private snapshot: ProgressSnapshot;
  private listeners = new Set<(snapshot: ProgressSnapshot) => void>();
  private pendingUnlockedItems: UnlockedItem[] = [];
  private pendingAchievementUnlocks: AchievementUnlock[] = [];

  constructor() {
    this.snapshot = this.load();
    if (this.evaluateAchievements().length > 0 || this.evaluateUnlocks().length > 0) {
      this.pendingUnlockedItems = [];
      this.pendingAchievementUnlocks = [];
      this.save();
    }
  }

  getSnapshot(): ProgressSnapshot {
    return clone(this.snapshot);
  }

  getDailyChallenge(): DailyChallenge {
    const today = createDailyChallenge();
    if (this.snapshot.daily.dateKey !== today.dateKey) {
      this.snapshot.daily = today;
      this.save();
    }
    return this.snapshot.daily;
  }

  getEquippedCore(): CoreDefinition {
    return CORES.find((core) => core.id === this.snapshot.equippedCoreId) ?? CORES[0];
  }

  equipCore(coreId: CoreId): void {
    if (!this.snapshot.unlockedCoreIds.includes(coreId)) {
      return;
    }
    this.snapshot.equippedCoreId = coreId;
    this.save();
  }

  equipSkin(characterId: CharacterId, skinId: CharacterSkinId): void {
    const skin = getSkinDefinition(skinId);
    if (skin.characterId !== characterId || !this.snapshot.unlockedSkinIds.includes(skinId)) {
      return;
    }
    this.snapshot.equippedSkins[characterId] = skinId;
    this.save();
  }

  equipEffectPalette(paletteId: EffectPaletteId): void {
    if (!this.snapshot.unlockedEffectPaletteIds.includes(paletteId)) {
      return;
    }
    this.snapshot.equippedEffectPaletteId = paletteId;
    this.save();
  }

  recordEnemySeen(enemyType: EnemyType): AchievementUnlock[] {
    if (enemyType === "dummy" || this.snapshot.discoveredEnemyTypes.includes(enemyType)) {
      return [];
    }
    this.snapshot.discoveredEnemyTypes.push(enemyType);
    this.evaluateProgression();
    this.save();
    return this.drainUnlockedAchievements();
  }

  getSelectedAdventureStageIndex(): number {
    const selectedIndex = ADVENTURE_STAGES.findIndex((stage) => stage.id === this.snapshot.selectedAdventureStageId);
    if (selectedIndex >= 0 && this.isAdventureStageUnlocked(this.snapshot.selectedAdventureStageId)) {
      return selectedIndex;
    }
    return this.getHighestUnlockedAdventureStageIndex();
  }

  getHighestUnlockedAdventureStageIndex(): number {
    let highest = 0;
    for (let index = 1; index < ADVENTURE_STAGES.length; index += 1) {
      const previous = ADVENTURE_STAGES[index - 1];
      if ((this.snapshot.adventureStages[previous.id]?.clears ?? 0) > 0) {
        highest = index;
      }
    }
    return highest;
  }

  isAdventureStageUnlocked(stageId: string): boolean {
    const index = ADVENTURE_STAGES.findIndex((stage) => stage.id === stageId);
    if (index <= 0) {
      return index === 0;
    }
    const previous = ADVENTURE_STAGES[index - 1];
    return (this.snapshot.adventureStages[previous.id]?.clears ?? 0) > 0;
  }

  selectAdventureStage(stageId: string): boolean {
    if (!this.isAdventureStageUnlocked(stageId)) {
      return false;
    }
    this.snapshot.selectedAdventureStageId = stageId;
    this.save();
    return true;
  }

  recordAdventureStageClear(input: { stageId: string; score: number; seconds: number; hpRatio: number; misses?: number }): AdventureStageClearResult {
    const current = this.snapshot.adventureStages[input.stageId] ?? createDefaultAdventureStageProgress();
    const grade = calculateAdventureGrade(input.score, input.seconds, input.hpRatio);
    const currentRank = gradeRank(current.bestGrade);
    const nextRank = gradeRank(grade);
    const isNewBest =
      current.clears === 0 ||
      nextRank > currentRank ||
      (nextRank === currentRank && input.score > current.bestScore) ||
      (nextRank === currentRank && input.score === current.bestScore && (current.bestSeconds === 0 || input.seconds < current.bestSeconds));
    const nextProgress: AdventureStageProgress = {
      clears: current.clears + 1,
      bestScore: isNewBest ? input.score : current.bestScore,
      bestSeconds: isNewBest ? input.seconds : current.bestSeconds,
      bestGrade: isNewBest ? grade : current.bestGrade
    };
    this.snapshot.adventureStages[input.stageId] = nextProgress;

    const currentIndex = ADVENTURE_STAGES.findIndex((stage) => stage.id === input.stageId);
    const nextStage = ADVENTURE_STAGES[currentIndex + 1];
    if (nextStage) {
      this.snapshot.selectedAdventureStageId = nextStage.id;
    }

    if ((input.misses ?? 0) === 0) {
      this.snapshot.achievementStats.noMissStageClears += 1;
    }
    this.evaluateProgression();
    this.save();
    return { ...nextProgress, grade, isNewBest, unlockedAchievements: this.drainUnlockedAchievements() };
  }

  recordCast(characterId: CharacterId, skillId: string, grade: CastGrade): AchievementUnlock[] {
    const character = this.snapshot.characters[characterId];
    const skill = this.snapshot.skills[skillId] ?? { uses: 0, perfects: 0, level: 1 };
    skill.uses += 1;
    if (grade === "Perfect") {
      skill.perfects += 1;
      character.perfectCasts += 1;
    }
    skill.level = calculateSkillLevel(skill.uses, skill.perfects);
    this.snapshot.skills[skillId] = skill;
    this.evaluateProgression();
    this.save();
    return this.drainUnlockedAchievements();
  }

  recordRun(input: {
    characterId: CharacterId;
    mode: GameMode;
    victory: boolean;
    score: number;
    seconds: number;
    hpRatio: number;
    bossClear: boolean;
    misses?: number;
    bossPosePerfectCounters?: number;
    shieldDamageAbsorbed?: number;
    markedEnemyKills?: number;
    slimesSummoned?: number;
    bossesDefeated?: BossType[];
  }): RunSummary {
    const character = this.snapshot.characters[input.characterId];
    const levelBefore = character.level;
    const modeBonus =
      input.mode === "tutorial"
        ? 20
        : input.mode === "adventure"
        ? 95
        : input.mode === "boss-rush"
          ? 70
          : input.mode === "survival"
            ? Math.floor(input.seconds / 6)
            : 40;
    const xpGained = Math.max(25, Math.floor(input.score / 18) + modeBonus + (input.victory ? 90 : 0));
    character.xp += xpGained;
    character.runs += 1;
    if (input.victory) {
      character.victories += 1;
      if (input.mode === "story") {
        this.snapshot.unlockStats.storyVictories += 1;
      }
      if (input.characterId === "maru" && input.bossClear) {
        this.snapshot.unlockStats.maruBossClears += 1;
      }
      if (input.hpRatio <= 0.4) {
        this.snapshot.unlockStats.lowHpVictories += 1;
      }
      if (input.mode !== "adventure" && input.mode !== "tutorial" && (input.misses ?? 0) === 0) {
        this.snapshot.achievementStats.noMissStageClears += 1;
      }
      if (input.characterId === "rio" && input.seconds <= 300) {
        this.snapshot.achievementStats.rioFastClears += 1;
      }
      if (input.mode === "survival" && input.seconds >= 600) {
        this.snapshot.achievementStats.survivalTenMinuteClears += 1;
      }
    }
    this.snapshot.achievementStats.bossPosePerfectCounters += input.bossPosePerfectCounters ?? 0;
    if (input.characterId === "maru") {
      this.snapshot.achievementStats.maruShieldDamageAbsorbed += Math.max(0, Math.round(input.shieldDamageAbsorbed ?? 0));
    }
    if (input.characterId === "neon") {
      this.snapshot.achievementStats.neonMarkedKills += Math.max(0, Math.round(input.markedEnemyKills ?? 0));
    }
    if (input.characterId === "cookie") {
      this.snapshot.achievementStats.cookieSlimesSummoned += Math.max(0, Math.round(input.slimesSummoned ?? 0));
    }
    this.snapshot.achievementStats.defeatedBossTypes = Array.from(
      new Set([...this.snapshot.achievementStats.defeatedBossTypes, ...(input.bossesDefeated ?? [])])
    );
    character.level = calculateCharacterLevel(character.xp);
    this.evaluateProgression(input);
    this.save();
    return {
      xpGained,
      levelBefore,
      levelAfter: character.level,
      unlockedItems: this.drainUnlockedItems(),
      unlockedAchievements: this.drainUnlockedAchievements()
    };
  }

  markTutorialCompleted(): void {
    if (this.snapshot.tutorialCompleted) {
      return;
    }
    this.snapshot.tutorialCompleted = true;
    this.save();
  }

  evaluateProgression(context: Partial<{ characterId: CharacterId; mode: GameMode; victory: boolean; hpRatio: number; bossClear: boolean }> = {}): void {
    this.evaluateAchievements();
    this.evaluateUnlocks(context);
    this.evaluateAchievements();
  }

  evaluateAchievements(): AchievementUnlock[] {
    const unlocked: AchievementUnlock[] = [];
    for (const definition of ACHIEVEMENTS) {
      const view = getAchievementProgress(this.snapshot, definition);
      const current = this.snapshot.achievements[definition.id] ?? { current: 0, completed: false, completedAt: null };
      current.current = view.current;
      if (!current.completed && view.completed) {
        current.completed = true;
        current.completedAt = Date.now();
        const unlock = createAchievementUnlock(definition);
        unlocked.push(unlock);
        this.pendingAchievementUnlocks.push(unlock);
      }
      this.snapshot.achievements[definition.id] = current;
    }
    return unlocked;
  }

  evaluateUnlocks(_context: Partial<{ characterId: CharacterId; mode: GameMode; victory: boolean; hpRatio: number; bossClear: boolean }> = {}): UnlockedItem[] {
    const unlocked: UnlockedItem[] = [];
    const addUnlock = (item: UnlockedItem) => {
      unlocked.push(item);
      this.pendingUnlockedItems.push(item);
    };
    const unlockCore = (coreId: CoreId) => {
      if (this.snapshot.unlockedCoreIds.includes(coreId)) {
        return;
      }
      const core = getCoreDefinition(coreId);
      this.snapshot.unlockedCoreIds.push(coreId);
      addUnlock({ type: "core", id: coreId, title: core.title, description: core.description });
    };
    const unlockSkin = (skinId: CharacterSkinId) => {
      if (this.snapshot.unlockedSkinIds.includes(skinId)) {
        return;
      }
      const skin = getSkinDefinition(skinId);
      this.snapshot.unlockedSkinIds.push(skinId);
      addUnlock({ type: "skin", id: skinId, title: skin.title, description: skin.description });
    };
    const unlockPalette = (paletteId: EffectPaletteId) => {
      if (this.snapshot.unlockedEffectPaletteIds.includes(paletteId)) {
        return;
      }
      const palette = getEffectPaletteDefinition(paletteId);
      this.snapshot.unlockedEffectPaletteIds.push(paletteId);
      addUnlock({ type: "effect", id: paletteId, title: palette.title, description: palette.description });
    };

    for (const definition of UNLOCK_CONDITIONS) {
      if (!isUnlockConditionMet(this.snapshot, definition)) {
        continue;
      }
      if (definition.itemType === "core") {
        unlockCore(definition.itemId as CoreId);
      } else if (definition.itemType === "skin") {
        unlockSkin(definition.itemId as CharacterSkinId);
      } else {
        unlockPalette(definition.itemId as EffectPaletteId);
      }
    }

    return unlocked;
  }

  private drainUnlockedItems(): UnlockedItem[] {
    const items = this.pendingUnlockedItems;
    this.pendingUnlockedItems = [];
    return items;
  }

  private drainUnlockedAchievements(): AchievementUnlock[] {
    const achievements = this.pendingAchievementUnlocks;
    this.pendingAchievementUnlocks = [];
    return achievements;
  }

  subscribe(listener: (snapshot: ProgressSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private load(): ProgressSnapshot {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return normalizeSnapshot(JSON.parse(raw) as Partial<ProgressSnapshot>);
      }
    } catch {
      // Local storage may be unavailable in private or restricted browser contexts.
    }
    return createDefaultSnapshot();
  }

  private save(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot));
    } catch {
      // Progress remains in memory when storage is unavailable.
    }
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export function getCoreDefinition(coreId: CoreId): CoreDefinition {
  return CORES.find((core) => core.id === coreId) ?? CORES[0];
}

export function getDefaultSkinId(characterId: CharacterId): CharacterSkinId {
  return `${characterId}-default` as CharacterSkinId;
}

export function getSkinsForCharacter(characterId: CharacterId): SkinDefinition[] {
  return SKINS.filter((skin) => skin.characterId === characterId);
}

export function getSkinDefinition(skinId: CharacterSkinId): SkinDefinition {
  return SKINS.find((skin) => skin.id === skinId) ?? SKINS[0];
}

export function getEffectPaletteDefinition(paletteId: EffectPaletteId): EffectPaletteDefinition {
  return EFFECT_PALETTES.find((palette) => palette.id === paletteId) ?? EFFECT_PALETTES[0];
}

export function calculateCharacterLevel(xp: number): number {
  const thresholds = [0, 80, 220, 450, 800, 1250, 1800, 2450, 3200, 4100];
  let level = 1;
  for (let index = 0; index < thresholds.length; index += 1) {
    if (xp >= thresholds[index]) {
      level = index + 1;
    }
  }
  return Math.min(10, level);
}

export function calculateSkillLevel(uses: number, perfects: number): number {
  if (uses >= 80 && perfects >= 18) {
    return 5;
  }
  if (uses >= 45 && perfects >= 9) {
    return 4;
  }
  if (uses >= 24 && perfects >= 4) {
    return 3;
  }
  if (uses >= 10) {
    return 2;
  }
  return 1;
}

function createDefaultSnapshot(): ProgressSnapshot {
  const characters = {} as Record<CharacterId, CharacterProgress>;
  for (const characterId of CHARACTER_ORDER) {
    characters[characterId] = {
      xp: 0,
      level: 1,
      runs: 0,
      victories: 0,
      perfectCasts: 0
    };
  }

  const skills: Record<string, SkillProgress> = {};
  for (const characterId of CHARACTER_ORDER) {
    Object.values(getSkillsForCharacter(characterId)).forEach((skill) => {
      skills[skill.id] = { uses: 0, perfects: 0, level: 1 };
    });
  }

  return {
    tutorialCompleted: false,
    unlockStats: {
      storyVictories: 0,
      maruBossClears: 0,
      lowHpVictories: 0
    },
    achievementStats: createDefaultAchievementStats(),
    achievements: createDefaultAchievementProgress(),
    characters,
    skills,
    unlockedCoreIds: [...defaultUnlockedCoreIds],
    equippedCoreId: "stability-core",
    unlockedSkinIds: [...defaultUnlockedSkinIds],
    equippedSkins: {
      rio: "rio-default",
      maru: "maru-default",
      neon: "neon-default",
      cookie: "cookie-default"
    },
    unlockedEffectPaletteIds: [...defaultUnlockedEffectPaletteIds],
    equippedEffectPaletteId: "classic",
    discoveredEnemyTypes: ["runner", "shooter"],
    selectedAdventureStageId: ADVENTURE_STAGES[0]?.id ?? "1-1",
    adventureStages: Object.fromEntries(ADVENTURE_STAGES.map((stage) => [stage.id, createDefaultAdventureStageProgress()])),
    daily: createDailyChallenge()
  };
}

function normalizeSnapshot(input: Partial<ProgressSnapshot>): ProgressSnapshot {
  const fallback = createDefaultSnapshot();
  const resetLegacyUnlocks = shouldResetLegacyUnlocks(input);
  const unlockedCoreIds = ensureIncludes(
    resetLegacyUnlocks
      ? fallback.unlockedCoreIds
      : input.unlockedCoreIds?.filter((coreId): coreId is CoreId => CORES.some((core) => core.id === coreId)) ?? fallback.unlockedCoreIds,
    defaultUnlockedCoreIds
  );
  const equippedCoreCandidate = CORES.some((core) => core.id === input.equippedCoreId) ? input.equippedCoreId as CoreId : fallback.equippedCoreId;
  const equippedCoreId = unlockedCoreIds.includes(equippedCoreCandidate) ? equippedCoreCandidate : fallback.equippedCoreId;
  const unlockedSkinIds =
    ensureIncludes(
      resetLegacyUnlocks
        ? fallback.unlockedSkinIds
        : input.unlockedSkinIds?.filter((skinId): skinId is CharacterSkinId => SKINS.some((skin) => skin.id === skinId)) ?? fallback.unlockedSkinIds,
      defaultUnlockedSkinIds
    );
  const equippedSkins = { ...fallback.equippedSkins, ...input.equippedSkins };
  for (const characterId of CHARACTER_ORDER) {
    const skinId = equippedSkins[characterId];
    const skin = SKINS.find((item) => item.id === skinId);
    if (!skin || skin.characterId !== characterId || !unlockedSkinIds.includes(skinId)) {
      equippedSkins[characterId] = getDefaultSkinId(characterId);
    }
  }
  const unlockedEffectPaletteIds =
    ensureIncludes(
      resetLegacyUnlocks
        ? fallback.unlockedEffectPaletteIds
        : input.unlockedEffectPaletteIds?.filter((paletteId): paletteId is EffectPaletteId => EFFECT_PALETTES.some((palette) => palette.id === paletteId)) ??
          fallback.unlockedEffectPaletteIds,
      defaultUnlockedEffectPaletteIds
    );
  const equippedEffectPaletteId = EFFECT_PALETTES.some((palette) => palette.id === input.equippedEffectPaletteId)
    ? input.equippedEffectPaletteId as EffectPaletteId
    : fallback.equippedEffectPaletteId;
  const discoveredEnemyTypes =
    input.discoveredEnemyTypes?.filter((enemyType): enemyType is EnemyType => NOISE_CODEX.some((entry) => entry.enemyType === enemyType)) ??
    fallback.discoveredEnemyTypes;
  const adventureStages = { ...fallback.adventureStages, ...input.adventureStages };
  for (const stage of ADVENTURE_STAGES) {
    adventureStages[stage.id] = normalizeAdventureStageProgress(adventureStages[stage.id]);
  }
  const selectedAdventureStageId =
    typeof input.selectedAdventureStageId === "string" && ADVENTURE_STAGES.some((stage) => stage.id === input.selectedAdventureStageId)
      ? input.selectedAdventureStageId
      : fallback.selectedAdventureStageId;
  const unlockStats = {
    storyVictories: Math.max(0, Math.floor(input.unlockStats?.storyVictories ?? fallback.unlockStats.storyVictories)),
    maruBossClears: Math.max(0, Math.floor(input.unlockStats?.maruBossClears ?? fallback.unlockStats.maruBossClears)),
    lowHpVictories: Math.max(0, Math.floor(input.unlockStats?.lowHpVictories ?? fallback.unlockStats.lowHpVictories))
  };
  const achievementStats = normalizeAchievementStats(input.achievementStats);
  const normalized = {
    ...fallback,
    ...input,
    tutorialCompleted: Boolean(input.tutorialCompleted),
    unlockStats,
    achievementStats,
    achievements: normalizeAchievementProgress(input.achievements),
    characters: { ...fallback.characters, ...input.characters },
    skills: { ...fallback.skills, ...input.skills },
    unlockedCoreIds,
    equippedCoreId,
    unlockedSkinIds,
    equippedSkins,
    unlockedEffectPaletteIds,
    equippedEffectPaletteId: unlockedEffectPaletteIds.includes(equippedEffectPaletteId) ? equippedEffectPaletteId : fallback.equippedEffectPaletteId,
    discoveredEnemyTypes,
    selectedAdventureStageId,
    adventureStages,
    daily: normalizeDailyChallenge(input.daily)
  };

  for (const characterId of CHARACTER_ORDER) {
    const progress = normalized.characters[characterId];
    progress.level = calculateCharacterLevel(progress.xp);
  }
  Object.keys(normalized.skills).forEach((skillId) => {
    const progress = normalized.skills[skillId];
    progress.level = calculateSkillLevel(progress.uses, progress.perfects);
  });
  syncAchievementProgress(normalized);

  return normalized;
}

function createDefaultAchievementStats(): AchievementStats {
  return {
    noMissStageClears: 0,
    bossPosePerfectCounters: 0,
    rioFastClears: 0,
    maruShieldDamageAbsorbed: 0,
    neonMarkedKills: 0,
    cookieSlimesSummoned: 0,
    survivalTenMinuteClears: 0,
    defeatedBossTypes: []
  };
}

function createDefaultAchievementProgress(): Record<AchievementId, AchievementProgress> {
  return Object.fromEntries(
    ACHIEVEMENTS.map((achievement) => [
      achievement.id,
      {
        current: 0,
        completed: false,
        completedAt: null
      }
    ])
  ) as Record<AchievementId, AchievementProgress>;
}

function normalizeAchievementStats(input?: Partial<AchievementStats>): AchievementStats {
  const fallback = createDefaultAchievementStats();
  return {
    noMissStageClears: Math.max(0, Math.floor(input?.noMissStageClears ?? fallback.noMissStageClears)),
    bossPosePerfectCounters: Math.max(0, Math.floor(input?.bossPosePerfectCounters ?? fallback.bossPosePerfectCounters)),
    rioFastClears: Math.max(0, Math.floor(input?.rioFastClears ?? fallback.rioFastClears)),
    maruShieldDamageAbsorbed: Math.max(0, Math.floor(input?.maruShieldDamageAbsorbed ?? fallback.maruShieldDamageAbsorbed)),
    neonMarkedKills: Math.max(0, Math.floor(input?.neonMarkedKills ?? fallback.neonMarkedKills)),
    cookieSlimesSummoned: Math.max(0, Math.floor(input?.cookieSlimesSummoned ?? fallback.cookieSlimesSummoned)),
    survivalTenMinuteClears: Math.max(0, Math.floor(input?.survivalTenMinuteClears ?? fallback.survivalTenMinuteClears)),
    defeatedBossTypes: Array.from(
      new Set((input?.defeatedBossTypes ?? fallback.defeatedBossTypes).filter((boss): boss is BossType => boss === "drum" || boss === "mirror" || boss === "zero"))
    )
  };
}

function normalizeAchievementProgress(input?: Partial<Record<AchievementId, Partial<AchievementProgress>>>): Record<AchievementId, AchievementProgress> {
  const achievements = createDefaultAchievementProgress();
  for (const definition of ACHIEVEMENTS) {
    const current = input?.[definition.id];
    if (!current) {
      continue;
    }
    achievements[definition.id] = {
      current: Math.max(0, Math.floor(current.current ?? 0)),
      completed: Boolean(current.completed),
      completedAt: typeof current.completedAt === "number" ? current.completedAt : null
    };
  }
  return achievements;
}

function syncAchievementProgress(snapshot: ProgressSnapshot): void {
  for (const definition of ACHIEVEMENTS) {
    const view = getAchievementProgress(snapshot, definition);
    const current = snapshot.achievements[definition.id] ?? { current: 0, completed: false, completedAt: null };
    current.current = view.current;
    if (view.completed && !current.completed) {
      current.completed = true;
      current.completedAt = Date.now();
    }
    snapshot.achievements[definition.id] = current;
  }
}

function createDefaultAdventureStageProgress(): AdventureStageProgress {
  return {
    clears: 0,
    bestScore: 0,
    bestSeconds: 0,
    bestGrade: null
  };
}

function normalizeAdventureStageProgress(input?: Partial<AdventureStageProgress>): AdventureStageProgress {
  return {
    clears: Math.max(0, Math.floor(input?.clears ?? 0)),
    bestScore: Math.max(0, Math.floor(input?.bestScore ?? 0)),
    bestSeconds: Math.max(0, input?.bestSeconds ?? 0),
    bestGrade: input?.bestGrade === "S" || input?.bestGrade === "A" || input?.bestGrade === "B" || input?.bestGrade === "C" ? input.bestGrade : null
  };
}

function ensureIncludes<T>(items: T[], required: T[]): T[] {
  return Array.from(new Set([...items, ...required]));
}

function shouldResetLegacyUnlocks(input: Partial<ProgressSnapshot>): boolean {
  const hadEverythingUnlocked =
    input.unlockedCoreIds?.length === CORES.length &&
    input.unlockedSkinIds?.length === SKINS.length &&
    input.unlockedEffectPaletteIds?.length === EFFECT_PALETTES.length;
  if (!hadEverythingUnlocked) {
    return false;
  }

  const hasCharacterProgress = Object.values(input.characters ?? {}).some(
    (character) => (character?.xp ?? 0) > 0 || (character?.runs ?? 0) > 0 || (character?.victories ?? 0) > 0 || (character?.perfectCasts ?? 0) > 0
  );
  const hasSkillProgress = Object.values(input.skills ?? {}).some((skill) => (skill?.uses ?? 0) > 0 || (skill?.perfects ?? 0) > 0);
  const hasAdventureProgress = Object.values(input.adventureStages ?? {}).some((stage) => (stage?.clears ?? 0) > 0);
  return !hasCharacterProgress && !hasSkillProgress && !hasAdventureProgress;
}

function calculateAdventureGrade(score: number, seconds: number, hpRatio: number): AdventureGrade {
  const speedScore = Math.max(0, 100 - seconds);
  const total = score + speedScore * 3 + hpRatio * 260;
  if (total >= 880 && hpRatio >= 0.45) {
    return "S";
  }
  if (total >= 650) {
    return "A";
  }
  if (total >= 430) {
    return "B";
  }
  return "C";
}

function gradeRank(grade: AdventureGrade | null): number {
  if (grade === "S") {
    return 4;
  }
  if (grade === "A") {
    return 3;
  }
  if (grade === "B") {
    return 2;
  }
  if (grade === "C") {
    return 1;
  }
  return 0;
}

export function describeDailyModifiers(modifiers: DailyChallengeModifiers): string[] {
  const lines: string[] = [];
  if (modifiers.playerHpMultiplier !== 1) {
    lines.push(`시작 체력 ${Math.round(modifiers.playerHpMultiplier * 100)}%`);
  }
  if (modifiers.startingGauge !== DEFAULT_DAILY_MODIFIERS.startingGauge) {
    lines.push(`시작 게이지 ${modifiers.startingGauge}%`);
  }
  if (modifiers.enemySpeedMultiplier !== 1) {
    lines.push(`적 이동 속도 x${formatModifier(modifiers.enemySpeedMultiplier)}`);
  }
  if (modifiers.enemyHpMultiplier !== 1) {
    lines.push(`일반 적 체력 x${formatModifier(modifiers.enemyHpMultiplier)}`);
  }
  if (modifiers.skillCooldownMultiplier !== 1) {
    lines.push(`스킬 쿨타임 x${formatModifier(modifiers.skillCooldownMultiplier)}`);
  }
  if (modifiers.perfectDamageMultiplier !== 1) {
    lines.push(`Perfect 스킬 피해 x${formatModifier(modifiers.perfectDamageMultiplier)}`);
  }
  if (modifiers.perfectGaugeGain > 0) {
    lines.push(`Perfect 시 게이지 +${modifiers.perfectGaugeGain}`);
  }
  if (modifiers.missCooldownMultiplier !== 1) {
    lines.push(`Miss 쿨타임 패널티 x${formatModifier(modifiers.missCooldownMultiplier)}`);
  }
  if (modifiers.killGaugeMultiplier !== 1) {
    lines.push(`처치 게이지 회복 x${formatModifier(modifiers.killGaugeMultiplier)}`);
  }
  if (modifiers.dashCooldownMultiplier !== 1) {
    lines.push(`대시 쿨타임 x${formatModifier(modifiers.dashCooldownMultiplier)}`);
  }
  if (modifiers.dashSkillDamageBonus > 0) {
    lines.push(`대시 후 스킬 피해 +${Math.round(modifiers.dashSkillDamageBonus * 100)}%`);
  }
  if (modifiers.swarmSpawnBonus > 0) {
    lines.push(`스웜 추가 출현 +${Math.round(modifiers.swarmSpawnBonus * 100)}%`);
  }
  if (modifiers.areaDamageMultiplier !== 1) {
    lines.push(`광역 스킬 범위/피해 x${formatModifier(modifiers.areaDamageMultiplier)}`);
  }
  if (modifiers.bossHpMultiplier !== 1) {
    lines.push(`보스 체력 x${formatModifier(modifiers.bossHpMultiplier)}`);
  }
  if (modifiers.bossScoreMultiplier !== 1) {
    lines.push(`보스 처치 점수 x${formatModifier(modifiers.bossScoreMultiplier)}`);
  }
  if (modifiers.oneHandSkillDamageMultiplier !== 1) {
    lines.push(`한 손 제스처 스킬 피해 x${formatModifier(modifiers.oneHandSkillDamageMultiplier)}`);
  }
  if (modifiers.randomCore) {
    lines.push("매 판 랜덤 코어 장착");
  }
  if (modifiers.mirrorZeroSpawnBonus > 0) {
    lines.push(`방해형 노이즈 추가 출현 +${Math.round(modifiers.mirrorZeroSpawnBonus * 100)}%`);
  }
  if (modifiers.enemyScoreMultiplier !== 1) {
    lines.push(`일반 처치 점수 x${formatModifier(modifiers.enemyScoreMultiplier)}`);
  }
  return lines;
}

function createDailyChallenge(date = new Date()): DailyChallenge {
  const dateKey = createDateKey(date);
  const index = hashText(dateKey) % DAILY_POOL.length;
  return createDailyFromSeed(DAILY_POOL[index], dateKey);
}

function createDailyFromSeed(seed: DailyChallengeSeed, dateKey: string): DailyChallenge {
  return {
    id: seed.id,
    title: seed.title,
    description: seed.description,
    dateKey,
    modifiers: {
      ...DEFAULT_DAILY_MODIFIERS,
      ...seed.modifiers
    }
  };
}

function normalizeDailyChallenge(input?: Partial<DailyChallenge>): DailyChallenge {
  const dateKey = createDateKey();
  if (input?.dateKey !== dateKey) {
    return createDailyChallenge();
  }

  const seed = DAILY_POOL.find((challenge) => challenge.id === input.id);
  const base = seed ? createDailyFromSeed(seed, dateKey) : createDailyChallenge();
  return {
    ...base,
    title: input.title ?? base.title,
    description: input.description ?? base.description,
    modifiers: {
      ...base.modifiers,
      ...(input.modifiers ?? {})
    }
  };
}

function formatModifier(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function createDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hashText(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) >>> 0;
  }
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
