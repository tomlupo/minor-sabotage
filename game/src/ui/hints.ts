// First-time hints: one short line at the moment a control matters, shown once per device.
// The game teaches itself instead of opening with a manual.
import type { Sim } from "../sim/sim";
import type { Phase } from "../missions/types";
import { TASK_MODE, type TaskId } from "../missions/campaign";

export interface Hint {
  id: string;
  text: string;
  /** Show when this becomes true. */
  when: (sim: Sim, phase: Phase) => boolean;
}

const KEY = "ms.hints.seen";

function seen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { return new Set(); }
}

export function markSeen(id: string): void {
  try {
    const s = seen();
    s.add(id);
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch { /* private mode: hints just repeat */ }
}

export function resetHints(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const guardOnScreenish = (sim: Sim) => {
  const L = sim.controlledSquad && sim.leaderOf(sim.controlledSquad);
  return !!L && sim.state.units.some((u) => u.side === "de" && !u.hidden && u.state === "ok" && Math.hypot(u.x - L.x, u.y - L.y) < 30);
};

export const HINTS: Hint[] = [
  { id: "walk", text: "Tap the street to walk there. Drag to lead the squad.", when: (s) => s.state.time > 0.5 },
  { id: "cone", text: "Yellow is what a guard sees. Stay out of it, or be quick.", when: (s) => s.state.time > 4 && guardOnScreenish(s) },
  { id: "knife", text: "Tap a guard from behind: the knife. From the front: the squad fires.", when: (s) => s.state.time > 9 && guardOnScreenish(s) },
  { id: "stealth", text: "Stealth: hide a man at a corner out of the cones, wait for the patrol to pass, then tap the ring.", when: (s, p) => p.kind === "task" && TASK_MODE[p.id as TaskId] === "stealth" && s.state.time > 8 },
  { id: "job", text: "Tap the white ring: the right man does the job.", when: (s, p) => s.state.time > 14 && p.interactables(s).some((i) => i.ready(s)) },
  { id: "alarm", text: "Alarm! Guard posts send men until you blow them up: hold on one to throw.", when: (s) => s.anyAlarm() },
  { id: "pick", text: "Tap a man's tag to send him alone. Tap it again to call him back.", when: (s) => s.state.time > 24 },
  { id: "kit", text: "A fallen man's kit: walk over it to take his grenades, bottles or Sten.", when: (s) => s.state.props.some((p) => p.kind === "kit") },
  { id: "down", text: "A veteran is down. Tap him and a friend gets him up.", when: (s) => s.state.units.some((u) => u.side === "pl" && u.state === "down") },
  { id: "squads", text: "Tap a squad tag to lead that squad. Hold it for its orders.", when: (s, p) => p.kind === "finale" && s.state.time > 2 },
  { id: "go", text: "GO gives the signal: the van comes, and squads on 'signal' move.", when: (s, p) => p.kind === "finale" && s.state.signalReady && !s.state.signalGiven && s.state.time > 7 },
  { id: "bottle", text: "Hold on the van to throw a petrol bottle at its cab.", when: (s) => s.state.vehicles.some((v) => v.tag === "van" && v.y < 100 && v.state === "intact") },
  { id: "tailgate", text: "The van has stopped. Tap its tailgate to open it.", when: (s, p) => p.interactables(s).some((i) => i.id === "tailgate") },
];

/** The next hint to show now, if any. */
export function nextHint(sim: Sim, phase: Phase, shown: Set<string>): Hint | null {
  const done = seen();
  for (const h of HINTS) {
    if (done.has(h.id) || shown.has(h.id)) continue;
    try { if (h.when(sim, phase)) return h; } catch { /* a hint never breaks play */ }
  }
  return null;
}
