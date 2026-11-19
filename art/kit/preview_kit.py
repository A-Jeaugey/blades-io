# Planche de contrôle des petites pièces du kit (lames, power-ups, caisse) :
# rendu EEVEE vu de dessus, pour repérer un chanfrein raté avant de lancer
# le jeu. Lancer : blender --background art/kit/cyber_kit.blend --python
# art/kit/preview_kit.py   (écrit art/kit/preview.png)
import bpy, math, os

scene = bpy.context.scene
names = [f"Blade{t}" for t in range(10)] + [f"PowerUp{t}" for t in range(5)] + ["Crate"]
for o in bpy.data.objects:
    o.hide_render = o.name not in names
for i, name in enumerate(names):
    o = bpy.data.objects[name]
    col, row = i % 5, i // 5
    o.location = (col * 2.6, -row * 2.6, 0)
    if name.startswith("PowerUp"):
        # Modélisés debout (plan x/z) : couchés pour la vue de dessus.
        o.rotation_euler = (-math.pi / 2, 0, 0)

sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 3.0
so = bpy.data.objects.new("sun", sun)
so.rotation_euler = (math.radians(50), 0, math.radians(35))
scene.collection.objects.link(so)
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.06, 0.08, 1)
scene.world = world

cam = bpy.data.cameras.new("cam")
cam.type = "ORTHO"
cam.ortho_scale = 15
co = bpy.data.objects.new("cam", cam)
# Vue plongeante, un peu de biais pour lire les volumes.
co.location = (5.2, -11.5, 13)
co.rotation_euler = (math.radians(30), 0, 0)
scene.collection.objects.link(co)
scene.camera = co
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1600
scene.render.resolution_y = 1100
scene.render.filepath = os.path.join(os.path.dirname(bpy.data.filepath), "preview.png")
bpy.ops.render.render(write_still=True)
