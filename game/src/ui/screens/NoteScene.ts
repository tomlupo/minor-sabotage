// The history note at mission complete (style guide §9): paper and ink only, no jokes and no
// animation. What happened in your operation, then what really happened, the people and what
// became of them, the photographs with their credits. Long text reads best as real type, so
// the note is an HTML page over the game.
import Phaser from "phaser";
import type { Flow } from "../../game/flow";
import { NOTE_EN, NOTE_PL, NOTE_PHOTOS, FATES } from "../../content/arsenal/note";
import { SQUADS, PEOPLE } from "../../content/arsenal/roster";
import { PAL, css, mix } from "../../art/palette";
import { sound } from "../../render/sound";
import { PRISONERS } from "../../missions/finale";

interface Credit { file: string; subject: string; author: string; licence: string; sourcePage: string; year: string }

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

export class NoteScene extends Phaser.Scene {
  flow!: Flow;
  private el: HTMLDivElement | null = null;
  private lang: "en" | "pl" = "en";

  constructor() {
    super("note");
  }
  init(data: { flow: Flow }) {
    this.flow = data.flow;
    this.lang = navigator.language?.startsWith("pl") ? "pl" : "en";
  }

  create() {
    this.cameras.main.setBackgroundColor(css(PAL.hud.paper[0]));
    this.flow.campaign.stage = "note";
    sound.music("note", 3);
    sound.ambience(false);
    void this.render();
    this.events.once("shutdown", () => { this.el?.remove(); this.el = null; });
  }

  private yourOperation(): string {
    const c = this.flow.campaign;
    const f = c.finale;
    const lines: string[] = [];
    if (!f) return "";
    lines.push(f.rudy === "escaped" ? "In your operation Rudy was got away in the DKW." : f.rudy === "killed" ? "In your operation Rudy was killed." : "In your operation Rudy was not freed.");
    if (f.freed > 0) lines.push(`${f.freed} of the ${PRISONERS} other prisoners in the van reached safety${f.prisonersKilled ? `, and ${f.prisonersKilled} were killed in the street` : ""}.`);
    const fallen = Object.values(c.soldiers).filter((s) => s.state === "dead").map((s) => PEOPLE[s.key]);
    const taken = Object.values(c.soldiers).filter((s) => s.state === "captured").map((s) => PEOPLE[s.key]);
    if (fallen.length) lines.push(`Fell: ${fallen.map((p) => `${p.name} “${p.pseudonym}”`).join(", ")}.`);
    if (taken.length) lines.push(`Taken by the Germans: ${taken.map((p) => `${p.name} “${p.pseudonym}”`).join(", ")}.`);
    if (!fallen.length && !taken.length) lines.push("None of your men was lost.");
    lines.push(`German losses: ${f.germansKilled} killed.`);
    return lines.map((l) => `<p>${esc(l)}</p>`).join("");
  }

  private async render() {
    let credits: Credit[] = [];
    try { credits = await (await fetch("./history/credits.json")).json(); } catch { credits = []; }
    const ink = css(PAL.hud.paper_ink), paper = css(PAL.hud.paper[1]), paper0 = css(PAL.hud.paper[0]), faint = css(mix(PAL.hud.paper_ink, PAL.hud.paper[1], 0.45));
    const el = document.createElement("div");
    el.id = "note";
    el.style.cssText = `position:fixed;inset:0;overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;background:${paper0};color:${ink};z-index:5;`;
    const text = (this.lang === "pl" ? NOTE_PL : NOTE_EN).map((p) => `<p>${esc(p)}</p>`).join("");
    const photos = NOTE_PHOTOS.map((f) => {
      const cr = credits.find((c) => c.file === f);
      return `<figure><img src="./history/${f}" alt="${esc(cr?.subject ?? f)}"><figcaption>${esc(cr?.subject ?? "")}</figcaption></figure>`;
    }).join("");
    const roll = SQUADS.map((sq) => `<div class="sq"><h3>${esc(sq.name)}'s squad</h3>${sq.people.map((p) => `<div class="p"><b>${esc(p.pseudonym)}</b> ${esc(p.name)}<br><span>${esc(p.section)}. ${esc(FATES[p.key] ?? "")}</span></div>`).join("")}</div>`).join("");
    const creditList = credits.map((c) => `<li>${esc(c.file)}: ${esc(c.subject)}. ${esc(c.author)}, ${esc(c.year)}. ${esc(c.licence)}. <a href="${esc(c.sourcePage)}" target="_blank" rel="noopener">Source</a></li>`).join("");
    el.innerHTML = `
<style>
  #note .page{max-width:680px;margin:0 auto;padding:max(18px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) 40px max(18px, env(safe-area-inset-left));font:16px/1.55 Georgia,"Times New Roman",serif;background:${paper};min-height:100%;box-shadow:0 0 0 1px ${faint}}
  #note h1{font:700 22px/1.2 Georgia,serif;margin:6px 0 2px;letter-spacing:.02em}
  #note h2{font:600 13px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:${faint};margin:26px 0 8px}
  #note h3{font:600 14px/1.2 Georgia,serif;margin:10px 0 4px}
  #note .date{font:13px ui-monospace,Menlo,monospace;color:${faint}}
  #note p{margin:0 0 12px}
  #note .figs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
  #note figure{margin:0}
  #note img{width:100%;height:auto;display:block;filter:sepia(.15);border:1px solid ${faint}}
  #note figcaption{font-size:12px;line-height:1.35;margin-top:4px;color:${faint}}
  #note .roll{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:4px 14px}
  #note .p{font-size:13px;line-height:1.35;margin-bottom:6px}
  #note .p span{color:${faint}}
  #note .credits{font-size:11px;line-height:1.4;color:${faint};padding-left:18px}
  #note .credits a{color:${faint}}
  #note .bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:22px}
  #note button{font:600 14px ui-monospace,Menlo,monospace;background:${css(PAL.hud.button_olive[1])};color:${css(PAL.hud.button_ink)};border:1px solid ${css(PAL.hud.button_rim)};padding:10px 14px;min-height:44px;border-radius:2px}
  #note button.alt{background:transparent;color:${ink};border-color:${faint}}
</style>
<div class="page">
  <div class="date">Warsaw, 26 March 1943</div>
  <h1>Akcja pod Arsenałem</h1>
  <h2>${this.lang === "pl" ? "Twoja akcja" : "Your operation"}</h2>
  ${this.yourOperation()}
  <h2>${this.lang === "pl" ? "Jak było naprawdę" : "What happened"}</h2>
  ${text}
  <div class="figs">${photos}</div>
  <h2>${this.lang === "pl" ? "Ludzie z twoich drużyn" : "The people in your squads"}</h2>
  <div class="roll">${roll}</div>
  <p style="font-size:13px;margin-top:10px">${esc(this.lang === "pl"
    ? "Według dowódcy w akcji wzięło udział 28 harcerzy; późniejsze opracowanie liczy 29. Z tych 29 wojnę przeżyło jedenastu."
    : "By its commander's count 28 scouts took part; a later study counts 29. Of those 29, eleven survived the war.")}</p>
  <h2>${this.lang === "pl" ? "Źródła i zdjęcia" : "Sources and photographs"}</h2>
  <p style="font-size:13px">${esc(this.lang === "pl"
    ? "Tekst oparto na polskiej literaturze przedmiotu (m.in. S. Broniewski, „Pod Arsenałem”; A. Borkiewicz-Celińska), cytowanej w pliku badań gry."
    : "The text rests on the Polish literature of the action (among others S. Broniewski, Pod Arsenałem; A. Borkiewicz-Celińska), cited in the game's research file.")}</p>
  <ol class="credits">${creditList}</ol>
  <div class="bar">
    <button id="n-lang" class="alt">${this.lang === "pl" ? "English" : "Po polsku"}</button>
    <button id="n-again">${this.lang === "pl" ? "Jeszcze raz" : "Play again"}</button>
    <button id="n-title" class="alt">${this.lang === "pl" ? "Tytuł" : "Title"}</button>
  </div>
</div>`;
    document.getElementById("ui")!.appendChild(el);
    this.el?.remove();
    this.el = el;
    el.querySelector("#n-lang")!.addEventListener("click", () => { this.lang = this.lang === "pl" ? "en" : "pl"; void this.render(); });
    el.querySelector("#n-again")!.addEventListener("click", () => { sound.ui("ui_ok"); this.flow.newOperation(); });
    el.querySelector("#n-title")!.addEventListener("click", () => { sound.ui("ui_back"); this.flow.toTitle(); });
  }
}
