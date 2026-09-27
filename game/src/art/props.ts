// Props (types.ts PropBuilder): the street furniture, barricades and set dressing of the Arsenal
// demo, Warsaw, 26 March 1943, about five in the afternoon. Every prop is drawn as code in the
// game's projection (style guide §2), lit from the top left, outlined on the bottom and right,
// with a cast shadow to the south-east (§4), from palette colours only (§3).
//
// Anchor = the prop's ground point (the base centre; for the telephone pole the foot of the pole,
// for the ghetto wall the middle of the 2 m segment). States a prop does not have fall back to
// intact; PROP_STATES lists the meaningful ones. Variants:
//   bench        0 faces south, 1 faces north (seen from behind)
//   tree         a number: the seed of its shape
//   street_sign  the street name, e.g. "DŁUGA", "BIELAŃSKA", "NALEWKI"
//   barrier      0 a Spanish rider in barbed wire, 1 a striped boom on two posts
//   gate         0 closed, 1 half open
//   ghetto_wall  "ew" (default) east-west segment, "ns" north-south; digits seed the bricks ("ns2")
//   snow_heap    a number: the seed of its shape
//   dorozka      0 faces east, 1 or "w" faces west
import type { PropArt, PropBuilder, PropKind, PropState } from "./types";
import { adColumn, bench, bin, hydrant, kiosk, lamp, phoneBox, phonePole, POLE_INSULATOR_PIXELS, streetSign, tramStop } from "./props-street";
import { barrel, barrier, cart, crates, gate, ghettoWall, sandbags, snowHeap, tree } from "./props-yard";
import { dorozka } from "./props-dorozka";

export const PROP_KINDS: readonly PropKind[] = [
  "lamp", "ad_column", "kiosk", "bench", "tree", "phone_pole", "phone_box", "sandbags", "barrier", "barrel",
  "crates", "cart", "hydrant", "tram_stop", "street_sign", "gate", "ghetto_wall", "bin", "snow_heap", "dorozka",
];

/** The states each prop is drawn in; any other state draws intact. */
export const PROP_STATES: Readonly<Record<PropKind, readonly PropState[]>> = {
  lamp: ["intact"],
  ad_column: ["intact"],
  kiosk: ["intact", "burning", "destroyed"],
  bench: ["intact"],
  tree: ["intact"],
  phone_pole: ["intact", "destroyed"],
  phone_box: ["intact", "destroyed"],
  sandbags: ["intact"],
  barrier: ["intact"],
  barrel: ["intact", "burning", "destroyed"],
  crates: ["intact", "burning", "destroyed"],
  cart: ["intact"],
  hydrant: ["intact"],
  tram_stop: ["intact"],
  street_sign: ["intact"],
  gate: ["intact"],
  ghetto_wall: ["intact"],
  bin: ["intact"],
  snow_heap: ["intact"],
  dorozka: ["intact"],
};

/**
 * The wire's insulator on the intact telephone pole: pixel (x, y) in
 * buildProp("phone_pole", "intact").image. The game draws the wires between poles from here;
 * subtract the prop's (ax, ay) for the offset from the pole's ground point. All four insulators
 * are in POLE_INSULATOR_PIXELS (west to east); this is the east-most.
 */
export const POLE_WIRE_POINT: [number, number] = [POLE_INSULATOR_PIXELS[3][0], POLE_INSULATOR_PIXELS[3][1]];
export { POLE_INSULATOR_PIXELS };

const num = (v: number | string | undefined, d: number): number => {
  if (typeof v === "number") return v;
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
};

export const buildProp: PropBuilder = (kind, state, variant) => {
  const st: PropState = PROP_STATES[kind].includes(state) ? state : "intact";
  let art: PropArt;
  switch (kind) {
    case "lamp": art = lamp(); break;
    case "ad_column": art = adColumn(); break;
    case "kiosk": art = kiosk(st); break;
    case "bench": art = bench(variant === "n" || variant === "north" ? 1 : num(variant, 0)); break;
    case "tree": art = tree(num(variant, 1)); break;
    case "phone_pole": art = phonePole(st); break;
    case "phone_box": art = phoneBox(st); break;
    case "sandbags": art = sandbags(); break;
    case "barrier": art = barrier(variant === "boom" ? 1 : num(variant, 0)); break;
    case "barrel": art = barrel(st); break;
    case "crates": art = crates(st); break;
    case "cart": art = cart(); break;
    case "hydrant": art = hydrant(); break;
    case "tram_stop": art = tramStop(); break;
    case "street_sign": art = streetSign(typeof variant === "string" ? variant : "DŁUGA"); break;
    case "gate": art = gate(variant === "open" ? 1 : num(variant, 0)); break;
    case "ghetto_wall": art = ghettoWall(typeof variant === "string" ? variant : `ew${num(variant, 1)}`); break;
    case "bin": art = bin(); break;
    case "snow_heap": art = snowHeap(num(variant, 1)); break;
    case "dorozka": art = dorozka(variant); break;
  }
  return art;
};
