export interface Vec2 {
  x: number;
  y: number;
}

export const v2 = (x: number, y: number): Vec2 => ({ x, y });

export const v2add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const v2sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const v2scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const v2lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const v2len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const v2dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export const v2rot = (p: Vec2, angleRad: number, pivot: Vec2 = { x: 0, y: 0 }): Vec2 => {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c };
};
