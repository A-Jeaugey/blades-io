# Personnages du kit (rendu v2), ajoutés par build_kit.py (exec, avant
# l'export) : une tête par skin, et des torses, bras et jambes par famille
# de tenue (armure, combinaison, veste, robe, bête, robot, roche…).
#
# Mêmes centres que les capsules d'origine (PlayerView.ts) : torse à
# y = 0,95, tête à 1,55, bras à ±0,38 / 1,05, jambes à ±0,14 / 0,35. Le
# client les anime autour de la hanche et de l'épaule. Repère Blender : z en
# haut, avant du personnage vers -y. Bras et jambe : le côté DROIT (extérieur
# vers +x) ; le gauche est le même, retourné par le client.
#
# Aucune couleur ici, comme le reste du kit. Un seul matériau (« skin »), et
# une couleur par sommet qui ne dit que la MATIÈRE de la face :
#   a  (0,0,0)  principale        b  (1,0,0)  secondaire
#   c  (0,0,1)  garniture         d  (1,0,1)  peau, étoffe claire, détail
#   g  (0,1,0)  lumineuse (visière, yeux, liserés)
# Le client donne à chaque matière la couleur, le métal et le poli du skin
# équipé (client/src/cosmetics/looks.ts) : un personnage reste un seul
# maillage par pièce, donc autant d'appels de rendu qu'avant.
#
# Rien ne descend autour des pieds ni ne s'étale au-delà de 0,45 u de l'axe
# sous la taille : l'anneau au sol (0,55 à 0,72 u) doit rester visible.

SK = {"a": (0, 0, 0, 1), "b": (1, 0, 0, 1), "c": (0, 0, 1, 1), "d": (1, 0, 1, 1), "g": (0, 1, 0, 1)}
HALF = math.pi / 2


def rot(rx=0.0, ry=0.0, rz=0.0):
    return Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X")


MIRROR = Matrix.Scale(-1, 4, (1, 0, 0))


def R(r, z, n=12, sy=1.0, cy=0.0, sx=1.0, cx=0.0):
    return ring(r, z, n, 0.0, sx, sy, cx, cy)


class Body:
    """Une pièce de personnage : un maillage, une matière par face."""

    def __init__(self, name, sharp=38.0):
        self.name = name
        self.sharp = sharp
        self.bm = bmesh.new()
        self.bm.loops.layers.float_color.new("Color")

    def add(self, verts, faces, r, loc=(0, 0, 0), tf=None, bevel=0.0):
        tmp = bmesh.new()
        layer = tmp.loops.layers.float_color.new("Color")
        bv = [tmp.verts.new(v) for v in verts]
        for f in faces:
            try:
                tmp.faces.new([bv[i] for i in f])
            except ValueError:
                continue
        if bevel > 0:
            bmesh.ops.bevel(tmp, geom=tmp.edges[:], offset=bevel, segments=1, affect="EDGES", profile=0.5)
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        mtx = Matrix.Translation(loc) @ (tf if tf is not None else Matrix.Identity(4))
        bmesh.ops.transform(tmp, matrix=mtx, verts=tmp.verts[:])
        # Un miroir retourne les faces : remises à l'endroit.
        if mtx.determinant() < 0:
            bmesh.ops.reverse_faces(tmp, faces=tmp.faces[:])
        c = SK[r]
        for face in tmp.faces:
            face.smooth = True
            for loop in face.loops:
                loop[layer] = c
        me = bpy.data.meshes.new("tmp")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def loft(self, rings, r, cap=True, **kw):
        n = len(rings[0])
        verts = [v for rg in rings for v in rg]
        faces = []
        for k in range(len(rings) - 1):
            for i in range(n):
                a, b = k * n + i, k * n + (i + 1) % n
                faces.append((a, b, b + n, a + n))
        if cap:
            faces.append(tuple(reversed(range(n))))
            faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
        self.add(verts, faces, r, **kw)

    def ell(self, rx, ry, rz, r, loc=(0, 0, 0), n=12, m=7, lat0=-90.0, lat1=90.0, jit=0.0, seed=1, **kw):
        """Ellipsoïde, entier ou tranche de latitudes (fermée à plat). jit :
        irrégularité du rayon (roche)."""
        rng = random.Random(seed)
        verts, rows = [], []
        for j in range(m + 1):
            la = lat0 + (lat1 - lat0) * j / m
            a = math.radians(la)
            if abs(abs(la) - 90.0) < 1e-6:
                rows.append([len(verts)])
                verts.append((0.0, 0.0, math.sin(a) * rz * (1 + rng.uniform(-jit, jit))))
                continue
            row = []
            for i in range(n):
                t = i / n * math.tau
                k = 1 + rng.uniform(-jit, jit)
                row.append(len(verts))
                verts.append((math.cos(t) * math.cos(a) * rx * k, math.sin(t) * math.cos(a) * ry * k, math.sin(a) * rz * k))
            rows.append(row)
        faces = []
        for j in range(m):
            A, B = rows[j], rows[j + 1]
            for i in range(n):
                i2 = (i + 1) % n
                if len(A) == 1 and len(B) == 1:
                    continue
                if len(A) == 1:
                    faces.append((A[0], B[i], B[i2]))
                elif len(B) == 1:
                    faces.append((A[i], A[i2], B[0]))
                else:
                    faces.append((A[i], A[i2], B[i2], B[i]))
        if len(rows[0]) > 1:
            faces.append(tuple(reversed(rows[0])))
        if len(rows[-1]) > 1:
            faces.append(tuple(rows[-1]))
        self.add(verts, faces, r, loc=loc, **kw)

    def box(self, sx, sy, sz, r, loc=(0, 0, 0), **kw):
        """Boîte centrée en `loc`."""
        hx, hy, hz = sx / 2, sy / 2, sz / 2
        self.loft([[(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz)],
                   [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]], r, loc=loc, **kw)

    def cyl(self, r0, r1, h, r, loc=(0, 0, 0), n=10, **kw):
        """Cylindre ou cône le long de z, centré en `loc` (r0 en bas)."""
        self.loft([ring(max(r0, 0.003), -h / 2, n), ring(max(r1, 0.003), h / 2, n)], r, loc=loc, **kw)

    def torus(self, RR, rr, r, loc=(0, 0, 0), n=16, m=6, **kw):
        verts, faces = [], []
        for i in range(n):
            a = i / n * math.tau
            for j in range(m):
                q = RR + math.cos(j / m * math.tau) * rr
                verts.append((math.cos(a) * q, math.sin(a) * q, math.sin(j / m * math.tau) * rr))
        for i in range(n):
            for j in range(m):
                faces.append((i * m + j, ((i + 1) % n) * m + j, ((i + 1) % n) * m + (j + 1) % m, i * m + (j + 1) % m))
        self.add(verts, faces, r, loc=loc, **kw)

    def band(self, prof, a0, a1, r, t=0.02, n=8, sy=1.0, **kw):
        """Plaque courbe qui épouse un profil : prof = [(rayon, z), ...] de bas
        en haut, entre les angles a0 et a1 (degrés ; 0 = l'avant, 90 = la
        droite, 180 = le dos), d'épaisseur t vers l'extérieur. Un tour complet
        (360°) se referme."""
        full = abs((a1 - a0) - 360.0) < 1e-6
        cols = n if full else n + 1
        rows = len(prof)
        verts = []
        for k in range(cols):
            a = math.radians(a0 + (a1 - a0) * k / n)
            dx, dy = math.sin(a), -math.cos(a) * sy
            for (rad, z) in prof:
                verts.append((dx * rad, dy * rad, z))
                verts.append((dx * (rad + t), dy * (rad + t), z))
        idx = lambda k, j, o: (k % cols) * rows * 2 + j * 2 + o
        faces = []
        for k in range(cols if full else cols - 1):
            for j in range(rows - 1):
                faces.append((idx(k, j, 1), idx(k + 1, j, 1), idx(k + 1, j + 1, 1), idx(k, j + 1, 1)))
                faces.append((idx(k, j, 0), idx(k, j + 1, 0), idx(k + 1, j + 1, 0), idx(k + 1, j, 0)))
            faces.append((idx(k, 0, 0), idx(k + 1, 0, 0), idx(k + 1, 0, 1), idx(k, 0, 1)))
            faces.append((idx(k, rows - 1, 0), idx(k, rows - 1, 1), idx(k + 1, rows - 1, 1), idx(k + 1, rows - 1, 0)))
        if not full:
            for k in (0, cols - 1):
                for j in range(rows - 1):
                    faces.append((idx(k, j, 0), idx(k, j, 1), idx(k, j + 1, 1), idx(k, j + 1, 0)))
        self.add(verts, faces, r, **kw)

    def shell(self, r, z0, z1, a0, a1, t=0.015, rx=0.255, rz=0.27, sy=1.04, steps=3, n=10, off=0.004):
        """Plaque qui épouse un crâne (ellipsoïde rx, rz) entre deux hauteurs."""
        prof = []
        for k in range(steps + 1):
            z = z0 + (z1 - z0) * k / steps
            prof.append((max(0.02, rx * math.sqrt(max(0.0, 1 - (z / rz) ** 2)) - off), z))
        self.band(prof, a0, a1, r, t=t, n=n, sy=sy)

    def spike(self, r, a_deg, rad, z, length, base, tilt=110.0, sy=1.0, n=5):
        """Pointe autour de l'axe, à l'angle a (comme band), qui part vers
        l'extérieur ; tilt : 0 vers le haut, 90 à l'horizontale, 180 en bas."""
        a = math.radians(a_deg)
        self.cyl(base, 0.0, length, r, loc=(math.sin(a) * rad, -math.cos(a) * rad * sy, z), n=n, tf=rot(rx=math.radians(tilt), rz=a))

    def finish(self):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        me.materials.append(role("skin"))
        ca = me.color_attributes["Color"]
        me.color_attributes.active_color = ca
        me.color_attributes.render_color_index = 0
        # Lisse, sauf aux arêtes franches (bord d'une plaque, d'une boîte).
        me.set_sharp_from_angle(angle=math.radians(self.sharp))
        me.update()
        o = bpy.data.objects.new(self.name, me)
        col.objects.link(o)
        return o


def both(fn):
    """Une fois de chaque côté (s = 1 : la droite)."""
    fn(1)
    fn(-1)


# =====================================================================
# Bras (centre du bras ; épaule en haut à z = 0,28, main à z = -0,3)
# =====================================================================
def arm_core(b, up, low, r_up=0.1, r_low=0.085):
    b.loft([R(0.06, 0.35, 10), R(r_up, 0.28, 10), R(r_up * 0.95, 0.06, 10), R(r_up * 0.8, -0.01, 10)], up)
    b.loft([R(r_low * 0.9, 0.01, 10), R(r_low, -0.06, 10), R(r_low * 0.84, -0.25, 10)], low)


def fist(b, r, size=0.085):
    b.ell(size, size * 1.08, size * 1.05, r, loc=(0, -0.01, -0.3), n=10, m=6)


# Armure : épaulière, coudière, canon d'avant-bras et son liseré, gantelet.
b = Body("SkArmArmor")
arm_core(b, "c", "c")
b.ell(0.14, 0.145, 0.115, "a", loc=(0.025, 0, 0.255), n=12, m=6)
b.ell(0.105, 0.11, 0.05, "b", loc=(0.02, 0, 0.17), n=10, m=4)
b.ell(0.07, 0.08, 0.07, "b", loc=(0, 0.045, 0.02), n=8, m=5)
b.loft([R(0.108, -0.04, 10), R(0.1, -0.21, 10)], "a")
b.box(0.018, 0.06, 0.13, "g", loc=(0.102, 0, -0.125), bevel=0.006)
b.band([(0.098, -0.235), (0.1, -0.205)], 0, 360, "b", t=0.012, n=10)
fist(b, "c")
b.finish()

# Combinaison : boudins, bagues aux articulations, écusson, gros gant.
b = Body("SkArmSuit")
b.ell(0.125, 0.125, 0.17, "a", loc=(0, 0, 0.17), n=10, m=6)
b.ell(0.115, 0.115, 0.15, "a", loc=(0, 0, -0.09), n=10, m=6)
b.torus(0.1, 0.024, "c", loc=(0, 0, 0.035), n=12, m=5)
b.torus(0.092, 0.024, "c", loc=(0, 0, -0.215), n=12, m=5)
b.box(0.014, 0.08, 0.08, "g", loc=(0.124, 0, 0.19), bevel=0.005)
b.ell(0.1, 0.105, 0.1, "b", loc=(0, -0.01, -0.3), n=10, m=6)
b.finish()

# Manche : étoffe, revers, main nue.
b = Body("SkArmSleeve")
arm_core(b, "a", "a", 0.105, 0.09)
b.ell(0.115, 0.11, 0.08, "a", loc=(0.01, 0, 0.27), n=10, m=5)
b.band([(0.086, -0.25), (0.09, -0.19)], 0, 360, "b", t=0.016, n=10)
fist(b, "d", 0.078)
b.finish()

# Manche de robe : en cloche, galon lumineux, main dans l'ombre.
b = Body("SkArmRobe")
b.loft([R(0.06, 0.35, 10), R(0.115, 0.27, 10), R(0.105, 0.06, 10), R(0.13, -0.13, 10), R(0.17, -0.26, 10)], "a")
b.band([(0.168, -0.272), (0.17, -0.245)], 0, 360, "g", t=0.012, n=10)
b.cyl(0.12, 0.13, 0.03, "c", loc=(0, 0, -0.262), n=10)
fist(b, "d", 0.07)
b.finish()

# Robot : rotules, segments en caisson, bande lumineuse, pince.
b = Body("SkArmMech")
b.ell(0.1, 0.1, 0.1, "c", loc=(0, 0, 0.26), n=10, m=6)
b.box(0.15, 0.15, 0.2, "a", loc=(0, 0, 0.12), bevel=0.02)
b.ell(0.075, 0.075, 0.075, "c", loc=(0, 0, 0.0), n=8, m=5)
b.box(0.17, 0.17, 0.2, "a", loc=(0, 0, -0.13), bevel=0.025)
b.box(0.02, 0.11, 0.035, "g", loc=(0.086, 0, -0.1), bevel=0.005)
b.cyl(0.07, 0.07, 0.04, "b", loc=(0, 0, -0.245), n=10)
both(lambda s: b.box(0.04, 0.11, 0.1, "c", loc=(s * 0.05, 0, -0.31), bevel=0.012))
b.finish()

# Roche : blocs à facettes, cœur lumineux entre deux.
b = Body("SkArmRock", sharp=1.0)
b.ell(0.15, 0.14, 0.13, "a", loc=(0.01, 0, 0.23), n=7, m=4, jit=0.12, seed=3)
b.ell(0.08, 0.08, 0.09, "g", loc=(0, 0, 0.06), n=6, m=3)
b.ell(0.12, 0.12, 0.11, "c", loc=(0, 0, -0.06), n=7, m=4, jit=0.12, seed=5)
b.ell(0.145, 0.15, 0.15, "a", loc=(0, -0.01, -0.24), n=7, m=4, jit=0.14, seed=7)
b.finish()

# Bête : bras nu, patte claire, griffes.
b = Body("SkArmBeast")
arm_core(b, "a", "a", 0.105, 0.09)
b.ell(0.095, 0.105, 0.085, "d", loc=(0, -0.015, -0.29), n=10, m=6)
for cx in (-0.045, 0.0, 0.045):
    b.cyl(0.02, 0.0, 0.07, "c", loc=(cx, -0.085, -0.34), n=5, tf=rot(rx=2.2))
b.finish()


# =====================================================================
# Jambes (centre de la jambe ; hanche en haut à z = 0,33, sol à z = -0,35)
# =====================================================================
def leg_core(b, up, low, r_up=0.125, r_low=0.1):
    b.loft([R(r_up * 1.02, 0.37, 10), R(r_up, 0.2, 10), R(r_up * 0.84, 0.04, 10)], up)
    b.loft([R(r_low * 0.95, 0.06, 10), R(r_low, -0.02, 10), R(r_low * 0.86, -0.25, 10)], low)


def boot(b, r, sole, length=0.2, half=0.1, h=0.11):
    b.box(half * 2, length + 0.12, h, r, loc=(0, -length / 2 + 0.03, -0.35 + 0.03 + h / 2), bevel=0.035)
    b.box(half * 2 + 0.012, length + 0.13, 0.03, sole, loc=(0, -length / 2 + 0.03, -0.335), bevel=0.008)
    b.loft([R(0.105, -0.27, 10), R(0.112, -0.17, 10)], r)


# Armure : genouillère, grève et son liseré, cuissot, soleret.
b = Body("SkLegArmor")
leg_core(b, "c", "c")
b.ell(0.085, 0.07, 0.085, "b", loc=(0, -0.085, 0.05), n=8, m=5)
b.band([(0.098, -0.22), (0.104, -0.02)], -85, 85, "a", t=0.022, n=6)
b.box(0.018, 0.05, 0.13, "g", loc=(0.118, -0.02, -0.12), bevel=0.006)
b.band([(0.128, 0.16), (0.13, 0.3)], 20, 160, "a", t=0.018, n=5)
boot(b, "c", "c")
b.box(0.17, 0.09, 0.07, "b", loc=(0, -0.2, -0.3), bevel=0.025)
b.finish()

# Combinaison : boudins, bagues, grosse botte à semelle.
b = Body("SkLegSuit")
b.ell(0.15, 0.15, 0.2, "a", loc=(0, 0, 0.2), n=10, m=6)
b.ell(0.135, 0.135, 0.17, "a", loc=(0, 0, -0.06), n=10, m=6)
b.torus(0.118, 0.026, "c", loc=(0, 0, 0.065), n=12, m=5)
b.torus(0.112, 0.026, "c", loc=(0, 0, -0.19), n=12, m=5)
boot(b, "b", "c", 0.22, 0.115, 0.13)
b.finish()

# Pantalon et basket : semelle claire, lacets lumineux.
b = Body("SkLegPants")
leg_core(b, "c", "c", 0.132, 0.112)
b.band([(0.1, -0.265), (0.106, -0.225)], 0, 360, "c", t=0.014, n=10)
boot(b, "b", "a", 0.2, 0.098, 0.1)
b.box(0.1, 0.02, 0.02, "g", loc=(0, -0.13, -0.205), bevel=0.005)
b.box(0.1, 0.02, 0.02, "g", loc=(0, -0.17, -0.215), bevel=0.005)
b.finish()

# Sous une robe : jambe sombre, soulier à pointe relevée.
b = Body("SkLegRobe")
leg_core(b, "c", "c", 0.11, 0.09)
boot(b, "b", "c", 0.2, 0.09, 0.09)
b.cyl(0.05, 0.0, 0.13, "b", loc=(0, -0.3, -0.26), n=6, tf=rot(rx=1.1))
b.finish()

# Robot : rotules, caissons, bande lumineuse, pied plat.
b = Body("SkLegMech")
b.ell(0.11, 0.11, 0.1, "c", loc=(0, 0, 0.31), n=10, m=6)
b.box(0.19, 0.19, 0.22, "a", loc=(0, 0, 0.17), bevel=0.025)
b.ell(0.085, 0.085, 0.08, "c", loc=(0, 0, 0.03), n=8, m=5)
b.box(0.2, 0.2, 0.24, "a", loc=(0, 0, -0.12), bevel=0.028)
b.box(0.11, 0.02, 0.035, "g", loc=(0, -0.102, -0.1), bevel=0.005)
b.box(0.22, 0.34, 0.09, "c", loc=(0, -0.06, -0.295), bevel=0.03)
b.box(0.23, 0.35, 0.025, "b", loc=(0, -0.06, -0.338))
b.finish()

# Roche.
b = Body("SkLegRock", sharp=1.0)
b.ell(0.16, 0.16, 0.19, "a", loc=(0, 0, 0.2), n=7, m=4, jit=0.12, seed=11)
b.ell(0.09, 0.09, 0.08, "g", loc=(0, 0, 0.03), n=6, m=3)
b.ell(0.14, 0.14, 0.15, "c", loc=(0, 0, -0.1), n=7, m=4, jit=0.12, seed=13)
b.ell(0.17, 0.22, 0.1, "a", loc=(0, -0.05, -0.26), n=7, m=4, jit=0.12, seed=17)
b.finish()

# Bête : patte claire et griffes.
b = Body("SkLegBeast")
leg_core(b, "a", "a", 0.13, 0.095)
b.ell(0.11, 0.17, 0.075, "d", loc=(0, -0.07, -0.28), n=10, m=5)
for cx in (-0.055, 0.0, 0.055):
    b.cyl(0.022, 0.0, 0.07, "c", loc=(cx, -0.24, -0.31), n=5, tf=rot(rx=1.75))
b.finish()


# =====================================================================
# Torses (centre du torse ; hanches à z = -0,56, cou à z = 0,53)
# =====================================================================
def trunk(b, r, waist=0.235, chest=0.335, sy=0.68, n=14, hip=0.25):
    b.loft([R(0.12, -0.58, n, sy), R(hip, -0.5, n, sy + 0.06), R(waist, -0.28, n, sy), R(chest * 0.93, 0.06, n, sy - 0.02),
            R(chest, 0.28, n, sy - 0.05), R(chest * 0.78, 0.41, n, sy), R(0.13, 0.49, n, 0.95), R(0.105, 0.57, n, 1.0)], r)


def belt(b, r, waist=0.24, sy=0.7, glow=True):
    b.band([(waist, -0.335), (waist + 0.004, -0.25)], 0, 360, r, t=0.026, n=16, sy=sy)
    if glow:
        b.box(0.1, 0.03, 0.075, "g", loc=(0, -(waist + 0.03) * sy - 0.005, -0.292), bevel=0.012)


# Tenue de base : plastron, cœur lumineux, ceinturon, réacteur dorsal.
b = Body("SkTorsoBase")
trunk(b, "a")
b.band([(0.24, -0.2), (0.318, 0.04), (0.338, 0.28), (0.275, 0.4)], -64, 64, "b", t=0.03, n=8, sy=0.65)
b.cyl(0.062, 0.062, 0.035, "g", loc=(0, -0.248, 0.2), n=8, tf=rot(rx=HALF))
b.band([(0.245, -0.23), (0.262, -0.06)], -46, 46, "c", t=0.016, n=6, sy=0.68)
belt(b, "c")
b.box(0.3, 0.15, 0.36, "c", loc=(0, 0.245, 0.1), bevel=0.035)
both(lambda s: b.box(0.035, 0.02, 0.22, "g", loc=(s * 0.09, 0.325, 0.1), bevel=0.006))
b.band([(0.145, 0.42), (0.13, 0.51)], 0, 360, "c", t=0.03, n=12, sy=0.95)
both(lambda s: b.box(0.12, 0.2, 0.05, "b", loc=(s * 0.27, 0, 0.385), bevel=0.02, tf=rot(ry=s * 0.25)))
b.finish()

# Armure : cuirasse, lames du ventre, gorgerin, tassettes, emblème.
b = Body("SkTorsoArmor")
trunk(b, "c")
b.loft([R(0.255, -0.2, 14, 0.7), R(0.345, 0.06, 14, 0.67), R(0.352, 0.28, 14, 0.64), R(0.285, 0.42, 14, 0.68)], "a")
b.band([(0.25, -0.265), (0.262, -0.2)], 0, 360, "b", t=0.02, n=14, sy=0.69)
b.band([(0.16, 0.41), (0.14, 0.51)], 0, 360, "b", t=0.035, n=12, sy=0.95)
for a0 in (-36, 54, 144, 234):
    b.band([(0.262, -0.57), (0.272, -0.33)], a0, a0 + 72, "a", t=0.024, n=4, sy=0.78)
    b.band([(0.262, -0.585), (0.264, -0.555)], a0, a0 + 72, "b", t=0.03, n=4, sy=0.78)
belt(b, "c", 0.25, 0.72)
b.box(0.1, 0.025, 0.1, "g", loc=(0, -0.252, 0.2), tf=rot(ry=math.pi / 4), bevel=0.01)
b.box(0.05, 0.05, 0.42, "b", loc=(0, 0.238, 0.1), bevel=0.015)
both(lambda s: b.band([(0.356, 0.1), (0.36, 0.14)], s * 47 - 28, s * 47 + 28, "b", t=0.012, n=4, sy=0.66))
b.finish()

# Combinaison : étoffe gonflée, coutures, boîtier de commande, sac de survie.
b = Body("SkTorsoSuit")
trunk(b, "a", waist=0.27, chest=0.35, sy=0.78, hip=0.27)
b.band([(0.272, -0.2), (0.276, -0.17)], 0, 360, "c", t=0.014, n=16, sy=0.78)
b.band([(0.338, 0.3), (0.332, 0.33)], 0, 360, "c", t=0.014, n=16, sy=0.74)
b.box(0.21, 0.08, 0.15, "c", loc=(0, -0.3, 0.15), bevel=0.022)
for k, cx in enumerate((-0.06, 0.0, 0.06)):
    b.box(0.038, 0.02, 0.038, "g" if k != 1 else "b", loc=(cx, -0.345, 0.17), bevel=0.008)
b.box(0.13, 0.02, 0.025, "g", loc=(0, -0.345, 0.112), bevel=0.006)
b.box(0.42, 0.2, 0.5, "b", loc=(0, 0.3, 0.08), bevel=0.06)
both(lambda s: b.box(0.05, 0.03, 0.09, "g", loc=(s * 0.14, 0.405, 0.24), bevel=0.01))
b.cyl(0.014, 0.014, 0.2, "c", loc=(0.15, 0.3, 0.42), n=6)
b.ell(0.03, 0.03, 0.03, "g", loc=(0.15, 0.3, 0.53), n=6, m=4)
belt(b, "c", 0.275, 0.8)
b.band([(0.185, 0.43), (0.185, 0.51)], 0, 360, "c", t=0.04, n=14, sy=0.95)
b.finish()

# Veste ouverte : maillot dessous, col rembourré, poches, écusson dans le dos.
b = Body("SkTorsoJacket")
trunk(b, "b")
b.band([(0.262, -0.4), (0.258, -0.28), (0.33, 0.06), (0.345, 0.28), (0.272, 0.42)], 13, 347, "a", t=0.032, n=18, sy=0.67)
b.band([(0.27, -0.44), (0.268, -0.385)], 13, 347, "c", t=0.04, n=18, sy=0.69)
b.ell(0.21, 0.2, 0.085, "c", loc=(0, 0.05, 0.47), n=12, m=5)
both(lambda s: b.band([(0.3, -0.26), (0.31, -0.12)], s * 58 - 22, s * 58 + 22, "c", t=0.014, n=4, sy=0.68))
b.box(0.18, 0.02, 0.18, "g", loc=(0, 0.262, 0.14), bevel=0.02)
both(lambda s: b.cyl(0.012, 0.012, 0.16, "g", loc=(s * 0.055, -0.235, 0.3), n=5))
b.finish()

# Robe : jupe évasée, ceinture d'étoffe, pèlerine et fermoir, galon lumineux.
b = Body("SkTorsoRobe")
b.loft([R(0.16, -0.61, 14, 0.9), R(0.365, -0.57, 14, 0.9), R(0.31, -0.3, 14, 0.82), R(0.27, -0.02, 14, 0.74), R(0.31, 0.26, 14, 0.66),
        R(0.24, 0.41, 14, 0.7), R(0.13, 0.49, 14, 0.95), R(0.105, 0.57, 14, 1.0)], "a")
b.band([(0.366, -0.585), (0.362, -0.54)], 0, 360, "g", t=0.012, n=16, sy=0.9)
b.band([(0.286, -0.13), (0.276, -0.03)], 0, 360, "b", t=0.022, n=16, sy=0.77)
b.box(0.075, 0.02, 0.26, "b", loc=(0.1, -0.245, -0.25), bevel=0.01)
b.ell(0.045, 0.03, 0.045, "g", loc=(0.1, -0.245, -0.08), n=8, m=4)
b.loft([R(0.42, 0.19, 14, 0.78), R(0.385, 0.31, 14, 0.76), R(0.19, 0.5, 14, 0.95)], "c")
b.band([(0.422, 0.175), (0.42, 0.21)], 0, 360, "b", t=0.01, n=16, sy=0.78)
b.ell(0.05, 0.03, 0.05, "g", loc=(0, -0.3, 0.36), n=8, m=4)
b.finish()


# Bêtes : ventre clair, et ce qui fait chacune.
def beast(name, belly="d"):
    bb = Body(name)
    trunk(bb, "a", waist=0.25, chest=0.315, sy=0.75)
    bb.band([(0.262, -0.44), (0.252, -0.28), (0.297, 0.06), (0.318, 0.28), (0.25, 0.4)], -46, 46, belly, t=0.012, n=8, sy=0.735)
    return bb


# Renard : queue en panache au bout clair, collerette.
b = beast("SkTorsoFox")
b.ell(0.11, 0.11, 0.19, "a", loc=(0, 0.3, -0.34), n=10, m=6, tf=rot(rx=-1.0))
b.ell(0.17, 0.17, 0.25, "a", loc=(0, 0.47, -0.12), n=10, m=6, tf=rot(rx=-0.45))
b.ell(0.12, 0.12, 0.17, "d", loc=(0, 0.545, 0.13), n=10, m=6, tf=rot(rx=-0.15))
for k in range(9):
    b.spike("d", k * 40, 0.17, 0.41, 0.19, 0.07, tilt=118, sy=0.85)
b.finish()

# Démon : queue en pique, ailes repliées, rune, pointes d'épaule.
b = beast("SkTorsoDemon", "c")
b.cyl(0.035, 0.028, 0.26, "a", loc=(0, 0.3, -0.42), n=6, tf=rot(rx=-1.15))
b.cyl(0.028, 0.02, 0.26, "a", loc=(0, 0.47, -0.27), n=6, tf=rot(rx=-0.5))
b.ell(0.07, 0.022, 0.09, "c", loc=(0, 0.535, -0.08), n=6, m=4)
WING = [(0, 0, 0), (0.3, 0.1, 0.36), (0.3, 0.12, -0.1), (0, 0.03, 0), (0.3, 0.13, 0.36), (0.3, 0.15, -0.1)]
WING_F = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
b.add(WING, WING_F, "c", loc=(0.1, 0.2, 0.2))
b.add(WING, WING_F, "c", loc=(-0.1, 0.2, 0.2), tf=MIRROR)
both(lambda s: b.cyl(0.012, 0.012, 0.42, "b", loc=(s * 0.25, 0.265, 0.38), n=5, tf=rot(ry=s * 0.7)))
b.box(0.09, 0.022, 0.09, "g", loc=(0, -0.248, 0.2), tf=rot(ry=math.pi / 4), bevel=0.008)
both(lambda s: b.spike("c", s * 90, 0.27, 0.43, 0.2, 0.06, tilt=40, sy=0.6))
belt(b, "c", 0.255, 0.77)
b.finish()

# Pousse : jupe de feuilles, liane lumineuse, collerette, bourgeon.
b = beast("SkTorsoSprout")
for k in range(9):
    a = k * 40.0
    b.ell(0.1, 0.028, 0.19, "b", loc=(math.sin(math.radians(a)) * 0.27, -math.cos(math.radians(a)) * 0.24, -0.47), n=8, m=5,
          tf=rot(rx=-0.4, rz=math.radians(a)))
b.band([(0.332, -0.02), (0.332, 0.02)], 0, 360, "g", t=0.016, n=16, sy=0.72, tf=Matrix.Translation((0, 0, 0.1)) @ rot(ry=0.5))
for k in range(7):
    a = k * 360 / 7
    b.ell(0.085, 0.02, 0.11, "b", loc=(math.sin(math.radians(a)) * 0.17, -math.cos(math.radians(a)) * 0.15, 0.44), n=6, m=4,
          tf=rot(rx=1.25, rz=math.radians(a)))
b.ell(0.085, 0.085, 0.1, "d", loc=(0, 0.25, 0.2), n=8, m=5)
b.ell(0.04, 0.04, 0.05, "g", loc=(0, 0.3, 0.3), n=6, m=4)
b.finish()

# Robot : châssis, panneau et cœur lumineux, ouïes, tuyères dorsales.
b = Body("SkTorsoMech")
b.box(0.3, 0.22, 0.14, "c", loc=(0, 0, -0.47), bevel=0.03)
b.cyl(0.12, 0.12, 0.16, "c", loc=(0, 0, -0.34), n=10)
b.box(0.6, 0.4, 0.56, "a", loc=(0, 0, 0.06), bevel=0.05)
b.box(0.38, 0.03, 0.27, "c", loc=(0, -0.205, 0.12), bevel=0.012)
b.cyl(0.075, 0.075, 0.04, "g", loc=(0, -0.222, 0.16), n=10, tf=rot(rx=HALF))
b.torus(0.085, 0.014, "b", loc=(0, -0.222, 0.16), n=12, m=4, tf=rot(rx=HALF))
for z in (-0.02, -0.065, -0.11):
    b.box(0.22, 0.03, 0.022, "b", loc=(0, -0.208, z))
both(lambda s: b.ell(0.095, 0.095, 0.095, "c", loc=(s * 0.3, 0, 0.26), n=8, m=5))
b.cyl(0.085, 0.085, 0.12, "c", loc=(0, 0, 0.39), n=10)
both(lambda s: b.cyl(0.05, 0.045, 0.32, "b", loc=(s * 0.13, 0.245, 0.2), n=8))
both(lambda s: b.cyl(0.035, 0.035, 0.03, "g", loc=(s * 0.13, 0.245, 0.37), n=8))
both(lambda s: b.box(0.03, 0.03, 0.03, "b", loc=(s * 0.25, -0.205, 0.29), bevel=0.008))
b.finish()

# Roche : blocs empilés, cœur lumineux dans les fissures, éclats dans le dos.
b = Body("SkTorsoRock", sharp=1.0)
b.ell(0.25, 0.2, 0.17, "a", loc=(0, 0, -0.44), n=7, m=4, jit=0.12, seed=21)
b.ell(0.2, 0.16, 0.2, "g", loc=(0, 0, -0.15), n=6, m=4)
b.ell(0.38, 0.27, 0.28, "a", loc=(0, 0, 0.17), n=8, m=5, jit=0.13, seed=23)
both(lambda s: b.ell(0.16, 0.15, 0.14, "c", loc=(s * 0.27, 0.02, 0.37), n=6, m=4, jit=0.14, seed=25 + s))
b.box(0.03, 0.03, 0.2, "g", loc=(0.05, -0.262, 0.2), tf=rot(ry=0.5))
b.box(0.03, 0.03, 0.14, "g", loc=(-0.02, -0.262, 0.08), tf=rot(ry=-0.6))
for (x, y, z, ry, ln) in ((0.1, 0.2, 0.42, 0.25, 0.3), (-0.08, 0.22, 0.38, -0.3, 0.24), (0.0, 0.25, 0.3, 0.0, 0.2)):
    b.cyl(0.06, 0.0, ln, "g", loc=(x, y, z), n=4, tf=rot(rx=-0.5, ry=ry))
b.finish()

# Habit : plastron de chemise, revers, nœud papillon, boutons, basques.
b = Body("SkTorsoCoat")
trunk(b, "a")
b.band([(0.262, -0.2), (0.316, 0.06), (0.338, 0.28), (0.272, 0.4)], -15, 15, "b", t=0.014, n=4, sy=0.655)
both(lambda s: b.band([(0.318, 0.04), (0.34, 0.28), (0.275, 0.4)], s * 28 - 13, s * 28 + 13, "c", t=0.026, n=4, sy=0.655))
both(lambda s: b.box(0.075, 0.035, 0.055, "g", loc=(s * 0.045, -0.2, 0.43), bevel=0.014))
b.ell(0.025, 0.025, 0.025, "c", loc=(0, -0.215, 0.43), n=6, m=4)
for z in (-0.02, 0.1, 0.22):
    b.ell(0.02, 0.014, 0.02, "g", loc=(0, -0.232 - (z > 0) * 0.008, z), n=6, m=4)
both(lambda s: b.band([(0.25, -0.78), (0.262, -0.5)], 180 + s * 32 - 26, 180 + s * 32 + 26, "a", t=0.02, n=4, sy=0.8))
b.box(0.07, 0.02, 0.04, "g", loc=(-0.15, -0.205, 0.22), bevel=0.006)
b.band([(0.142, 0.42), (0.128, 0.5)], 0, 360, "b", t=0.022, n=12, sy=0.95)
belt(b, "c", 0.24, 0.7, glow=False)
b.finish()

# Tenue croisée : revers en V, ceinture nouée, fourreau en travers du dos.
b = Body("SkTorsoGi")
trunk(b, "a")
both(lambda s: b.box(0.07, 0.03, 0.56, "c", loc=(s * 0.045, -0.218 + (s > 0) * 0.012, 0.13), tf=rot(ry=s * 0.52), bevel=0.01))
b.band([(0.243, -0.34), (0.248, -0.24)], 0, 360, "g", t=0.026, n=16, sy=0.7)
b.box(0.09, 0.05, 0.07, "g", loc=(0.08, -0.2, -0.29), bevel=0.015)
b.box(0.05, 0.02, 0.2, "g", loc=(0.06, -0.21, -0.42), tf=rot(ry=0.2), bevel=0.008)
b.box(0.05, 0.02, 0.17, "g", loc=(0.12, -0.205, -0.4), tf=rot(ry=-0.25), bevel=0.008)
b.box(0.06, 0.05, 0.82, "c", loc=(0, 0.245, 0.1), tf=rot(ry=0.6), bevel=0.014)
b.box(0.035, 0.035, 0.2, "b", loc=(0.285, 0.245, 0.52), tf=rot(ry=0.6), bevel=0.008)
b.box(0.11, 0.07, 0.025, "g", loc=(0.225, 0.245, 0.43), tf=rot(ry=0.6), bevel=0.006)
both(lambda s: b.band([(0.34, 0.24), (0.3, 0.4)], s * 90 - 34, s * 90 + 34, "c", t=0.03, n=5, sy=0.62))
b.finish()


# =====================================================================
# Têtes (centre de la tête ; cou jusqu'à z = -0,33)
# =====================================================================
def neck(b, r):
    b.loft([R(0.1, -0.34, 10), R(0.11, -0.18, 10)], r)


def eyes(b, r="c", x=0.085, y=-0.225, z=0.02, rx=0.036, rz=0.046):
    both(lambda s: b.ell(rx, 0.02, rz, r, loc=(s * x, y, z), n=8, m=4))


# Tenue de base : casque lisse, visière lumineuse, mentonnière, cimier.
b = Body("SkHeadBase")
neck(b, "c")
b.ell(0.255, 0.265, 0.27, "a", n=14, m=8)
b.shell("g", -0.035, 0.1, -68, 68, t=0.016)
b.shell("c", -0.21, -0.045, -54, 54, t=0.024)
b.box(0.05, 0.36, 0.07, "b", loc=(0, 0.03, 0.245), bevel=0.02)
both(lambda s: b.cyl(0.075, 0.06, 0.05, "c", loc=(s * 0.255, 0.02, -0.02), n=8, tf=rot(ry=s * HALF)))
both(lambda s: b.ell(0.03, 0.03, 0.03, "g", loc=(s * 0.285, 0.02, -0.02), n=6, m=4))
b.finish()

# Recrue : casque léger, bandeau, lunettes relevées, jugulaires.
b = Body("SkHeadRecrue")
neck(b, "d")
b.ell(0.235, 0.245, 0.25, "d", n=14, m=8)
b.ell(0.262, 0.272, 0.272, "a", lat0=10, n=14, m=6)
b.shell("c", 0.025, 0.065, 0, 360, t=0.022, rx=0.262, n=14, steps=1)
b.shell("g", -0.01, 0.022, 0, 360, t=0.012, rx=0.245, rz=0.26, n=14, steps=1)
b.shell("c", 0.13, 0.165, 0, 360, t=0.012, rx=0.266, n=14, steps=1)
both(lambda s: b.cyl(0.058, 0.058, 0.045, "g", loc=(s * 0.085, -0.238, 0.15), n=8, tf=rot(rx=HALF - 0.45)))
both(lambda s: b.box(0.022, 0.035, 0.2, "c", loc=(s * 0.228, -0.07, -0.09), bevel=0.006))
eyes(b, z=-0.045, y=-0.232)
b.finish()

# Sentinelle : heaume fermé, visière en T, ailerons.
b = Body("SkHeadSentinelle")
neck(b, "c")
b.ell(0.255, 0.265, 0.285, "a", n=14, m=8)
b.shell("c", -0.2, 0.13, -78, 78, t=0.02, rz=0.285, steps=4)
b.shell("g", 0.0, 0.065, -60, 60, t=0.032, rz=0.285, steps=2)
b.box(0.036, 0.03, 0.17, "g", loc=(0, -0.268, -0.09), bevel=0.008)
both(lambda s: b.box(0.026, 0.27, 0.15, "b", loc=(s * 0.268, 0.07, 0.06), tf=rot(rx=-0.35), bevel=0.01))
b.box(0.045, 0.4, 0.05, "b", loc=(0, 0.02, 0.268), bevel=0.016)
b.finish()

# Ninja : tête voilée, fente des yeux, bandeau noué qui flotte.
b = Body("SkHeadNinja")
neck(b, "a")
b.ell(0.25, 0.26, 0.265, "a", n=14, m=8)
b.shell("d", -0.01, 0.075, -56, 56, t=0.007, rx=0.25, rz=0.265, steps=2)
eyes(b, y=-0.243, z=0.03)
b.shell("g", 0.09, 0.145, 0, 360, t=0.015, rx=0.25, rz=0.265, n=14, steps=1)
b.box(0.075, 0.05, 0.065, "g", loc=(0, 0.275, 0.115), bevel=0.014)
both(lambda s: b.box(0.05, 0.02, 0.25, "g", loc=(s * 0.045, 0.31, -0.02), tf=rot(rx=0.3, rz=s * 0.15), bevel=0.006))
b.shell("c", -0.2, -0.03, -62, 62, t=0.013, rx=0.25, rz=0.265)
b.finish()

# Astronaute : grand casque, visière bombée dorée, anneau de col.
b = Body("SkHeadAstro")
b.ell(0.29, 0.29, 0.29, "a", n=16, m=9)
b.ell(0.215, 0.15, 0.185, "d", loc=(0, -0.17, 0.01), n=14, m=7)
b.torus(0.2, 0.026, "c", loc=(0, -0.2, 0.01), n=16, m=5, tf=rot(rx=HALF))
b.torus(0.2, 0.042, "c", loc=(0, 0, -0.25), n=16, m=6)
both(lambda s: b.box(0.045, 0.07, 0.07, "g", loc=(s * 0.285, -0.03, 0.08), bevel=0.012))
b.box(0.12, 0.06, 0.12, "c", loc=(0, 0.28, -0.02), bevel=0.02)
b.finish()

# Spectre : capuchon pointu, visage dans l'ombre, deux yeux qui brillent.
b = Body("SkHeadSpectre")
b.ell(0.27, 0.28, 0.28, "a", n=14, m=8)
b.cyl(0.17, 0.0, 0.32, "a", loc=(0, 0.14, 0.3), n=10, tf=rot(rx=-0.9))
b.ell(0.19, 0.08, 0.2, "c", loc=(0, -0.215, -0.01), n=12, m=6)
b.torus(0.2, 0.03, "b", loc=(0, -0.2, -0.01), n=16, m=5, tf=rot(rx=HALF))
both(lambda s: b.ell(0.04, 0.025, 0.052, "g", loc=(s * 0.075, -0.278, 0.02), n=8, m=4))
for k in range(8):
    b.spike("a", k * 45 + 10, 0.13, -0.27, 0.2, 0.07, tilt=160)
b.finish()

# Robot : tête en caisson, écran, yeux et bouche lumineux, antenne.
b = Body("SkHeadRobot")
b.cyl(0.08, 0.08, 0.14, "c", loc=(0, 0, -0.26), n=10)
b.box(0.46, 0.4, 0.4, "a", loc=(0, 0, 0), bevel=0.045)
b.box(0.37, 0.03, 0.23, "c", loc=(0, -0.2, 0.01), bevel=0.012)
both(lambda s: b.box(0.09, 0.03, 0.075, "g", loc=(s * 0.088, -0.214, 0.045), bevel=0.014))
for cx in (-0.055, 0.0, 0.055):
    b.box(0.038, 0.03, 0.026, "g", loc=(cx, -0.214, -0.065), bevel=0.006)
both(lambda s: b.cyl(0.078, 0.078, 0.055, "b", loc=(s * 0.25, 0, 0), n=10, tf=rot(ry=HALF)))
b.cyl(0.014, 0.014, 0.2, "c", loc=(0.1, 0, 0.3), n=6)
b.ell(0.045, 0.045, 0.045, "g", loc=(0.1, 0, 0.41), n=8, m=5)
b.box(0.2, 0.15, 0.03, "b", loc=(-0.07, 0.02, 0.208), bevel=0.008)
b.finish()

# Renard : museau clair, truffe, oreilles dressées, joues en pointe.
b = Body("SkHeadRenard")
neck(b, "a")
b.ell(0.25, 0.24, 0.235, "a", n=14, m=8)
b.cyl(0.135, 0.045, 0.25, "d", loc=(0, -0.3, -0.065), n=10, tf=rot(rx=HALF + 0.12))
b.ell(0.042, 0.04, 0.038, "c", loc=(0, -0.428, -0.04), n=8, m=5)
both(lambda s: b.cyl(0.1, 0.0, 0.22, "d", loc=(s * 0.2, -0.08, -0.1), n=6, tf=rot(ry=s * 2.0)))
both(lambda s: b.cyl(0.105, 0.0, 0.25, "a", loc=(s * 0.145, 0.02, 0.3), n=4, tf=rot(ry=s * 0.3)))
both(lambda s: b.cyl(0.062, 0.0, 0.17, "d", loc=(s * 0.145, -0.025, 0.285), n=4, tf=rot(ry=s * 0.3)))
both(lambda s: b.ell(0.034, 0.02, 0.05, "c", loc=(s * 0.105, -0.212, 0.055), n=8, m=4, tf=rot(ry=s * 0.4)))
b.finish()

# Chevalier : grand heaume, fente, croix de renfort, ouïes, plumet.
b = Body("SkHeadChevalier")
b.loft([R(0.2, -0.32, 14, 1.04), R(0.245, -0.2, 14, 1.04), R(0.266, 0.08, 14, 1.04), R(0.25, 0.2, 14, 1.04), R(0.17, 0.27, 14, 1.04)], "a")
b.band([(0.262, 0.03), (0.266, 0.075)], -64, 64, "c", t=0.014, n=10, sy=1.04)
b.band([(0.246, -0.2), (0.267, 0.08), (0.25, 0.21)], -7, 7, "b", t=0.022, n=2, sy=1.04)
b.band([(0.266, 0.085), (0.262, 0.118)], 0, 360, "b", t=0.018, n=14, sy=1.04)
b.band([(0.203, -0.32), (0.21, -0.285)], 0, 360, "b", t=0.018, n=14, sy=1.04)
for k in range(3):
    both(lambda s: b.band([(0.256, -0.11), (0.262, -0.035)], s * (22 + k * 11) - 2, s * (22 + k * 11) + 2, "c", t=0.012, n=1, sy=1.04))
b.box(0.05, 0.32, 0.035, "b", loc=(0, 0.05, 0.27), bevel=0.01)
b.ell(0.036, 0.21, 0.13, "g", loc=(0, 0.07, 0.31), n=10, m=6)
b.finish()

# Démon : cornes recourbées, arcade lourde, yeux en amande, crocs.
b = Body("SkHeadDemon")
neck(b, "a")
b.ell(0.25, 0.25, 0.26, "a", n=14, m=8)
b.cyl(0.05, 0.15, 0.17, "a", loc=(0, -0.1, -0.2), n=8, tf=rot(rx=-0.5))
b.shell("c", 0.06, 0.125, -66, 66, t=0.036, rx=0.25, rz=0.26, steps=1)
both(lambda s: b.ell(0.046, 0.02, 0.028, "g", loc=(s * 0.09, -0.236, 0.03), n=8, m=4, tf=rot(ry=-s * 0.35)))
both(lambda s: b.cyl(0.068, 0.05, 0.15, "d", loc=(s * 0.17, 0, 0.25), n=7, tf=rot(ry=s * 0.7)))
both(lambda s: b.cyl(0.05, 0.03, 0.15, "d", loc=(s * 0.26, 0, 0.355), n=7, tf=rot(ry=s * 0.3)))
both(lambda s: b.cyl(0.03, 0.0, 0.15, "d", loc=(s * 0.265, 0, 0.48), n=7, tf=rot(ry=-s * 0.3)))
both(lambda s: b.cyl(0.055, 0.0, 0.2, "a", loc=(s * 0.28, 0.02, 0.02), n=4, tf=rot(ry=s * 1.3)))
both(lambda s: b.cyl(0.02, 0.0, 0.065, "d", loc=(s * 0.05, -0.2, -0.165), n=5, tf=rot(rx=math.pi)))
b.finish()

# Skateur : casquette à visière, écusson, cheveux sur la nuque.
b = Body("SkHeadSkateur")
neck(b, "d")
b.ell(0.24, 0.245, 0.25, "d", n=14, m=8)
b.shell("c", -0.15, 0.12, 76, 284, t=0.022, rx=0.24, rz=0.25, steps=3, n=12)
b.ell(0.262, 0.272, 0.27, "b", lat0=14, n=14, m=6)
b.box(0.3, 0.25, 0.03, "b", loc=(0, -0.335, 0.075), tf=rot(rx=-0.1), bevel=0.012)
b.ell(0.032, 0.032, 0.02, "g", loc=(0, 0, 0.275), n=8, m=4)
b.box(0.09, 0.025, 0.07, "g", loc=(0, -0.26, 0.155), tf=rot(rx=0.35), bevel=0.012)
eyes(b, y=-0.232, z=-0.01)
b.finish()

# Pousse : tête ronde, grands yeux, tige et deux feuilles, collerette.
b = Body("SkHeadPousse")
neck(b, "a")
b.ell(0.265, 0.265, 0.26, "a", n=14, m=8)
both(lambda s: b.ell(0.05, 0.025, 0.062, "c", loc=(s * 0.095, -0.243, 0.02), n=8, m=5))
both(lambda s: b.ell(0.017, 0.012, 0.017, "d", loc=(s * 0.084, -0.266, 0.045), n=6, m=3))
b.cyl(0.026, 0.02, 0.17, "c", loc=(0, 0, 0.32), n=6)
both(lambda s: b.ell(0.14, 0.075, 0.03, "g", loc=(s * 0.125, 0, 0.44), n=10, m=4, tf=rot(ry=-s * 0.5)))
for k in range(7):
    a = k * 360 / 7 + 15
    b.ell(0.08, 0.02, 0.11, "b", loc=(math.sin(math.radians(a)) * 0.15, -math.cos(math.radians(a)) * 0.15, -0.25), n=6, m=4,
          tf=rot(rx=1.2, rz=math.radians(a)))
b.finish()

# Martien : grand crâne, yeux en amande, antennes à boule, gemme au front.
b = Body("SkHeadMartien")
neck(b, "d")
b.ell(0.27, 0.27, 0.3, "d", loc=(0, 0.01, 0.04), n=14, m=8)
b.cyl(0.07, 0.17, 0.2, "d", loc=(0, -0.02, -0.2), n=10)
both(lambda s: b.ell(0.085, 0.035, 0.12, "c", loc=(s * 0.115, -0.218, 0.02), n=10, m=5, tf=rot(ry=-s * 0.45, rz=s * 0.3)))
both(lambda s: b.cyl(0.013, 0.013, 0.27, "c", loc=(s * 0.11, 0, 0.43), n=5, tf=rot(ry=s * 0.3)))
both(lambda s: b.ell(0.05, 0.05, 0.05, "g", loc=(s * 0.15, 0, 0.57), n=8, m=5))
b.box(0.06, 0.02, 0.012, "c", loc=(0, -0.185, -0.19))
b.ell(0.03, 0.02, 0.04, "g", loc=(0, -0.268, 0.17), n=6, m=4)
b.finish()

# Pilote : serre-tête de cuir, fourrure, lunettes relevées, écharpe.
b = Body("SkHeadPilote")
neck(b, "d")
b.ell(0.238, 0.245, 0.25, "d", n=14, m=8)
b.ell(0.26, 0.27, 0.27, "a", lat0=4, n=14, m=6)
b.shell("a", -0.16, 0.035, 62, 298, t=0.022, rx=0.24, rz=0.25, steps=3, n=12)
both(lambda s: b.box(0.03, 0.13, 0.2, "a", loc=(s * 0.25, 0.0, -0.1), bevel=0.012))
b.shell("b", 0.015, 0.075, 0, 360, t=0.034, rx=0.262, n=14, steps=1)
b.shell("c", 0.09, 0.13, 0, 360, t=0.016, rx=0.266, n=14, steps=1)
both(lambda s: b.cyl(0.068, 0.068, 0.05, "g", loc=(s * 0.092, -0.268, 0.11), n=10, tf=rot(rx=HALF)))
both(lambda s: b.torus(0.07, 0.017, "c", loc=(s * 0.092, -0.276, 0.11), n=10, m=4, tf=rot(rx=HALF)))
eyes(b, y=-0.232, z=-0.02)
b.torus(0.15, 0.06, "b", loc=(0, 0, -0.26), n=12, m=5)
b.finish()

# DJ : visière à diodes, casque audio à anneaux lumineux.
b = Body("SkHeadDj")
neck(b, "a")
b.ell(0.25, 0.26, 0.265, "a", n=14, m=8)
b.shell("g", -0.005, 0.085, -68, 68, t=0.024, rx=0.25, rz=0.265, steps=2)
b.shell("c", 0.085, 0.108, -70, 70, t=0.03, rx=0.25, rz=0.265, steps=1)
b.shell("c", -0.028, -0.005, -70, 70, t=0.03, rx=0.25, rz=0.265, steps=1)
b.ell(0.29, 0.05, 0.295, "c", lat0=4, n=14, m=6)
both(lambda s: b.cyl(0.12, 0.12, 0.035, "c", loc=(s * 0.25, 0, -0.02), n=12, tf=rot(ry=HALF)))
both(lambda s: b.cyl(0.108, 0.098, 0.08, "b", loc=(s * 0.29, 0, -0.02), n=12, tf=rot(ry=s * HALF)))
both(lambda s: b.torus(0.07, 0.017, "g", loc=(s * 0.332, 0, -0.02), n=12, m=4, tf=rot(ry=HALF)))
b.finish()

# Corbeau : capuchon, long bec, verres ronds, plumes.
b = Body("SkHeadCorbeau")
b.ell(0.265, 0.27, 0.275, "a", n=14, m=8)
b.cyl(0.115, 0.012, 0.4, "b", loc=(0, -0.4, -0.075), n=10, tf=rot(rx=HALF + 0.22))
b.torus(0.115, 0.022, "c", loc=(0, -0.225, -0.03), n=12, m=5, tf=rot(rx=HALF + 0.22))
both(lambda s: b.cyl(0.058, 0.058, 0.05, "g", loc=(s * 0.105, -0.245, 0.065), n=10, tf=rot(rx=HALF, rz=s * 0.3)))
both(lambda s: b.torus(0.06, 0.016, "c", loc=(s * 0.11, -0.255, 0.065), n=10, m=4, tf=rot(rx=HALF, rz=s * 0.3)))
for cx in (-0.055, 0.0, 0.055):
    b.box(0.022, 0.22, 0.07, "c", loc=(cx, 0.15, 0.26 - abs(cx) * 0.4), tf=rot(rx=-0.45), bevel=0.008)
for k in range(9):
    b.spike("c", k * 40 + 5, 0.15, -0.25, 0.19, 0.06, tilt=150)
b.finish()

# Dandy : haut-de-forme à ruban, monocle, moustache.
b = Body("SkHeadDandy")
neck(b, "d")
b.ell(0.238, 0.245, 0.25, "d", n=14, m=8)
b.shell("c", -0.12, 0.1, 82, 278, t=0.02, rx=0.238, rz=0.25, steps=3, n=12)
b.cyl(0.34, 0.34, 0.03, "a", loc=(0, 0, 0.165), n=16)
b.cyl(0.2, 0.215, 0.32, "a", loc=(0, 0, 0.335), n=14)
b.band([(0.203, 0.185), (0.206, 0.25)], 0, 360, "g", t=0.012, n=14)
eyes(b, y=-0.232, z=0.01)
b.torus(0.052, 0.011, "g", loc=(0.085, -0.25, 0.012), n=10, m=4, tf=rot(rx=HALF))
both(lambda s: b.ell(0.062, 0.025, 0.026, "c", loc=(s * 0.052, -0.24, -0.085), n=8, m=4, tf=rot(ry=s * 0.3)))
b.ell(0.03, 0.03, 0.036, "d", loc=(0, -0.252, -0.04), n=6, m=4)
b.finish()

# Samouraï : kabuto à nervures, croissant, couvre-nuque à trois lames, masque.
b = Body("SkHeadSamourai")
neck(b, "c")
b.ell(0.24, 0.25, 0.25, "c", n=14, m=8)
b.shell("d", 0.0, 0.065, -50, 50, t=0.007, rx=0.24, rz=0.25, steps=2)
eyes(b, y=-0.236, z=0.03, rx=0.032, rz=0.03)
b.shell("b", -0.125, -0.07, -42, 42, t=0.022, rx=0.24, rz=0.25, steps=1)
b.ell(0.268, 0.278, 0.275, "a", lat0=10, n=14, m=6)
for k in range(6):
    b.shell("b", 0.06, 0.265, k * 60 - 3, k * 60 + 3, t=0.016, rx=0.268, rz=0.275, steps=3, n=1)
b.band([(0.262, 0.05), (0.345, 0.02)], -72, 72, "a", t=0.02, n=8, sy=1.04)
for i in range(3):
    r0 = 0.27 + 0.036 * i
    z0 = -0.02 - 0.085 * i
    b.band([(r0, z0), (r0 - 0.01, z0 + 0.09)], 62, 298, "a", t=0.018, n=10, sy=1.04)
    b.band([(r0, z0 - 0.012), (r0, z0 + 0.01)], 62, 298, "b", t=0.025, n=10, sy=1.04)
both(lambda s: b.box(0.03, 0.1, 0.13, "b", loc=(s * 0.275, -0.2, 0.09), tf=rot(rz=s * 0.5), bevel=0.01))
both(lambda s: b.cyl(0.03, 0.022, 0.17, "g", loc=(s * 0.09, -0.28, 0.27), n=6, tf=rot(ry=s * 0.9)))
both(lambda s: b.cyl(0.022, 0.0, 0.19, "g", loc=(s * 0.2, -0.28, 0.395), n=6, tf=rot(ry=s * 0.25)))
b.ell(0.04, 0.025, 0.04, "g", loc=(0, -0.288, 0.2), n=8, m=4)
b.ell(0.036, 0.036, 0.03, "b", loc=(0, 0, 0.285), n=8, m=4)
b.finish()

# Sorcier : chapeau pointu qui retombe, large bord, barbe et sourcils.
b = Body("SkHeadSorcier")
neck(b, "d")
b.ell(0.23, 0.24, 0.24, "d", loc=(0, 0, -0.02), n=14, m=8)
eyes(b, y=-0.226, z=0.0)
b.cyl(0.04, 0.012, 0.1, "d", loc=(0, -0.27, -0.045), n=6, tf=rot(rx=HALF))
both(lambda s: b.ell(0.062, 0.026, 0.024, "b", loc=(s * 0.085, -0.226, 0.07), n=8, m=4, tf=rot(ry=-s * 0.25)))
b.cyl(0.03, 0.16, 0.32, "b", loc=(0, -0.15, -0.26), n=10, tf=rot(rx=0.25))
both(lambda s: b.ell(0.072, 0.03, 0.03, "b", loc=(s * 0.06, -0.238, -0.105), n=8, m=4, tf=rot(ry=s * 0.35)))
b.shell("b", -0.2, 0.08, 92, 268, t=0.03, rx=0.23, rz=0.24, steps=3, n=10)
b.loft([R(0.44, 0.1, 16), R(0.3, 0.15, 16), R(0.26, 0.2, 16)], "a")
b.loft([R(0.25, 0.18, 12, 1.0, 0.0), R(0.19, 0.36, 12, 1.0, 0.02), R(0.12, 0.52, 12, 1.0, 0.08), R(0.06, 0.64, 12, 1.0, 0.17), R(0.012, 0.7, 12, 1.0, 0.27)], "a")
b.band([(0.252, 0.185), (0.232, 0.245)], 0, 360, "g", t=0.013, n=14)
b.box(0.075, 0.022, 0.075, "d", loc=(0, -0.258, 0.215), bevel=0.012)
b.ell(0.026, 0.02, 0.026, "g", loc=(0.12, -0.13, 0.4), n=6, m=3)
b.ell(0.022, 0.02, 0.022, "g", loc=(-0.07, -0.1, 0.5), n=6, m=3)
b.finish()

# Golem : cristal à facettes serti dans la roche, éclats.
b = Body("SkHeadGolem", sharp=1.0)
b.ell(0.14, 0.14, 0.1, "a", loc=(0, 0, -0.27), n=6, m=3, jit=0.12, seed=31)
b.ell(0.2, 0.2, 0.3, "g", loc=(0, 0, 0.06), n=6, m=4)
for k in range(5):
    a = math.radians(k * 72 + 36)
    b.ell(0.13, 0.12, 0.14, "a" if k % 2 == 0 else "c", loc=(math.sin(a) * 0.19, -math.cos(a) * 0.19, -0.14), n=6, m=3, jit=0.15, seed=33 + k)
both(lambda s: b.ell(0.1, 0.07, 0.06, "c", loc=(s * 0.11, -0.16, 0.14), n=6, m=3, jit=0.12, seed=41 + s))
both(lambda s: b.box(0.06, 0.04, 0.03, "c", loc=(s * 0.075, -0.19, 0.06)))
b.cyl(0.05, 0.0, 0.22, "g", loc=(0.12, 0.08, 0.3), n=4, tf=rot(ry=0.4))
b.cyl(0.045, 0.0, 0.18, "g", loc=(-0.1, 0.1, 0.27), n=4, tf=rot(ry=-0.5))
b.finish()
