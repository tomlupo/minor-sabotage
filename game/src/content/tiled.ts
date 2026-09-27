// Map <-> Tiled JSON (.tmj). ADR-0001: maps are Tiled files and the rules read the tile and
// object properties (walkable, blocks sight, cover, building group id, street id). Tiles are
// 12 x 9 px (1 m), so Tiled's pixel coordinates are the art's.
import type { GroundMat } from "../art/types";
import { emptyMap, type MapBuilding, type MapData, type MapProp, F_ROOF, F_SIGHT, F_WALK } from "./mapdata";

export const TW = 12;
export const TH = 9;
const GID_FLAGS = 101;
const GID_STREETS = 201;

type Prop = { name: string; type: "string" | "int" | "bool" | "float"; value: string | number | boolean };
export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  point?: boolean;
  polyline?: { x: number; y: number }[];
  rotation: number;
  visible: boolean;
  properties?: Prop[];
}
export interface TiledLayer {
  id: number;
  name: string;
  type: "tilelayer" | "objectgroup";
  x: number;
  y: number;
  width?: number;
  height?: number;
  data?: number[];
  objects?: TiledObject[];
  opacity: number;
  visible: boolean;
}
export interface TiledTileset {
  firstgid: number;
  name: string;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  image: string;
  imagewidth: number;
  imageheight: number;
  margin: number;
  spacing: number;
  tiles: { id: number; properties: Prop[] }[];
}
export interface TiledMap {
  type: "map";
  version: string;
  tiledversion: string;
  orientation: "orthogonal";
  renderorder: "right-down";
  infinite: false;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  nextlayerid: number;
  nextobjectid: number;
  properties: Prop[];
  tilesets: TiledTileset[];
  layers: TiledLayer[];
}

const p = (name: string, value: string | number | boolean): Prop => ({
  name,
  type: typeof value === "boolean" ? "bool" : typeof value === "number" ? (Number.isInteger(value) ? "int" : "float") : "string",
  value,
});
const getProp = (o: { properties?: Prop[] }, name: string) => o.properties?.find((q) => q.name === name)?.value;

export function mapToTiled(md: MapData): TiledMap {
  let oid = 1;
  const obj = (o: Omit<TiledObject, "id" | "rotation" | "visible">): TiledObject => ({ id: oid++, rotation: 0, visible: true, ...o });
  const flagsLayer = Array.from(md.flags, (f) => (f ? GID_FLAGS + f : 0));
  const streetLayer = Array.from(md.street, (s) => (s >= 0 ? GID_STREETS + s : 0));
  const layers: TiledLayer[] = [
    { id: 1, name: "ground", type: "tilelayer", x: 0, y: 0, width: md.w, height: md.h, data: Array.from(md.ground, (g) => g + 1), opacity: 1, visible: true },
    { id: 2, name: "blocking", type: "tilelayer", x: 0, y: 0, width: md.w, height: md.h, data: flagsLayer, opacity: 0.6, visible: true },
    { id: 3, name: "streets", type: "tilelayer", x: 0, y: 0, width: md.w, height: md.h, data: streetLayer, opacity: 0.4, visible: false },
    {
      id: 4, name: "buildings", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: true,
      objects: md.buildings.map((b) => obj({
        name: b.id, type: "building", x: b.x * TW, y: b.y * TH, width: b.w * TW, height: b.d * TH,
        properties: [
          p("kind", b.kind), p("storeys", b.storeys), p("roof", b.roof), p("plaster", b.plaster), p("street", b.street),
          p("cuttable", b.cuttable), p("seed", b.seed), p("front", JSON.stringify(b.front ?? {})),
          ...(b.courtyard ? [p("courtyard", JSON.stringify(b.courtyard))] : []),
        ],
      })),
    },
    {
      id: 5, name: "props", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: true,
      objects: md.props.map((q) => obj({
        name: q.kind, type: "prop", x: q.x * TW, y: q.y * TH, width: 0, height: 0, point: true,
        properties: [
          ...(q.variant ? [p("variant", q.variant)] : []),
          ...(q.tag ? [p("tag", q.tag)] : []),
          ...(q.block ? [p("block", JSON.stringify(q.block))] : []),
        ],
      })),
    },
    {
      id: 6, name: "zones", type: "objectgroup", x: 0, y: 0, opacity: 0.5, visible: false,
      objects: md.zones.map((z) => obj({ name: z.name, type: "zone", x: z.x * TW, y: z.y * TH, width: z.w * TW, height: z.h * TH })),
    },
    {
      id: 7, name: "paths", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: false,
      objects: md.paths.map((q) => obj({
        name: q.name, type: "path", x: q.pts[0].x * TW, y: q.pts[0].y * TH, width: 0, height: 0,
        polyline: q.pts.map((pt) => ({ x: (pt.x - q.pts[0].x) * TW, y: (pt.y - q.pts[0].y) * TH })),
      })),
    },
  ];
  const tile = (i: number, props: Prop[]) => ({ id: i, properties: props });
  return {
    type: "map", version: "1.10", tiledversion: "1.11.0", orientation: "orthogonal", renderorder: "right-down", infinite: false,
    width: md.w, height: md.h, tilewidth: TW, tileheight: TH, nextlayerid: 8, nextobjectid: oid,
    properties: [p("name", md.name), p("generatedBy", "game/src/content/arsenal/map.ts via tests/map.test.ts: edit the builder, not this file"), p("streets", JSON.stringify(md.streets))],
    tilesets: [
      {
        firstgid: 1, name: "materials", tilewidth: TW, tileheight: TH, tilecount: md.legend.length, columns: md.legend.length,
        image: "tiles/materials.png", imagewidth: TW * md.legend.length, imageheight: TH, margin: 0, spacing: 0,
        tiles: md.legend.map((m, i) => tile(i, [p("material", m)])),
      },
      {
        firstgid: GID_FLAGS, name: "flags", tilewidth: TW, tileheight: TH, tilecount: 32, columns: 32,
        image: "tiles/flags.png", imagewidth: TW * 32, imageheight: TH, margin: 0, spacing: 0,
        tiles: Array.from({ length: 32 }, (_, f) => tile(f, [
          p("walkable", !!(f & F_WALK)), p("blocksSight", !!(f & F_SIGHT)), p("cover", !!(f & 4)), p("roof", !!(f & F_ROOF)),
        ])),
      },
      {
        firstgid: GID_STREETS, name: "streets", tilewidth: TW, tileheight: TH, tilecount: md.streets.length, columns: md.streets.length,
        image: "tiles/streets.png", imagewidth: TW * md.streets.length, imageheight: TH, margin: 0, spacing: 0,
        tiles: md.streets.map((s) => tile(s.id, [p("street", s.name), p("streetId", s.id)])),
      },
    ],
    layers,
  };
}

export function mapFromTiled(t: TiledMap): MapData {
  const materials = t.tilesets.find((s) => s.name === "materials")!;
  const legend = materials.tiles.map((x) => getProp(x, "material") as GroundMat);
  const md = emptyMap(String(getProp(t, "name") ?? "map"), t.width, t.height, legend);
  md.streets = JSON.parse(String(getProp(t, "streets") ?? "[]"));
  const layer = (n: string) => t.layers.find((l) => l.name === n)!;
  const g = layer("ground").data!, f = layer("blocking").data!, s = layer("streets").data!;
  for (let i = 0; i < md.w * md.h; i++) {
    md.ground[i] = Math.max(0, g[i] - 1);
    md.flags[i] = f[i] ? f[i] - GID_FLAGS : 0;
    md.street[i] = s[i] ? s[i] - GID_STREETS : -1;
  }
  for (const o of layer("buildings").objects!) {
    const b: MapBuilding = {
      id: o.name,
      kind: getProp(o, "kind") as MapBuilding["kind"],
      x: Math.round(o.x / TW), y: Math.round(o.y / TH), w: Math.round(o.width / TW), d: Math.round(o.height / TH),
      storeys: Number(getProp(o, "storeys")),
      roof: getProp(o, "roof") as MapBuilding["roof"],
      plaster: getProp(o, "plaster") as MapBuilding["plaster"],
      street: Number(getProp(o, "street")),
      cuttable: Boolean(getProp(o, "cuttable")),
      seed: Number(getProp(o, "seed")),
      front: JSON.parse(String(getProp(o, "front") ?? "{}")),
    };
    const court = getProp(o, "courtyard");
    if (court) b.courtyard = JSON.parse(String(court));
    const idx = md.buildings.length;
    md.buildings.push(b);
    for (let cy = b.y; cy < b.y + b.d; cy++)
      for (let cx = b.x; cx < b.x + b.w; cx++) {
        const i = cy * md.w + cx;
        if (!(md.flags[i] & F_WALK)) md.building[i] = idx;
      }
  }
  for (const o of layer("props").objects!) {
    const q: MapProp = { kind: o.name as MapProp["kind"], x: o.x / TW, y: o.y / TH };
    const v = getProp(o, "variant"), tag = getProp(o, "tag"), block = getProp(o, "block");
    if (v !== undefined) q.variant = String(v);
    if (tag !== undefined) q.tag = String(tag);
    if (block !== undefined) q.block = JSON.parse(String(block));
    md.props.push(q);
  }
  for (const o of layer("zones").objects!) md.zones.push({ name: o.name, x: o.x / TW, y: o.y / TH, w: o.width / TW, h: o.height / TH });
  for (const o of layer("paths").objects!) md.paths.push({ name: o.name, pts: o.polyline!.map((pt) => ({ x: (o.x + pt.x) / TW, y: (o.y + pt.y) / TH })) });
  return md;
}
