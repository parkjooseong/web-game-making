import type { AllyKind, Vector2 } from "../types";

export interface DamageEnemyOptions {
  source?: Vector2;
  bypassFrontGuard?: boolean;
  sourceSkillId?: string;
  sourceAllyKind?: AllyKind;
}
