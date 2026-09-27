// The sound-effect voice cap. A firefight can ask for far more sounds than an iPhone should
// mix, so at most `max` voices play; a new one steals the oldest voice of the same or lower
// priority, and each sound also has its own cap (ten troopers' footsteps never crowd out a shot).

export interface VoiceLike {
  name: string;
  prio: number;
  start: number;
  end: number;
  /** Fade out quickly and stop (stolen). */
  stop(at: number): void;
  /** Disconnect a finished voice. */
  release(): void;
}

export class VoicePool<V extends VoiceLike> {
  readonly list: V[] = [];
  constructor(readonly max = 24) {}

  /** Makes room for a new voice. False means drop the new one (everything playing matters more). */
  admit(name: string, prio: number, cap: number, now: number): boolean {
    this.prune(now);
    let same = 0;
    let oldestSame = -1;
    for (let i = 0; i < this.list.length; i++) {
      if (this.list[i].name !== name) continue;
      if (oldestSame < 0) oldestSame = i;
      same++;
    }
    if (same >= cap && oldestSame >= 0) this.steal(oldestSame, now);
    if (this.list.length < this.max) return true;
    const victim = this.list.findIndex((v) => v.prio <= prio);
    if (victim < 0) return false;
    this.steal(victim, now);
    return true;
  }

  add(v: V): void {
    this.list.push(v);
  }

  /** Releases voices that have finished. */
  prune(now: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].end <= now) {
        this.list[i].release();
        this.list.splice(i, 1);
      }
    }
  }

  private steal(i: number, now: number): void {
    const [v] = this.list.splice(i, 1);
    v.stop(now);
  }
}
