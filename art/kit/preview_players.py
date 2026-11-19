# Planche de contrôle des personnages du kit : chaque skin assemblé (tête,
# torse, bras, jambes), de trois quarts face puis de dos, aux couleurs de sa
# tenue, relues de client/src/cosmetics/looks.ts (KIT_SKINS).
# Lancer : blender --background art/kit/cyber_kit.blend --python
# art/kit/preview_players.py   (écrit art/kit/preview_players.png)
import bpy, math, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), "..", ".."))
src = open(os.path.join(ROOT, "client", "src", "cosmetics", "looks.ts"), encoding="utf-8").read()
src = src[src.index("export const KIT_SKINS"):src.index("export const KIT_BASE")]
PRESET = {"CLOTH": [0, 0, 0.1, 0], "CLOTH_ROUGH": [0.8, 0.75, 0.6, 0.65], "PLATE": [0.75, 0.8, 0.2, 0], "PLATE_ROUGH": [0.34, 0.3, 0.7, 0.6]}


def nums(text):
    text = text.strip()
    return PRESET[text] if text in PRESET else [float(v) for v in text.strip("[]").split(",")]


SKINS = [("base", "Base", "Base", "Armor", "Armor", [0xffffff, 0x4fa6c4, 0x001822, 0xcccccc, 0x00e5ff], [0.5, 0.55, 0.25, 0.3], [0.38, 0.4, 0.65, 0.5])]
pat = re.compile(r'(\w+): \{\s*head: "(\w+)", torso: "(\w+)", arm: "(\w+)", leg: "(\w+)",\s*a: (0x\w+), b: (0x\w+), c: (0x\w+), d: (0x\w+), glow: (0x\w+),\s*metal: (\[[^\]]*\]|\w+), rough: (\[[^\]]*\]|\w+),')
for m in pat.finditer(src):
    SKINS.append((m.group(1), m.group(2), m.group(3), m.group(4), m.group(5), [int(m.group(k), 16) for k in range(6, 11)], nums(m.group(11)), nums(m.group(12))))
print("skins", len(SKINS))


def lin(h):
    out = []
    for sh in (16, 8, 0):
        c = ((h >> sh) & 255) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


scene = bpy.context.scene
for o in bpy.data.objects:
    o.hide_render = True


def skin_material(name, cols, metal, rough):
    mat = bpy.data.materials.new("pv_" + name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "Color"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(attr.outputs["Color"], sep.inputs["Color"])

    def mix(fac, c0, c1, kind="RGBA"):
        n = nt.nodes.new("ShaderNodeMix")
        n.data_type = kind
        nt.links.new(fac, n.inputs["Factor"])
        a, b = (n.inputs["A"], n.inputs["B"]) if kind == "RGBA" else (n.inputs[2], n.inputs[3])
        for sock, c in ((a, c0), (b, c1)):
            if isinstance(c, tuple):
                sock.default_value = (*c, 1)
            elif isinstance(c, float):
                sock.default_value = c
            else:
                nt.links.new(c, sock)
        return n.outputs["Result"] if kind == "RGBA" else n.outputs[0]

    r, g, b = sep.outputs["Red"], sep.outputs["Green"], sep.outputs["Blue"]
    A, B, C, D, G = [lin(c) for c in cols]
    base = mix(b, mix(r, A, B), mix(r, C, D))
    nt.links.new(mix(g, base, (0.0, 0.0, 0.0)), bsdf.inputs["Base Color"])
    nt.links.new(mix(g, (0.0, 0.0, 0.0), G), bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 2.5
    nt.links.new(mix(b, mix(r, float(metal[0]), float(metal[1]), "FLOAT"), mix(r, float(metal[2]), float(metal[3]), "FLOAT"), "FLOAT"), bsdf.inputs["Metallic"])
    nt.links.new(mix(b, mix(r, float(rough[0]), float(rough[1]), "FLOAT"), mix(r, float(rough[2]), float(rough[3]), "FLOAT"), "FLOAT"), bsdf.inputs["Roughness"])
    return mat


def place(piece, mat, loc, yaw, flip=False):
    src_o = bpy.data.objects[piece]
    me = src_o.data.copy()
    me.materials.clear()
    me.materials.append(mat)
    o = bpy.data.objects.new(piece + "_pv", me)
    scene.collection.objects.link(o)
    o.rotation_euler = (0, 0, yaw)
    o.scale = (-1 if flip else 1, 1, 1)
    c, s = math.cos(yaw), math.sin(yaw)
    o.location = (loc[0] + c * loc[3] - s * loc[4], loc[1] + s * loc[3] + c * loc[4], loc[2])
    return o


COLS = 10
for i, (name, head, torso, arm, leg, cols, metal, rough) in enumerate(SKINS):
    mat = skin_material(name, cols, metal, rough)
    for view in range(2):
        # Rangées empilées en hauteur (la caméra regarde de face).
        gx = (i % COLS) * 1.5
        gz = -((i // COLS) * 2 + view) * 2.5
        yaw = math.radians(28) if view == 0 else math.radians(180 + 28)
        place("SkTorso" + torso, mat, (gx, 0, gz + 0.95, 0, 0), yaw)
        place("SkHead" + head, mat, (gx, 0, gz + 1.55, 0, 0), yaw)
        place("SkArm" + arm, mat, (gx, 0, gz + 1.05, 0.38, 0), yaw)
        place("SkArm" + arm, mat, (gx, 0, gz + 1.05, -0.38, 0), yaw, True)
        place("SkLeg" + leg, mat, (gx, 0, gz + 0.35, 0.14, 0), yaw)
        place("SkLeg" + leg, mat, (gx, 0, gz + 0.35, -0.14, 0), yaw, True)

for rot_, energy in (((50, 0, 30), 3.0), ((60, 0, -140), 1.2)):
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = energy
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = tuple(math.radians(v) for v in rot_)
    scene.collection.objects.link(so)
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.1, 0.11, 0.14, 1)
scene.world = world

cam = bpy.data.cameras.new("cam")
cam.type = "ORTHO"
cam.ortho_scale = 15.4
co = bpy.data.objects.new("cam", cam)
# De face (le personnage regarde vers -y), à peine en plongée.
co.location = (6.75, -30, -0.65)
co.rotation_euler = (math.radians(86), 0, 0)
scene.collection.objects.link(co)
scene.camera = co
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 2400
scene.render.resolution_y = 1700
scene.render.filepath = os.path.join(os.path.dirname(bpy.data.filepath), "preview_players.png")
bpy.ops.render.render(write_still=True)
