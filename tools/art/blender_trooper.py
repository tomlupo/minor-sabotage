"""Soldier bake-off, the Blender side (docs/art/style-guide.md, section 10).

A low-poly partisan rifleman (flat cap, jacket, trousers, boots, the white-and-red
armband, a Sten) built from primitives, rigged as parts parented to pivots, posed idle
plus a 4-frame walk, and rendered by Workbench through an orthographic camera at the
game's projection, in the five drawn facings. Each face is flat-shaded in one of its
material's three tones by its angle to the light; the render has no anti-aliasing. The
pixels are then reduced to the trooper palette, inner lines are drawn where one part
lies in front of another, and the style guide's 1 px outline goes round the figure.

Run from the repository root (Blender 5.2; nothing else, numpy ships with Blender):

    blender -b --factory-startup -P tools/art/blender_trooper.py

It writes
    docs/art/bakeoff/blender-1x.png   the contact sheet at true size, laid out like
                                      pixel-1x.png: columns idle | walk 0-3, rows
                                      s se e ne n, 24 x 24 cells, a 4 px margin
    docs/art/bakeoff/blender-4x.png   the same at 4x, nearest neighbour
    game/public/bakeoff/blender.png   the 25 cells on transparency, no margin, and
    game/public/bakeoff/blender.json  their layout and ground point, for the art lab's
                                      phone page (art.html?only=bakeoff)
and prints each frame's size. Deterministic: the same palette and script give
byte-identical files. Scratch renders go to a temporary directory ($TMPDIR), removed
afterwards. It exits non-zero, writing nothing, if the frames do not fit a cell, a pixel
lands far from the palette or the render passes disagree.

Options, after a lone "--":
    --preview PATH   also write an 8x render of the idle pose in every facing (no
                     outline), to look at the model itself
"""

import contextlib
import json
import math
import os
import pathlib
import shutil
import struct
import sys
import tempfile
import zlib

import bmesh
import bpy
import numpy as np
from mathutils import Quaternion, Vector

ROOT = pathlib.Path(__file__).resolve().parents[2]
PAL = json.loads((ROOT / "docs/art/palette.json").read_text())

# ------------------------------------------------------------------------- the camera
#
# The game projects a ground point (x, y) metres at height z to sx = 12x, sy = 9y - 7.5z
# art px (style guide section 2; y points south, down the screen). An orthographic
# camera looking north and down at elevation a, k px per metre on its image plane, gives
# sx = k x and sy = k (y sin a - z cos a). So:
#   - the line of sight is the direction that lands on one point: 9 dy = 7.5 dz, so
#     tan a = 9 / 7.5 and a = atan(1.2) = 50.19 degrees below the horizon (the guide's
#     "about 55 degrees");
#   - down the image k = hypot(9, 7.5) = 11.715 px per metre, across it k = 12: the
#     game's pixels are 12 / 11.715 = 1.0243 times taller than square, which Blender
#     renders exactly with pixel_aspect_y and a horizontal sensor fit.
# (sin a = 0.75 alone gives 48.6 degrees and cos a = 0.625 alone 51.3: the game's
# projection is this camera plus that 2.4 % stretch, not a pure rotation.)
# The model is built in art px: a unit renders 1 px across the screen, 0.75 px down the
# screen per unit toward the camera and 0.625 px up per unit of height.
ELEV = math.atan2(9.0, 7.5)
ASPECT_Y = 12.0 / math.hypot(9.0, 7.5)
CELL = 24
# Where the renders put the ground point under the soldier, in pixels from the cell's
# top left. The game's cells use (12, 22) (src/art/types.ts TROOPER_CELL), with one row
# below it for the outline. At the true 50 degrees a step toward the camera drops the
# foot 0.75 px per unit, so this soldier needs about three rows below his ground point:
# fit() moves all frames down together until the lowest foot of any of them sits on row
# 22, and blender.json records where the ground point ended up (row 19).
ANCHOR = (12.0, 20.0)

# Facings as world headings, counter-clockwise from east. The diagonals point along the
# screen's 45-degree lines, which on the squashed ground (12 px across, 9 down per
# metre) are 53.13 degrees off east: the middle of the game's facing bins
# (src/render/iso.ts facingOf).
DIAG = math.degrees(math.atan2(12.0, 9.0))
FACINGS = [("s", -90.0), ("se", -DIAG), ("e", 0.0), ("ne", DIAG), ("n", 90.0)]

# ------------------------------------------------------------------------ the palette
#
# The pixel side's rifleman (src/artlab/sections/troopers.ts: partisan, cap, sten,
# jacket 0, seed 3) resolves to these palette groups (src/art/troopers.ts resolveLook);
# the render uses the same ones. Each material maps the three light bands (dark, mid,
# lit) to indices into its ramp.
TR = PAL["troopers"]
MATERIALS = {
    "jacket": (TR["partisan_jackets"][0], (0, 1, 2)),
    "trousers": (TR["partisan_jackets"][2], (0, 1, 2)),
    "cap": (TR["headgear"]["cap"], (0, 1, 2)),
    "cap_dark": (TR["headgear"]["cap"], (0, 0, 0)),
    "hair": (TR["headgear"]["hat"], (0, 1, 2)),
    "skin": (TR["skin"], (0, 1, 1)),
    "metal": (TR["rifle"], (0, 0, 1)),
    "boots": ([TR["boots"], TR["headgear"]["cap"][0]], (0, 0, 1)),
    "belt": ([TR["belt"]], (0, 0, 0)),
    "band_white": ([TR["armband"]["white"]], (0, 0, 0)),
    "band_red": ([TR["armband"]["red"]], (0, 0, 0)),
    "eye": ([TR["eye"]], (0, 0, 0)),
    "shirt": ([PAL["city_1943"]["cloth"][2]], (0, 0, 0)),
}
OUTLINE = tuple(PAL["shared"]["outline"])
# every colour a pixel may end as: the reduction's targets
COLOURS = sorted({tuple(c) for ramp, _ in MATERIALS.values() for c in ramp} | {OUTLINE})
# The pixel side's contact sheet: troopers.ts BG (a mid cobble grey, so the outline
# reads as on the street) and a 4 px margin (pixel-1x.png is 128 x 128).
SHEET_BG = (138, 133, 122)
SHEET_MARGIN = 4

# Light from the top left (style guide section 4), fixed in the world: from the west,
# from above, and a little from the camera's side so faces toward the viewer sit in the
# mid tone. n.L above LIT takes the light tone, below DARK the dark one.
LIGHT = Vector((-1.2, -0.8, 1.2)).normalized()
LIT, DARK = 0.58, 0.05


def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# -------------------------------------------------------------------------- the scene


def reset_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras):
        for d in list(coll):
            coll.remove(d)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.render_aa = "OFF"  # one sample per pixel: hard edges, no blends
    sh = sc.display.shading
    sh.light = "FLAT"  # the material colour as is; bands are set per face below
    sh.color_type = "MATERIAL"
    for flag in (
        "show_object_outline",
        "show_cavity",
        "show_shadows",
        "show_specular_highlight",
        "show_xray",
        "use_dof",
    ):
        setattr(sh, flag, False)
    r = sc.render
    r.film_transparent = True
    r.dither_intensity = 0.0  # Blender dithers 8-bit output by default
    r.resolution_x = r.resolution_y = CELL
    r.resolution_percentage = 100
    r.pixel_aspect_x, r.pixel_aspect_y = 1.0, ASPECT_Y
    r.use_stamp = False
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    r.image_settings.color_depth = "8"
    v = sc.view_settings  # so a material's colour comes out unchanged
    v.view_transform, v.look, v.exposure, v.gamma = "Standard", "None", 0.0, 1.0
    sc.display_settings.display_device = "sRGB"
    return sc


def make_materials():
    """Three material slots per palette material: its dark, mid and lit tones."""
    mats = {}
    for name, (ramp, bands) in MATERIALS.items():
        slots = []
        for b, idx in enumerate(bands):
            m = bpy.data.materials.new(f"{name}.{b}")
            m.diffuse_color = (*(srgb_to_linear(c) for c in ramp[idx]), 1.0)
            slots.append(m)
        mats[name] = slots
    return mats


def make_camera(sc):
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.ortho_scale = CELL  # 24 units across 24 px
    cam_data.clip_start, cam_data.clip_end = 1.0, 400.0
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.rotation_euler = (math.pi / 2 - ELEV, 0.0, 0.0)
    view = Vector((0.0, math.cos(ELEV), -math.sin(ELEV)))
    up = Vector((0.0, math.sin(ELEV), math.cos(ELEV)))
    # the image's centre is (12, 12): shift so the ground point lands on ANCHOR; a row
    # is ASPECT_Y units along the image's vertical
    ax, ay = ANCHOR
    centre = up * ((ay - CELL / 2) * ASPECT_Y) + Vector((CELL / 2 - ax, 0.0, 0.0))
    cam.location = centre - view * 200.0
    return cam


# --------------------------------------------------------------------- the primitives


def octagon(rx, ry, c):
    """A rectangle's outline with the corners cut by c, counter-clockwise."""
    if c <= 0:
        return [(rx, -ry), (rx, ry), (-rx, ry), (-rx, -ry)]
    return [
        (rx, -ry + c),
        (rx, ry - c),
        (rx - c, ry),
        (-rx + c, ry),
        (-rx, ry - c),
        (-rx, -ry + c),
        (-rx + c, -ry),
        (rx - c, -ry),
    ]


def block(at, z0, z1, rx, ry, c=0.0, taper=(1.0, 1.0), lean=(0.0, 0.0)):
    """A box with chamfered vertical edges from z0 up to z1, centred on at = (x, y). The
    top can be narrower (taper) and shifted (lean)."""
    bot = [(x + at[0], y + at[1], z0) for x, y in octagon(rx, ry, c)]
    top_outline = octagon(rx * taper[0], ry * taper[1], c * min(taper))
    top = [(x + at[0] + lean[0], y + at[1] + lean[1], z1) for x, y in top_outline]
    n = len(bot)
    faces = [list(range(n - 1, -1, -1)), list(range(n, 2 * n))]
    faces += [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    return bot + top, faces


def turned(geom, fn):
    verts, faces = geom
    return [fn(*v) for v in verts], faces


def along_y(geom):
    """A block built along +z, laid along +y (guns point forward)."""
    return turned(geom, lambda x, y, z: (x, z, -y))


def pivot(name, parent, loc=(0.0, 0.0, 0.0)):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    e.rotation_mode = "QUATERNION"
    return e


PARTS = []  # every mesh part: shading, the group pass and the depth pass walk it
# Parts belong to groups, by the pivot that carries them. Inner lines (see inner_lines)
# are drawn where one group lies in front of another.
GROUPS = ["body", "head", "arm_l", "arm_r", "leg_l", "leg_r", "gun"]


def group_of(pivot_name):
    kind, _, side = pivot_name.partition("_")
    if kind in ("hip", "knee", "ankle"):
        return f"leg_{side}"
    if kind in ("shoulder", "elbow"):
        return f"arm_{side}"
    return {"torso": "body", "pelvis": "body"}.get(kind, kind)


def part(parent, material, geom, mats):
    verts, faces = geom
    me = bpy.data.meshes.new(material)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()
    for m in mats[material]:
        me.materials.append(m)
    depth = me.color_attributes.new("depth", "FLOAT_COLOR", "POINT")
    me.color_attributes.active_color = depth
    me.color_attributes.render_color_index = me.color_attributes.active_color_index
    ob = bpy.data.objects.new(f"{parent.name}.{material}", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    # the group pass: the group's number in the red channel, one step of 16 each
    g = GROUPS.index(group_of(parent.name)) + 1
    ob.color = (srgb_to_linear(16 * g), 0.0, 0.0, 1.0)
    PARTS.append(ob)
    return ob


# -------------------------------------------------------------------------- the model
#
# Body space: x to the soldier's right, y forward, z up, in art px (see the camera).
# Proportions follow the style guide's trooper: a big head under a flat cap, about a
# third of his height, a short jacket and short legs, drawn to read at 22 px.

HIP_Z = 8.4  # hip joints above the ground, standing
HIP_X = 2.0  # hip joints either side of the middle
THIGH, SHIN = 4.0, 3.2
BOOT_H = 1.6  # ankle above the sole
TORSO_H = 8.6  # pelvis to the shoulder tops
SHOULDER = (4.3, 7.3)  # shoulder joints: out from the middle, up from the pelvis
UPPER_ARM, FOREARM = 4.2, 3.4
NECK_Z = TORSO_H + 0.3
# The head is carried chin up: at the camera's 50 degrees a level head shows mostly
# the top of the cap, and the peak hides the eyes.
CHIN_UP = 10.0


def build_model(mats):
    rig = {}
    rig["root"] = root = pivot("root", None)
    rig["pelvis"] = pelvis = pivot("pelvis", root, (0.0, 0.0, HIP_Z))
    rig["torso"] = torso = pivot("torso", pelvis)
    rig["head"] = head = pivot("head", torso, (0.0, 0.6, NECK_Z))
    o = (0.0, 0.0)
    th = TORSO_H
    table = [
        # torso: the jacket, the belt, the shirt collar at the throat
        (torso, "jacket", block(o, -0.6, th, 4.0, 2.5, c=1.0, taper=(1.0, 0.95))),
        (torso, "belt", block(o, 0.0, 1.3, 4.15, 2.65, c=1.0)),
        (torso, "shirt", block((0.0, 2.3), th - 2.2, th + 0.2, 1.0, 0.35)),
        # head: the face, hair at the back and sides, eyes under the cap
        (head, "skin", block(o, 0.0, 6.0, 3.4, 3.1, c=1.7)),
        (head, "skin", block((0.0, 3.2), 1.6, 2.6, 0.5, 0.6)),  # the nose
        (head, "hair", block((0.0, -2.0), 0.9, 5.6, 3.6, 1.4, c=1.0)),
        (head, "eye", block((-1.5, 3.1), 2.2, 3.8, 0.5, 0.25)),
        (head, "eye", block((1.5, 3.1), 2.2, 3.8, 0.5, 0.25)),
        # the flat cap (kaszkiet): a low crown puffed forward over a dark peak
        (head, "cap", block((0.0, 0.4), 4.8, 6.6, 3.8, 3.4, c=1.9, taper=(0.9, 0.85))),
        (head, "cap_dark", block((0.0, 3.9), 4.7, 5.3, 2.8, 0.8, c=0.5)),
    ]
    for parent, material, geom in table:
        part(parent, material, geom, mats)

    # legs: hip -> knee -> ankle pivots, the boot level under the ankle
    for side, s in (("l", -1.0), ("r", 1.0)):
        rig[f"hip_{side}"] = hip = pivot(f"hip_{side}", pelvis, (s * HIP_X, 0.0, 0.0))
        rig[f"knee_{side}"] = knee = pivot(f"knee_{side}", hip, (0.0, 0.0, -THIGH))
        rig[f"ankle_{side}"] = ankle = pivot(f"ankle_{side}", knee, (0.0, 0.0, -SHIN))
        part(hip, "trousers", block(o, -THIGH - 0.4, 0.4, 1.0, 1.15, c=0.4), mats)
        part(knee, "trousers", block(o, -SHIN - 0.3, 0.3, 0.95, 1.05, c=0.4), mats)
        boot = block((0.0, 0.6), -BOOT_H, 0.3, 1.1, 1.9, c=0.5, lean=(0.0, -0.4))
        part(ankle, "boots", boot, mats)

    # arms: shoulder -> elbow pivots, the hands at the ends; the armband on the right
    # upper arm (toward the camera in the e, se and ne views, and seen in s and n)
    for side, s in (("l", -1.0), ("r", 1.0)):
        at = (s * SHOULDER[0], 0.0, SHOULDER[1])
        rig[f"shoulder_{side}"] = sh = pivot(f"shoulder_{side}", torso, at)
        rig[f"elbow_{side}"] = el = pivot(f"elbow_{side}", sh, (0.0, 0.0, -UPPER_ARM))
        part(sh, "jacket", block(o, -UPPER_ARM, 0.9, 0.95, 1.05, c=0.4), mats)
        part(el, "jacket", block(o, -FOREARM, 0.4, 0.95, 1.0, c=0.35), mats)
        part(
            el, "skin", block(o, -FOREARM - 1.3, -FOREARM + 0.2, 0.8, 0.8, c=0.2), mats
        )
        if side == "r":
            part(sh, "band_white", block(o, -2.3, -1.0, 1.1, 1.2, c=0.45), mats)
            part(sh, "band_red", block(o, -3.6, -2.3, 1.1, 1.2, c=0.45), mats)

    # the Sten at the right hip: receiver and barrel along +y, the magazine out to the
    # left, a skeleton stock back past the hip. Its pivot is the pistol grip.
    rig["gun"] = gun = pivot("gun", torso)
    part(gun, "metal", along_y(block(o, -2.4, 5.2, 0.62, 0.62, c=0.2)), mats)
    part(gun, "metal", along_y(block(o, 5.2, 7.0, 0.35, 0.35)), mats)
    mag = turned(block(o, 0.0, 3.2, 0.45, 0.62), lambda x, y, z: (-z - 0.4, y + 2.2, x))
    part(gun, "metal", mag, mats)
    stock = block(o, -4.6, -2.4, 0.3, 0.3, lean=(0.0, 0.3))
    part(gun, "metal", along_y(turned(stock, lambda x, y, z: (x, y - 0.5, z))), mats)
    return rig


# ------------------------------------------------------------------------- the poses


def two_bone(a, b, l1, l2, pole):
    """Where the middle joint of a chain a -> joint -> b goes, bending toward pole."""
    d = b - a
    dist = d.length
    if dist >= l1 + l2 - 1e-6:
        return a + d * (l1 / (l1 + l2))
    x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(0.0, l1 * l1 - x * x))
    dn = d / dist
    p = pole - dn * pole.dot(dn)
    p = p.normalized() if p.length > 1e-6 else Vector((0.0, 0.0, 1.0))
    return a + dn * x + p * h


def aim(q_parent, direction):
    """The local rotation that points a part's -z along direction, given in the space
    of the pivot's parent's parent, which q_parent turns into the parent's."""
    local = q_parent.inverted() @ direction
    return Vector((0.0, 0.0, -1.0)).rotation_difference(local.normalized())


def rot(axis, deg):
    return Quaternion(axis, math.radians(deg))


X_AXIS, Z_AXIS = Vector((1.0, 0.0, 0.0)), Vector((0.0, 0.0, 1.0))

# A pose: the pelvis forward and up, the torso's lean (degrees, + forward), and each
# sole's place (forward, up) and toe pitch (degrees, + toe down), left foot first.
IDLE = {"hf": 0.0, "hu": HIP_Z, "tilt": 0.0, "feet": [(0.0, 0.0, 0.0), (0.0, 0.0, 0.0)]}
# The walk, after the pixel side's (src/art/troopers.ts makePose "walk"): a scissor at
# the contacts with the body a full pixel down (1.6 units at 0.625 px per unit), the
# swing foot lifted on the passing frames. The gun stays in both hands.
STRIDE = 2.6
LIFT = 2.2
LOW = HIP_Z - 1.6
FRONT, BACK = (STRIDE, 0.0, -8.0), (-STRIDE + 0.6, 0.9, 20.0)
PLANT, SWING = (0.3, 0.0, 0.0), (-0.8, LIFT, 10.0)
WALK = [
    {"hf": 0.0, "hu": LOW, "tilt": 4.0, "feet": [FRONT, BACK]},
    {"hf": 0.0, "hu": HIP_Z, "tilt": 4.0, "feet": [PLANT, SWING]},
    {"hf": 0.0, "hu": LOW, "tilt": 4.0, "feet": [BACK, FRONT]},
    {"hf": 0.0, "hu": HIP_Z, "tilt": 4.0, "feet": [SWING, PLANT]},
]

# The Sten held at the hip, pointing ahead, a little down and out to the right: the
# grip's place in torso space, the gun's yaw (+ to the right) and pitch (+ up).
GRIP = Vector((2.6, 2.4, 2.6))
GUN_YAW, GUN_PITCH = 26.0, -6.0


def apply_pose(rig, heading, pose):
    rig["root"].rotation_quaternion = rot(Z_AXIS, heading - 90.0)
    rig["pelvis"].location = (0.0, pose["hf"], pose["hu"])
    rig["torso"].rotation_quaternion = rot(X_AXIS, -pose["tilt"])
    rig["head"].rotation_quaternion = rot(X_AXIS, CHIN_UP + pose["tilt"])

    # legs: two-bone chains, knees forward, the boots level unless the toe is pitched
    for i, side in enumerate(("l", "r")):
        f, u, toe = pose["feet"][i]
        s = -1.0 if side == "l" else 1.0
        hip = Vector((s * HIP_X, pose["hf"], pose["hu"]))
        ankle = Vector((s * HIP_X, f, u + BOOT_H))
        knee = two_bone(hip, ankle, THIGH, SHIN, Vector((0.0, 1.0, 0.1)))
        q_hip = aim(Quaternion(), knee - hip)
        q_knee = aim(q_hip, ankle - knee)
        rig[f"hip_{side}"].rotation_quaternion = q_hip
        rig[f"knee_{side}"].rotation_quaternion = q_knee
        level = (q_hip @ q_knee).inverted()
        rig[f"ankle_{side}"].rotation_quaternion = level @ rot(X_AXIS, -toe)

    # the gun at the grip; the right hand on the grip, the left on the magazine housing
    q_gun = rot(Z_AXIS, -GUN_YAW) @ rot(X_AXIS, GUN_PITCH)
    rig["gun"].location = GRIP
    rig["gun"].rotation_quaternion = q_gun
    grip = GRIP + q_gun @ Vector((0.0, -0.2, -0.9))
    fore = GRIP + q_gun @ Vector((-0.5, 2.6, -0.8))
    for side, hand, pole in (
        ("r", grip, Vector((1.0, -0.6, -0.4))),
        ("l", fore, Vector((-1.0, -0.4, -0.6))),
    ):
        s = -1.0 if side == "l" else 1.0
        sh = Vector((s * SHOULDER[0], 0.0, SHOULDER[1]))
        elbow = two_bone(sh, hand, UPPER_ARM, FOREARM + 0.6, pole)
        q_sh = aim(Quaternion(), elbow - sh)
        rig[f"shoulder_{side}"].rotation_quaternion = q_sh
        rig[f"elbow_{side}"].rotation_quaternion = aim(q_sh, hand - elbow)


def shade_faces():
    """Flat shading in three bands: each face takes its material's dark, mid or lit tone
    by the angle between its normal and the light (style guide section 4)."""
    bpy.context.view_layer.update()
    for ob in PARTS:
        turn = ob.matrix_world.to_3x3().normalized()
        me = ob.data
        idx = np.empty(len(me.polygons), dtype=np.int32)
        for i, p in enumerate(me.polygons):
            d = (turn @ p.normal).normalized().dot(LIGHT)
            idx[i] = 2 if d > LIT else 0 if d < DARK else 1
        me.polygons.foreach_set("material_index", idx)
        me.update()


# ---------------------------------------------------------------------- the rendering


# The depth pass: each vertex's distance along the line of sight, as a grey, so the
# render interpolates it across every face (exact under an orthographic camera).
DEPTH_NEAR, DEPTH_RANGE = 170.0, 60.0


def write_depths(cam):
    view = cam.matrix_world.to_3x3() @ Vector((0.0, 0.0, -1.0))
    origin = cam.matrix_world.translation
    for ob in PARTS:
        mw = ob.matrix_world
        me = ob.data
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        world = np.c_[co.reshape(-1, 3), np.ones(len(me.vertices))] @ np.array(mw).T
        d = ((world[:, :3] - np.array(origin)) @ np.array(view) - DEPTH_NEAR) / DEPTH_RANGE
        rgba = np.repeat(np.clip(d, 0.0, 1.0)[:, None], 4, axis=1)
        rgba[:, 3] = 1.0
        me.color_attributes["depth"].data.foreach_set("color", rgba.ravel())
        me.update()


def render_passes(sc, cam, tmp):
    """The frame three ways, all through the same camera so they agree pixel for pixel:
    the shaded colours, the part groups (0 where empty) and the depth (units)."""
    sh = sc.display.shading
    sh.color_type = "MATERIAL"
    colour = render(sc, tmp / "colour.png")
    sh.color_type = "OBJECT"
    groups = (render(sc, tmp / "group.png")[:, :, 0].astype(np.int32) + 8) // 16
    write_depths(cam)
    sh.color_type = "VERTEX"
    grey = render(sc, tmp / "depth.png")[:, :, 0] / 255.0
    lin = np.where(grey <= 0.04045, grey / 12.92, ((grey + 0.055) / 1.055) ** 2.4)
    depth = DEPTH_NEAR + lin * DEPTH_RANGE
    sh.color_type = "MATERIAL"
    return colour, groups, depth


@contextlib.contextmanager
def quiet():
    """Blender prints a line for every render; keep them out of the script's report."""
    sys.stdout.flush()
    saved, null = os.dup(1), os.open(os.devnull, os.O_WRONLY)
    os.dup2(null, 1)
    try:
        yield
    finally:
        os.dup2(saved, 1)
        os.close(null)
        os.close(saved)


def render(sc, path):
    """Render the scene to path and return it as an RGBA array, top row first."""
    sc.render.filepath = str(path)
    with quiet():
        bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(str(path), check_existing=False)
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)  # the PNG's bytes / 255, bottom row first
    bpy.data.images.remove(im)
    return np.flipud(np.round(a.reshape(h, w, 4) * 255.0).astype(np.uint8))


def to_palette(cell):
    """Every opaque pixel to the nearest trooper colour, alpha to 0 or 255. Returns the
    cell, how many pixels moved and the largest move (RGB distance)."""
    out = np.zeros_like(cell)
    opaque = cell[:, :, 3] >= 128
    cols = np.array(COLOURS, dtype=np.int32)
    px = cell[opaque][:, :3].astype(np.int32)
    d = ((px[:, None, :] - cols[None, :, :]) ** 2).sum(axis=2)
    out[opaque, :3] = cols[d.argmin(axis=1)]
    out[opaque, 3] = 255
    best = d.min(axis=1) if len(px) else np.zeros(1)
    return out, int((best > 0).sum()), float(np.sqrt(best.max()))


# Inner lines, the pixel side's "edge" (src/art/troopers-raster.ts): where a part lies in
# front of another, the cloth pixel behind it along the border becomes outline, so an arm
# reads against the jacket it crosses and the near leg against the far one. Only cloth
# takes a line (never a face, a hand or the gun), and never around the head.
CLOTH = {tuple(c) for m in ("jacket", "trousers", "belt", "boots") for c in MATERIALS[m][0]}
LINED = [GROUPS.index(g) + 1 for g in ("body", "arm_l", "arm_r", "leg_l", "leg_r", "gun")]
INNER_GAP = 1.5  # units of depth between the parts before a line is drawn


def inner_lines(cell, groups, depth):
    h, w = groups.shape
    cloth = np.zeros((h, w), dtype=bool)
    for c in CLOTH:
        cloth |= np.all(cell[:, :, :3] == c, axis=2)
    cloth &= np.isin(groups, LINED)
    g = np.pad(groups, 1)
    d = np.pad(depth, 1)
    mark = np.zeros_like(cloth)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        gn = g[1 + dy : 1 + dy + h, 1 + dx : 1 + dx + w]
        dn = d[1 + dy : 1 + dy + h, 1 + dx : 1 + dx + w]
        mark |= cloth & np.isin(gn, LINED) & (gn != groups) & (depth - dn > INNER_GAP)
    out = cell.copy()
    out[mark, :3] = OUTLINE
    return out


def outline(cell):
    """Style guide section 4: a 1 px outline in the palette's outline colour around the
    silhouette, on the four sides of every pixel."""
    a = cell[:, :, 3] > 0
    n = np.zeros_like(a)
    n[1:, :] |= a[:-1, :]
    n[:-1, :] |= a[1:, :]
    n[:, 1:] |= a[:, :-1]
    n[:, :-1] |= a[:, 1:]
    ring = n & ~a
    out = cell.copy()
    out[ring, :3] = OUTLINE
    out[ring, 3] = 255
    return out


def bounds(cell):
    ys, xs = np.nonzero(cell[:, :, 3])
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


# ------------------------------------------------------------------------ the output


def write_png(path, pixels):
    """A plain 8-bit RGB or RGBA PNG with no time stamp or metadata, so it is the same
    file every run."""
    h, w, ch = pixels.shape
    raw = b"".join(b"\x00" + pixels[y].tobytes() for y in range(h))

    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    head = struct.pack(">IIBBBBB", w, h, 8, {3: 2, 4: 6}[ch], 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", head)
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def sheet(cells, margin, bg):
    """Rows of 24 x 24 cells on a background, RGBA; bg None leaves it transparent."""
    h = len(cells) * CELL + 2 * margin
    w = len(cells[0]) * CELL + 2 * margin
    out = np.zeros((h, w, 4), dtype=np.uint8)
    if bg is not None:
        out[:, :, :3] = bg
        out[:, :, 3] = 255
    for r, row in enumerate(cells):
        for c, cell in enumerate(row):
            y, x = margin + r * CELL, margin + c * CELL
            region = out[y : y + CELL, x : x + CELL]
            m = cell[:, :, 3] > 0
            region[m] = cell[m]
    return np.ascontiguousarray(out)


FRAMES = [("idle", 0, IDLE)] + [("walk", i, pose) for i, pose in enumerate(WALK)]


def render_cells(sc, cam, rig, tmp):
    """Every facing and frame: rendered, reduced to the palette, inner lines drawn. Rows
    of RGBA cells before the outer outline, and the reduction's statistics."""
    cells, moved, worst = [], 0, 0.0
    for _, heading in FACINGS:
        row = []
        for _, _, pose in FRAMES:
            apply_pose(rig, heading, pose)
            shade_faces()
            colour, groups, depth = render_passes(sc, cam, tmp)
            flat, n, far = to_palette(colour)
            if not np.array_equal(flat[:, :, 3] > 0, groups > 0):
                sys.exit("blender_trooper: FAILED, the group pass disagrees with the render")
            moved, worst = moved + n, max(worst, far)
            row.append(inner_lines(flat, groups, depth))
        cells.append(row)
    return cells, moved, worst


def fit(cells):
    """Move every frame down by the same whole number of rows so the lowest foot of any
    frame sits on row 22, the game's ground row, with its outline on row 23. Returns the
    shift, or exits naming the frames that do not fit (the outline needs a free row and
    column on every side)."""
    names = [f"{a}_{f}_{i}" for f, _ in FACINGS for a, i, _ in FRAMES]
    boxes = dict(zip(names, (bounds(c) for row in cells for c in row)))
    top = min(boxes, key=lambda n: boxes[n][1])
    bottom = max(boxes, key=lambda n: boxes[n][3])
    left = min(boxes, key=lambda n: boxes[n][0])
    right = max(boxes, key=lambda n: boxes[n][2])
    dy = (CELL - 2) - boxes[bottom][3]
    rows = boxes[bottom][3] - boxes[top][1] + 1
    if rows > CELL - 2 or boxes[left][0] < 1 or boxes[right][2] > CELL - 2:
        sys.exit(
            f"blender_trooper: FAILED, the frames need {rows} rows (top {top}, bottom "
            f"{bottom}) and columns {boxes[left][0]}-{boxes[right][2]} ({left}, {right});"
            f" a 24 x 24 cell holds 22 of each inside its outline"
        )
    return dy


def shifted(cell, dy):
    out = np.zeros_like(cell)
    if dy >= 0:
        out[dy:] = cell[: CELL - dy]
    else:
        out[:dy] = cell[-dy:]
    return out


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    preview = (
        pathlib.Path(argv[argv.index("--preview") + 1]) if "--preview" in argv else None
    )

    sc = reset_scene()
    mats = make_materials()
    cam = make_camera(sc)
    rig = build_model(mats)
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="blender_trooper_"))
    big = None
    try:
        cells, moved, worst = render_cells(sc, cam, rig, tmp)
        if preview:
            sc.render.resolution_x = sc.render.resolution_y = CELL * 8
            tiles = []
            for _, heading in FACINGS:
                apply_pose(rig, heading, IDLE)
                shade_faces()
                tiles.append(render(sc, tmp / "big.png"))
            big = np.concatenate(tiles, axis=1)
            big[big[:, :, 3] == 0, :3] = SHEET_BG
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    dy = fit(cells)
    if worst > 12:
        sys.exit(f"blender_trooper: FAILED, a pixel was {worst:.1f} off the palette")
    cells = [[outline(shifted(c, dy)) for c in row] for row in cells]
    anchor = (ANCHOR[0], ANCHOR[1] + dy)
    for (fname, _), row in zip(FACINGS, cells):
        for (anim, i, _), c in zip(FRAMES, row):
            x0, y0, x1, y1 = bounds(c)
            size = f"{x1 - x0 + 1:2d} x {y1 - y0 + 1:2d}"
            print(f"  {anim}_{fname}_{i:<3d} {size} px, cols {x0:2d}-{x1:2d} rows {y0:2d}-{y1:2d}")
    print(f"blender_trooper: 25 cells, ground point at {anchor}, {moved} pixels moved")

    one = sheet(cells, SHEET_MARGIN, SHEET_BG)[:, :, :3]
    write_png(ROOT / "docs/art/bakeoff/blender-1x.png", np.ascontiguousarray(one))
    four = np.repeat(np.repeat(one, 4, axis=0), 4, axis=1)
    write_png(ROOT / "docs/art/bakeoff/blender-4x.png", np.ascontiguousarray(four))
    write_png(ROOT / "game/public/bakeoff/blender.png", sheet(cells, 0, None))
    manifest = {
        "_about": "Written by tools/art/blender_trooper.py; the art lab's bakeoff section reads it.",
        "cell": CELL,
        "anchor": list(anchor),
        "columns": [f"{anim}_{i}" for anim, i, _ in FRAMES],
        "rows": [fname for fname, _ in FACINGS],
    }
    text = json.dumps(manifest, indent=2) + "\n"
    (ROOT / "game/public/bakeoff/blender.json").write_text(text)
    if big is not None:
        write_png(preview, np.ascontiguousarray(big[:, :, :3]))


main()
