#!/usr/bin/env python3
"""Render the style guide's reference images from docs/art/palette.json.

  docs/art/palette.png    every ramp in the palette, labelled
  docs/art/troopers.png   the reference trooper body (22 px) in each role and side,
                          at 1x (true size) and 6x, in the 16 x 22 cell the guide specifies

Run from the repository root:  python3 tools/art/reference_sheet.py
The trooper templates here are the reference, not final art: the soldier bake-off
(docs/art/style-guide.md, "Bake-off") replaces them.
"""

import json
import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
PAL = json.loads((ROOT / "docs/art/palette.json").read_text())

# ---- trooper templates: 16 x 22 cell, facing right, feet on the bottom row -------------
# o outline, H/h/D headgear light/mid/dark, s/S skin light/shade, e eye, U/u/d jacket
# light/mid/dark, w belt, b boots, g/G rifle, p pack, r red charge, W/R armband.
BODY = [
    "......oooo......",
    ".....oHHhho.....",
    "....oHHhhhho....",
    "....oHhhhhhDo...",
    "...oDDDDDDDDDo..",
    "....osssssSo....",
    "....ossssseo....",
    "....oSsssSSo....",
    ".....ooSSoo.....",
    "....oUUuuuuo....",
    "...oUUuuuuudo...",
    "...oUuuuuuudoooo",
    "...oUssgggggGGGo",
    "...oouussuuoooo.",
    "....owwwwwwo....",
    "....oduuuudo....",
    "....oddo.odo....",
    "....odo..odo....",
    "....odo..odo....",
    "...obbo..obbo...",
    "...obbbo.obbbo..",
    "...ooooo.ooooo..",
]
HEADS = {
    "helmet_wz31": {},
    "cap": {0: "", 1: "", 2: ".....oooooo", 3: "....ohhHHhhoo", 4: "....oDDDDDDDDDo"},
    "hat": {
        0: "",
        1: "......oooo",
        2: ".....oHhhho",
        3: "..oooDDDDDDooo",
        4: "..oDDDDDDDDDDo",
    },
    "stahlhelm": {
        0: "",
        1: ".....ooooo",
        2: "....oHHhhhoo",
        3: "...oHhhhhhhho",
        4: "..oDhhhhhhhhhDo",
        5: "..oDoosssssoDo",
    },
    "stahlhelm_big": {
        1: ".....ooooo",
        2: "....oHHhhhoo",
        3: "...oHhhhhhhhho",
        4: "..oDhhhhhhhhhDo",
        5: "..oDDDDDDDDDDDo",
        6: "....oosssssoo",
    },
    "bare": {0: "", 1: "", 2: ".....oooooo", 3: "....oHHHHHHo", 4: "....oHHHHHHHo"},
}
ROLE_PX = {
    "sniper": [
        (16, 12, "g"),
        (17, 12, "g"),
        (18, 12, "g"),
        (19, 12, "o"),
        (16, 11, "o"),
        (17, 11, "o"),
        (18, 11, "o"),
        (16, 13, "o"),
        (17, 13, "o"),
        (18, 13, "o"),
        (9, 11, "g"),
        (10, 11, "g"),
        (11, 11, "g"),
    ],
    "sapper": [
        (1, 9, "o"),
        (2, 9, "o"),
        (1, 10, "o"),
        (1, 11, "o"),
        (1, 12, "o"),
        (1, 13, "o"),
        (1, 14, "o"),
        (2, 15, "o"),
        (2, 10, "p"),
        (2, 11, "r"),
        (2, 12, "r"),
        (2, 13, "p"),
        (2, 14, "p"),
        (3, 15, "o"),
    ],
    "scout": [(9, 10, "g"), (10, 10, "g")],
}
ARMBAND = [(4, 10, "W"), (4, 11, "R")]


def body(head, role, side):
    rows = [r for r in BODY]
    for k, v in HEADS[head].items():
        rows[k] = (v + "." * 16)[:16]
    if side == "prisoner":  # no rifle, no kit
        for r in (11, 12, 13):
            rows[r] = "".join(
                "." if i >= 12 else ("u" if ch in "gG" else ch)
                for i, ch in enumerate(rows[r])
            )
    px = [] if side in ("occupier", "prisoner") else ROLE_PX.get(role, []) + ARMBAND
    return rows, px


def colours(side, head, jacket=0):
    t, s = PAL["troopers"], PAL["shared"]
    if side == "occupier":
        J, belt, boots = (
            t["occupier_field_grey"],
            t["occupier_belt"],
            t["occupier_boots"],
        )
    elif side == "prisoner":
        J, belt, boots = t["prisoner_coat"], t["prisoner_coat"][0], t["boots"]
    else:
        J, belt, boots = t["partisan_jackets"][jacket], t["belt"], t["boots"]
    hg = {"stahlhelm_big": "stahlhelm", "bare": None}.get(head, head)
    Hd = t["headgear"][hg] if hg else [[58, 44, 32], [82, 62, 44], [104, 80, 58]]
    return {
        "o": s["outline"],
        "H": Hd[2],
        "h": Hd[1],
        "D": Hd[0],
        "s": t["skin"][1],
        "S": t["skin"][0],
        "e": t["eye"],
        "U": J[2],
        "u": J[1],
        "d": J[0],
        "w": belt,
        "b": boots,
        "g": t["rifle"][0],
        "G": t["rifle"][1],
        "p": t["pack"],
        "r": s["poppy_red"],
        "W": t["armband"]["white"],
        "R": t["armband"]["red"],
    }


def draw(img, x, y, rows, px, col, scale, flip=False):
    d = ImageDraw.Draw(img)

    def put(c, r, k):
        if k in ". " or k not in col:
            return
        cx = (15 - c) if flip else c
        d.rectangle(
            [
                x + cx * scale,
                y + r * scale,
                x + cx * scale + scale - 1,
                y + r * scale + scale - 1,
            ],
            fill=tuple(col[k]),
        )

    for r, row in enumerate(rows):
        for c, k in enumerate(row):
            put(c, r, k)
    for c, r, k in px:
        put(c, r, k)


CAST = [
    ("rifleman", "cap", "grunt", "partisan", 0),
    ("scout", "cap", "scout", "partisan", 0),
    ("sniper", "hat", "sniper", "partisan", 1),
    ("sapper", "helmet_wz31", "sapper", "partisan", 2),
    ("rookie", "stahlhelm_big", "rookie", "partisan", 3),
    ("occupier", "stahlhelm", "grunt", "occupier", 0),
    ("prisoner", "bare", "grunt", "prisoner", 0),
]


def troopers_png():
    S, cell_w = 6, 16 * 6 + 40
    W, H = 24 + cell_w * len(CAST), 22 * S + 90
    img = Image.new("RGB", (W, H), (238, 240, 230))
    d = ImageDraw.Draw(img)
    font = ImageFont.load_default()
    for i, (name, head, role, side, jk) in enumerate(CAST):
        rows, px = body(head, role, side)
        col = colours(side, head, jk)
        x0 = 20 + i * cell_w
        draw(img, x0, 16, rows, px, col, S, flip=(side == "occupier"))
        draw(
            img,
            x0 + 16 * S + 8,
            16 + 22 * S - 22,
            rows,
            px,
            col,
            1,
            flip=(side == "occupier"),
        )
        d.text((x0, 22 * S + 26), name, fill=(30, 36, 25), font=font)
        d.text((x0, 22 * S + 42), f"{side} / {head}", fill=(92, 101, 82), font=font)
    d.text(
        (20, H - 18),
        "reference body, 16 x 22 cell, 6x and 1x (true size). Replaced by the bake-off winner.",
        fill=(92, 101, 82),
        font=font,
    )
    img.save(ROOT / "docs/art/troopers.png")


def palette_png():
    rows = []

    def walk(prefix, node):
        if isinstance(node, dict):
            for k, v in node.items():
                if not k.startswith("_"):
                    walk(f"{prefix}.{k}" if prefix else k, v)
        elif isinstance(node, list) and node and isinstance(node[0], (int, float)):
            if all(isinstance(v, int) for v in node):
                rows.append((prefix, [node]))
        elif isinstance(node, list) and node and isinstance(node[0], list):
            if isinstance(node[0][0], list):
                for j, ramp in enumerate(node):
                    rows.append((f"{prefix}[{j}]", ramp))
            else:
                rows.append((prefix, node))

    walk("", {k: v for k, v in PAL.items() if k != "light"})
    sw, rh = 28, 30
    img = Image.new("RGB", (620, 16 + rh * len(rows)), (238, 240, 230))
    d = ImageDraw.Draw(img)
    font = ImageFont.load_default()
    for i, (name, ramp) in enumerate(rows):
        y = 8 + i * rh
        d.text((10, y + 8), name, fill=(30, 36, 25), font=font)
        for j, c in enumerate(ramp):
            d.rectangle(
                [330 + j * (sw + 4), y, 330 + j * (sw + 4) + sw, y + sw - 4],
                fill=tuple(c),
                outline=(36, 32, 26),
            )
    img.save(ROOT / "docs/art/palette.png")


if __name__ == "__main__":
    troopers_png()
    palette_png()
    print("wrote docs/art/troopers.png and docs/art/palette.png")
