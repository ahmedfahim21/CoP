import math
from rig import Model, faint_clip, gallop, glow, merge, strike

COAT = 0xf6efe0
HOOF = 0x6a5a48
HORN = 0xe8e0cc
FLAME_OUT = 0xff8c1a
FLAME_IN = 0xffe07a


def fire(m: Model, bone: str, pos, rot, size):
    with m.frame(pos, rot, size):
        m.cone(bone, (0, 0.16, 0), 0.1, 0.38, FLAME_OUT, material=glow(0xff6a00))
        m.cone(bone, (0, 0.1, 0.02), 0.055, 0.24, FLAME_IN, material=glow(0xffc030))


def build() -> Model:
    m = Model('rapidash', height=1.75, attack_style='kick', attack_duration=0.55)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.78, 0), 'root')
    m.bone('neck', (0, 0.92, 0.36), 'body')
    m.bone('head', (0, 1.32, 0.5), 'neck')
    m.bone('mane', (0, 1.0, 0.3), 'neck')
    m.bone('tail', (0, 0.88, -0.48), 'body')
    legs = {'legFL': (0.16, 0.32), 'legFR': (-0.16, 0.32), 'legBL': (0.16, -0.34), 'legBR': (-0.16, -0.34)}
    for name, (x, z) in legs.items():
        m.bone(name, (x, 0.72, z), 'body')
    m.blob('body', (0, 0.8, 0), (0.25, 0.25, 0.48), COAT)
    m.limb('neck', (0, 0.9, 0.34), (0, 1.25, 0.5), 0.13, COAT)
    m.blob('head', (0, 1.36, 0.6), (0.14, 0.14, 0.24), COAT, rot=(0.5, 0, 0))
    for name, (x, z) in legs.items():
        fam = f'leg_{name}'
        m.limb(name, (x, 0.74, z), (x, 0.38, z), 0.07, COAT, family=fam)
        m.limb(name, (x, 0.38, z), (x, 0.1, z), 0.05, COAT, family=fam)
        m.cylinder(name, (x, 0.05, z), 0.06, 0.07, 0.09, HOOF)
    hc = (0, 1.36, 0.58)
    with m.on(hc, (0, 1.48, 0.62), sink=0.03):
        m.cone('head', (0, 1.6, 0.68), 0.05, 0.36, HORN, rot=(0.4, 0, 0))
    for side in (1, -1):
        m.eye('head', (side * 0.1, 1.4, 0.66), 0.04, sclera=True, iris=0xb23a2a, yaw=side * 0.9, tall=1, on=hc)
        with m.on(hc, (side * 0.08, 1.5, 0.5), sink=0.02):
            m.cone('head', (side * 0.08, 1.54, 0.48), 0.05, 0.13, COAT, rot=(-0.3, 0, -side * 0.2))
    for i in range(5):
        fire(m, 'mane', (0, 1.0 + i * 0.07, 0.3 + i * 0.04), (-0.7, 0, 0), 1 - i * 0.08)
    for i in range(3):
        fire(m, 'tail', (0, 0.9, -0.5 - i * 0.05), (-1.9 + i * 0.25, 0, 0), 1.25 - i * 0.15)
    m.socket('muzzle', 'head', (0, 1.3, 0.85))

    def flick(u, cycles=9):
        f = 1 + math.sin(u * math.tau * cycles) * 0.13 + math.sin(u * math.tau * cycles * 1.7) * 0.08
        return {'mane': {'scale': (1 / f, f, 1 / f)}, 'tail': {'scale': (1 / f, f, 1 / f)}}

    @m.clip('idle', 2.0)
    def idle(u):
        t = u * math.tau
        return merge(flick(u, 13), {'neck': {'rot': (math.sin(t) * 0.05, math.sin(t * 0.5) * 0.1, 0)}, 'legFR': {'rot': (max(0, math.sin(t * 2)) * 0.25, 0, 0)}})

    @m.clip('walk', 0.45)
    def walk(u):
        return merge(gallop(u, head='neck', swing=0.9, bob=0.1), flick(u, 6))

    @m.clip('leap', 1.0)
    def leap(u):
        # Mid-air over the river: legs folded tight, neck stretched.
        return merge(flick(u, 8), {'legFL': {'rot': (-1.1, 0, 0)}, 'legFR': {'rot': (-1.1, 0, 0)}, 'legBL': {'rot': (1.0, 0, 0)}, 'legBR': {'rot': (1.0, 0, 0)}, 'body': {'rot': (-0.15, 0, 0)}, 'neck': {'rot': (0.25, 0, 0)}})

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        # Flame Charge: rear up, then stamp onto the tower.
        return merge(flick(u, 6), {'body': {'rot': (min(0, s) * 0.6 + max(0, s) * 0.15, 0, 0)}, 'legFL': {'rot': (min(0, s) * 1.4, 0, 0)}, 'legFR': {'rot': (min(0, s) * 1.2, 0, 0)}})

    faint_clip(m)
    return m
