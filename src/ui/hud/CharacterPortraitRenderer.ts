import type { CharacterId } from "../../game/simulation/types";

export interface CharacterCardDetail {
  role: string;
  difficulty: string;
  gestures: string;
  synergy: string;
  shortTone: string;
}

export const CHARACTER_CARD_DETAILS: Record<CharacterId, CharacterCardDetail> = {
  rio: {
    role: "고속 번개 딜러",
    difficulty: "쉬움",
    gestures: "Slash / Thrust",
    synergy: "번개 배달 루트",
    shortTone: "사선 · 번개 · 부스터"
  },
  maru: {
    role: "방어/반격 탱커",
    difficulty: "보통",
    gestures: "Cross Guard / Palm Push",
    synergy: "도깨비 성벽",
    shortTone: "원 · 방패 · 뿔"
  },
  neon: {
    role: "표식/함정 암살자",
    difficulty: "어려움",
    gestures: "Point / Circle / Focus Triangle",
    synergy: "글리치 처형자",
    shortTone: "삼각형 · 글리치 · 칼날"
  },
  cookie: {
    role: "소환/장판 서포터",
    difficulty: "보통",
    gestures: "Circle / Spread / Heart",
    synergy: "슬라임 파티 셰프",
    shortTone: "원 · 젤리 · 냄비"
  }
};

interface PortraitOptions {
  active?: boolean;
  compact?: boolean;
}

export function renderCharacterPortrait(characterId: CharacterId, options: PortraitOptions = {}): string {
  const classes = ["character-card-portrait", `portrait-${characterId}`];
  if (options.active) {
    classes.push("is-active");
  }
  if (options.compact) {
    classes.push("is-compact");
  }

  return `
    <div class="${classes.join(" ")}" aria-hidden="true">
      ${portraitSvg(characterId)}
    </div>
  `;
}

function portraitSvg(characterId: CharacterId): string {
  switch (characterId) {
    case "rio":
      return `
        <svg viewBox="0 0 180 180" role="img">
          <defs>
            <linearGradient id="rioSuit" x1="35" y1="48" x2="145" y2="155">
              <stop stop-color="#48f7ff"/>
              <stop offset="1" stop-color="#2f86ff"/>
            </linearGradient>
          </defs>
          <path class="portrait-glow" d="M27 126 80 91 63 134 147 42 112 101 153 88 91 160z"/>
          <path class="rio-trail" d="M18 120 66 91 51 124 107 61"/>
          <path class="rio-pack" d="M42 83 74 77 79 133 45 140z"/>
          <path class="rio-leg" d="M71 120 91 120 88 156 61 158z"/>
          <path class="rio-leg right" d="M102 119 122 116 134 151 108 158z"/>
          <path class="rio-body" d="M62 74 119 66 135 120 75 135z"/>
          <path class="rio-core" d="M86 84 116 82 105 121 78 125z"/>
          <path class="rio-arm" d="M117 79 154 89 150 107 111 99z"/>
          <path class="rio-arm left" d="M62 82 31 106 41 122 71 99z"/>
          <ellipse class="skin" cx="94" cy="58" rx="28" ry="25"/>
          <path class="rio-hair" d="M62 56 89 13 95 45 128 22 113 58 152 56 111 76 78 75z"/>
          <path class="rio-eye" d="M77 57 91 58 81 64z"/>
          <path class="rio-eye" d="M105 56 119 54 111 63z"/>
          <path class="rio-bolt" d="M146 84 164 65 157 88 174 87 150 119 156 96z"/>
        </svg>
      `;
    case "maru":
      return `
        <svg viewBox="0 0 180 180" role="img">
          <circle class="portrait-glow" cx="90" cy="105" r="63"/>
          <ellipse class="maru-shadow" cx="91" cy="154" rx="62" ry="16"/>
          <path class="maru-horn" d="M58 47 32 15 70 36z"/>
          <path class="maru-horn right" d="M122 47 148 15 110 36z"/>
          <ellipse class="maru-body" cx="91" cy="105" rx="50" ry="56"/>
          <circle class="skin" cx="90" cy="58" r="31"/>
          <path class="maru-hair" d="M55 48Q90 13 126 48 109 38 90 43 72 38 55 48z"/>
          <circle class="maru-eye" cx="78" cy="60" r="4"/>
          <circle class="maru-eye" cx="103" cy="60" r="4"/>
          <path class="maru-mouth" d="M80 73Q90 80 101 73"/>
          <path class="maru-shield" d="M47 73H133L126 135 90 162 54 135z"/>
          <circle class="maru-emblem" cx="90" cy="111" r="24"/>
          <path class="maru-cross" d="M90 84V139M62 112H118"/>
        </svg>
      `;
    case "neon":
      return `
        <svg viewBox="0 0 180 180" role="img">
          <path class="portrait-glow" d="M90 9 159 159H21z"/>
          <path class="neon-echo" d="M26 104h38v8H26zM119 139h36v8h-36zM128 48h24v7h-24z"/>
          <path class="neon-cloak" d="M90 14 142 76 129 159 99 131 76 163 41 79z"/>
          <path class="neon-inner" d="M68 78H112L104 139H76z"/>
          <ellipse class="skin" cx="90" cy="65" rx="27" ry="23"/>
          <path class="neon-hood" d="M90 17 135 74Q113 51 90 52 66 51 45 74z"/>
          <path class="neon-mask" d="M60 62H120V78H60z"/>
          <path class="neon-visor" d="M63 68H117"/>
          <path class="neon-blade" d="M127 91 171 110 132 124z"/>
          <path class="neon-arm" d="M111 84 145 98 137 116 105 100z"/>
          <path class="neon-glitch" d="M30 62h33M117 41h24M36 134h31M126 151h28"/>
        </svg>
      `;
    case "cookie":
      return `
        <svg viewBox="0 0 180 180" role="img">
          <circle class="portrait-glow" cx="86" cy="106" r="62"/>
          <ellipse class="cookie-slime" cx="132" cy="139" rx="28" ry="22"/>
          <circle class="slime-eye" cx="122" cy="137" r="3"/>
          <circle class="slime-eye" cx="141" cy="137" r="3"/>
          <path class="cookie-pot" d="M36 92H70L66 146H39z"/>
          <ellipse class="cookie-body" cx="87" cy="105" rx="48" ry="53"/>
          <path class="cookie-apron" d="M64 77H111L107 145H70z"/>
          <circle class="skin" cx="88" cy="58" r="27"/>
          <path class="cookie-hair" d="M55 53Q88 24 124 53 108 47 89 51 70 47 55 53z"/>
          <circle class="chef-hat" cx="63" cy="29" r="17"/>
          <circle class="chef-hat middle" cx="90" cy="21" r="22"/>
          <circle class="chef-hat" cx="118" cy="29" r="17"/>
          <rect class="chef-band" x="56" y="37" width="69" height="20" rx="9"/>
          <circle class="cookie-eye" cx="78" cy="61" r="4"/>
          <circle class="cookie-eye" cx="101" cy="61" r="4"/>
          <path class="cookie-smile" d="M80 73Q90 79 101 72"/>
          <path class="cookie-ladle" d="M121 82 153 123"/>
          <ellipse class="cookie-ladle-bowl" cx="158" cy="130" rx="14" ry="11"/>
          <path class="cookie-heart" d="M91 104c-8-10-24 2 0 18 24-16 8-28 0-18z"/>
        </svg>
      `;
  }
}

