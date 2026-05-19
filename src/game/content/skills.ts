import type { SkillSlot } from "../input/actions";
import type { CastGrade, CharacterId, GestureId } from "../simulation/types";

export interface SkillDefinition {
  id: string;
  slot: SkillSlot;
  name: string;
  shortName: string;
  gestureId: GestureId;
  gestureLabel: string;
  cooldown: number;
  gaugeCost: number;
  color: number;
  uiColor: string;
  damageByGrade: Record<Exclude<CastGrade, "Miss">, number>;
}

export interface CharacterDefinition {
  id: CharacterId;
  name: string;
  title: string;
  color: number;
  uiColor: string;
  hp: number;
  speed: number;
  basicDamage: number;
  basicColor: number;
  failureLine: string;
  perfectLine: string;
  ultimateLine: string;
  skills: Record<SkillSlot, SkillDefinition>;
}

export const RIO_SKILLS: Record<SkillSlot, SkillDefinition> = {
  Q: {
    id: "spark-slash",
    slot: "Q",
    name: "스파크 슬래시",
    shortName: "Slash",
    gestureId: "slash",
    gestureLabel: "손을 빠르게 휘두르세요",
    cooldown: 6,
    gaugeCost: 24,
    color: 0x48f7ff,
    uiColor: "#48f7ff",
    damageByGrade: {
      Normal: 28,
      Great: 40,
      Perfect: 58
    }
  },
  E: {
    id: "lightning-dash",
    slot: "E",
    name: "라이트닝 대시",
    shortName: "Dash",
    gestureId: "thrust",
    gestureLabel: "한 손을 앞으로 찌르세요",
    cooldown: 8,
    gaugeCost: 30,
    color: 0xffd166,
    uiColor: "#ffd166",
    damageByGrade: {
      Normal: 24,
      Great: 36,
      Perfect: 52
    }
  },
  R: {
    id: "chain-bolt",
    slot: "R",
    name: "체인 볼트",
    shortName: "Bolt",
    gestureId: "rise",
    gestureLabel: "손을 머리 위로 들어올리세요",
    cooldown: 10,
    gaugeCost: 45,
    color: 0xb8ff5c,
    uiColor: "#b8ff5c",
    damageByGrade: {
      Normal: 22,
      Great: 32,
      Perfect: 46
    }
  },
  F: {
    id: "thunder-overdrive",
    slot: "F",
    name: "썬더 오버드라이브",
    shortName: "Overdrive",
    gestureId: "open-arms",
    gestureLabel: "양팔을 V자로 크게 들어올리세요",
    cooldown: 34,
    gaugeCost: 100,
    color: 0xd7ff3f,
    uiColor: "#d7ff3f",
    damageByGrade: {
      Normal: 26,
      Great: 42,
      Perfect: 70
    }
  }
};

export const MARU_SKILLS: Record<SkillSlot, SkillDefinition> = {
  Q: {
    id: "dokkaebi-guard",
    slot: "Q",
    name: "도깨비 가드",
    shortName: "Guard",
    gestureId: "cross-guard",
    gestureLabel: "양팔을 X자로 교차하세요",
    cooldown: 7,
    gaugeCost: 18,
    color: 0x8c7aff,
    uiColor: "#8c7aff",
    damageByGrade: {
      Normal: 0,
      Great: 10,
      Perfect: 18
    }
  },
  E: {
    id: "shield-push",
    slot: "E",
    name: "밀어내기",
    shortName: "Push",
    gestureId: "palm-push",
    gestureLabel: "손바닥을 앞으로 밀어내세요",
    cooldown: 7.5,
    gaugeCost: 26,
    color: 0xffd166,
    uiColor: "#ffd166",
    damageByGrade: {
      Normal: 22,
      Great: 34,
      Perfect: 52
    }
  },
  R: {
    id: "earth-drum",
    slot: "R",
    name: "땅울림",
    shortName: "Slam",
    gestureId: "ground-slam",
    gestureLabel: "양손을 아래로 내리치세요",
    cooldown: 10,
    gaugeCost: 42,
    color: 0xb8ff5c,
    uiColor: "#b8ff5c",
    damageByGrade: {
      Normal: 24,
      Great: 38,
      Perfect: 58
    }
  },
  F: {
    id: "giant-shield-wall",
    slot: "F",
    name: "거대 방패 소환",
    shortName: "Wall",
    gestureId: "open-arms",
    gestureLabel: "양팔을 크게 벌려 방패벽을 여세요",
    cooldown: 34,
    gaugeCost: 100,
    color: 0x7dffb2,
    uiColor: "#7dffb2",
    damageByGrade: {
      Normal: 18,
      Great: 28,
      Perfect: 46
    }
  }
};

export const NEON_SKILLS: Record<SkillSlot, SkillDefinition> = {
  Q: {
    id: "glitch-mark",
    slot: "Q",
    name: "글리치 마크",
    shortName: "Mark",
    gestureId: "point",
    gestureLabel: "손을 뻗어 적을 가리키세요",
    cooldown: 5,
    gaugeCost: 18,
    color: 0xff5ea8,
    uiColor: "#ff5ea8",
    damageByGrade: {
      Normal: 10,
      Great: 18,
      Perfect: 28
    }
  },
  E: {
    id: "shadow-cut",
    slot: "E",
    name: "쉐도우 컷",
    shortName: "Cut",
    gestureId: "ground-slam",
    gestureLabel: "손을 아래로 날카롭게 베세요",
    cooldown: 7,
    gaugeCost: 28,
    color: 0x8c7aff,
    uiColor: "#8c7aff",
    damageByGrade: {
      Normal: 28,
      Great: 46,
      Perfect: 70
    }
  },
  R: {
    id: "noise-trap",
    slot: "R",
    name: "노이즈 트랩",
    shortName: "Trap",
    gestureId: "circle",
    gestureLabel: "손으로 작은 원을 그리세요",
    cooldown: 9,
    gaugeCost: 38,
    color: 0x48f7ff,
    uiColor: "#48f7ff",
    damageByGrade: {
      Normal: 18,
      Great: 30,
      Perfect: 46
    }
  },
  F: {
    id: "blackout",
    slot: "F",
    name: "블랙아웃",
    shortName: "Blackout",
    gestureId: "focus-triangle",
    gestureLabel: "양손을 얼굴 앞에 모아 삼각형을 만드세요",
    cooldown: 34,
    gaugeCost: 100,
    color: 0x222a44,
    uiColor: "#c7b8ff",
    damageByGrade: {
      Normal: 24,
      Great: 42,
      Perfect: 68
    }
  }
};

export const COOKIE_SKILLS: Record<SkillSlot, SkillDefinition> = {
  Q: {
    id: "jelly-bomb",
    slot: "Q",
    name: "젤리 폭탄",
    shortName: "Bomb",
    gestureId: "circle",
    gestureLabel: "손으로 원을 그려 젤리를 던지세요",
    cooldown: 6,
    gaugeCost: 24,
    color: 0xff7ad9,
    uiColor: "#ff7ad9",
    damageByGrade: {
      Normal: 26,
      Great: 40,
      Perfect: 60
    }
  },
  E: {
    id: "slime-summon",
    slot: "E",
    name: "슬라임 소환",
    shortName: "Slime",
    gestureId: "spread",
    gestureLabel: "양손을 모았다가 펼치세요",
    cooldown: 8,
    gaugeCost: 30,
    color: 0x7dffb2,
    uiColor: "#7dffb2",
    damageByGrade: {
      Normal: 12,
      Great: 18,
      Perfect: 26
    }
  },
  R: {
    id: "sweet-field",
    slot: "R",
    name: "달콤한 장판",
    shortName: "Field",
    gestureId: "wave",
    gestureLabel: "손을 좌우로 흔드세요",
    cooldown: 10,
    gaugeCost: 42,
    color: 0xb8ff5c,
    uiColor: "#b8ff5c",
    damageByGrade: {
      Normal: 10,
      Great: 18,
      Perfect: 28
    }
  },
  F: {
    id: "slime-party",
    slot: "F",
    name: "대왕 슬라임 파티",
    shortName: "Party",
    gestureId: "heart",
    gestureLabel: "양팔로 큰 하트를 만드세요",
    cooldown: 34,
    gaugeCost: 100,
    color: 0xffd166,
    uiColor: "#ffd166",
    damageByGrade: {
      Normal: 24,
      Great: 42,
      Perfect: 72
    }
  }
};

export const CHARACTERS: Record<CharacterId, CharacterDefinition> = {
  rio: {
    id: "rio",
    name: "RIO",
    title: "번개 배달부",
    color: 0x48f7ff,
    uiColor: "#48f7ff",
    hp: 110,
    speed: 275,
    basicDamage: 13,
    basicColor: 0x48f7ff,
    failureLine: "어? 방금 그건 뭐였어?",
    perfectLine: "느려. 너무 느려!",
    ultimateLine: "배달 완료. 번개까지 같이 왔어!",
    skills: RIO_SKILLS
  },
  maru: {
    id: "maru",
    name: "MARU",
    title: "도깨비 방패 수호자",
    color: 0x8c7aff,
    uiColor: "#8c7aff",
    hp: 145,
    speed: 235,
    basicDamage: 10,
    basicColor: 0x8c7aff,
    failureLine: "괜찮아! 다시 하면 돼!",
    perfectLine: "이 방패, 생각보다 세거든?",
    ultimateLine: "뒤에 있어. 내가 막을게.",
    skills: MARU_SKILLS
  },
  neon: {
    id: "neon",
    name: "NEON",
    title: "글리치 암살자",
    color: 0xff5ea8,
    uiColor: "#ff5ea8",
    hp: 92,
    speed: 292,
    basicDamage: 12,
    basicColor: 0xff5ea8,
    failureLine: "입력 오류. 사용자 책임.",
    perfectLine: "오류 발견. 삭제한다.",
    ultimateLine: "블랙아웃. 이제 조용해.",
    skills: NEON_SKILLS
  },
  cookie: {
    id: "cookie",
    name: "COOKIE",
    title: "슬라임 연금술사",
    color: 0xff7ad9,
    uiColor: "#ff7ad9",
    hp: 118,
    speed: 250,
    basicDamage: 9,
    basicColor: 0x7dffb2,
    failureLine: "음... 이건 요리가 아니었나 봐.",
    perfectLine: "슬라임 친구들, 출동!",
    ultimateLine: "이건 요리야! 폭발하는 요리!",
    skills: COOKIE_SKILLS
  }
};

export const CHARACTER_ORDER: CharacterId[] = ["rio", "maru", "neon", "cookie"];
export const SKILLS = RIO_SKILLS;

export function getCharacter(id: CharacterId): CharacterDefinition {
  return CHARACTERS[id];
}

export function getSkillsForCharacter(id: CharacterId): Record<SkillSlot, SkillDefinition> {
  return CHARACTERS[id].skills;
}

export const gradeLabels: Record<CastGrade, string> = {
  Miss: "MISS",
  Normal: "NORMAL",
  Great: "GREAT",
  Perfect: "PERFECT"
};
