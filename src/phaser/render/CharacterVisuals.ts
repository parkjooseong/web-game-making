import type { CharacterId, CharacterSkinId } from "../../game/simulation/types";

export interface CharacterVisualColors {
  jacket: number;
  trim: number;
  pants: number;
  hair: number;
  skin: number;
  shoe: number;
  accent: number;
}

export type TrailShape = "lightning" | "shield-dust" | "glitch" | "jelly";
export type GlowShape = "bolt-ring" | "guard-aura" | "glitch-prism" | "jelly-bloom";

export interface CharacterVisualDefinition {
  id: CharacterId;
  idleRate: number;
  shadowWidth: number;
  shadowHeight: number;
  trailShape: TrailShape;
  glowShape: GlowShape;
}

export const CHARACTER_VISUALS: Record<CharacterId, CharacterVisualDefinition> = {
  rio: {
    id: "rio",
    idleRate: 1.35,
    shadowWidth: 92,
    shadowHeight: 20,
    trailShape: "lightning",
    glowShape: "bolt-ring"
  },
  maru: {
    id: "maru",
    idleRate: 0.82,
    shadowWidth: 106,
    shadowHeight: 28,
    trailShape: "shield-dust",
    glowShape: "guard-aura"
  },
  neon: {
    id: "neon",
    idleRate: 1.08,
    shadowWidth: 86,
    shadowHeight: 22,
    trailShape: "glitch",
    glowShape: "glitch-prism"
  },
  cookie: {
    id: "cookie",
    idleRate: 1.18,
    shadowWidth: 100,
    shadowHeight: 26,
    trailShape: "jelly",
    glowShape: "jelly-bloom"
  }
};

export function getCharacterVisualColors(
  characterId: CharacterId,
  skinId: CharacterSkinId,
  baseColor: number
): CharacterVisualColors {
  const defaults: Record<CharacterId, CharacterVisualColors> = {
    rio: { jacket: baseColor, trim: 0xffd166, pants: 0x1c2a3d, hair: 0x162238, skin: 0xffd0b5, shoe: 0xd7ff3f, accent: 0xd7ff3f },
    maru: { jacket: baseColor, trim: 0x7dffb2, pants: 0x2a2442, hair: 0x4b2d52, skin: 0xf2c3aa, shoe: 0xffd166, accent: 0xffd166 },
    neon: { jacket: 0x221a3a, trim: baseColor, pants: 0x0a0e1a, hair: 0x0a0e1a, skin: 0xd9c0c8, shoe: 0x48f7ff, accent: 0x48f7ff },
    cookie: { jacket: baseColor, trim: 0xffd166, pants: 0xa64a7a, hair: 0xa64a7a, skin: 0xffd0b5, shoe: 0x7dffb2, accent: 0x7dffb2 }
  };

  switch (skinId) {
    case "rio-racer":
      return { jacket: 0xffd166, trim: 0x48f7ff, pants: 0x172235, hair: 0x162238, skin: 0xffd0b5, shoe: 0xff5ea8, accent: 0xd7ff3f };
    case "rio-ninja":
      return { jacket: 0x151a25, trim: 0xb8ff5c, pants: 0x0b1019, hair: 0x071018, skin: 0xffc8ad, shoe: 0x48f7ff, accent: 0xb8ff5c };
    case "maru-knight":
      return { jacket: 0x7dffb2, trim: 0xf6fbff, pants: 0x263348, hair: 0x635178, skin: 0xf2c3aa, shoe: 0xffd166, accent: 0xffd166 };
    case "maru-pajama":
      return { jacket: 0xffb3d9, trim: 0xb8ff5c, pants: 0x6c5485, hair: 0x5b3a63, skin: 0xf2c3aa, shoe: 0xf6fbff, accent: 0xffd166 };
    case "neon-hacker":
      return { jacket: 0x102433, trim: 0x48f7ff, pants: 0x080e18, hair: 0x071018, skin: 0xd9c0c8, shoe: 0xb8ff5c, accent: 0xff5ea8 };
    case "neon-idol":
      return { jacket: 0xff5ea8, trim: 0xc7b8ff, pants: 0x251336, hair: 0x2c183f, skin: 0xffd0d8, shoe: 0x48f7ff, accent: 0xffd166 };
    case "cookie-patissier":
      return { jacket: 0xf6fbff, trim: 0x7dffb2, pants: 0xff7ad9, hair: 0xc0508a, skin: 0xffd0b5, shoe: 0xffd166, accent: 0x7dffb2 };
    case "cookie-witch":
      return { jacket: 0x6e4b9d, trim: 0xffd166, pants: 0x2b1a44, hair: 0xff7ad9, skin: 0xffd0b5, shoe: 0xb8ff5c, accent: 0xc7b8ff };
    default:
      return defaults[characterId];
  }
}

