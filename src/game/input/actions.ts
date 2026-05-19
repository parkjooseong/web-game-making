export type SkillSlot = "Q" | "E" | "R" | "F";

export type InputAction =
  | "move"
  | "dash"
  | "prepare-skill-q"
  | "prepare-skill-e"
  | "prepare-skill-r"
  | "prepare-skill-f"
  | "pause"
  | "debug-cast-normal"
  | "debug-cast-great"
  | "debug-cast-perfect";

export interface MoveInput {
  x: number;
  y: number;
}
