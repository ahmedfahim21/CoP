import math
from rig import Model, biped_walk, breath, clamp01, ease_in_out, faint_clip, flap, merge

GREEN = 0x7cc35a
CREAM = 0xf4ecc8
BLADE = 0xe8eef2
SCYTHE = [(0, 0), (0.08, 0.06), (0.2, 0.22), (0.3, 0.45), (0.32, 0.6), (0.24, 0.42), (0.1, 0.2), (-0.02, 0.06)]


def build() -> Model:
    m = Model('scyther', height=1.4, attack_style='spin', attack_duration=0.55)
    m.bone('root', (0, 0, 0))
    m.bone('spin', (0, 0, 0), 'root')
    m.bone('hips', (0, 0.45, -0.04), 'spin')
    m.bone('legL', (0.12, 0.45, -0.05), 'hips')
    m.bone('legR', (-0.12, 0.45, -0.05), 'hips')
    m.bone('torso', (0, 0.6, 0), 'hips')
    m.bone('armL', (0.18, 0.86, 0.06), 'torso')
    m.bone('armR', (-0.18, 0.86, 0.06), 'torso')
    m.bone('bladeL', (0.24, 0.6, 0.1), 'armL')
    m.bone('bladeR', (-0.24, 0.6, 0.1), 'armR')
    m.bone('head', (0, 1.06, 0.1), 'torso')
    m.bone('wingL', (0.08, 0.88, -0.16), 'torso')
    m.bone('wingR', (-0.08, 0.88, -0.16), 'torso')
    m.blob('hips', (0, 0.5, -0.08), (0.16, 0.18, 0.2), GREEN)
    m.blob('torso', (0, 0.75, 0.02), (0.18, 0.26, 0.15), GREEN, rot=(0.25, 0, 0))
    m.blob('torso', (0, 0.68, 0.1), (0.13, 0.22, 0.09), CREAM, rot=(0.25, 0, 0))
    m.limb('torso', (0, 0.9, 0.06), (0, 1.05, 0.1), 0.07, GREEN)
    m.blob('head', (0, 1.14, 0.15), (0.15, 0.13, 0.19), GREEN)
    for side, leg in ((1, 'legL'), (-1, 'legR')):
        m.limb(leg, (side * 0.12, 0.45, -0.05), (side * 0.13, 0.22, 0.02), 0.055, GREEN, family=f'leg{side}')
        m.limb(leg, (side * 0.13, 0.22, 0.02), (side * 0.13, 0.05, -0.04), 0.045, GREEN, family=f'leg{side}')
        m.blob(leg, (side * 0.13, 0.03, 0.02), (0.06, 0.03, 0.1), CREAM, family=f'leg{side}')
    for side, arm, blade in ((1, 'armL', 'bladeL'), (-1, 'armR', 'bladeR')):
        m.limb(arm, (side * 0.18, 0.86, 0.06), (side * 0.24, 0.62, 0.1), 0.05, GREEN, family=f'arm{side}')
        m.flat(blade, SCYTHE, 0.02, BLADE, pos=(side * 0.24, 0.6, 0.1), rot=(math.pi / 2 + 0.6, 0 if side > 0 else math.pi, 0), material='metal')
    for side, wing in ((1, 'wingL'), (-1, 'wingR')):
        m.sphere(wing, (side * 0.22, 0.95, -0.22), (0.18, 0.04, 0.32), 0xe8f4ff, rot=(0.25, side * 0.4, 0), material='gloss')
    hc = (0, 1.12, 0.12)
    with m.on(hc, (0, 1.24, 0.06), sink=0.03):
        m.cone('head', (0, 1.27, 0.0), 0.05, 0.2, GREEN, rot=(-0.9, 0, 0))
    for side in (1, -1):
        m.eye('head', (side * 0.09, 1.16, 0.28), 0.045, sclera=True, iris=0x2a2a2a, yaw=side * 0.55, tall=0.85, on=hc)
    m.socket('muzzle', 'bladeR', (-0.24, 0.62, 0.55))

    def ready():
        return {'bladeL': {'rot': (-0.3, 0, 0)}, 'bladeR': {'rot': (-0.3, 0, 0)}}

    @m.clip('idle', 2.0)
    def idle(u):
        t = u * math.tau
        f = flap(u * 18)
        return merge(ready(), {'torso': {'scale': (1, breath(u, 2), 1)}, 'wingL': {'rot': (0, 0, 0.15 + f * 0.06)}, 'wingR': {'rot': (0, 0, -0.15 - f * 0.06)}, 'head': {'rot': (0, math.sin(t) * 0.2, 0)}, 'armL': {'rot': (-0.3 + math.sin(t * 2) * 0.05, 0, 0)}, 'armR': {'rot': (-0.3 - math.sin(t * 2) * 0.05, 0, 0)}})

    @m.clip('walk', 0.55)
    def walk(u):
        f = flap(u * 6)
        return merge(ready(), biped_walk(u, body='hips', head='head', swing=0.7, arm_swing=0.25, bob=0.06), {'wingL': {'rot': (0, 0, 0.3 + f * 0.2)}, 'wingR': {'rot': (0, 0, -0.3 - f * 0.2)}})

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        # Fury Cutter: a full pirouette with the blades thrown wide.
        a = clamp01(u)
        wide = math.sin(a * math.pi)
        return merge(ready(), {'spin': {'rot': (0, ease_in_out(a) * math.tau, 0), 'loc': (0, wide * 0.15, 0)}, 'armL': {'rot': (0, 0, wide * 1.2)}, 'armR': {'rot': (0, 0, -wide * 1.2)}})

    faint_clip(m)
    return m
