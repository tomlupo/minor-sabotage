# Soldier bake-off (style guide §10)

One partisan rifleman (flat cap, Sten, jacket 0) in idle and the 4-frame walk, in the five
drawn facings, made two ways. Both sheets share one layout: columns idle | walk 0–3, rows
s se e ne n, 24 × 24 cells, a 4 px margin. The `-4x` files are the same sheets at 4×.

**Pixel templates** (`pixel-1x.png`, `pixel-4x.png`). These come from the game's own
generator, `game/src/art/troopers.ts`. One pose table is projected into each facing, and the
heads are hand-drawn per facing (`troopers-heads.ts`). The art lab lays out the sheet at
`art.html?only=troopers&tsec=bakeoff`. No script writes these two PNGs: they were saved from
that page, which always draws the current generator.

**Blender** (`blender-1x.png`, `blender-4x.png`). These come from
`tools/art/blender_trooper.py`:

- a low-poly model built from boxes, on a rig of pivots;
- rendered in Workbench with flat colour and no anti-aliasing;
- an orthographic camera at the game's own 50.19° (the derivation is in the script);
- each face takes one of its material's three tones by its angle to the light;
- the result is reduced to the palette, gets inner lines where one part lies in front of
  another, and gets the 1 px outline.

To regenerate, run this from the repo root (about 2 s, byte-identical every run):

    blender -b --factory-startup -P tools/art/blender_trooper.py

The script also writes `game/public/bakeoff/blender.png` and `blender.json` for the phone
page.

**Phone page.** Run `npm run dev` in `game/`, then open `http://<forge>:5173/art.html?only=bakeoff`.
Both soldiers walk a circle each, in step, at the game's walk rate and speed (the page
prints both, read from the code), and each faces the way he is walking. A tap switches between the game's zoom (1.5) and 3. Both
contact sheets are below the stage.

## What I see (Tom decides)

- **Silhouette from frame to frame.** On both sides the upper body (head, arms, gun) is
  pixel-identical across the four walk frames once the 1 px bob is aligned. Only the legs
  move. The Blender figure leans 4° into the walk, so its upper body changes 2–19 px
  between idle and the first walk frame; the pixel side's changes 0–10 px.
- **Facing at 1×.** The pixel side draws a head for each facing, and in every one the peak,
  nose and eye point where he goes. On the Blender side, s and se read: two eyes under the
  peak, and the collar. The e, ne and n views read mostly from the gun and the boots. Seen
  from the game's true 50°, the top of the cap is about half the head in every facing, and
  the face shrinks to 3–4 rows. The pixel side draws the soldier as if seen from about 30°.
  The armband shows in all five facings on both sides. The pixel side puts it on whichever
  arm faces the camera; the Blender model wears it on the right arm.
- **Room in the cell.** At the true angle, a step toward the camera drops the foot 0.75 px
  per unit. The pixel side uses 0.45 there. So the Blender figure needs about three rows
  below its ground point:
  - it fits the 24 × 24 cell only with the ground point on row 19, not the game's 22
    (recorded in `blender.json`, used by the phone page);
  - it only fits with a shorter stride (2.6 against 3.4);
  - it stands 20–22 px tall with its outline, depending on the facing. The pixel side is
    22 px in all five facings.
- **The next 119 drawings.** The pixel generator already draws 22 of the guide's 24 frames
  per facing (all but swim), for every look. On the Blender side, the render, palette, line
  and outline steps are done, and all five facings come from one pose. Each new animation
  is a pose table; idle and walk are about 10 lines. The cost is making each pose read at
  22 px through a 50° camera. The head and cap proportions took most of the tuning here,
  and lying or kneeling at the true angle is untried.
