# Kit de modèles « cyber » (thèmes Néon, Forge, Profondeurs) pour le rendu
# v2 du client (?gfx=v2). Un objet par pièce, à l'origine, dans le repère du
# jeu une fois exporté (y en haut, +z vers le sud, donc vers la caméra).
#
# Les matériaux ne portent que des RÔLES (leur nom) : le client les remplace
# par des matériaux aux couleurs du thème actif (client/src/scene/v2/kit.ts).
# Aucune couleur du jeu ne vit donc dans le .glb.
#
# Lancer : node art/kit/dump_shapes.mjs (formes des lames et des power-ups,
# relues du jeu), puis blender --background --python art/kit/build_kit.py
# Sorties : client/src/assets3d/cyber_kit.glb et art/kit/cyber_kit.blend
import bpy, bmesh, json, math, os, random, warnings
import numpy as np
from mathutils import Matrix, Vector

warnings.simplefilter("ignore")
random.seed(11)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_GLB = os.path.join(ROOT, "client", "src", "assets3d", "cyber_kit.glb")
OUT_BLEND = os.path.join(ROOT, "art", "kit", "cyber_kit.blend")

bpy.ops.wm.read_factory_settings(use_empty=True)
col = bpy.context.scene.collection

# --- Matériaux : un rôle par nom -----------------------------------------
ROLE_PREVIEW = {
    # rôle: (couleur d'aperçu dans Blender, émissif ?)
    "body": ((0.02, 0.022, 0.03), False),
    "body_mid": ((0.07, 0.075, 0.09), False),
    "paint": ((0.25, 0.25, 0.23), False),
    "soil": ((0.012, 0.01, 0.008), False),
    "blade": ((0.8, 0.82, 0.86), False),
    "powerup": ((1.0, 0.8, 0.1), True),
    "crate_body": ((0.05, 0.055, 0.07), False),
    "crate_edge": ((0.0, 0.85, 1.0), True),
    "e_crate": ((1.0, 0.1, 0.6), True),
    "reeds": ((0.05, 0.4, 0.25), False),
    "screen": ((0.0, 0.85, 1.0), True),
    "e_obelisk": ((0.0, 0.85, 1.0), True),
    "e_core": ((1.0, 0.1, 0.6), True),
    "e_halo": ((0.0, 0.85, 1.0), True),
    "e_neon": ((0.55, 0.2, 1.0), True),
    "e_screen": ((0.0, 0.85, 1.0), True),
    "e_led": ((0.2, 0.9, 0.4), True),
    "e_cube": ((1.0, 0.1, 0.6), True),
    "e_pad": ((0.0, 0.85, 1.0), True),
    # Quartier (district_pieces.py)
    "tint": ((0.3, 0.32, 0.36), False),
    "window": ((0.9, 0.75, 0.45), True),
    "plant": ((0.05, 0.4, 0.25), False),
    # Personnages (player_pieces.py) : la matière de chaque face est dans la
    # couleur par sommet, le client lui donne les couleurs du skin.
    "skin": ((0.5, 0.5, 0.5), False),
}
MATS = {}


def role(name):
    if name in MATS:
        return MATS[name]
    color, emissive = ROLE_PREVIEW[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1) if not emissive else (0.01, 0.01, 0.01, 1)
    b.inputs["Roughness"].default_value = 0.45
    b.inputs["Metallic"].default_value = 0.6 if name.startswith("body") else 0.0
    if emissive:
        b.inputs["Emission Color"].default_value = (*color, 1)
        b.inputs["Emission Strength"].default_value = 1.0
    MATS[name] = m
    return m


def led_mask_image():
    """Grille de LED (blanc sur noir) : le client lui donne la couleur du thème."""
    cols, rows, cell = 20, 28, 6
    w, h = cols * cell, rows * cell
    px = np.zeros((h, w, 4), dtype=np.float32)
    px[..., 3] = 1.0
    rng = np.random.default_rng(5)
    for r in range(rows):
        for c in range(cols):
            if rng.random() < 0.42:
                continue
            v = 0.35 + 0.65 * rng.random()
            px[r * cell + 2:r * cell + 4, c * cell + 1:c * cell + 5, :3] = v
    img = bpy.data.images.new("led_mask", w, h)
    img.pixels.foreach_set(px.ravel())
    img.pack()
    return img


def led_material():
    if "e_led" in MATS:
        return MATS["e_led"]
    m = role("e_led")
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = led_mask_image()
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
    return m


# --- Constructeur de pièce : un seul maillage, plusieurs matériaux --------
def ring(r, z, n, phase=0.0, sx=1.0, sy=1.0, cx=0.0, cy=0.0):
    return [(cx + math.cos(phase + i / n * math.tau) * r * sx, cy + math.sin(phase + i / n * math.tau) * r * sy, z) for i in range(n)]


class Prop:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.bm.loops.layers.uv.new("UVMap")
        self.mats = []

    def _mat_index(self, name):
        m = led_material() if name == "e_led" else role(name)
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def add(self, verts, faces, mat, loc=(0, 0, 0), rot_z=0.0, smooth=False, bevel=0.0, uvs=None, rot_x=0.0, rot_y=0.0):
        tmp = bmesh.new()
        uv = tmp.loops.layers.uv.new("UVMap")
        bv = [tmp.verts.new(v) for v in verts]
        mi = self._mat_index(mat)
        for fi, f in enumerate(faces):
            try:
                face = tmp.faces.new([bv[i] for i in f])
            except ValueError:
                continue
            if uvs is not None:
                for loop, vi in zip(face.loops, f):
                    loop[uv].uv = uvs[vi]
        if bevel > 0:
            bmesh.ops.bevel(tmp, geom=tmp.edges[:], offset=bevel, segments=1, affect="EDGES", profile=0.5)
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        for face in tmp.faces:
            face.material_index = mi
            face.smooth = smooth
        mtx = Matrix.Translation(loc) @ Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Rotation(rot_y, 4, "Y") @ Matrix.Rotation(rot_x, 4, "X")
        bmesh.ops.transform(tmp, matrix=mtx, verts=tmp.verts[:])
        me = bpy.data.meshes.new("tmp")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def add_solid(self, verts, faces, mat, bevel, sharp_deg=28.0):
        """Volume fermé venu du jeu (triangles) : faces planes refondues, puis
        seules les arêtes vives sont chanfreinées. Renvoie le x le plus grand
        (la pointe d'une lame)."""
        tmp = bmesh.new()
        tmp.loops.layers.uv.new("UVMap")
        bv = [tmp.verts.new(v) for v in verts]
        for f in faces:
            try:
                tmp.faces.new([bv[i] for i in f])
            except ValueError:
                continue
        bmesh.ops.remove_doubles(tmp, verts=tmp.verts[:], dist=1e-5)
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        bmesh.ops.dissolve_limit(tmp, angle_limit=math.radians(1.0), verts=tmp.verts[:], edges=tmp.edges[:])
        # Les arêtes qui partent de la pointe restent vives : les chanfreiner
        # la tronquerait (une dague y perdait un cinquième de sa longueur).
        far = max(v.co.x for v in tmp.verts) - 1e-4
        sharp = [
            e for e in tmp.edges
            if len(e.link_faces) == 2 and e.calc_face_angle() > math.radians(sharp_deg)
            and not any(v.co.x > far for v in e.verts)
        ]
        if bevel > 0 and sharp:
            bmesh.ops.bevel(tmp, geom=sharp, offset=bevel, segments=1, affect="EDGES", profile=0.5, clamp_overlap=True)
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        mi = self._mat_index(mat)
        for face in tmp.faces:
            face.material_index = mi
            face.smooth = False
        tip = max(v.co.x for v in tmp.verts)
        me = bpy.data.meshes.new("tmp")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        return tip

    def loft(self, rings, mat, cap=True, **kw):
        n = len(rings[0])
        verts = [v for r in rings for v in r]
        faces = []
        for k in range(len(rings) - 1):
            for i in range(n):
                a, b = k * n + i, k * n + (i + 1) % n
                faces.append((a, b, b + n, a + n))
        if cap:
            faces.append(tuple(reversed(range(n))))
            faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
        self.add(verts, faces, mat, **kw)

    def box(self, sx, sy, sz, mat, loc=(0, 0, 0), **kw):
        """Boîte dont la base est en `loc`."""
        hx, hy = sx / 2, sy / 2
        self.loft([[(-hx, -hy, 0), (hx, -hy, 0), (hx, hy, 0), (-hx, hy, 0)],
                   [(-hx, -hy, sz), (hx, -hy, sz), (hx, hy, sz), (-hx, hy, sz)]], mat, loc=loc, **kw)

    def disc(self, r_in, r_out, mat, z=0.0, n=48, loc=(0, 0, 0)):
        if r_in > 0:
            verts = ring(r_in, z, n) + ring(r_out, z, n)
            faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        else:
            verts = [(0, 0, z)] + ring(r_out, z, n)
            faces = [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)]
        self.add(verts, faces, mat, loc=loc)

    def torus(self, R, r, mat, loc=(0, 0, 0), n=32, m=6):
        verts, faces = [], []
        for i in range(n):
            a = i / n * math.tau
            for j in range(m):
                b = j / m * math.tau
                rr = R + math.cos(b) * r
                verts.append((math.cos(a) * rr, math.sin(a) * rr, math.sin(b) * r))
        for i in range(n):
            for j in range(m):
                faces.append((i * m + j, ((i + 1) % n) * m + j, ((i + 1) % n) * m + (j + 1) % m, i * m + (j + 1) % m))
        self.add(verts, faces, mat, loc=loc, smooth=True)

    def finish(self):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        me.update()
        o = bpy.data.objects.new(self.name, me)
        col.objects.link(o)
        return o


Q = math.pi / 4

# --- Obélisque (collider 1,5 u ; 1,0 u pour les amas, à l'échelle) -------
p = Prop("Obelisk")
H = 8.5
p.loft([ring(1.5, 0, 8, math.pi / 8), ring(1.38, 0.35, 8, math.pi / 8)], "body_mid", bevel=0.04)
rad = lambda z: 1.15 - 0.5 * (z / H)
p.loft([ring(rad(0.35) * 0.84, 0.35, 4, Q), ring(rad(H) * 0.84, H - 0.3, 4, Q)], "e_obelisk")
z = 0.35
for sh in (2.4, 1.9, 1.5, 1.2, 0.9):
    z1 = z + sh - 0.12
    p.loft([ring(rad(z), z, 4, Q), ring(rad(z1), z1, 4, Q)], "body", bevel=0.05)
    z += sh
p.loft([ring(rad(z) * 0.9, z, 4, Q), ring(0.05, z + 0.9, 4, Q)], "e_obelisk")
p.finish()

# --- Pilier central (collider 1,1 u) : balise ----------------------------
p = Prop("CentralPillar")
p.loft([ring(1.1, 0, 12), ring(1.0, 0.5, 12)], "body_mid", bevel=0.04)
p.loft([ring(0.62, 0.5, 8), ring(0.5, 10.2, 8)], "e_core")
z = 0.5
for sh in (2.6, 2.3, 2.0, 1.7, 1.3):
    r0, r1 = 0.95 - 0.035 * z, 0.95 - 0.035 * (z + sh)
    p.loft([ring(r0, z, 8, math.pi / 8), ring(r1, z + sh - 0.16, 8, math.pi / 8)], "body", bevel=0.04)
    z += sh
p.loft([ring(0.75, z, 8, math.pi / 8), ring(0.9, z + 0.25, 8, math.pi / 8), ring(0.6, z + 0.45, 8, math.pi / 8)], "body_mid")
p.loft([ring(0.05, z + 0.9, 4), ring(0.5, z + 1.6, 4), ring(0.05, z + 2.5, 4)], "e_core")
p.torus(1.45, 0.05, "e_halo", loc=(0, 0, z + 1.6), n=40, m=6)
p.disc(2.38, 2.55, "e_halo", z=0.05, n=64)
p.finish()

# --- Rack serveur (largeur le long de +x) --------------------------------
p = Prop("Rack")
W, D, HR = 2.7, 1.45, 3.5
p.box(W + 0.12, D + 0.12, 0.14, "body_mid")
p.box(W, D, HR - 0.14, "body", loc=(0, 0, 0.14), bevel=0.05)
p.box(W + 0.08, D + 0.08, 0.1, "body_mid", loc=(0, 0, HR))
p.box(W + 0.1, D + 0.1, 0.05, "e_neon", loc=(0, 0, HR - 0.14))
hw = W / 2 - 0.16
for sgn in (-1, 1):
    y = sgn * (D / 2 + 0.008)
    quad = [(-hw, y, 0.34), (hw, y, 0.34), (hw, y, HR - 0.28), (-hw, y, HR - 0.28)]
    p.add(quad, [(0, 1, 2, 3)], "e_led", uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
    for sx in (-1, 1):
        p.box(0.05, 0.05, HR - 0.6, "e_neon", loc=(sx * (W / 2 + 0.012), sgn * (D / 2 + 0.012), 0.24))
for k in range(7):
    p.box(W - 0.5, 0.07, 0.06, "body", loc=(0, -0.48 + k * 0.16, HR + 0.1))
p.finish()

# --- Arche : piliers à ±2,6 u le long de x, passage le long de z ---------
p = Prop("Arch")
SPAN, AH = 2.6, 5.3
for sx in (-1, 1):
    p.box(1.25, 1.25, 0.3, "body_mid", loc=(sx * SPAN, 0, 0), bevel=0.04)
    p.box(0.95, 0.95, AH - 0.3, "body", loc=(sx * SPAN, 0, 0.3), bevel=0.06)
    # Filets lumineux sur les faces du passage.
    for sy in (-1, 1):
        p.box(0.06, 0.06, AH - 0.9, "e_neon", loc=(sx * (SPAN - 0.49), sy * 0.49, 0.5))
p.box(SPAN * 2 + 1.5, 1.1, 0.75, "body", loc=(0, 0, AH), bevel=0.07)
p.box(SPAN * 2 - 1.0, 0.07, 0.07, "e_neon", loc=(0, -0.56, AH + 0.05))
p.box(SPAN * 2 - 1.0, 0.07, 0.07, "e_neon", loc=(0, 0.56, AH + 0.05))
p.box(1.0, 1.16, 0.3, "e_neon", loc=(0, 0, AH + 0.22))
p.finish()

# --- Panneau holographique : face vers +z (le sud) -----------------------
p = Prop("Billboard")
p.loft([ring(0.9, 0, 10), ring(0.82, 0.6, 10)], "body_mid", bevel=0.03)
p.loft([ring(0.42, 0.6, 8), ring(0.28, 6.4, 8)], "body")
p.loft([ring(0.05, 6.4, 6), ring(0.34, 6.75, 6), ring(0.05, 7.1, 6)], "e_neon")
PW, PH, PY, PC = 5.0, 2.4, -0.5, 6.0
for dz in (-PH / 2 - 0.1, PH / 2 + 0.04):
    p.box(PW + 0.3, 0.12, 0.12, "e_neon", loc=(0, PY, PC + dz))
for sx in (-1, 1):
    p.box(0.1, 0.1, PH + 0.2, "body_mid", loc=(sx * (PW / 2 + 0.1), PY, PC - PH / 2 - 0.1))
p.box(0.14, 0.5, 0.14, "body_mid", loc=(0, PY / 2, PC + PH / 2 + 0.02))
p.box(0.14, 0.5, 0.14, "body_mid", loc=(0, PY / 2, PC - PH / 2 - 0.1))
p.finish()
# Écran à part : matériau translucide, rendu après le reste.
p = Prop("BillboardScreen")
quad = [(-PW / 2, PY, PC - PH / 2), (PW / 2, PY, PC - PH / 2), (PW / 2, PY, PC + PH / 2), (-PW / 2, PY, PC + PH / 2)]
p.add(quad, [(0, 1, 2, 3)], "screen", uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
p.finish()

# --- Pad à drone et son drone --------------------------------------------
p = Prop("DronePad")
p.loft([ring(3.1, 0, 40), ring(3.0, 0.07, 40)], "body_mid")
p.disc(2.45, 2.6, "e_screen", z=0.078, n=56)
p.disc(0.9, 0.98, "e_screen", z=0.078, n=40)
for i in range(4):
    a = i / 4 * math.tau + Q
    p.box(0.9, 0.1, 0.085, "paint", loc=(math.cos(a) * 1.75, math.sin(a) * 1.75, 0), rot_z=a)
p.finish()

p = Prop("Drone")
p.loft([ring(0.1, -0.16, 12), ring(0.5, -0.05, 12), ring(0.55, 0.06, 12), ring(0.2, 0.2, 12)], "body", smooth=True)
for i in range(4):
    a = i / 4 * math.tau + Q
    p.box(0.9, 0.07, 0.05, "body_mid", loc=(math.cos(a) * 0.45, math.sin(a) * 0.45, 0.02), rot_z=a)
    p.torus(0.3, 0.03, "body_mid", loc=(math.cos(a) * 0.85, math.sin(a) * 0.85, 0.05), n=16, m=5)
p.disc(0, 0.16, "e_screen", z=-0.165, n=12)
p.finish()

# --- Cristal en lévitation -----------------------------------------------
p = Prop("Shard")
p.loft([ring(0.02, -1.8, 6), ring(0.62, -0.5, 6), ring(0.7, 0.2, 6), ring(0.02, 1.8, 6)], "e_neon")
p.finish()

# --- Cube flottant : cage sombre, cœur lumineux --------------------------
p = Prop("Cube")
S = 0.8
p.box(S * 0.72, S * 0.72, S * 0.72, "e_cube", loc=(0, 0, -S * 0.36))
t = 0.09
for a in (-1, 1):
    for b in (-1, 1):
        o = (S - t) / 2
        p.box(t, t, S, "body", loc=(a * o, b * o, -S / 2))
        p.box(S, t, t, "body", loc=(0, a * o, b * o - t / 2))
        p.box(t, S, t, "body", loc=(a * o, 0, b * o - t / 2))
p.finish()

# --- Trappe au sol (à plat : rien qui ressemble à un obstacle) -----------
p = Prop("GroundPad")
p.loft([ring(2.3, 0, 32), ring(2.25, 0.03, 32)], "body_mid")
p.disc(1.75, 1.86, "e_pad", z=0.036, n=48)
for i in range(6):
    a = i / 6 * math.tau
    p.box(0.5, 0.08, 0.04, "paint", loc=(math.cos(a) * 1.2, math.sin(a) * 1.2, 0), rot_z=a)
p.box(1.3, 0.9, 0.04, "body", loc=(0, 0, 0), bevel=0.01)
p.finish()

# --- Buisson : massif de roseaux (rayon 5 u, mis à l'échelle en jeu) -----
BR = 5.0
p = Prop("BushBase")
p.disc(0, BR, "soil", z=0.012, n=48)
p.loft([ring(BR + 0.22, 0, 48), ring(BR + 0.18, 0.12, 48), ring(BR, 0.12, 48), ring(BR - 0.02, 0, 48)], "body_mid", cap=False)
p.finish()


def reeds():
    """Lames à 4 niveaux ; COLOR_0 = hauteur relative (0 au pied, 1 à la pointe)."""
    n_blades, LV = 2200, 4
    verts = np.zeros((n_blades * LV * 2, 3), dtype=np.float32)
    cols = np.zeros((n_blades * LV * 2, 4), dtype=np.float32)
    faces = []
    for k in range(n_blades):
        rr = BR * math.sqrt(random.random()) * 0.97
        a = random.random() * math.tau
        px, py = math.cos(a) * rr, math.sin(a) * rr
        edge = rr / BR
        hgt = (3.0 - 1.3 * edge ** 2) * random.uniform(0.6, 1.0)
        yaw = random.random() * math.tau
        ld = random.random() * math.tau
        lean = random.uniform(0.15, 0.75) * hgt * (0.45 + edge * 0.55)
        w = random.uniform(0.09, 0.17)
        shade = random.uniform(0.75, 1.0)
        for j in range(LV):
            t = j / (LV - 1)
            cx = px + math.cos(ld) * lean * t * t
            cy = py + math.sin(ld) * lean * t * t
            cz = hgt * t * (1 - 0.18 * t)
            ww = w * (1 - t) ** 0.7 + 0.006
            ox, oy = math.cos(yaw) * ww, math.sin(yaw) * ww
            i0 = (k * LV + j) * 2
            verts[i0] = (cx - ox, cy - oy, cz)
            verts[i0 + 1] = (cx + ox, cy + oy, cz)
            cols[i0] = cols[i0 + 1] = (t * shade, t * shade, t * shade, 1.0)
            if j < LV - 1:
                faces.append((i0, i0 + 1, i0 + 3, i0 + 2))
    me = bpy.data.meshes.new("BushReeds")
    me.from_pydata(verts.tolist(), [], faces)
    me.update()
    ca = me.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", cols.ravel())
    me.color_attributes.active_color = ca
    me.color_attributes.render_color_index = 0
    me.materials.append(role("reeds"))
    me.shade_smooth()
    o = bpy.data.objects.new("BushReeds", me)
    col.objects.link(o)


reeds()

# --- Formes relues du jeu (art/kit/dump_shapes.mjs) ----------------------
SRC = os.path.join(ROOT, "art", "kit", "src")


def read_obj(name):
    """Sommets et faces d'un .obj du jeu, passés dans le repère de Blender :
    (x, y, z) du jeu (y en haut) devient (x, -z, y)."""
    verts, faces = [], []
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        for line in f:
            p = line.split()
            if not p:
                continue
            if p[0] == "v":
                x, y, z = float(p[1]), float(p[2]), float(p[3])
                verts.append((x, -z, y))
            elif p[0] == "f":
                faces.append(tuple(int(i) - 1 for i in p[1:]))
    return verts, faces


# Lames : une par palier, la silhouette du jeu, arêtes chanfreinées pour
# accrocher la lumière. Le chanfrein ne doit pas raccourcir la lame : sa
# pointe est la portée qui tue un corps (BLADE_TIP_REACH).
BLADE_TIPS = json.load(open(os.path.join(SRC, "blade_tips.json"), encoding="utf-8"))
for t, expected in enumerate(BLADE_TIPS):
    p = Prop(f"Blade{t}")
    verts, faces = read_obj(f"blade_{t}.obj")
    tip = p.add_solid(verts, faces, "blade", bevel=0.009)
    assert abs(tip - expected) < 0.012, f"lame {t} : pointe {tip:.4f} au lieu de {expected:.4f}"
    p.finish()

# Power-ups : la forme du type (elle le fait reconnaître sans la couleur),
# épaissie d'un chanfrein, dans un anneau commun à tous.
for t in range(5):
    p = Prop(f"PowerUp{t}")
    verts, faces = read_obj(f"powerup_{t}.obj")
    p.add_solid(verts, faces, "powerup", bevel=0.035)
    p.torus(1.16, 0.045, "powerup", n=40, m=6)
    p.finish()
# L'anneau est modélisé à plat (axe z) : couché dans le plan de la forme.
for t in range(5):
    o = bpy.data.objects[f"PowerUp{t}"]
    bm = bmesh.new()
    bm.from_mesh(o.data)
    rim = [v for v in bm.verts if math.hypot(v.co.x, v.co.y) > 1.08 and abs(v.co.z) < 0.06]
    bmesh.ops.rotate(bm, verts=rim, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    bm.to_mesh(o.data)
    bm.free()

# Caisse : centrée, 1,6 u de côté (le client la met à l'échelle CRATE_SCALE,
# comme la boîte d'origine). Coffre blindé, bandeau et emblème lumineux.
p = Prop("Crate")
C = 1.6
p.box(C * 0.94, C * 0.94, C * 0.94, "crate_body", loc=(0, 0, -C * 0.47), bevel=0.07)
for sx in (-1, 1):
    for sy in (-1, 1):
        p.box(0.2, 0.2, C, "body_mid", loc=(sx * (C / 2 - 0.1), sy * (C / 2 - 0.1), -C / 2), bevel=0.03)
for sz in (-1, 1):
    p.box(C * 1.02, C * 1.02, 0.12, "body_mid", loc=(0, 0, sz * (C / 2 - 0.06) - 0.06), bevel=0.02)
p.box(C * 0.96, C * 0.96, 0.1, "e_crate", loc=(0, 0, -0.05))
p.box(0.55, 0.55, 0.04, "e_crate", loc=(0, 0, C / 2), rot_z=Q)
for sx in (-1, 1):
    p.box(0.05, C * 0.7, 0.05, "crate_edge", loc=(sx * (C / 2 + 0.005), 0, C * 0.24))
    p.box(C * 0.7, 0.05, 0.05, "crate_edge", loc=(0, sx * (C / 2 + 0.005), C * 0.24))
p.finish()

# --- Quartier : façades, toits, mobilier urbain (mode « district ») ------
exec(compile(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "district_pieces.py"), encoding="utf-8").read(), "district_pieces.py", "exec"))

# --- Personnages : têtes, torses, bras et jambes des skins ----------------
exec(compile(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "player_pieces.py"), encoding="utf-8").read(), "player_pieces.py", "exec"))

# --- Export --------------------------------------------------------------
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
props = bpy.ops.export_scene.gltf.get_rna_type().properties
kw = dict(filepath=OUT_GLB, export_format="GLB", export_yup=True, export_apply=True, export_materials="EXPORT")
for key, val in (("export_vertex_color", "ACTIVE"), ("export_all_vertex_colors", False), ("export_active_vertex_color_when_no_material", True),
                 ("export_animations", False), ("export_cameras", False), ("export_lights", False), ("export_image_format", "AUTO")):
    if key in props:
        kw[key] = val
bpy.ops.export_scene.gltf(**kw)
tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in bpy.data.objects if o.type == "MESH"}
print("KIT OK", os.path.getsize(OUT_GLB), "octets", tris)
