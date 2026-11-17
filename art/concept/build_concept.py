# Scène-concept « Néon réaliste » : une tranche de l'arène (positions réelles
# de shared/src/decor.ts) remodelée en assets PBR, rendue en EEVEE (moteur
# temps réel, proche de ce que three.js peut tenir avec un éclairage cuit).
# Lancer : blender --background --python build_concept.py
import bpy, bmesh, math, random, warnings
import numpy as np
from mathutils import Vector, Matrix

warnings.simplefilter("ignore")
random.seed(7)
np.random.seed(7)
OUT = r"C:\dev\blades-io\art\concept"

# --- Remise à zéro -------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = scene.collection


def G(x, y, z=0.0):
    """Coordonnées du jeu (x, y vers le sud) -> Blender (x, -y, z en haut)."""
    return Vector((x, -y, z))


# --- Outils de nodes -----------------------------------------------------
def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    return m, nt, bsdf


def pbr(name, color, metallic=0.0, rough=0.5, emit=None, strength=0.0, coat=0.0):
    m, nt, b = new_mat(name)
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    b.inputs["Coat Weight"].default_value = coat
    return m


def sock(nt, v):
    return v


def link(nt, a, b):
    nt.links.new(a, b)


def mth(nt, op, a, b=None, c=None):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def mixc(nt, fac, a, b):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    for key, v in (("Factor", fac), ("A", a), ("B", b)):
        s = [i for i in n.inputs if i.name == key and (key == "Factor" and i.type == "VALUE" or i.type == "RGBA")][0]
        if hasattr(v, "is_linked"):
            nt.links.new(v, s)
        elif isinstance(v, (int, float)):
            s.default_value = v
        else:
            s.default_value = (*v, 1)
    return [o for o in n.outputs if o.type == "RGBA"][0]


def noise(nt, vec, scale, detail=3.0, rough=0.55):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    nt.links.new(vec, n.inputs["Vector"])
    return n.outputs["Fac"] if "Fac" in n.outputs else n.outputs[0]


# --- Outils de maillage --------------------------------------------------
def add_obj(name, mesh, loc=(0, 0, 0), rot_z=0.0, mat=None, smooth=False):
    o = bpy.data.objects.new(name, mesh)
    o.location = loc
    o.rotation_euler = (0, 0, rot_z)
    col.objects.link(o)
    if mat is not None:
        mesh.materials.append(mat)
    if smooth:
        mesh.shade_smooth()
    return o


def loft(name, rings, cap=True):
    """Maillage par anneaux successifs (même nombre de points par anneau)."""
    n = len(rings[0])
    verts = [v for r in rings for v in r]
    faces = []
    for k in range(len(rings) - 1):
        for i in range(n):
            a = k * n + i
            b = k * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap:
        faces.append(tuple(reversed(range(n))))
        faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    return me


def ring(r, z, n, phase=0.0, sx=1.0, sy=1.0):
    return [(math.cos(phase + i / n * math.tau) * r * sx, math.sin(phase + i / n * math.tau) * r * sy, z) for i in range(n)]


def box_mesh(name, sx, sy, sz):
    """Boîte posée sur z = 0."""
    hx, hy = sx / 2, sy / 2
    return loft(name, [[(-hx, -hy, 0), (hx, -hy, 0), (hx, hy, 0), (-hx, hy, 0)],
                       [(-hx, -hy, sz), (hx, -hy, sz), (hx, hy, sz), (-hx, hy, sz)]])


def bevel(o, w=0.04, seg=2):
    m = o.modifiers.new("bevel", "BEVEL")
    m.width = w
    m.segments = seg
    m.limit_method = "ANGLE"
    return o


def disc(name, r_in, r_out, n=64, z=0.0):
    verts = ring(r_in, z, n) + ring(r_out, z, n) if r_in > 0 else [(0, 0, z)] + ring(r_out, z, n)
    faces = []
    if r_in > 0:
        for i in range(n):
            faces.append((i, (i + 1) % n, n + (i + 1) % n, n + i))
    else:
        for i in range(n):
            faces.append((0, 1 + i, 1 + (i + 1) % n))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    return me


def torus(name, R, r, loc, mat, n=64, m=10):
    rings_ = []
    verts, faces = [], []
    for i in range(n):
        a = i / n * math.tau
        for j in range(m):
            b = j / m * math.tau
            rr = R + math.cos(b) * r
            verts.append((math.cos(a) * rr, math.sin(a) * rr, math.sin(b) * r))
    for i in range(n):
        for j in range(m):
            a = i * m + j
            b = i * m + (j + 1) % m
            c = ((i + 1) % n) * m + (j + 1) % m
            d = ((i + 1) % n) * m + j
            faces.append((a, d, c, b))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    return add_obj(name, me, loc, 0, mat, smooth=True)


def point_light(name, loc, color, watts, radius=0.3, shadow=True):
    l = bpy.data.lights.new(name, "POINT")
    l.color = color
    l.energy = watts
    l.shadow_soft_size = radius
    l.use_shadow = shadow
    o = bpy.data.objects.new(name, l)
    o.location = loc
    col.objects.link(o)
    return o


# --- Palette (familles du thème Néon) ------------------------------------
CYAN = (0.0, 0.85, 1.0)
PINK = (1.0, 0.08, 0.55)
AMBER = (1.0, 0.55, 0.08)
VIOLET = (0.55, 0.2, 1.0)
BLUE = (0.1, 0.45, 1.0)
WHITE = (0.9, 0.95, 1.0)
GOLD = (1.0, 0.72, 0.15)

M_METAL_DARK = pbr("metal_dark", (0.018, 0.02, 0.025), metallic=0.9, rough=0.38)
M_METAL_MID = pbr("metal_mid", (0.06, 0.065, 0.075), metallic=0.85, rough=0.45)
M_RUBBER = pbr("rubber", (0.008, 0.008, 0.01), rough=0.7)
M_PAINT_WORN = pbr("paint_worn", (0.22, 0.22, 0.2), rough=0.8)
M_HAZARD = pbr("hazard", (0.55, 0.36, 0.02), rough=0.7)
M_SOIL = pbr("soil", (0.012, 0.01, 0.008), rough=0.95)


def emissive(name, c, s):
    return pbr(name, (0.01, 0.01, 0.01), rough=0.4, emit=c, strength=s)


M_E_CYAN = emissive("e_cyan", CYAN, 14)
M_E_CYAN_SOFT = emissive("e_cyan_soft", (0.0, 0.55, 0.75), 0.55)
M_E_PINK = emissive("e_pink", PINK, 14)
M_E_AMBER = emissive("e_amber", AMBER, 10)


# --- Sol : dalles de béton mouillé ---------------------------------------
def ground_material():
    m, nt, b = new_mat("ground_wet_concrete")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    link(nt, geo.outputs["Position"], sep.inputs[0])
    P = geo.outputs["Position"]
    X, Y = sep.outputs["X"], sep.outputs["Y"]
    SLAB = 5.0
    sx, sy = mth(nt, "DIVIDE", X, SLAB), mth(nt, "DIVIDE", Y, SLAB)
    # Joint : bande étroite au bord de chaque dalle.
    ex = mth(nt, "ABSOLUTE", mth(nt, "SUBTRACT", mth(nt, "FRACT", sx), 0.5))
    ey = mth(nt, "ABSOLUTE", mth(nt, "SUBTRACT", mth(nt, "FRACT", sy), 0.5))
    seam = mth(nt, "GREATER_THAN", mth(nt, "MAXIMUM", ex, ey), 0.4935)
    # Teinte propre à chaque dalle.
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    link(nt, mth(nt, "FLOOR", sx), comb.inputs[0])
    link(nt, mth(nt, "FLOOR", sy), comb.inputs[1])
    wn = nt.nodes.new("ShaderNodeTexWhiteNoise")
    link(nt, comb.outputs[0], wn.inputs["Vector"])
    tint = wn.outputs["Value"]
    # Flaques : grandes taches, bords nets.
    pud = noise(nt, P, 0.13, 3.0, 0.5)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.6
    ramp.color_ramp.elements[1].position = 0.63
    link(nt, pud, ramp.inputs[0])
    wet = ramp.outputs[0]
    stain = noise(nt, P, 0.4, 5.0, 0.6)
    fine = noise(nt, P, 3.2, 6.0, 0.65)
    base = mixc(nt, stain, (0.024, 0.027, 0.034), (0.058, 0.062, 0.072))
    base = mixc(nt, mth(nt, "MULTIPLY", tint, 0.4), base, (0.075, 0.078, 0.086))
    base = mixc(nt, mth(nt, "MULTIPLY", wet, 0.55), base, (0.006, 0.007, 0.01))
    base = mixc(nt, seam, base, (0.003, 0.003, 0.004))
    link(nt, base, b.inputs["Base Color"])
    rough = mth(nt, "ADD", 0.5, mth(nt, "MULTIPLY", fine, 0.22))
    rough = mth(nt, "ADD", mth(nt, "MULTIPLY", rough, mth(nt, "SUBTRACT", 1.0, wet)), mth(nt, "MULTIPLY", wet, 0.035))
    rough = mth(nt, "MAXIMUM", rough, mth(nt, "MULTIPLY", seam, 0.9))
    link(nt, rough, b.inputs["Roughness"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    h = mth(nt, "MULTIPLY", fine, mth(nt, "SUBTRACT", 1.0, wet))
    h = mth(nt, "SUBTRACT", mth(nt, "MULTIPLY", h, 0.03), mth(nt, "MULTIPLY", seam, 0.04))
    link(nt, h, bump.inputs["Height"])
    link(nt, bump.outputs[0], b.inputs["Normal"])
    b.inputs["Specular IOR Level"].default_value = 0.6
    return m


ground = bpy.data.meshes.new("ground")
S = 220
ground.from_pydata([(-S, -S, 0), (S, -S, 0), (S, S, 0), (-S, S, 0)], [], [(0, 1, 2, 3)])
add_obj("Ground", ground, (0, 0, 0), 0, ground_material())

# Repère de vitesse : la grille de 20 u du jeu devient des rails lumineux
# encastrés (canal de métal sombre, filet émissif).
VIEW = Vector((16, -55, 0))
for k in range(-6, 8):
    v = k * 20.0
    for axis in (0, 1):
        L = 200.0
        sx_, sy_ = (L, 0.34) if axis == 0 else (0.34, L)
        loc = (VIEW.x, -v, 0.004) if axis == 0 else (v, VIEW.y, 0.004)
        add_obj("rail", box_mesh("rail", sx_, sy_, 0.012), loc, 0, M_METAL_DARK)
        sx2, sy2 = (L, 0.05) if axis == 0 else (0.05, L)
        add_obj("rail_led", box_mesh("rail_led", sx2, sy2, 0.02), loc, 0, M_E_CYAN_SOFT)


# --- Obélisque : monolithe segmenté, cœur lumineux -----------------------
def obelisk(x, y, color_mat, light_color, h=8.5, lit=True):
    base = G(x, y)
    o = add_obj("ob_plinth", loft("ob_plinth", [ring(1.75, 0, 8, math.pi / 8), ring(1.6, 0.35, 8, math.pi / 8)]), base, 0, M_METAL_MID)
    bevel(o, 0.05)
    def rad(z):
        return 1.2 - 0.5 * (z / h)
    # Cœur émissif visible dans les fentes.
    add_obj("ob_core", loft("ob_core", [ring(rad(0.35) * 0.86, 0.35, 4, math.pi / 4), ring(rad(h) * 0.86, h - 0.3, 4, math.pi / 4)]), base, 0, color_mat)
    z = 0.35
    seg_h = [2.4, 1.9, 1.5, 1.2, 0.9]
    for sh in seg_h:
        z1 = z + sh - 0.11
        s = add_obj("ob_seg", loft("ob_seg", [ring(rad(z), z, 4, math.pi / 4), ring(rad(z1), z1, 4, math.pi / 4)]), base, 0, M_METAL_DARK)
        bevel(s, 0.06, 2)
        z += sh
    tip = add_obj("ob_tip", loft("ob_tip", [ring(rad(z) * 0.9, z, 4, math.pi / 4), ring(0.05, z + 0.9, 4, math.pi / 4)]), base, 0, color_mat)
    # Cercle peint usé au sol : zone de collision lisible.
    add_obj("ob_mark", disc("ob_mark", 2.35, 2.5, 72, 0.006), base, 0, M_PAINT_WORN)
    if lit:
        for (dx, dy) in ((2.0, -2.0), (-2.0, 2.0)):
            point_light("ob_light", base + Vector((dx, dy, 2.6)), light_color, 900, 0.5)
        point_light("ob_top", base + Vector((0, 0, h + 1.2)), light_color, 500, 0.4, shadow=False)


# Anneau intérieur réel (generateObelisks(8, 40, 0.3)).
inner = []
for i in range(8):
    a = i / 8 * math.tau + 0.3
    r = 40 + math.sin(i * 1.7) * 6
    inner.append((math.cos(a) * r, math.sin(a) * r))
for i, (x, y) in enumerate(inner):
    near = (Vector((x, -y, 0)) - VIEW).length < 45
    obelisk(x, y, M_E_CYAN, CYAN, lit=near)


# --- Racks serveur -------------------------------------------------------
def led_panel_material():
    m, nt, b = new_mat("led_panel")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    link(nt, tc.outputs["Generated"], sep.inputs[0])
    u = mth(nt, "MULTIPLY", sep.outputs["X"], 22.0)
    v = mth(nt, "MULTIPLY", sep.outputs["Z"], 30.0)
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    link(nt, mth(nt, "FLOOR", u), comb.inputs[0])
    link(nt, mth(nt, "FLOOR", v), comb.inputs[1])
    wn = nt.nodes.new("ShaderNodeTexWhiteNoise")
    link(nt, comb.outputs[0], wn.inputs["Vector"])
    rnd = wn.outputs["Value"]
    du = mth(nt, "LESS_THAN", mth(nt, "ABSOLUTE", mth(nt, "SUBTRACT", mth(nt, "FRACT", u), 0.5)), 0.3)
    dv = mth(nt, "LESS_THAN", mth(nt, "ABSOLUTE", mth(nt, "SUBTRACT", mth(nt, "FRACT", v), 0.5)), 0.18)
    on = mth(nt, "GREATER_THAN", rnd, 0.62)
    mask = mth(nt, "MULTIPLY", mth(nt, "MULTIPLY", du, dv), on)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.0, (*CYAN, 1)
    e[1].position, e[1].color = 0.84, (*PINK, 1)
    n3 = e.new(0.94)
    n3.color = (*AMBER, 1)
    link(nt, rnd, ramp.inputs[0])
    link(nt, ramp.outputs[0], b.inputs["Emission Color"])
    link(nt, mth(nt, "MULTIPLY", mask, 9.0), b.inputs["Emission Strength"])
    b.inputs["Base Color"].default_value = (0.004, 0.004, 0.005, 1)
    b.inputs["Roughness"].default_value = 0.25
    return m


M_LED = led_panel_material()


def rack(x, y):
    base = G(x, y)
    W, D, H = 2.7, 1.45, 3.5
    body = add_obj("rack_body", box_mesh("rack_body", W, D, H), base, 0, M_METAL_DARK)
    bevel(body, 0.05)
    add_obj("rack_foot", box_mesh("rack_foot", W + 0.12, D + 0.12, 0.14), base, 0, M_METAL_MID)
    add_obj("rack_cap", box_mesh("rack_cap", W + 0.08, D + 0.08, 0.1), base + Vector((0, 0, H)), 0, M_METAL_MID)
    # Façades à LED, avant (sud, vers la caméra) et arrière.
    for sgn in (-1, 1):
        me = bpy.data.meshes.new("rack_led")
        hw = W / 2 - 0.16
        yy = sgn * (D / 2 + 0.006)
        me.from_pydata([(-hw, yy, 0.3), (hw, yy, 0.3), (hw, yy, H - 0.25), (-hw, yy, H - 0.25)], [], [(0, 1, 2, 3)])
        me.update()
        add_obj("rack_led", me, base, 0, M_LED)
    # Liseré rose en tête : repère de couleur de la structure.
    add_obj("rack_strip", box_mesh("rack_strip", W + 0.1, D + 0.1, 0.05), base + Vector((0, 0, H - 0.12)), 0, M_E_PINK)
    for sx_ in (-1, 1):
        add_obj("rack_edge", box_mesh("rack_edge", 0.05, 0.05, H - 0.5), base + Vector((sx_ * (W / 2 + 0.01), -(D / 2 + 0.01), 0.2)), 0, M_E_CYAN)
    # Lames d'aération sur le dessus.
    for k in range(7):
        add_obj("rack_vent", box_mesh("rack_vent", W - 0.5, 0.07, 0.06), base + Vector((0, -0.48 + k * 0.16, H + 0.1)), 0, M_METAL_DARK)


for rx in (-2.5, 2.5):
    rack(rx, 62)
point_light("rack_light", G(0, 62, 2.2), PINK, 1100, 0.4)
point_light("rack_light_s", G(0, 64.6, 1.6), PINK, 500, 0.4)
point_light("rack_light_n", G(0, 59.4, 1.6), CYAN, 350, 0.4)

# Zébra de sécurité peint devant les racks (au sol, sans relief).
for k in range(18):
    me = bpy.data.meshes.new("zebra")
    x0 = -4.4 + k * 0.5
    y0, y1 = -64.9, -64.3
    me.from_pydata([(x0, y0, 0.005), (x0 + 0.25, y0, 0.005), (x0 + 0.55, y1, 0.005), (x0 + 0.3, y1, 0.005)], [], [(0, 1, 2, 3)])
    me.update()
    add_obj("zebra", me, (0, 0, 0), 0, M_HAZARD)


# --- Buisson : massif de roseaux bioluminescents -------------------------
def foliage_material():
    m, nt, b = new_mat("reeds")
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "Col"
    link(nt, at.outputs["Color"], b.inputs["Base Color"])
    tip = at.outputs["Alpha"]
    b.inputs["Roughness"].default_value = 0.5
    b.inputs["Subsurface Weight"].default_value = 0.25
    b.inputs["Emission Color"].default_value = (0.05, 1.0, 0.75, 1)
    link(nt, mth(nt, "MULTIPLY", mth(nt, "POWER", tip, 5.0), 0.5), b.inputs["Emission Strength"])
    return m


M_REEDS = foliage_material()


def bush(x, y, radius):
    base = G(x, y)
    add_obj("bush_soil", disc("bush_soil", 0, radius, 64, 0.01), base, 0, M_SOIL)
    rim = add_obj("bush_rim", loft("bush_rim", [ring(radius + 0.22, 0, 64), ring(radius + 0.18, 0.12, 64), ring(radius, 0.12, 64), ring(radius - 0.02, 0, 64)], cap=False), base, 0, M_METAL_MID)
    n_blades = int(1500 * radius)
    LV = 6
    verts = np.zeros((n_blades * LV * 2, 3), dtype=np.float32)
    cols = np.zeros((n_blades * LV * 2, 4), dtype=np.float32)
    faces = []
    for k in range(n_blades):
        rr = radius * math.sqrt(random.random()) * 0.97
        a = random.random() * math.tau
        px, py = math.cos(a) * rr, math.sin(a) * rr
        edge = rr / radius
        hgt = (2.9 - 1.3 * edge ** 2) * random.uniform(0.6, 1.0)
        yaw = random.random() * math.tau
        lean_dir = random.random() * math.tau
        lean = random.uniform(0.15, 0.75) * hgt * (0.5 + edge * 0.6)
        w = random.uniform(0.05, 0.11)
        shade = random.uniform(0.7, 1.15)
        hue = random.random()
        for j in range(LV):
            t = j / (LV - 1)
            cx = px + math.cos(lean_dir) * lean * t * t
            cy = py + math.sin(lean_dir) * lean * t * t
            cz = hgt * t * (1 - 0.18 * t)
            ww = w * (1 - t) ** 0.7 + 0.004
            ox, oy = math.cos(yaw) * ww, math.sin(yaw) * ww
            i0 = (k * LV + j) * 2
            verts[i0] = (cx - ox, cy - oy, cz)
            verts[i0 + 1] = (cx + ox, cy + oy, cz)
            g = (0.003 + 0.04 * t ** 1.6) * shade
            c = (g * (0.25 + 0.2 * hue), g * 1.0, g * (0.5 + 0.5 * hue), t)
            cols[i0] = c
            cols[i0 + 1] = c
            if j < LV - 1:
                faces.append((i0, i0 + 1, i0 + 3, i0 + 2))
    me = bpy.data.meshes.new("reeds")
    me.from_pydata(verts.tolist(), [], faces)
    me.update()
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", cols.ravel())
    add_obj("bush_reeds", me, base, 0, M_REEDS, smooth=True)
    m_seed = emissive("e_seed", (0.2, 1.0, 0.7), 9)
    for k in range(int(9 * radius)):
        rr = radius * math.sqrt(random.random()) * 0.8
        a = random.random() * math.tau
        hh = random.uniform(2.9, 3.9)
        px, py = math.cos(a) * rr, math.sin(a) * rr
        add_obj("stalk", loft("stalk", [ring(0.02, 0, 4), ring(0.012, hh, 4)]), base + Vector((px, py, 0)), 0, M_SOIL)
        add_obj("seed", loft("seed", [ring(0.01, hh - 0.09, 6), ring(0.075, hh, 6), ring(0.01, hh + 0.12, 6)]), base + Vector((px, py, 0)), 0, m_seed)
    point_light("bush_glow", base + Vector((0, 0, 3.6)), (0.1, 1.0, 0.7), 320, 1.2, shadow=False)


bush(28, 62, 4.5)
bush(-28, 62, 4.5)


# --- Pad à drone ---------------------------------------------------------
def pad(x, y):
    base = G(x, y)
    p = add_obj("pad", loft("pad", [ring(3.1, 0, 48), ring(3.0, 0.07, 48)]), base, 0, M_METAL_MID)
    add_obj("pad_ring", disc("pad_ring", 2.45, 2.6, 72, 0.076), base, 0, M_E_CYAN)
    add_obj("pad_ring2", disc("pad_ring2", 0.9, 0.98, 48, 0.076), base, 0, M_E_CYAN)
    for i in range(4):
        a = i / 4 * math.tau + math.pi / 4
        add_obj("pad_tick", box_mesh("pad_tick", 0.9, 0.1, 0.08), base + Vector((math.cos(a) * 1.75, math.sin(a) * 1.75, 0)), a, M_PAINT_WORN)
    # Drone en vol stationnaire.
    d = base + Vector((0, 0, 3.6))
    body = add_obj("drone", loft("drone", [ring(0.1, -0.16, 12), ring(0.5, -0.05, 12), ring(0.55, 0.06, 12), ring(0.2, 0.2, 12)]), d, 0, M_METAL_DARK, smooth=True)
    for i in range(4):
        a = i / 4 * math.tau + math.pi / 4
        arm = d + Vector((math.cos(a) * 0.85, math.sin(a) * 0.85, 0.05))
        add_obj("drone_arm", box_mesh("drone_arm", 0.9, 0.07, 0.05), d + Vector((math.cos(a) * 0.45, math.sin(a) * 0.45, 0.02)), a, M_METAL_MID)
        torus("drone_rotor", 0.3, 0.025, arm, M_METAL_MID, 24, 6)
    add_obj("drone_eye", disc("drone_eye", 0, 0.14, 16, -0.165), d, 0, M_E_CYAN)
    point_light("pad_light", base + Vector((0, 0, 1.2)), CYAN, 420, 0.6, shadow=False)
    spot = bpy.data.lights.new("drone_spot", "SPOT")
    spot.color = CYAN
    spot.energy = 2500
    spot.spot_size = math.radians(38)
    spot.spot_blend = 0.4
    so = bpy.data.objects.new("drone_spot", spot)
    so.location = d + Vector((0, 0, -0.2))
    col.objects.link(so)


pad(30, 45)


# --- Lames ---------------------------------------------------------------
def blade_mesh(scale=1.0):
    """Dague : pointe vers +x, plate dans le plan du sol."""
    def dia(x, hw, ht):
        return [(x, -hw, 0), (x, 0, -ht), (x, hw, 0), (x, 0, ht)]
    s = scale
    rings_ = [dia(0.2 * s, 0.035 * s, 0.03 * s), dia(0.26 * s, 0.11 * s, 0.03 * s), dia(0.85 * s, 0.085 * s, 0.022 * s), dia(1.25 * s, 0.002, 0.002)]
    return loft("blade", rings_)


def steel(name, glow, strength):
    m, nt, b = new_mat(name)
    b.inputs["Base Color"].default_value = (0.75, 0.78, 0.82, 1)
    b.inputs["Metallic"].default_value = 1.0
    b.inputs["Roughness"].default_value = 0.2
    b.inputs["Emission Color"].default_value = (*glow, 1)
    b.inputs["Emission Strength"].default_value = strength
    return m


RARITY = {
    "common": steel("steel_common", WHITE, 2.2),
    "rare": steel("steel_rare", BLUE, 5.0),
    "epic": steel("steel_epic", VIOLET, 5.5),
    "legendary": steel("steel_legendary", GOLD, 6.0),
}
M_GRIP = pbr("grip", (0.02, 0.015, 0.012), rough=0.6)
M_GUARD = pbr("guard", (0.3, 0.25, 0.15), metallic=1.0, rough=0.3)


def blade(loc, angle, rarity="common", scale=1.0, tilt=0.0):
    o = add_obj("blade", blade_mesh(scale), loc, angle, RARITY[rarity])
    o.rotation_euler = (tilt, 0, angle)
    g = add_obj("blade_guard", box_mesh("g", 0.06 * scale, 0.34 * scale, 0.07 * scale), loc, angle, M_GUARD)
    g.location = loc + Vector((math.cos(angle) * 0.2 * scale, math.sin(angle) * 0.2 * scale, -0.035 * scale))
    h = add_obj("blade_grip", loft("grip", [ring(0.035 * scale, 0, 8), ring(0.035 * scale, 0.34 * scale, 8)]), loc, 0, M_GRIP)
    h.rotation_euler = (0, math.pi / 2, angle)
    h.location = loc + Vector((-math.cos(angle) * 0.14 * scale, -math.sin(angle) * 0.14 * scale, 0))


# --- Joueur --------------------------------------------------------------
def player(x, y, armor, accent, accent_mat, blades, face=0.0):
    base = G(x, y)
    m_armor = pbr("armor", armor, metallic=0.75, rough=0.32, coat=0.4)
    m_under = pbr("undersuit", (0.012, 0.013, 0.016), rough=0.55)
    SXY, SZ = 1.7, 1.2

    def part(name, rings_, mat, off=(0, 0, 0)):
        o = add_obj(name, loft(name, rings_), base + Vector((off[0] * SXY, off[1] * SXY, off[2])), face, mat, smooth=True)
        o.scale = (SXY, SXY, SZ)
        s = o.modifiers.new("sub", "SUBSURF")
        s.levels = 2
        s.render_levels = 2
        return o

    # Jambes, bassin, torse, épaules, bras, tête : volumes simples lissés.
    for sx in (-0.17, 0.17):
        part("leg", [ring(0.1, 0.0, 8), ring(0.13, 0.06, 8), ring(0.12, 0.4, 8), ring(0.15, 0.75, 8)], m_under, (sx * math.cos(face), sx * math.sin(face), 0))
        part("boot", [ring(0.15, 0.0, 8, 0, 1.0, 1.25), ring(0.16, 0.14, 8, 0, 1.0, 1.2), ring(0.12, 0.3, 8)], m_armor, (sx * math.cos(face), sx * math.sin(face), 0))
    part("hips", [ring(0.26, 0.68, 10, 0, 1.0, 0.72), ring(0.3, 0.86, 10, 0, 1.0, 0.72), ring(0.24, 1.0, 10, 0, 1.0, 0.7)], m_under)
    part("torso", [ring(0.24, 0.95, 10, 0, 1.0, 0.7), ring(0.4, 1.3, 10, 0, 1.0, 0.68), ring(0.42, 1.5, 10, 0, 1.0, 0.66), ring(0.2, 1.62, 10, 0, 1.0, 0.7)], m_armor)
    for sx in (-0.5, 0.5):
        off = (sx * math.cos(face), sx * math.sin(face), 0)
        part("shoulder", [ring(0.08, 1.36, 8), ring(0.2, 1.44, 8), ring(0.2, 1.58, 8), ring(0.08, 1.66, 8)], m_armor, off)
        part("arm", [ring(0.09, 0.82, 8), ring(0.11, 0.95, 8), ring(0.1, 1.4, 8)], m_under, (off[0] * 1.08, off[1] * 1.08, 0))
    part("head", [ring(0.1, 1.62, 10), ring(0.2, 1.7, 10), ring(0.215, 1.86, 10), ring(0.17, 2.0, 10), ring(0.06, 2.06, 10)], m_armor)
    # Visière émissive, tournée vers `face - 90°` (l'avant du personnage).
    fx, fy = math.sin(face), -math.cos(face)
    v = add_obj("visor", box_mesh("visor", 0.42, 0.07, 0.1), base + Vector((fx * 0.19 * SXY, fy * 0.19 * SXY, 1.8 * SZ - 0.02)), face, accent_mat)
    # Anneau au sol : couleur du joueur (repère existant du jeu).
    torus("ring", 1.15, 0.05, base + Vector((0, 0, 0.05)), accent_mat, 64, 8)
    point_light("p_light", base + Vector((0, 0, 0.5)), accent, 160, 0.9, shadow=False)
    # Orbites.
    for (count, radius, phase, rarities) in blades:
        for i in range(count):
            a = phase + i / count * math.tau
            loc = base + Vector((math.cos(a) * (radius + 0.3), math.sin(a) * (radius + 0.3), 1.1))
            blade(loc, a, rarities[i % len(rarities)], 1.0)


player(16, 55, (0.05, 0.16, 0.5), CYAN, M_E_CYAN, [(7, 1.8, 0.3, ["common", "common", "rare"])], face=0.5)
player(8.5, 47.5, (0.5, 0.04, 0.16), PINK, M_E_PINK,
       [(8, 1.8, 0.1, ["common", "rare", "common", "epic"]), (12, 2.9, 0.4, ["common", "common", "rare", "common", "epic", "legendary"])], face=2.4)

# Lames au sol (butin).
for (lx, ly, rar) in [(21, 52, "common"), (12.5, 59, "common"), (24, 49.5, "rare"), (19, 60.5, "common"), (10, 54, "epic"),
                      (26, 55.5, "common"), (14, 44, "common"), (5, 56, "rare"), (20.5, 46, "legendary"), (2, 51, "common")]:
    blade(G(lx, ly, 0.05), random.random() * math.tau, rar, 0.9)


# --- Caisse --------------------------------------------------------------
def crate(x, y):
    base = G(x, y)
    b = add_obj("crate", box_mesh("crate", 1.5, 1.5, 1.3), base, 0.35, pbr("crate_body", (0.035, 0.04, 0.05), metallic=0.6, rough=0.5))
    bevel(b, 0.07)
    for (sx, sy) in ((0.75, 0.75), (-0.75, 0.75), (0.75, -0.75), (-0.75, -0.75)):
        c, s = math.cos(0.35), math.sin(0.35)
        p = base + Vector((sx * c - sy * s, sx * s + sy * c, 0))
        add_obj("crate_post", box_mesh("crate_post", 0.16, 0.16, 1.36), p, 0.35, M_METAL_MID)
    add_obj("crate_band", box_mesh("crate_band", 1.54, 1.54, 0.09), base + Vector((0, 0, 0.6)), 0.35, M_E_AMBER)
    add_obj("crate_lid", box_mesh("crate_lid", 0.5, 0.5, 0.03), base + Vector((0, 0, 1.3)), 0.35 + math.pi / 4, M_E_AMBER)
    point_light("crate_light", base + Vector((0, 0, 1.9)), AMBER, 260, 0.5, shadow=False)


crate(23, 58.5)

# Câbles au sol entre les racks et l'obélisque (habillage).
def cable(points, r=0.045):
    cu = bpy.data.curves.new("cable", "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("NURBS")
    sp.points.add(len(points) - 1)
    for p, (x, y) in zip(sp.points, points):
        v = G(x, y, r)
        p.co = (v.x, v.y, v.z, 1)
    sp.use_endpoint_u = True
    sp.order_u = 4
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    o = bpy.data.objects.new("cable", cu)
    cu.materials.append(M_RUBBER)
    col.objects.link(o)


cable([(4.0, 61.3), (7, 60), (9, 55), (13, 49), (17, 44), (20.3, 41.6)])
cable([(4.0, 62.2), (8, 62.5), (12, 60), (15, 50), (18.5, 45), (20.6, 42.2)], 0.035)

# --- Habillage du sol (à plat : aucune collision suggérée) ---------------
def ground_text(txt, x, y, size, rot, mat):
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = txt
    cu.size = size
    cu.align_x = "CENTER"
    o = bpy.data.objects.new("txt", cu)
    o.location = G(x, y, 0.006)
    o.rotation_euler = (0, 0, rot)
    cu.materials.append(mat)
    col.objects.link(o)


ground_text("SECTEUR 04", 13.5, 63.5, 1.5, math.radians(45), M_PAINT_WORN)
ground_text("07", 27, 50.5, 2.4, math.radians(45), M_PAINT_WORN)

M_PLATE = pbr("plate", (0.05, 0.055, 0.065), metallic=0.9, rough=0.42)
M_GRATE = pbr("grate", (0.01, 0.011, 0.013), metallic=0.8, rough=0.5)
# Passerelle de plaques d'acier vers le pad.
for k in range(6):
    pl = add_obj("plate", box_mesh("plate", 2.4, 2.4, 0.03), G(20 + k * 0.0, 51.5, 0), 0, M_PLATE)
    pl.location = G(22.5 + k * 1.25, 50.5 - k * 0.92, 0)
    pl.rotation_euler = (0, 0, math.radians(36))
    bevel(pl, 0.01, 1)
# Grilles d'évacuation, avec leur lueur.
for (gx, gy) in ((11, 51), (19, 63), (6.5, 57.5)):
    add_obj("grate_frame", box_mesh("grate_frame", 1.7, 1.0, 0.02), G(gx, gy, 0), 0, M_METAL_MID)
    for k in range(9):
        add_obj("grate_bar", box_mesh("grate_bar", 0.07, 0.86, 0.035), G(gx - 0.7 + k * 0.175, gy, 0), 0, M_GRATE)
    add_obj("grate_glow", box_mesh("grate_glow", 1.5, 0.8, 0.012), G(gx, gy, 0), 0, emissive("e_grate", AMBER, 1.6))
# Chevrons peints vers le passage des racks.
for k in range(4):
    for sgn in (-1, 1):
        me = bpy.data.meshes.new("chev")
        y0 = -(66.2 + k * 0.9)
        me.from_pydata([(0, y0 + 0.5, 0.005), (sgn * 0.9, y0, 0.005), (sgn * 0.9, y0 - 0.3, 0.005), (0, y0 + 0.2, 0.005)], [], [(0, 1, 2, 3)])
        me.update()
        add_obj("chev", me, (0, 0, 0), 0, M_PAINT_WORN)

# --- Lumière et ambiance -------------------------------------------------
sun = bpy.data.lights.new("moon", "SUN")
sun.color = (0.55, 0.68, 1.0)
sun.energy = 0.85
sun.angle = math.radians(4)
so = bpy.data.objects.new("moon", sun)
so.rotation_euler = (math.radians(52), 0, math.radians(-125))
col.objects.link(so)

world = bpy.data.worlds.new("night")
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.05, 0.075, 0.16, 1)
bg.inputs[1].default_value = 1.0
scene.world = world
# Brume : un volume borné (le volume du monde, infini, éteignait la lune).
mv = bpy.data.materials.new("haze")
mv.use_nodes = True
for n in list(mv.node_tree.nodes):
    if n.type != "OUTPUT_MATERIAL":
        mv.node_tree.nodes.remove(n)
vs_ = mv.node_tree.nodes.new("ShaderNodeVolumeScatter")
vs_.inputs["Color"].default_value = (0.6, 0.75, 1.0, 1)
vs_.inputs["Density"].default_value = 0.0045
mv.node_tree.links.new(vs_.outputs[0], [n for n in mv.node_tree.nodes if n.type == "OUTPUT_MATERIAL"][0].inputs["Volume"])
hz = add_obj("haze", box_mesh("haze", 160, 160, 16), (VIEW.x, VIEW.y, 0), 0, mv)

# --- Rendu ---------------------------------------------------------------
scene.render.engine = "BLENDER_EEVEE"
ee = scene.eevee
ee.taa_render_samples = 96
ee.use_raytracing = True
ee.ray_tracing_method = "SCREEN"
ee.ray_tracing_options.resolution_scale = "1"
ee.ray_tracing_options.trace_max_roughness = 0.5
ee.use_shadows = True
ee.volumetric_tile_size = "4"
ee.volumetric_samples = 96
ee.volumetric_end = 160
ee.use_volumetric_shadows = True
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = 0.9

# Bloom en composition (EEVEE n'en a plus en propre).
try:
    ng = bpy.data.node_groups.new("Comp", "CompositorNodeTree")
    ng.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    rl = ng.nodes.new("CompositorNodeRLayers")
    gl = ng.nodes.new("CompositorNodeGlare")
    out = ng.nodes.new("NodeGroupOutput")
    gl.inputs["Type"].default_value = "Bloom"
    gl.inputs["Threshold"].default_value = 1.2
    gl.inputs["Strength"].default_value = 0.55
    gl.inputs["Size"].default_value = 0.6
    ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
    ng.links.new(gl.outputs["Image"], out.inputs[0])
    scene.compositing_node_group = ng
except Exception as e:
    print("COMPOSITOR SKIPPED:", e)


def camera(name, pos, target, ortho=None, fov_y=None):
    cd = bpy.data.cameras.new(name)
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho
    else:
        cd.sensor_fit = "VERTICAL"
        cd.angle_y = math.radians(fov_y)
    cd.clip_start = 0.5
    cd.clip_end = 600
    o = bpy.data.objects.new(name, cd)
    o.location = pos
    o.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
    col.objects.link(o)
    return o


T = VIEW + Vector((0, 0, 0.5))
# Vue isométrique proposée : orthographique, lacet 45°, 45° au-dessus du sol.
el, yaw, D = math.radians(45), math.radians(45), 120
cam_iso = camera("cam_iso", T + Vector((math.sin(yaw) * math.cos(el), -math.cos(yaw) * math.cos(el), math.sin(el))) * D, T, ortho=46)
# Caméra actuelle du jeu (shared/src/constants.ts) : 54°, 27 u, champ 55°.
p = math.radians(54)
cam_game = camera("cam_game", T + Vector((0, -math.cos(p), math.sin(p))) * 27, T, fov_y=55)

bpy.ops.wm.save_as_mainfile(filepath=OUT + r"\concept_neon.blend")
import sys
which = [a for a in sys.argv if a.startswith("--only=")]
for cam, fname in ((cam_iso, "concept_neon_iso.png"), (cam_game, "concept_neon_camera_actuelle.png")):
    if which and which[0].split("=")[1] not in fname:
        continue
    scene.camera = cam
    scene.render.filepath = OUT + "\\" + fname
    bpy.ops.render.render(write_still=True)
    print("RENDERED", fname)
