import type { Vector2 } from "./types";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function distance(a: Vector2, b: Vector2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalize(vector: Vector2): Vector2 {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 0.0001) {
    return { x: 0, y: 0 };
  }
  return { x: vector.x / length, y: vector.y / length };
}

export function dot(a: Vector2, b: Vector2): number {
  return a.x * b.x + a.y * b.y;
}

export function perpendicularDistance(point: Vector2, origin: Vector2, direction: Vector2): number {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return Math.abs(dx * -direction.y + dy * direction.x);
}

export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
