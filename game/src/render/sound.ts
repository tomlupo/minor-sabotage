// Rules events to sound. The synthesiser lives in src/audio (drawn as code, like the art).
import type { Sim } from "../sim/sim";
import type { SimEvent } from "../sim/types";
import { audio, type Sfx, type Music } from "../audio";

// the alarm raises the music once per phase; loops started in a phase end with it
let alarmOn = false;
const fireLoops = new Set<string>();

export const sound = {
  unlock() { audio.unlock(); },
  muted(m: boolean) { audio.setMuted(m); },
  music(m: Music | null, fade = 1.5) { audio.music(m, fade); },
  ambience(on: boolean) { audio.ambience(on); },
  listener(x: number, y: number) { audio.setListener(x, y); },
  ui(name: Sfx) { audio.play(name); },
  play(name: Sfx, x?: number, y?: number, gain?: number) { audio.play(name, { x, y, gain }); },
  duck(a: number, s: number) { audio.duck(a, s); },

  /** A phase starts calm: no alarm yet, whatever the last phase ended on. */
  beginPhase() {
    alarmOn = false;
    audio.intensity(0);
  },
  /** A phase is over: nothing it left burning may go on sounding over the next screen. */
  endPhase() {
    for (const id of fireLoops) audio.loop("fire", id, null);
    fireLoops.clear();
    alarmOn = false;
    audio.intensity(0);
  },

  event(sim: Sim, e: SimEvent) {
    switch (e.t) {
      case "shot": {
        const name = e.weapon === "sten" ? "sten" : e.weapon === "mp40" ? "mp40" : e.weapon === "rifle" ? "rifle" : "pistol";
        audio.play(name, { x: e.x0, y: e.y0 });
        // presentation randomness only: the rules' seeded RNG must not be touched from here
        if (e.hit === -1 && Math.random() < 0.15) audio.play("ricochet", { x: e.x1, y: e.y1, gain: 0.5 });
        break;
      }
      case "hit": if (e.unit >= 0) audio.play("hit", { x: e.x, y: e.y, gain: 0.7 }); break;
      case "death": audio.play(e.silent ? "knife" : "body_fall", { x: e.x, y: e.y }); break;
      case "explosion": audio.play("explosion", { x: e.x, y: e.y }); audio.duck(0.5, 0.6); break;
      case "bottle": audio.play("bottle_smash", { x: e.x, y: e.y }); break; // the smash carries its own whoosh
      case "throw": {
        const u = sim.unit(e.unit);
        audio.play(e.kind === "grenade" ? "grenade_throw" : "bottle_throw", { x: u?.x, y: u?.y });
        break;
      }
      case "fire": {
        const id = `fire${e.id}`;
        if (e.on) fireLoops.add(id);
        else fireLoops.delete(id);
        audio.loop("fire", id, e.on ? { x: e.x, y: e.y, gain: 0.8 } : null);
        break;
      }
      case "whistle": audio.play("whistle", { x: e.x, y: e.y }); break;
      case "alarm":
        if (!alarmOn) { alarmOn = true; audio.intensity(1); audio.play("ui_alert"); }
        break;
      case "brake": {
        const v = sim.vehicle(e.id);
        audio.play("truck_brake", { x: v?.x, y: v?.y });
        break;
      }
      case "vehicle": {
        const v = sim.vehicle(e.id);
        if (e.state === "burning") audio.play("explosion_far", { x: v?.x, y: v?.y });
        break;
      }
      case "work": if (e.done) audio.play("ui_ok"); break;
      case "objective": if (e.status === "done") audio.play("promotion"); break;
      case "pause": audio.play("ui_pause"); audio.duck(0.6, 1); break;
      case "phase": audio.play(e.outcome === "fail" ? "fallen" : "mission_done"); break;
      default: break;
    }
  },
};
