"""
Procedural character modelling for Clash of Pokémons, run inside Blender.

A species is described in "game space" — the same axes the three.js client uses: X right,
Y up, Z forward (the model faces +Z), one unit = one arena tile. This module turns that
description into a skinned, animated glTF:

- Organic bodies are metaballs grouped into families. Parts in one family melt into each
  other (a head flowing into a neck), parts in different families stay separate (two legs).
- Details that should stay crisp (eyes, horns, claws, wings) are rigid meshes bound to one bone.
- Every bone is a short vertical stick whose head is the pivot. With that convention a
  bone's local axes equal game axes, so poses below are written as game-space euler angles
  and offsets, exactly like the old hand-built three.js joints.
- Animation clips are Python functions sampled into keyframes.

Colours live in a vertex colour attribute; a handful of shared materials carry surface
response (skin, gloss, metal) and emissive "glow_*" materials that the client animates.
"""
from __future__ import annotations

import math
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Callable, Iterable

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

FPS = 30
# A metaball's visible surface sits at this fraction of its influence radius (stiffness 2,
# threshold 0.6), measured empirically. Used to size blobs to the radii we ask for.
META_SURFACE = 0.575

# game (x, y up, z forward) -> blender (x, y forward is -y, z up)
_C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
_C4 = _C.to_4x4()
_CI4 = _C.transposed().to_4x4()


def to_blender(v) -> Vector:
    x, y, z = v
    return Vector((x, -z, y))


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hex_color: int) -> tuple[float, float, float, float]:
    r = ((hex_color >> 16) & 255) / 255
    g = ((hex_color >> 8) & 255) / 255
    b = (hex_color & 255) / 255
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


def euler3(rot) -> Matrix:
    """Game-space XYZ euler (three.js default order) as a 3x3 matrix."""
    return Euler(rot, 'XYZ').to_matrix()


# --------------------------------------------------------------------------- parts


@dataclass
class Blob:
    family: str
    bone: str
    kind: str  # 'ELLIPSOID' | 'CAPSULE'
    center: Vector  # game space
    radii: Vector  # visible radii, game axes (capsule: radius in x, half-length in y)
    rot: Matrix  # game-space orientation
    color: int
    stiffness: float = 2.0


@dataclass
class Detail:
    bone: str
    verts: list[Vector]  # game space, final
    faces: list[tuple[int, ...]]
    color: int
    material: str
    smooth: bool = True
    # Surface snapping: (origin, anchor, sink, family). The detail moves so `anchor` lands
    # `sink` below where a ray from `origin` through `anchor` leaves that family's surface.
    snap: tuple[Vector, Vector, float, str] | None = None


@dataclass
class Clip:
    name: str
    seconds: float
    fn: Callable[[float], dict]
    loop: bool


@dataclass
class Model:
    name: str
    height: float
    attack_style: str
    attack_duration: float = 0.5
    fly_height: float = 0.0
    # Metaball grid size; smaller = smoother but heavier.
    resolution: float | None = None
    bones: dict[str, tuple[Vector, str | None]] = field(default_factory=dict)
    blobs: list[Blob] = field(default_factory=list)
    details: list[Detail] = field(default_factory=list)
    clips: list[Clip] = field(default_factory=list)
    empties: dict[str, tuple[str, Vector]] = field(default_factory=dict)
    _frames: list[Matrix] = field(default_factory=lambda: [Matrix.Identity(4)])
    _snaps: list[tuple[Vector, Vector, float, str]] = field(default_factory=list)

    # ---- skeleton -----------------------------------------------------------

    def bone(self, name: str, head, parent: str | None = None) -> str:
        """A pivot at `head` (game space, absolute)."""
        assert name not in self.bones, f'duplicate bone {name}'
        assert parent is None or parent in self.bones, f'{name}: unknown parent {parent}'
        self.bones[name] = (Vector(head), parent)
        return name

    def socket(self, name: str, bone: str, pos):
        """A named point riding on a bone (e.g. 'muzzle' where projectiles start)."""
        self.empties[name] = (bone, self._xf(Vector(pos)))

    # ---- local frames -------------------------------------------------------

    @contextmanager
    def frame(self, pos=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
        """Positions inside the block are relative to this frame (nests)."""
        s = Matrix.Diagonal((scale, scale, scale, 1)) if not isinstance(scale, tuple) else Matrix.Diagonal((*scale, 1))
        m = self._frames[-1] @ Matrix.Translation(Vector(pos)) @ euler3(rot).to_4x4() @ s
        self._frames.append(m)
        try:
            yield
        finally:
            self._frames.pop()

    @contextmanager
    def on(self, origin, anchor, sink: float = 0.0, family: str = 'body'):
        """Details inside sit on the generated surface. Metaballs swell where they overlap,
        so features like eyes are placed by raycast from `origin` (a point inside the body)
        through `anchor` (where the feature roughly is) instead of by hand-tuned depth."""
        self._snaps.append((self._xf(Vector(origin)), self._xf(Vector(anchor)), sink, family))
        try:
            yield
        finally:
            self._snaps.pop()

    def _xf(self, p: Vector) -> Vector:
        return (self._frames[-1] @ p.to_4d()).to_3d()

    def _xrot(self, rot) -> Matrix:
        return self._frames[-1].to_3x3().normalized() @ euler3(rot)

    def _xscale(self) -> float:
        return self._frames[-1].to_3x3().median_scale

    # ---- organic parts (metaballs) ------------------------------------------

    def blob(self, bone: str, center, radii, color: int, family: str = 'body', rot=(0, 0, 0), stiffness: float = 2.0):
        """An ellipsoid that melts into other blobs of the same family."""
        r = radii if isinstance(radii, (tuple, list)) else (radii, radii, radii)
        k = self._xscale()
        self.blobs.append(Blob(family, bone, 'ELLIPSOID', self._xf(Vector(center)), Vector(r) * k, self._xrot(rot), color, stiffness))

    def limb(self, bone: str, a, b, radius: float, color: int, family: str = 'body', stiffness: float = 2.0):
        """A capsule from point a to b."""
        pa, pb = self._xf(Vector(a)), self._xf(Vector(b))
        mid = (pa + pb) / 2
        axis = pb - pa
        half = axis.length / 2
        rot = Vector((0, 1, 0)).rotation_difference(axis.normalized()).to_matrix() if half > 1e-6 else Matrix.Identity(3)
        k = self._xscale()
        self.blobs.append(Blob(family, bone, 'CAPSULE', mid, Vector((radius * k, half, radius * k)), rot, color, stiffness))

    # ---- rigid details ------------------------------------------------------

    def _add(self, bone: str, local_verts: Iterable[Vector], faces, color: int, material: str, local_matrix: Matrix, smooth=True):
        m = self._frames[-1] @ local_matrix
        verts = [(m @ v.to_4d()).to_3d() for v in local_verts]
        self.details.append(Detail(bone, verts, list(faces), color, material, smooth, self._snaps[-1] if self._snaps else None))

    @staticmethod
    def _place(pos, rot, scale) -> Matrix:
        s = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
        return Matrix.Translation(Vector(pos)) @ euler3(rot).to_4x4() @ Matrix.Diagonal((*s, 1))

    def sphere(self, bone, pos, radii, color, rot=(0, 0, 0), material='skin', segments=None):
        r = radii if isinstance(radii, (tuple, list)) else (radii, radii, radii)
        # Small features need far fewer segments to look round at battle zoom.
        size = max(r) * self._xscale()
        segments = segments or ((16, 11) if size > 0.12 else (12, 8) if size > 0.04 else (8, 6))
        verts, faces = _uv_sphere(*segments)
        self._add(bone, verts, faces, color, material, self._place(pos, rot, r))

    def dome(self, bone, pos, radii, color, rot=(0, 0, 0), material='skin'):
        """Upper half of a sphere (+Y)."""
        r = radii if isinstance(radii, (tuple, list)) else (radii, radii, radii)
        verts, faces = _uv_sphere(20, 14, half=True)
        self._add(bone, verts, faces, color, material, self._place(pos, rot, r))

    def cone(self, bone, pos, radius, height, color, rot=(0, 0, 0), material='skin', squash=(1.0, 1.0), segments=16):
        """Cone pointing +Y, centred on `pos` (like THREE.ConeGeometry)."""
        verts, faces = _cone(segments)
        self._add(bone, verts, faces, color, material, self._place(pos, rot, (radius * squash[0], height, radius * squash[1])))

    def cylinder(self, bone, pos, r_top, r_bottom, height, color, rot=(0, 0, 0), material='skin', segments=16):
        verts, faces = _cylinder(segments, r_top, r_bottom)
        self._add(bone, verts, faces, color, material, self._place(pos, rot, (1, height, 1)))

    def box(self, bone, pos, size, color, rot=(0, 0, 0), material='skin', bevel=0.15):
        verts, faces = _rounded_box(bevel)
        self._add(bone, verts, faces, color, material, self._place(pos, rot, size), smooth=bevel > 0)

    def torus(self, bone, pos, radius, tube, color, rot=(0, 0, 0), arc=math.tau, material='skin'):
        """Ring in the XY plane around Z (like THREE.TorusGeometry)."""
        verts, faces = _torus(radius, tube, arc)
        self._add(bone, verts, faces, color, material, self._place(pos, rot, 1))

    def flat(self, bone, outline, depth, color, pos=(0, 0, 0), rot=(0, 0, 0), material='skin', scale=1.0):
        """A 2D outline (XY) extruded `depth` along Z — wings, fins, leaves, flames."""
        verts, faces = _extrude(outline, depth)
        self._add(bone, verts, faces, color, material, self._place(pos, rot, scale), smooth=False)

    def eye(self, bone, pos, r, *, sclera=False, iris=None, yaw=0.0, tall=1.3, pitch=0.0, on=None, family='body'):
        """A Pokémon eye: glossy dark oval with a catchlight, optionally white and coloured iris.
        `on` (a point inside the head) seats it on the head's real surface."""
        if on is not None:
            with self.on(on, pos, sink=r * 0.18, family=family):
                self.eye(bone, pos, r, sclera=sclera, iris=iris, yaw=yaw, tall=tall, pitch=pitch)
            return
        with self.frame(pos, (pitch, yaw, 0)):
            if sclera:
                self.sphere(bone, (0, 0, -r * 0.25), (r * 1.25, r * 1.25 * tall, r * 0.55), 0xf7f7f2, material='gloss')
            if iris is not None:
                self.sphere(bone, (0, 0, 0), (r * 0.9, r * 0.9 * tall * 0.95, r * 0.5), iris, material='gloss')
                self.sphere(bone, (0, 0, r * 0.12), (r * 0.5, r * 0.5 * tall, r * 0.45), 0x1c1c22, material='gloss')
            else:
                self.sphere(bone, (0, 0, 0), (r, r * tall, r * 0.5), 0x1c1c22, material='gloss')
            self.sphere(bone, (r * 0.32, r * 0.45, r * 0.4), (r * 0.32, r * 0.32, r * 0.18), 0xffffff, material='gloss', segments=(8, 6))

    # ---- animation ----------------------------------------------------------

    def clip(self, name: str, seconds: float, loop: bool = True):
        """Decorator: fn(u in 0..1) -> {bone: {'rot': (x,y,z), 'loc': (x,y,z), 'scale': s | (x,y,z)}}."""

        def wrap(fn):
            self.clips.append(Clip(name, seconds, fn, loop))
            return fn

        return wrap


# --------------------------------------------------------------------------- primitives (game space)


def _uv_sphere(seg_u: int, seg_v: int, half=False):
    verts = [Vector((0, 1, 0))]
    rows = seg_v // 2 if half else seg_v - 1
    for i in range(1, rows + 1):
        phi = math.pi * i / seg_v
        for j in range(seg_u):
            th = math.tau * j / seg_u
            verts.append(Vector((math.sin(phi) * math.sin(th), math.cos(phi), math.sin(phi) * math.cos(th))))
    faces = [(0, 1 + (j + 1) % seg_u, 1 + j) for j in range(seg_u)]
    for i in range(rows - 1):
        a, b = 1 + i * seg_u, 1 + (i + 1) * seg_u
        for j in range(seg_u):
            j2 = (j + 1) % seg_u
            faces.append((a + j, a + j2, b + j2, b + j))
    if half:
        last = 1 + (rows - 1) * seg_u
        verts.append(Vector((0, 0, 0)))
        c = len(verts) - 1
        faces += [(last + j, last + (j + 1) % seg_u, c) for j in range(seg_u)]
    else:
        verts.append(Vector((0, -1, 0)))
        s = len(verts) - 1
        last = 1 + (rows - 1) * seg_u
        faces += [(last + j, last + (j + 1) % seg_u, s) for j in range(seg_u)]
    return verts, faces


def _cone(seg: int):
    verts = [Vector((0, 0.5, 0))] + [Vector((math.sin(math.tau * j / seg), -0.5, math.cos(math.tau * j / seg))) for j in range(seg)]
    verts.append(Vector((0, -0.5, 0)))
    faces = [(0, 1 + (j + 1) % seg, 1 + j) for j in range(seg)]
    faces += [(1 + j, 1 + (j + 1) % seg, seg + 1) for j in range(seg)]
    return verts, faces


def _cylinder(seg: int, rt: float, rb: float):
    top = [Vector((math.sin(math.tau * j / seg) * rt, 0.5, math.cos(math.tau * j / seg) * rt)) for j in range(seg)]
    bot = [Vector((math.sin(math.tau * j / seg) * rb, -0.5, math.cos(math.tau * j / seg) * rb)) for j in range(seg)]
    verts = top + bot + [Vector((0, 0.5, 0)), Vector((0, -0.5, 0))]
    faces = [(j, (j + 1) % seg, seg + (j + 1) % seg, seg + j) for j in range(seg)]
    faces += [(2 * seg, (j + 1) % seg, j) for j in range(seg)]
    faces += [(2 * seg + 1, seg + j, seg + (j + 1) % seg) for j in range(seg)]
    return verts, faces


def _rounded_box(bevel: float):
    # A unit cube (-0.5..0.5) with corners pulled in: cheap "rounded" look once smooth shaded.
    verts, faces = _uv_sphere(12, 8)
    out = []
    for v in verts:
        # Superellipse: push sphere points towards cube faces.
        p = 2.0 / max(bevel, 0.05) if bevel > 0 else 40
        n = (abs(v.x) ** p + abs(v.y) ** p + abs(v.z) ** p) ** (1 / p)
        out.append(v / (2 * n) if n > 0 else v)
    return out, faces


def _torus(radius: float, tube: float, arc: float, radial=10, tubular=28):
    verts, faces = [], []
    closed = abs(arc - math.tau) < 1e-6
    steps = tubular if closed else tubular + 1
    for i in range(steps):
        u = arc * i / tubular
        for j in range(radial):
            v = math.tau * j / radial
            x = (radius + tube * math.cos(v)) * math.cos(u)
            y = (radius + tube * math.cos(v)) * math.sin(u)
            z = tube * math.sin(v)
            verts.append(Vector((x, y, z)))
    for i in range(tubular):
        i2 = (i + 1) % steps
        for j in range(radial):
            j2 = (j + 1) % radial
            faces.append((i * radial + j, i2 * radial + j, i2 * radial + j2, i * radial + j2))
    return verts, faces


def _extrude(outline, depth):
    n = len(outline)
    front = [Vector((x, y, depth / 2)) for x, y in outline]
    back = [Vector((x, y, -depth / 2)) for x, y in outline]
    verts = front + back
    faces = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
    faces += [(i, n + i, n + (i + 1) % n, (i + 1) % n) for i in range(n)]
    return verts, faces


# --------------------------------------------------------------------------- materials


def _material(name: str):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    rough, metal = {'skin': (0.62, 0.0), 'gloss': (0.15, 0.0), 'metal': (0.32, 0.65), 'matte': (0.92, 0.0)}.get(name.split('_')[0], (0.6, 0.0))
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if name.startswith('glow_') or name.startswith('charge_'):
        hexc = int(name.split('_')[1], 16)
        bsdf.inputs['Emission Color'].default_value = rgba(hexc)
        bsdf.inputs['Emission Strength'].default_value = 1.0
        bsdf.inputs['Roughness'].default_value = 0.9
    return mat


def glow(hex_color: int) -> str:
    """Always-lit emissive part (flames, gems); the client flickers and boosts it."""
    return f'glow_{hex_color:06x}'


def charge(hex_color: int) -> str:
    """Emissive part that only lights up while attacking or using a special (cheeks, eyes)."""
    return f'charge_{hex_color:06x}'


# --------------------------------------------------------------------------- build


def _reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'


def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _activate(obj):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def _blob_metric(b: Blob, p_game: Vector) -> float:
    """Normalised distance: <1 inside the blob's visible surface."""
    local = b.rot.transposed() @ (p_game - b.center)
    if b.kind == 'CAPSULE':
        y = max(-b.radii.y, min(b.radii.y, local.y))
        return Vector((local.x, local.y - y, local.z)).length / b.radii.x
    return Vector((local.x / b.radii.x, local.y / b.radii.y, local.z / b.radii.z)).length


def _family_mesh(model: Model, family: str, blobs: list[Blob], res: float, max_faces: int):
    mb = bpy.data.metaballs.new(f'{family}')
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = 0.6
    for b in blobs:
        if b.kind == 'CAPSULE':
            el = mb.elements.new(type='CAPSULE')
            el.radius = b.radii.x / META_SURFACE
            # Blender capsules run along their local X; ours run along game local Y.
            el.rotation = Vector((1, 0, 0)).rotation_difference(_C @ b.rot @ Vector((0, 1, 0)))
            el.size_x = b.radii.y
        else:
            rot_b = (_C @ b.rot @ _C.transposed()).to_quaternion()
            el = mb.elements.new(type='ELLIPSOID')
            r0 = max(b.radii) / META_SURFACE
            el.radius = r0
            # Element local axes are blender axes before rotation: x=game x, y=game -z, z=game y.
            el.size_x = b.radii.x / (META_SURFACE * r0)
            el.size_y = b.radii.z / (META_SURFACE * r0)
            el.size_z = b.radii.y / (META_SURFACE * r0)
            el.rotation = rot_b
        el.co = to_blender(b.center)
        el.stiffness = b.stiffness
    obj = _link(bpy.data.objects.new(f'mb_{family}', mb))
    _activate(obj)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.active_object
    if len(obj.data.polygons) > max_faces:
        dec = obj.modifiers.new('dec', 'DECIMATE')
        dec.ratio = max_faces / len(obj.data.polygons)
        bpy.ops.object.modifier_apply(modifier=dec.name)
    me = obj.data
    for poly in me.polygons:
        poly.use_smooth = True
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    groups: dict[str, bpy.types.VertexGroup] = {}
    for v in me.vertices:
        p = Vector((v.co.x, v.co.z, -v.co.y))  # blender -> game
        metrics = [(_blob_metric(b, p), b) for b in blobs]
        nearest = min(metrics, key=lambda t: t[0])[1]
        col.data[v.index].color = rgba(nearest.color)
        weights: dict[str, float] = {}
        for s, b in metrics:
            w = math.exp(-max(0.0, s - 1.0) * 4.0) if s > 1 else 1.0 + (1.0 - s) * 0.5
            weights[b.bone] = weights.get(b.bone, 0.0) + w
        top = sorted(weights.items(), key=lambda kv: -kv[1])[:3]
        total = sum(w for _, w in top)
        for bone, w in top:
            if w / total < 0.02:
                continue
            g = groups.get(bone) or obj.vertex_groups.new(name=bone)
            groups[bone] = g
            g.add([v.index], w / total, 'REPLACE')
    me.materials.append(_material('skin'))
    return obj


def _snap_details(model: Model, family_objs: dict[str, object]):
    from mathutils.bvhtree import BVHTree

    deps = bpy.context.evaluated_depsgraph_get()
    trees = {fam: BVHTree.FromObject(obj, deps) for fam, obj in family_objs.items()}
    moved: dict[tuple, Vector] = {}
    for d in model.details:
        if not d.snap:
            continue
        origin, anchor, sink, family = d.snap
        key = (tuple(origin), tuple(anchor), sink, family)
        if key not in moved:
            tree = trees.get(family)
            assert tree is not None, f'{model.name}: snap to unknown family {family}'
            direction = (anchor - origin).normalized()
            hit, _, _, _ = tree.ray_cast(to_blender(origin), to_blender(direction))
            assert hit is not None, f'{model.name}: snap ray from {tuple(origin)} towards {tuple(anchor)} missed {family}'
            surface = Vector((hit.x, hit.z, -hit.y))
            moved[key] = surface - direction * sink - anchor
        delta = moved[key]
        d.verts = [v + delta for v in d.verts]


def _detail_mesh(d: Detail, i: int):
    me = bpy.data.meshes.new(f'detail{i}')
    me.from_pydata([tuple(to_blender(v)) for v in d.verts], [], d.faces)
    me.validate()
    for poly in me.polygons:
        poly.use_smooth = d.smooth
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    c = rgba(d.color)
    for k in range(len(me.vertices)):
        col.data[k].color = c
    me.materials.append(_material(d.material))
    obj = _link(bpy.data.objects.new(f'detail{i}', me))
    g = obj.vertex_groups.new(name=d.bone)
    g.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
    return obj


def _armature(model: Model):
    data = bpy.data.armatures.new('rig')
    arm = _link(bpy.data.objects.new('rig', data))
    _activate(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    stick = model.height * 0.06
    for name, (head, parent) in model.bones.items():
        eb = data.edit_bones.new(name)
        h = to_blender(head)
        eb.head = h
        eb.tail = h + Vector((0, 0, stick))
        eb.roll = 0
        if parent:
            eb.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    # The convention everything below relies on: bone local axes == game axes.
    for b in data.bones:
        diff = b.matrix_local.to_3x3() - _C
        assert sum(diff[i][j] ** 2 for i in range(3) for j in range(3)) < 1e-8, f'{b.name}: unexpected bone frame {b.matrix_local.to_3x3()}'
    return arm


def _bake_clips(model: Model, arm):
    arm.animation_data_create()
    ad = arm.animation_data
    for b in arm.pose.bones:
        b.rotation_mode = 'XYZ'
    for clip in model.clips:
        act = bpy.data.actions.new(clip.name)
        ad.action = act
        frames = max(2, round(clip.seconds * FPS))
        for f in range(frames + 1):
            u = f / frames
            if clip.loop and f == frames:
                u = 0.0  # close the loop exactly
            pose = clip.fn(u)
            for pb in arm.pose.bones:
                key = pose.get(pb.name, {})
                pb.rotation_euler = key.get('rot', (0, 0, 0))
                pb.location = key.get('loc', (0, 0, 0))
                s = key.get('scale', 1.0)
                pb.scale = s if isinstance(s, (tuple, list)) else (s, s, s)
                pb.keyframe_insert('rotation_euler', frame=f + 1)
                pb.keyframe_insert('location', frame=f + 1)
                pb.keyframe_insert('scale', frame=f + 1)
        track = ad.nla_tracks.new()
        track.name = clip.name
        track.strips.new(clip.name, 1, act)
        ad.action = None
    for pb in arm.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def build(model: Model, out_path: str) -> dict:
    _reset()
    assert 'root' in model.bones, 'every model needs a root bone'
    assert any(c.name == 'idle' for c in model.clips), f'{model.name}: needs an idle clip'
    arm = _armature(model)
    res = model.resolution or model.height / 38
    families: dict[str, list[Blob]] = {}
    for b in model.blobs:
        families.setdefault(b.family, []).append(b)
    family_objs = {fam: _family_mesh(model, fam, bl, res, 2200 if fam == 'body' else 700) for fam, bl in families.items()}
    _snap_details(model, family_objs)
    parts = list(family_objs.values())
    parts += [_detail_mesh(d, i) for i, d in enumerate(model.details)]
    _activate(parts[0])
    for p in parts:
        p.select_set(True)
    bpy.ops.object.join()
    mesh = bpy.context.active_object
    mesh.name = model.name
    mesh.parent = arm
    mod = mesh.modifiers.new('armature', 'ARMATURE')
    mod.object = arm

    bpy.context.view_layer.update()
    for name, (bone, pos) in model.empties.items():
        e = _link(bpy.data.objects.new(name, None))
        e.parent = arm
        e.parent_type = 'BONE'
        e.parent_bone = bone
        bpy.context.view_layer.update()
        e.matrix_world = Matrix.Translation(to_blender(pos))

    _bake_clips(model, arm)
    _activate(arm)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_vertex_color='MATERIAL',
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        # Draco shrinks the meshes ~5x; the client decodes with three's bundled decoder.
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_color_quantization=8,
        export_draco_generic_quantization=12,
    )
    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    return {
        'height': model.height,
        'flyHeight': model.fly_height,
        'attackStyle': model.attack_style,
        'attackDuration': model.attack_duration,
        'clips': [c.name for c in model.clips],
        'triangles': tris,
    }


# --------------------------------------------------------------------------- motion helpers (mirror the old motion.ts)


def clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def ease_out(t: float) -> float:
    return 1 - (1 - t) ** 3


def ease_in_out(t: float) -> float:
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def strike(a: float) -> float:
    """Attack shape: anticipation (to -0.55), snap through the hit at a≈0.38 (to 1), settle."""
    if a < 0.22:
        return -math.sin((a / 0.22) * (math.pi / 2)) * 0.55
    if a < 0.38:
        return -0.55 + 1.55 * ease_out((a - 0.22) / 0.16)
    return 1 - ease_in_out((a - 0.38) / 0.62)


def flap(u: float) -> float:
    """Wing beat for one cycle: quick downstroke, slower recovery. Returns -1..1."""
    c = u % 1
    return -math.cos((c / 0.4) * math.pi) if c < 0.4 else math.cos(((c - 0.4) / 0.6) * math.pi)


def merge(*poses: dict) -> dict:
    """Combine bone poses: rotations and offsets add, scales multiply."""
    out: dict = {}
    for pose in poses:
        for bone, key in pose.items():
            cur = out.setdefault(bone, {})
            for k, v in key.items():
                if k == 'scale':
                    a = cur.get('scale', 1.0)
                    av = a if isinstance(a, (tuple, list)) else (a, a, a)
                    bv = v if isinstance(v, (tuple, list)) else (v, v, v)
                    cur['scale'] = tuple(x * y for x, y in zip(av, bv))
                else:
                    a = cur.get(k, (0, 0, 0))
                    cur[k] = tuple(x + y for x, y in zip(a, v))
    return out


def faint_clip(model: Model, root: str = 'root', fall: float = 0.0):
    """Default faint: topple sideways, sink, shrink away at the very end. `fall` drops fliers."""

    @model.clip('faint', 1.0, loop=False)
    def _faint(u):
        f = clamp01(u / 0.6) ** 3
        shrink = 1 - clamp01((u - 0.7) / 0.3) * 0.6
        return {root: {'rot': (0, 0, f * 1.35), 'loc': (0, -f * 0.15 - fall * clamp01(u * 1.6), 0), 'scale': shrink}}


# --------------------------------------------------------------------------- gaits (one cycle per u in 0..1)


def breath(u: float, cycles: int = 1, depth: float = 0.025):
    return 1 + math.sin(u * math.tau * cycles) * depth


def biped_walk(u, *, legs=('legL', 'legR'), arms=('armL', 'armR'), body='hips', root='root', head=None,
               swing=0.7, arm_swing=0.6, bob=0.05, lean=0.12, roll=0.05):
    t = u * math.tau
    s = math.sin(t)
    pose = {
        root: {'loc': (0, abs(math.cos(t)) * bob, 0)},
        body: {'rot': (lean, 0, math.sin(t) * roll)},
        legs[0]: {'rot': (s * swing, 0, 0)},
        legs[1]: {'rot': (-s * swing, 0, 0)},
    }
    if arms:
        pose[arms[0]] = {'rot': (-s * arm_swing, 0, 0)}
        pose[arms[1]] = {'rot': (s * arm_swing, 0, 0)}
    if head:
        pose[head] = {'rot': (-lean * 0.6, 0, -math.sin(t) * roll * 0.8)}
    return pose


def quad_walk(u, *, legs=('legFL', 'legFR', 'legBL', 'legBR'), body='body', root='root', head=None, swing=0.65, bob=0.04):
    t = u * math.tau
    s = math.sin(t)
    fl, fr, bl, br = legs
    pose = {
        root: {'loc': (0, abs(math.cos(t)) * bob, 0)},
        body: {'rot': (math.sin(t * 2) * 0.04, 0, math.sin(t) * 0.03)},
        fl: {'rot': (s * swing, 0, 0)}, br: {'rot': (s * swing, 0, 0)},
        fr: {'rot': (-s * swing, 0, 0)}, bl: {'rot': (-s * swing, 0, 0)},
    }
    if head:
        pose[head] = {'rot': (math.sin(t * 2 + 1) * 0.06, 0, 0)}
    return pose


def gallop(u, *, legs=('legFL', 'legFR', 'legBL', 'legBR'), body='body', root='root', head=None, swing=0.85, bob=0.1):
    """Front legs reach together, hind legs drive half a beat later; the body rocks."""
    t = u * math.tau
    fl, fr, bl, br = legs
    pose = {
        root: {'loc': (0, max(0.0, math.sin(t + 0.6)) * bob, 0)},
        body: {'rot': (math.sin(t + 1.6) * 0.09, 0, 0)},
        fl: {'rot': (math.sin(t) * swing, 0, 0)},
        fr: {'rot': (math.sin(t + 0.35) * swing, 0, 0)},
        bl: {'rot': (math.sin(t - 1.2) * swing, 0, 0)},
        br: {'rot': (math.sin(t - 0.85) * swing, 0, 0)},
    }
    if head:
        pose[head] = {'rot': (-math.sin(t + 1.6) * 0.1, 0, 0)}
    return pose


def wings(u, *, cycles=1, left='wingL', right='wingR', amount=0.7, body='body', bob=0.1):
    f = flap(u * cycles)
    return {left: {'rot': (0, 0, -f * amount)}, right: {'rot': (0, 0, f * amount)}, body: {'loc': (0, -f * bob, 0)}}
