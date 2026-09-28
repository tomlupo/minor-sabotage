// The real people of the Arsenal action in the demo's three squads (decision 2026-09-28:
// real people in the demo, ranks and roles set by hand). Sections and deeds from
// docs/research/arsenal.md §2. Only two Sten guns existed (Maciek, Słoń); most carried
// pistols; the Butelki section had petrol bottles and Granaty four grenades.
// The white-and-red armband is the style guide's readability cue (§6): on the day they
// wore civilian clothes and no armbands.
import type { TrooperLook } from "../../art/types";
import type { Role, WeaponId } from "../../sim/types";

export interface Person {
  key: string;
  pseudonym: string;
  name: string;
  section: string;
  rank: number;
  role: Role;
  weapon: WeaponId;
  grenades: number;
  bottles: number;
  look: TrooperLook;
  /** One line for the briefing card, from the sources. */
  line: string;
}

export interface SquadDef {
  name: string;
  colour: number;
  people: Person[];
  /** What this squad is good at, for the briefing cards. */
  strength: string;
}

const P = (
  key: string, pseudonym: string, name: string, section: string, rank: number, role: Role, weapon: WeaponId,
  kit: { g?: number; b?: number }, look: Omit<TrooperLook, "body" | "armband">, line: string,
): Person => ({
  key, pseudonym, name, section, rank, role, weapon, grenades: kit.g ?? 0, bottles: kit.b ?? 0,
  look: { body: "partisan", armband: true, ...look }, line,
});

export const SQUADS: SquadDef[] = [
  {
    name: "Zośka",
    colour: 0,
    strength: "Petrol bottles, a Sten and grenades: the attack",
    people: [
      P("zoska", "Zośka", "Tadeusz Zawadzki", "Atak, commander", 6, "leader", "pistol", {}, { jacket: 0, headgear: "bare", weapon: "pistol", kit: "none", seed: 11 }, "Planned the action and led the attack group. Rudy was his closest friend."),
      P("slon", "Słoń", "Jerzy Gawin", "Sten II", 4, "sten", "sten", {}, { jacket: 2, headgear: "cap", weapon: "sten", kit: "none", seed: 12 }, "The Sten gunner of Sten II. His gun jammed until Zośka took the safety off."),
      P("anoda", "Anoda", "Jan Rodowicz", "Butelki", 4, "bottles", "pistol", { b: 2 }, { jacket: 1, headgear: "beret", weapon: "pistol", kit: "bottle_bag", seed: 13 }, "Threw the first bottle. It missed."),
      P("bolec", "Bolec", "Tadeusz Chojko", "Butelki", 3, "bottles", "pistol", { b: 3 }, { jacket: 3, headgear: "cap", weapon: "pistol", kit: "bottle_bag", seed: 14 }, "His bottle, the third, broke the windscreen and set the van alight."),
      P("alek", "Alek", "Maciej Aleksy Dawidowski", "Granaty", 5, "grenades", "pistol", { g: 2 }, { jacket: 2, headgear: "hat", weapon: "pistol", kit: "grenade_pouch", seed: 15 }, "Held the northernmost post on Nalewki with the section's grenades."),
    ],
  },
  {
    name: "Kołczan",
    colour: 1,
    strength: "The second Sten and more grenades: the barrier",
    people: [
      P("kolczan", "Kołczan", "Eugeniusz Koecher", "Sten I", 4, "leader", "pistol", {}, { jacket: 1, headgear: "cap", weapon: "pistol", kit: "none", seed: 21 }, "First to reach the van. He opened the tailgate."),
      P("maciek", "Maciek", "Sławomir Bittner", "Sten I", 4, "sten", "sten", {}, { jacket: 0, headgear: "beret", weapon: "sten", kit: "none", seed: 22 }, "The Sten gunner of Sten I."),
      P("buzdygan", "Buzdygan", "Tadeusz Krzyżewicz", "Sten II", 3, "pistol", "pistol", {}, { jacket: 3, headgear: "bare", weapon: "pistol", kit: "none", seed: 23 }, "Pistol cover for Sten II. The youngest of the attack group."),
      P("hubert", "Hubert", "Hubert Lenk", "Granaty", 3, "grenades", "pistol", { g: 1 }, { jacket: 2, headgear: "cap", weapon: "pistol", kit: "grenade_pouch", seed: 24 }, "Granaty section, with Alek on Nalewki."),
      P("mirski", "Mirski", "Jerzy Zapadko", "Granaty", 3, "grenades", "pistol", { g: 1 }, { jacket: 0, headgear: "hat", weapon: "pistol", kit: "grenade_pouch", seed: 25 }, "Granaty section. Later the last commander of the Parasol battalion."),
    ],
  },
  {
    name: "Giewont",
    colour: 2,
    strength: "Two scouts who know the van and the street: the cover and the signal",
    people: [
      P("giewont", "Giewont", "Władysław Cieplak", "Ubezpieczenie, commander", 5, "leader", "pistol", { g: 1 }, { jacket: 3, headgear: "hat", weapon: "pistol", kit: "none", seed: 31 }, "Commanded the cover group."),
      P("kuba", "Kuba", "Konrad Okolski", "Sygnalizacja", 3, "scout", "pistol", {}, { jacket: 1, headgear: "cap", weapon: "pistol", kit: "binoculars", seed: 32 }, "Had been driven in the van himself and knew its route. He waved his cap."),
      P("kadlubek", "Kadłubek", "Witold Bartnicki", "Sygnalizacja", 3, "scout", "pistol", {}, { jacket: 0, headgear: "hat", weapon: "pistol", kit: "binoculars", seed: 33 }, "In a Tyrolean hat by the Bank Polski. He bowed as the van passed."),
      P("jur", "Jur", "Andrzej Wolski", "Sygnalizacja", 3, "pistol", "pistol", {}, { jacket: 2, headgear: "cap", weapon: "pistol", kit: "none", seed: 34 }, "Held the telephone in the restaurant on the corner."),
      P("kopec", "Kopeć", "Stanisław Jastrzębski", "Stare Miasto", 3, "pistol", "pistol", { g: 1 }, { jacket: 3, headgear: "beret", weapon: "pistol", kit: "none", seed: 35 }, "Covered the Old Town end of Długa."),
    ],
  },
];

export const PEOPLE: Record<string, Person> = Object.fromEntries(SQUADS.flatMap((s) => s.people).map((p) => [p.key, p]));

/** Looks for everyone else on the street. Keys are what the rules call `look`. */
export const OTHER_LOOKS: Record<string, TrooperLook> = {
  de_rifle: { body: "occupier", headgear: "stahlhelm", weapon: "rifle", kit: "none", seed: 101 },
  de_mp40: { body: "occupier", headgear: "stahlhelm", weapon: "mp40", kit: "none", seed: 102 },
  de_officer: { body: "occupier", headgear: "peaked_cap", weapon: "pistol", kit: "none", seed: 103 },
  de_gestapo: { body: "occupier", headgear: "peaked_cap", weapon: "pistol", kit: "none", seed: 104 },
  pris: { body: "prisoner", headgear: "bare", weapon: "none", kit: "none", seed: 201 },
  pris2: { body: "prisoner", headgear: "bare", weapon: "none", kit: "none", seed: 202 },
  rudy: { body: "prisoner", headgear: "bare", weapon: "none", kit: "none", seed: 203, beaten: true },
  civ_m1: { body: "civilian_m", headgear: "hat", weapon: "none", kit: "none", jacket: 1, seed: 301 },
  civ_m2: { body: "civilian_m", headgear: "cap", weapon: "none", kit: "none", jacket: 3, seed: 302 },
  civ_f1: { body: "civilian_f", headgear: "headscarf", weapon: "none", kit: "none", jacket: 0, seed: 303 },
  civ_f2: { body: "civilian_f", headgear: "hat", weapon: "none", kit: "none", jacket: 2, seed: 304 },
  jeremi: { body: "partisan", headgear: "cap", weapon: "pistol", kit: "driver_tag", jacket: 1, armband: true, seed: 41 },
};

export function allLooks(): Record<string, TrooperLook> {
  return { ...OTHER_LOOKS, ...Object.fromEntries(Object.values(PEOPLE).map((p) => [p.key, p.look])) };
}
