import math
from rig import Model, charge, faint_clip

STEEL = 0xb4bcc8
RED = 0xd8344a
BLUE = 0x3a6ad8


def build() -> Model:
    m = Model('magneton', height=1.6, attack_style='cast', attack_duration=0.3)
    m.bone('root', (0, 0, 0))
    m.bone('cluster', (0, 0.9, 0), 'root')
    for i, (x, y, z, s) in enumerate(((0, 0.32, 0.05, 1.1), (0.32, -0.15, 0, 1), (-0.32, -0.15, 0, 1))):
        bone = m.bone(f'mite{i}', (x, 0.9 + y, z), 'cluster')
        with m.frame((x, 0.9 + y, z), (0, 0, 0), s):
            m.blob(bone, (0, 0, 0), 0.2, STEEL, family=f'mite{i}')
            m.sphere(bone, (0, 0.01, 0.17), (0.09, 0.09, 0.04), 0xf3f1ea, material=charge(0xfff3a0))
            m.sphere(bone, (0, 0.01, 0.2), (0.04, 0.04, 0.02), 0x1c1c22, material='gloss')
            for sx in (1, -1):
                m.torus(bone, (sx * 0.26, 0, 0), 0.09, 0.03, STEEL, rot=(0, math.pi / 2, math.pi / 2 if sx > 0 else -math.pi / 2), arc=math.pi, material='metal')
                m.box(bone, (sx * 0.26, 0.09, 0), (0.06, 0.05, 0.06), RED, bevel=0.3)
                m.box(bone, (sx * 0.26, -0.09, 0), (0.06, 0.05, 0.06), BLUE, bevel=0.3)
            m.cylinder(bone, (0, 0.23, 0), 0.025, 0.025, 0.1, 0x8a929e, material='metal')
            for k in range(3):
                a = k / 3 * math.tau
                m.cylinder(bone, (math.cos(a) * 0.12, -0.12, math.sin(a) * 0.12), 0.012, 0.018, 0.05, 0x8a929e, material='metal')
    m.socket('muzzle', 'cluster', (0, 1.0, 0.3))

    @m.clip('idle', 3.0)
    def idle(u):
        t = u * math.tau
        pose = {'cluster': {'rot': (0, math.sin(t) * 0.25, 0), 'loc': (0, math.sin(t * 2) * 0.06, 0)}}
        for i in range(3):
            pose[f'mite{i}'] = {'rot': (0, 0, math.sin(t * 3 + i * 2) * 0.15)}
        return pose

    @m.clip('walk', 1.0)
    def walk(u):
        return idle(u)

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        # Zap: the trio pulses outward.
        k = max(0.0, 1 - u * 2.5)
        return {f'mite{i}': {'scale': 1 + k * 0.12} for i in range(3)}

    faint_clip(m)
    return m
