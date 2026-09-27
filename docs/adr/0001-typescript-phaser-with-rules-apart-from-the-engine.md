---
status: accepted
date: 2026-09-27
---

# TypeScript and Phaser, with the game's rules kept apart from the engine

Minor Sabotage is written in TypeScript on Phaser. Maps are made in Tiled and sprites in Aseprite. It ships as a PWA on GitHub Pages, as the prototype does, and Capacitor will wrap it for the App Store later. Tom approved this on 2026-09-27 under the constraint "for now we stay on github with posisble move to ios appstore": the web on an iPhone is where the game lives now, and the App Store has to stay reachable.

The rules are not Phaser code. The squad, route finding, sight and cones, the alarm, the roster and ranks are plain TypeScript running on a fixed tick. Phaser only draws that state and passes input in. Route finding and line of sight are our own small code over the Tiled tile and object properties (walkable, blocks sight, cover, building group, street). The tactical pause stops the rules' clock while drawing and input carry on, so orders can be given during a pause. Saves use their own IndexedDB database named `minor-sabotage`.

New rules go only into the TypeScript game. The C++ Open Fodder copy in this repository (see the tag `imported-from-openfodder`) is frozen and kept only to play and compare feel against. It is deleted once the TypeScript game plays, and the provenance scan against that tag then confirms that only our code is left.

## Considered options

- **Godot 4.** A stronger editor. Rejected because the web on iOS Safari is its weakest target: a bigger download and Safari quirks, on the platform the game has to run on first.
- **Keep the C++ Open Fodder engine and replace it piece by piece.** This was the first plan for the copy. Rejected because the engine cannot draw the chosen look, the "Diorama": it has no prop layer, no drawing order by feet, and only 16 px tiles seen straight down. Every rule would also be written twice, once in C++ and again in the final game.
- **Rules inside Phaser scenes.** Rejected because suspend-and-resume-once has to be a plain snapshot of the game's state, the rules have to be testable without a browser, and a later move to another engine or to native code must not mean rewriting them.

## Consequences

- Until the TypeScript game plays, the repository holds two games: the frozen C++ prototype, which the Pages deploy still builds, and the new one. The Pages deploy moves to the TypeScript build when that is ready.
- The saves database that the prototype shares with the Open Fodder port on the same origin (`/Saves`, see `Projects/emscripten/web/pre.js`) is never fixed in C++. The TypeScript game uses its own database from the start.
- The first art in the chosen look goes into a small slice: one Warsaw street and one forest clearing.
