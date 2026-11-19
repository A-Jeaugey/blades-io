# Pièces du quartier (mode « district », carte à murs : shared/src/maps.ts),
# ajoutées au kit par build_kit.py (exec, avant l'export). Mêmes règles que le
# reste du kit : des rôles, aucune couleur du jeu.
#
# Repère Blender : x à droite, z en haut, et -y vers l'extérieur d'une façade
# (le sud du jeu, une fois exporté).
#
# Façades : panneaux de 4 u de large (FACADE_MODULE) sur 4 u de haut
# (FLOOR_HEIGHT), mur dans le plan y = 0, reliefs vers -y. Le client les pose
# le long des côtés de chaque bâtiment (scene/v2/DistrictView.ts), d'où des
# côtés multiples de 4.
#
# Mobilier : aux dimensions de son collider (PROP_SHAPES), grand côté le
# long de x, centré, posé au sol.
#
# Rôles propres au quartier :
#   tint    surface dont la teinte vient du client, par sommet (murs,
#           carrosseries, conteneurs) ;
#   window  vitre : matériau sans éclairage, allumée ou éteinte par sommet ;
#   plant   feuillage des jardinières.

W, FH = 4.0, 4.0


def front(p, x0, x1, z0, z1, depth, mat, off=0.0, bevel=0.0):
    """Boîte plaquée sur la façade : de y = -off à y = -(off + depth)."""
    p.box(x1 - x0, depth, z1 - z0, mat, loc=((x0 + x1) / 2, -off - depth / 2, z0), bevel=bevel)


def slab(p):
    p.box(W, 0.25, FH, "tint", loc=(0, 0.125, 0))


def window(p, x0, x1, z0, z1, frame=0.09):
    front(p, x0 - frame, x1 + frame, z0 - frame, z1 + frame, 0.07, "body_mid")
    front(p, x0, x1, z0, z1, 0.03, "window", off=0.07)


def cyl(p, r, z0, z1, mat, n=8, loc=(0, 0, 0), r1=None, **kw):
    p.loft([ring(r, z0, n), ring(r if r1 is None else r1, z1, n)], mat, loc=loc, **kw)


# --- Étages ---------------------------------------------------------------
# Étage courant, léger : c'est lui qui couvre les hauteurs (des milliers
# d'exemplaires). Deux fenêtres et un bandeau.
p = Prop("FacadeLite")
slab(p)
front(p, -1.55, -0.45, 1.1, 3.0, 0.04, "window", off=0.0)
front(p, 0.45, 1.55, 1.1, 3.0, 0.04, "window", off=0.0)
front(p, -2, 2, 3.78, 4.0, 0.08, "body_mid")
p.finish()

# Habitation : fenêtres encadrées, appui, balcon, climatiseur.
p = Prop("FacadeWin")
slab(p)
window(p, -1.55, -0.45, 1.0, 3.0)
window(p, 0.45, 1.55, 1.4, 3.0)
front(p, -1.75, -0.25, 0.86, 0.94, 0.16, "body_mid")
# Balcon sous la fenêtre de gauche
p.box(1.7, 0.6, 0.08, "body_mid", loc=(-1.0, -0.3, 0.55))
for x in (-1.82, -0.18):
    p.box(0.05, 0.05, 0.75, "body", loc=(x, -0.57, 0.6))
p.box(1.7, 0.05, 0.05, "body", loc=(-1.0, -0.57, 1.33))
p.box(1.7, 0.03, 0.03, "body", loc=(-1.0, -0.57, 0.95))
# Climatiseur sous la fenêtre de droite
p.box(0.9, 0.42, 0.6, "body_mid", loc=(1.0, -0.21, 0.55), bevel=0.03)
p.box(0.6, 0.03, 0.4, "body", loc=(1.0, -0.435, 0.65))
front(p, -2, 2, 3.78, 4.0, 0.1, "body_mid")
p.finish()

# Bureaux : bandeau vitré continu, meneaux, filet lumineux.
p = Prop("FacadeStrip")
slab(p)
front(p, -2, 2, 1.2, 3.1, 0.06, "body")
for x0 in (-1.92, -0.6, 0.72):
    front(p, x0, x0 + 1.2, 1.3, 3.0, 0.03, "window", off=0.06)
front(p, -2, 2, 3.25, 3.31, 0.05, "e_screen")
front(p, -2, 2, 0.2, 0.9, 0.05, "body_mid")
front(p, -2, 2, 3.8, 4.0, 0.1, "body_mid")
p.finish()

# Industriel : mur aveugle nervuré, tuyau, grille d'aération, voyant.
p = Prop("FacadeBlank")
slab(p)
for x in (-1.5, -0.5, 0.5):
    front(p, x - 0.08, x + 0.08, 0, 4, 0.07, "body_mid")
cyl(p, 0.11, 0, 4, "body", n=6, loc=(1.5, -0.2, 0))
for z in (0.9, 2.9):
    p.box(0.32, 0.26, 0.08, "body_mid", loc=(1.5, -0.13, z))
front(p, -1.3, -0.7, 1.6, 2.5, 0.05, "body")
for i in range(4):
    front(p, -1.26, -0.74, 1.68 + i * 0.2, 1.76 + i * 0.2, 0.04, "body_mid", off=0.05)
front(p, 0.1, 0.22, 2.9, 3.02, 0.05, "e_pad")
front(p, -2, 2, 3.8, 4.0, 0.08, "body_mid")
p.finish()

# --- Rez-de-chaussée ------------------------------------------------------
# Boutique : vitrine, porte, auvent, enseigne.
p = Prop("FacadeShop")
slab(p)
front(p, -2, 2, 0, 0.45, 0.08, "body_mid")
window(p, -1.7, 0.6, 0.6, 2.7, frame=0.1)
front(p, 0.95, 1.8, 0, 2.6, 0.05, "body")
front(p, 1.0, 1.75, 1.3, 2.45, 0.02, "window", off=0.05)
front(p, 0.95, 1.8, 2.66, 2.72, 0.06, "e_halo")
# Auvent incliné au-dessus de la vitrine
p.box(2.7, 0.95, 0.06, "body", loc=(-0.55, -0.5, 2.92), rot_x=-0.22)
for x in (-1.8, 0.7):
    p.box(0.04, 0.9, 0.04, "body_mid", loc=(x, -0.5, 2.88), rot_x=-0.22)
# Enseigne
front(p, -1.6, 1.6, 3.2, 3.75, 0.14, "body", bevel=0.02)
front(p, -1.45, 1.45, 3.3, 3.65, 0.02, "e_neon", off=0.14)
p.finish()

# Entrée d'immeuble : double porte en retrait, marches, marquise, interphone.
p = Prop("FacadeDoor")
slab(p)
front(p, -2, 2, 0, 0.45, 0.08, "body_mid")
front(p, -1.0, 1.0, 0, 2.7, 0.1, "body_mid")
front(p, -0.85, -0.04, 0.12, 2.55, 0.03, "body", off=0.1)
front(p, 0.04, 0.85, 0.12, 2.55, 0.03, "body", off=0.1)
front(p, -0.7, -0.2, 1.5, 2.4, 0.02, "window", off=0.13)
front(p, 0.2, 0.7, 1.5, 2.4, 0.02, "window", off=0.13)
p.box(2.4, 0.5, 0.12, "paint", loc=(0, -0.25, 0))
p.box(2.9, 0.9, 0.1, "body", loc=(0, -0.45, 2.85))
front(p, -1.2, 1.2, 2.78, 2.84, 0.7, "e_halo", off=0.1)
front(p, 1.25, 1.45, 1.2, 1.55, 0.05, "body")
front(p, 1.3, 1.4, 1.38, 1.48, 0.02, "e_pad", off=0.05)
cyl(p, 0.07, 0, 4, "body", n=6, loc=(-1.7, -0.14, 0))
front(p, -2, 2, 3.8, 4.0, 0.08, "body_mid")
p.finish()

# Rideau de fer : garage ou quai, cadre à chevrons, gyrophare.
p = Prop("FacadeShutter")
slab(p)
front(p, -1.8, 1.8, 0, 3.2, 0.09, "body_mid")
for i in range(9):
    front(p, -1.6, 1.6, 0.06 + i * 0.33, 0.33 + i * 0.33, 0.05, "body", off=0.09)
front(p, -1.6, 1.6, 0.0, 0.06, 0.06, "paint", off=0.09)
front(p, -1.6, 1.6, 3.05, 3.2, 0.2, "body", off=0.09, bevel=0.02)
front(p, 1.34, 1.46, 3.3, 3.42, 0.1, "e_core")
front(p, -2, 2, 3.8, 4.0, 0.08, "body_mid")
p.finish()

# Soubassement nu : plinthe, gaine, panneau d'affichage.
p = Prop("FacadePlain")
slab(p)
front(p, -2, 2, 0, 0.6, 0.1, "body_mid")
p.box(4, 0.08, 0.08, "body", loc=(0, -0.07, 2.6))
p.box(0.3, 0.14, 0.4, "body_mid", loc=(-1.2, -0.07, 2.42))
front(p, 0.2, 1.5, 1.0, 2.3, 0.05, "body")
front(p, 0.28, 1.42, 1.08, 2.22, 0.02, "window", off=0.05)
front(p, 0.2, 1.5, 2.34, 2.4, 0.04, "e_screen", off=0.02)
front(p, -2, 2, 3.8, 4.0, 0.08, "body_mid")
p.finish()

# Angle : couvre le joint de deux façades (mis à l'échelle en hauteur).
p = Prop("FacadeCorner")
p.box(0.36, 0.36, FH, "body_mid", loc=(0, 0, 0))
p.finish()

# Acrotère : couronnement du toit, 4 u de long.
p = Prop("RoofEdge")
p.box(W, 0.4, 0.55, "body_mid", loc=(0, 0.1, 0))
p.box(W, 0.52, 0.1, "body", loc=(0, 0.1, 0.55))
front(p, -2, 2, 0.22, 0.3, 0.03, "e_neon", off=0.1)
p.finish()

# --- Toits ----------------------------------------------------------------
p = Prop("RoofAC")
p.box(2.0, 1.4, 1.0, "body_mid", loc=(0, 0, 0.15), bevel=0.04)
for x in (-0.5, 0.5):
    cyl(p, 0.38, 1.15, 1.22, "body", n=10, loc=(x, 0, 0))
for x in (-0.8, 0.8):
    for y in (-0.5, 0.5):
        p.box(0.12, 0.12, 0.15, "body", loc=(x, y, 0))
cyl(p, 0.09, 0, 0.7, "body", n=6, loc=(1.25, 0.3, 0))
p.finish()

p = Prop("RoofTank")
for a in range(4):
    ang = a * math.pi / 2 + Q
    p.box(0.12, 0.12, 1.3, "body", loc=(math.cos(ang) * 0.85, math.sin(ang) * 0.85, 0))
cyl(p, 1.15, 1.3, 3.5, "body_mid", n=12)
p.loft([ring(1.2, 3.5, 12), ring(0.15, 4.1, 12)], "body")
p.torus(1.16, 0.04, "body", loc=(0, 0, 2.2), n=12, m=4)
p.finish()

p = Prop("RoofAntenna")
p.box(0.5, 0.5, 0.3, "body_mid", loc=(0, 0, 0))
cyl(p, 0.07, 0.3, 6.0, "body", n=6, r1=0.03)
for z, s in ((2.2, 0.9), (3.4, 0.7), (4.5, 0.5)):
    p.box(s, 0.04, 0.04, "body", loc=(0, 0, z))
    p.box(0.04, s, 0.04, "body", loc=(0, 0, z + 0.15))
p.loft([ring(0.45, 1.5, 10), ring(0.1, 1.72, 10)], "body_mid", loc=(0.3, 0, 0), rot_y=0.9)
p.box(0.1, 0.1, 0.1, "e_core", loc=(0, 0, 6.0))
p.finish()

# Grand panneau de toit : écran vers -y.
p = Prop("RoofSign")
for x in (-2.4, 2.4):
    p.box(0.14, 0.14, 4.6, "body", loc=(x, 0.2, 0))
    p.box(0.1, 1.3, 0.1, "body", loc=(x, 0.8, 0.9), rot_x=0.6)
p.box(6.4, 0.22, 3.2, "body", loc=(0, 0, 1.5), bevel=0.03)
front(p, -3.05, 3.05, 1.65, 4.55, 0.02, "e_screen", off=0.11)
front(p, -3.2, 3.2, 1.42, 1.5, 0.03, "e_neon", off=0.11)
p.finish()

# --- Mobilier (dimensions de PROP_SHAPES) ---------------------------------
# Conteneur maritime 6 × 2,4 × 2,6 : flancs ondulés, montants, portes.
p = Prop("Container")
p.box(5.9, 2.3, 2.5, "tint", loc=(0, 0, 0.06))
for i in range(14):
    x = -2.6 + i * 0.4
    for y in (-1.17, 1.17):
        p.box(0.2, 0.06, 2.2, "tint", loc=(x, y, 0.2))
for sx in (-1, 1):
    for sy in (-1, 1):
        p.box(0.16, 0.16, 2.6, "body_mid", loc=(sx * 2.92, sy * 1.12, 0))
for z in (0, 2.5):
    for sy in (-1, 1):
        p.box(6.0, 0.14, 0.1, "body_mid", loc=(0, sy * 1.13, z))
    for sx in (-1, 1):
        p.box(0.14, 2.4, 0.1, "body_mid", loc=(sx * 2.93, 0, z))
for y in (-0.55, 0.55):
    p.box(0.06, 0.05, 2.2, "body", loc=(2.98, y, 0.2))
    p.box(0.06, 0.05, 2.2, "body", loc=(2.98, y * 0.2, 0.2))
p.box(0.05, 2.0, 0.08, "body", loc=(2.99, 0, 1.2))
p.finish()

# Voiture à sustentation 4,6 × 2 × 1,4 : pas de roues, lueur sous la caisse.
p = Prop("Car")
p.loft([[(-2.3, -0.92, 0.3), (2.1, -0.92, 0.3), (2.1, 0.92, 0.3), (-2.3, 0.92, 0.3)],
        [(-2.3, -1.0, 0.55), (2.3, -1.0, 0.5), (2.3, 1.0, 0.5), (-2.3, 1.0, 0.55)],
        [(-2.25, -0.96, 0.92), (2.1, -0.94, 0.8), (2.1, 0.94, 0.8), (-2.25, 0.96, 0.92)]], "tint", bevel=0.05)
p.loft([[(-1.7, -0.9, 0.9), (1.2, -0.9, 0.82), (1.2, 0.9, 0.82), (-1.7, 0.9, 0.9)],
        [(-1.2, -0.72, 1.38), (0.4, -0.72, 1.36), (0.4, 0.72, 1.36), (-1.2, 0.72, 1.38)]], "body", bevel=0.04)
p.box(1.5, 1.3, 0.05, "tint", loc=(-0.4, 0, 1.37))
for sx in (-1, 1):
    for sy in (-1, 1):
        p.box(0.9, 0.3, 0.2, "body", loc=(sx * 1.4, sy * 0.78, 0.12), bevel=0.04)
p.box(3.6, 1.2, 0.04, "e_pad", loc=(0, 0, 0.2))
for y in (-0.7, 0.7):
    p.box(0.06, 0.36, 0.1, "e_halo", loc=(2.3, y, 0.6))
p.box(0.06, 1.7, 0.07, "e_core", loc=(-2.3, 0, 0.72))
p.finish()

# Barrière de chantier 3 × 0,7 × 1 : profil en béton extrudé, bandes.
p = Prop("Barrier")
prof = [(-0.35, 0), (-0.35, 0.16), (-0.13, 0.46), (-0.1, 1.0), (0.1, 1.0), (0.13, 0.46), (0.35, 0.16), (0.35, 0)]
p.loft([[(-1.5, y, z) for y, z in prof], [(1.5, y, z) for y, z in prof]], "paint")
for x in (-0.9, 0.0, 0.9):
    for sy in (-1, 1):
        p.box(0.5, 0.02, 0.16, "e_core", loc=(x, sy * 0.125, 0.68))
p.finish()

# Benne 2,2 × 1,4 × 1,4
p = Prop("Dumpster")
p.loft([[(-0.95, -0.6, 0.15), (0.95, -0.6, 0.15), (0.95, 0.6, 0.15), (-0.95, 0.6, 0.15)],
        [(-1.1, -0.7, 1.15), (1.1, -0.7, 1.15), (1.1, 0.7, 1.15), (-1.1, 0.7, 1.15)]], "tint", bevel=0.03)
p.box(2.24, 0.75, 0.07, "body_mid", loc=(0, -0.34, 1.2), rot_x=0.16)
p.box(2.24, 0.72, 0.07, "body_mid", loc=(0, 0.36, 1.27), rot_x=-0.1)
for sx in (-1, 1):
    p.box(0.08, 1.0, 0.1, "body", loc=(sx * 1.12, 0, 0.85))
    for sy in (-1, 1):
        p.box(0.14, 0.14, 0.15, "body", loc=(sx * 0.8, sy * 0.5, 0))
p.finish()

# Distributeur 1,2 × 0,9 × 2,1 : façade lumineuse vers -y.
p = Prop("Vending")
p.box(1.2, 0.9, 2.1, "body", loc=(0, 0, 0), bevel=0.03)
p.box(0.7, 0.03, 1.2, "window", loc=(-0.17, -0.455, 0.7))
p.box(0.28, 0.03, 0.7, "e_screen", loc=(0.38, -0.455, 1.2))
p.box(0.28, 0.03, 0.2, "e_pad", loc=(0.38, -0.455, 0.85))
p.box(1.1, 0.03, 0.14, "e_neon", loc=(0, -0.455, 1.92))
p.box(0.7, 0.05, 0.22, "body_mid", loc=(-0.17, -0.46, 0.3))
p.finish()

# Banc 2,2 × 0,7 × 0,9
p = Prop("Bench")
p.box(2.2, 0.55, 0.08, "paint", loc=(0, -0.05, 0.42), bevel=0.02)
p.box(2.2, 0.08, 0.42, "paint", loc=(0, 0.3, 0.5), bevel=0.02)
for x in (-0.85, 0.85):
    p.box(0.1, 0.6, 0.42, "body_mid", loc=(x, 0, 0))
p.box(1.9, 0.04, 0.03, "e_pad", loc=(0, -0.28, 0.38))
p.finish()

# Jardinière 2,4 × 2,4 × 0,8 : bac en béton, terre, feuillage, filet de LED.
p = Prop("Planter")
for sx, sy, lx, ly in ((0, -1.08, 2.4, 0.24), (0, 1.08, 2.4, 0.24), (-1.08, 0, 0.24, 1.92), (1.08, 0, 0.24, 1.92)):
    p.box(lx, ly, 0.8, "paint", loc=(sx, sy, 0), bevel=0.02)
p.box(1.95, 1.95, 0.05, "soil", loc=(0, 0, 0.62))
p.box(2.44, 2.44, 0.05, "e_pad", loc=(0, 0, 0.08))
rng = random.Random(4)
for i in range(22):
    a = rng.random() * math.tau
    d = rng.random() * 0.8
    h = 0.7 + rng.random() * 1.0
    lean = (rng.random() - 0.5) * 0.5
    x, y = math.cos(a) * d, math.sin(a) * d
    p.loft([ring(0.1, 0.65, 3, a), [(x * 0.2 + lean * math.cos(a), y * 0.2 + lean * math.sin(a), 0.65 + h)] * 3], "plant", loc=(x, y, 0), cap=False)
p.finish()

# Palettes 1,4 × 1,4 × 1,2 : deux palettes, caisses sanglées.
p = Prop("Pallets")
for z in (0.0, 0.16):
    for i in range(5):
        p.box(1.4, 0.2, 0.03, "paint", loc=(0, -0.6 + i * 0.3, z + 0.11))
    for y in (-0.6, 0, 0.6):
        p.box(1.4, 0.1, 0.1, "paint", loc=(0, y, z))
p.box(1.2, 0.62, 0.55, "tint", loc=(0, -0.32, 0.31), bevel=0.02)
p.box(0.62, 0.6, 0.5, "tint", loc=(-0.3, 0.34, 0.31), bevel=0.02)
p.box(0.5, 0.5, 0.36, "body_mid", loc=(0.36, 0.34, 0.31), bevel=0.02)
p.box(0.9, 0.56, 0.3, "body_mid", loc=(0.05, -0.3, 0.86), bevel=0.02)
p.box(0.06, 0.66, 0.6, "body", loc=(0.2, -0.32, 0.3))
p.finish()

# Borne interactive 1 × 1 × 1,8 : pupitre incliné.
p = Prop("Terminal")
p.loft([ring(0.5, 0, 8, math.pi / 8), ring(0.42, 0.12, 8, math.pi / 8)], "body_mid")
p.loft([ring(0.3, 0.12, 4, Q, 1.0, 0.7), ring(0.36, 1.15, 4, Q, 1.0, 0.8)], "body", bevel=0.02)
p.box(0.72, 0.1, 0.62, "body", loc=(0, -0.12, 1.12), rot_x=-0.45, bevel=0.02)
p.box(0.6, 0.02, 0.48, "e_screen", loc=(0, -0.19, 1.2), rot_x=-0.45)
p.box(0.5, 0.2, 0.03, "e_pad", loc=(0, -0.36, 1.0), rot_x=0.2)
p.box(0.06, 0.06, 0.25, "e_neon", loc=(0, 0.1, 1.55))
p.finish()

# Lampadaire (collider 0,3 u) : mât et couronne lumineuse, sans orientation.
# Plus haut que la caméra à la troisième personne (6 à 7 u) : à sa hauteur,
# la couronne lui passait devant l'objectif.
p = Prop("Lamp")
LH = 8.6
cyl(p, 0.3, 0, 0.5, "body_mid", n=8, r1=0.16)
cyl(p, 0.1, 0.5, LH, "body", n=6, r1=0.07)
p.loft([ring(0.25, LH - 0.05, 10), ring(0.85, LH + 0.15, 10), ring(0.8, LH + 0.3, 10), ring(0.2, LH + 0.5, 10)], "body_mid")
p.disc(0.3, 0.78, "e_halo", z=LH + 0.1, n=10)
p.torus(0.85, 0.03, "e_halo", loc=(0, 0, LH + 0.2), n=14, m=4)
p.finish()

# Borne lumineuse (collider 0,3 u)
p = Prop("Bollard")
cyl(p, 0.26, 0, 0.12, "body_mid", n=8)
cyl(p, 0.18, 0.12, 0.82, "body", n=8)
cyl(p, 0.2, 0.82, 0.92, "e_screen", n=8)
cyl(p, 0.18, 0.92, 1.0, "body_mid", n=8, r1=0.1)
p.finish()

# --- Habillage sans collider ----------------------------------------------
# Enseigne suspendue : câble de 16 u (une avenue), caisson lumineux au milieu.
p = Prop("HangSign")
p.box(16, 0.04, 0.04, "body", loc=(0, 0, 1.75))
for x in (-2.2, 2.2):
    p.box(0.04, 0.04, 0.55, "body", loc=(x, 0, 1.2))
p.box(5.4, 0.3, 1.2, "body", loc=(0, 0, 0), bevel=0.03)
p.box(5.0, 0.02, 0.86, "e_neon", loc=(0, -0.16, 0.17))
p.box(5.0, 0.02, 0.86, "e_screen", loc=(0, 0.16, 0.17))
p.finish()

# Passerelle couverte : 16 u de portée, 3 de large, 3 de haut.
p = Prop("SkyBridge")
p.box(16, 3.0, 0.25, "body_mid", loc=(0, 0, 0))
p.box(16, 3.1, 0.2, "body", loc=(0, 0, 2.8))
for sy in (-1, 1):
    p.box(16, 0.12, 0.9, "tint", loc=(0, sy * 1.44, 0.25))
    p.box(16, 0.12, 0.45, "tint", loc=(0, sy * 1.44, 2.35))
    p.box(16, 0.04, 1.2, "window", loc=(0, sy * 1.44, 1.15))
    for i in range(9):
        p.box(0.1, 0.16, 2.55, "body_mid", loc=(-8 + i * 2, sy * 1.44, 0.25))
p.box(15, 0.5, 0.04, "e_pad", loc=(0, 0, -0.04))
p.finish()

# Sacs-poubelle : trois sacs avachis.
p = Prop("Trash")
for x, y, s in ((0, 0, 1.0), (0.5, 0.25, 0.8), (-0.1, 0.5, 0.7)):
    p.loft([ring(0.3 * s, 0, 7), ring(0.4 * s, 0.22 * s, 7, 0.3), ring(0.3 * s, 0.5 * s, 7, 0.6), ring(0.07 * s, 0.68 * s, 7)], "body", loc=(x, y, 0), smooth=True)
p.finish()

# Cône de chantier
p = Prop("Cone")
p.box(0.46, 0.46, 0.04, "body", loc=(0, 0, 0))
p.loft([ring(0.18, 0.04, 8), ring(0.045, 0.66, 8)], "e_core")
p.loft([ring(0.142, 0.3, 8), ring(0.11, 0.42, 8)], "paint")
p.finish()
