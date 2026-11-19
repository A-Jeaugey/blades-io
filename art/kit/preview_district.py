# Planche de contrôle des pièces du quartier (district_pieces.py) : rendu
# EEVEE de trois quarts. Lancer : blender --background art/kit/cyber_kit.blend
# --python art/kit/preview_district.py   (écrit art/kit/preview.png)
import bpy, math, os

scene = bpy.context.scene
rows = [
    ["FacadeLite", "FacadeWin", "FacadeStrip", "FacadeBlank", "RoofEdge", "FacadeCorner"],
    ["FacadeShop", "FacadeDoor", "FacadeShutter", "FacadePlain", "RoofSign"],
    ["Container", "Car", "Dumpster", "Pallets", "Vending", "Terminal", "RoofAC"],
    ["Barrier", "Bench", "Planter", "Lamp", "Bollard", "Trash", "Cone", "RoofTank", "RoofAntenna"],
    ["HangSign", "SkyBridge"],
]
names = [n for r in rows for n in r]
for o in bpy.data.objects:
    o.hide_render = o.name not in names
y = 0.0
for r in rows:
    x = 0.0
    depth = 0.0
    for name in r:
        o = bpy.data.objects[name]
        w = max(o.dimensions.x, 1.0)
        o.location = (x + w / 2, y, 0)
        x += w + 1.2
        depth = max(depth, o.dimensions.y, 1.0)
    y -= depth + 3.5

sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 3.0
so = bpy.data.objects.new("sun", sun)
so.rotation_euler = (math.radians(55), 0, math.radians(-30))
scene.collection.objects.link(so)
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.08, 0.09, 0.12, 1)
scene.world = world

cam = bpy.data.cameras.new("cam")
cam.type = "ORTHO"
cam.ortho_scale = 34
co = bpy.data.objects.new("cam", cam)
co.location = (14, -38, 22)
co.rotation_euler = (math.radians(62), 0, 0)
scene.collection.objects.link(co)
scene.camera = co
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 2000
scene.render.resolution_y = 1500
scene.render.filepath = os.path.join(os.path.dirname(bpy.data.filepath), "preview.png")
bpy.ops.render.render(write_still=True)
