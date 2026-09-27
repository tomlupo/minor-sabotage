// Rules events to sound. The synthesiser lives in src/audio (drawn as code, like the art);
// it is looked up at runtime so the game runs silent until it exists.
import type { Sim } from "../sim/sim";
import type { SimEvent } from "../sim/types";

type AudioApi = {
  unlock(): void;
  setMuted(m: boolean): void;
  setVolumes(music: number, sfx: number): void;
  setListener(x: number, y: number): void;
  play(s: string, o?: { x?: number; y?: number; gain?: number; rate?: number }): void;
  loop(l: string, id: string, o?: { x?: number; y?: number; gain?: number; rate?: number } | null): void;
  music(m: string | null, fade?: number): void;
  intensity(v: number): void;
  ambience(on: boolean): void;
  duck(amount: number, seconds: number): void;
};

const MODS = import.meta.glob<{ audio?: AudioApi }>("../audio/index.ts", { eager: true });
const api: AudioApi | null = Object.values(MODS)[0]?.audio ?? null;

let alarmOn = false;

export const sound = {
  available: !!api,
  unlock() { api?.unlock(); },
  muted(m: boolean) { api?.setMuted(m); },
  music(m: string | null, fade = 1.5) { api?.music(m, fade); },
  ambience(on: boolean) { api?.ambience(on); },
  listener(x: number, y: number) { api?.setListener(x, y); },
  ui(name: string) { api?.play(name); },
  play(name: string, x?: number, y?: number, gain?: number) { api?.play(name, { x, y, gain }); },
  duck(a: number, s: number) { api?.duck(a, s); },
  resetIntensity() { alarmOn = false; api?.intensity(0); },

  event(sim: Sim, e: SimEvent) {
    if (!api) return;
    switch (e.t) {
      case "shot": {
        const name = e.weapon === "sten" ? "sten" : e.weapon === "mp40" ? "mp40" : e.weapon === "rifle" ? "rifle" : "pistol";
        api.play(name, { x: e.x0, y: e.y0 });
        if (e.hit === -1 && sim.rand() < 0.15) api.play("ricochet", { x: e.x1, y: e.y1, gain: 0.5 });
        break;
      }
      case "hit": if (e.unit >= 0) api.play("hit", { x: e.x, y: e.y, gain: 0.7 }); break;
      case "death": api.play(e.silent ? "knife" : "body_fall", { x: e.x, y: e.y }); break;
      case "explosion": api.play("explosion", { x: e.x, y: e.y }); api.duck(0.5, 0.6); break;
      case "bottle": api.play("bottle_smash", { x: e.x, y: e.y }); api.play("fire_whoosh", { x: e.x, y: e.y }); break;
      case "throw": {
        const u = sim.unit(e.unit);
        api.play(e.kind === "grenade" ? "grenade_throw" : "bottle_throw", { x: u?.x, y: u?.y });
        break;
      }
      case "fire": api.loop("fire", `fire${e.id}`, e.on ? { x: e.x, y: e.y, gain: 0.8 } : null); break;
      case "whistle": api.play("whistle", { x: e.x, y: e.y }); break;
      case "alarm":
        if (!alarmOn) { alarmOn = true; api.intensity(1); api.play("ui_alert"); }
        break;
      case "brake": {
        const v = sim.vehicle(e.id);
        api.play("truck_brake", { x: v?.x, y: v?.y });
        break;
      }
      case "vehicle": {
        const v = sim.vehicle(e.id);
        if (e.state === "burning") api.play("explosion_far", { x: v?.x, y: v?.y });
        break;
      }
      case "work": if (e.done) api.play("ui_ok"); break;
      case "objective": if (e.status === "done") api.play("promotion"); break;
      case "pause": api.play("ui_pause"); api.duck(0.6, 1); break;
      case "phase": api.play(e.outcome === "fail" ? "fallen" : "mission_done"); break;
      default: break;
    }
  },
};
