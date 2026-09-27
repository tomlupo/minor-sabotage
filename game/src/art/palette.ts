// The one source of colour is docs/art/palette.json (style guide §3). Nothing in the game
// hard-codes a colour; generators take them from here.
import raw from "../../../docs/art/palette.json";

export type RGB = readonly [number, number, number];
export type Ramp = readonly RGB[];

export const PAL = raw as unknown as {
  shared: {
    outline: RGB;
    shadow: RGB;
    poppy_red: RGB;
    cone_yellow: RGB;
    select_gold: RGB;
    ghost: RGB;
    chalk: RGB;
    glass: RGB;
    glass_dark: RGB;
    window_lit: RGB;
    fire: Ramp;
  };
  city_1943: Record<
    | "cobble"
    | "pavement"
    | "slush"
    | "dirty_snow"
    | "puddle"
    | "plaster_ochre"
    | "plaster_green"
    | "plaster_cream"
    | "brick"
    | "stone_grey"
    | "tin_roof"
    | "soot"
    | "bark"
    | "tram"
    | "tram_cream"
    | "wood"
    | "cut_cap"
    | "cloth",
    Ramp
  > & { mortar: RGB; rail: RGB };
  forest: Record<string, Ramp>;
  troopers: {
    skin: Ramp;
    eye: RGB;
    boots: RGB;
    belt: RGB;
    rifle: Ramp;
    pack: RGB;
    armband: { white: RGB; red: RGB };
    partisan_jackets: Ramp[];
    prisoner_coat: Ramp;
    occupier_field_grey: Ramp;
    occupier_belt: RGB;
    occupier_boots: RGB;
    headgear: { cap: Ramp; hat: Ramp; helmet_wz31: Ramp; stahlhelm: Ramp };
  };
  hud: {
    tag_steel: Ramp;
    tag_ink: RGB;
    button_olive: Ramp;
    button_rim: RGB;
    button_ink: RGB;
    hp_ok: RGB;
    hp_low: RGB;
    squads: { squad_1: RGB; squad_2: RGB; squad_3: RGB };
    paper: Ramp;
    paper_ink: RGB;
  };
  light: {
    ambient: Record<"day" | "afternoon" | "dusk" | "night", readonly [number, number, number]>;
    pool: Record<string, { rgb: readonly [number, number, number]; radius_m?: number }>;
  };
};

export const hex = (c: RGB): number => (c[0] << 16) | (c[1] << 8) | c[2];
export const css = (c: RGB, a = 1): string =>
  a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

export const SQUAD_COLOURS: readonly RGB[] = [PAL.hud.squads.squad_1, PAL.hud.squads.squad_2, PAL.hud.squads.squad_3];
