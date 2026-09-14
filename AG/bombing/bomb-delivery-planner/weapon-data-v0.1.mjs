export const WEAPON_DATABASE_V0_1 = Object.freeze([
  { id: "M82", name: "Mk-82 (LD)", weight: 500, drag: 0.165, area: 2.000, fragAlt0: 2140, fragAlt5: 2500, fragRange0: 2550, fragRange5: 2900, fragTime0: 24.4, fragTime5: 25.9, safety: "MCH Table 5.3" },
  { id: "B49", name: "Mk-82 AIR (HD)", weight: 550, drag: 1.000, area: 4.000, fragAlt0: 2140, fragAlt5: 2500, fragRange0: 2550, fragRange5: 2900, fragTime0: 24.4, fragTime5: 25.9, safety: "MCH Table 5.3 · Mk-82 All Types" },
  { id: "M83", name: "Mk-83 (LD)", weight: 1000, drag: 0.165, area: 2.000, fragAlt0: 2455, fragAlt5: 2825, fragRange0: 2905, fragRange5: 3307.5, fragTime0: 26.2, fragTime5: 27.8, safety: "Mk-82/84 midpoint · provisional" },
  { id: "B85", name: "Mk-83 AIR (HD)", weight: 990, drag: 1.000, area: 4.000, fragAlt0: 2455, fragAlt5: 2825, fragRange0: 2905, fragRange5: 3307.5, fragTime0: 26.2, fragTime5: 27.8, safety: "Mk-82/84 midpoint · provisional" },
  { id: "M84", name: "Mk-84 (LD)", weight: 2000, drag: 0.165, area: 2.000, fragAlt0: 2770, fragAlt5: 3150, fragRange0: 3260, fragRange5: 3715, fragTime0: 28.0, fragTime5: 29.7, safety: "MCH Table 5.3" },
  { id: "B50", name: "Mk-84 AIR (HD)", weight: 1975, drag: 1.000, area: 4.000, fragAlt0: 2770, fragAlt5: 3150, fragRange0: 3260, fragRange5: 3715, fragTime0: 28.0, fragTime5: 29.7, safety: "MCH Table 5.3 · Mk-84 All Types" },
].map((weapon) => Object.freeze(weapon)));

export function getWeaponById(weaponId) {
  const weapon = WEAPON_DATABASE_V0_1.find((candidate) => candidate.id === weaponId);
  if (!weapon) throw new RangeError(`Unknown weaponId: ${weaponId}`);
  return weapon;
}
