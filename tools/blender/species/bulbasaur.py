import math
from rig import Model, charge, faint_clip, merge, quad_walk, strike

TEAL = 0x6cc7ac
SPOT = 0x3b8f78
BULB = 0x5ab44a
BULB_DARK = 0x3e8c34


def build() -> Model:
    m = Model('bulbasaur', height=1.1, attack_style='cast', attack_duration=0.55)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.3, 0), 'root')
    m.bone('head', (0, 0.4, 0.24), 'body')
    m.bone('jaw', (0, 0.4, 0.4), 'head')
    m.bone('bulb', (0, 0.52, -0.08), 'body')
    legs = {'legFL': (0.18, 0.18), 'legFR': (-0.18, 0.18), 'legBL': (0.19, -0.2), 'legBR': (-0.19, -0.2)}
    for name, (x, z) in legs.items():
        m.bone(name, (x, 0.24, z), 'body')

    m.blob('body', (0, 0.3, -0.02), (0.29, 0.21, 0.33), TEAL)
    m.blob('head', (0, 0.47, 0.33), (0.31, 0.25, 0.25), TEAL)
    m.blob('head', (0, 0.42, 0.47), (0.2, 0.13, 0.12), TEAL)  # wide snout
    for name, (x, z) in legs.items():
        fam = f'leg_{name}'
        m.limb(name, (x, 0.24, z), (x * 1.05, 0.08, z + 0.02), 0.085, TEAL, family=fam)
        m.blob(name, (x * 1.05, 0.05, z + 0.06), (0.1, 0.06, 0.12), TEAL, family=fam)
        for dx in (-0.04, 0.04):
            m.cone(name, (x * 1.05 + dx, 0.05, z + 0.18), 0.02, 0.05, 0xfbf7ee, rot=(math.pi / 2, 0, 0))
    # The bulb: a plump green bud wrapped in dark leaves.
    m.blob('bulb', (0, 0.6, -0.08), (0.26, 0.27, 0.26), BULB, family='bulb')
    m.blob('bulb', (0, 0.82, -0.08), (0.12, 0.12, 0.12), BULB, family='bulb')
    for i in range(6):
        a = i / 6 * math.tau
        m.sphere('bulb', (math.cos(a) * 0.2, 0.58, -0.08 + math.sin(a) * 0.2), (0.07, 0.2, 0.13), BULB_DARK, rot=(0, -a, math.cos(a) * 0.25))
    # Face.
    hc = (0, 0.46, 0.25)
    for side in (1, -1):
        m.eye('head', (side * 0.15, 0.52, 0.48), 0.06, sclera=True, iris=0xd2333a, yaw=side * 0.5, tall=1.05, on=hc)
        with m.on(hc, (side * 0.2, 0.66, 0.3), sink=0.03):
            m.cone('head', (side * 0.2, 0.66, 0.3), 0.07, 0.13, TEAL, rot=(0, 0, -side * 0.45))
    for x, y, z in ((0.14, 0.4, 0.05), (-0.18, 0.38, -0.12), (0.08, 0.36, -0.28)):
        with m.on((0, 0.3, 0), (x, y, z), sink=0.02):
            m.sphere('body', (x, y, z), (0.065, 0.02, 0.05), SPOT)
    with m.on(hc, (0.12, 0.66, 0.36), sink=0.015):
        m.sphere('head', (0.12, 0.66, 0.36), (0.05, 0.015, 0.04), SPOT)
    with m.on(hc, (0, 0.36, 0.56), sink=0.02):
        m.sphere('jaw', (0, 0.36, 0.56), (0.11, 0.022, 0.04), 0xd8536b, material=charge(0xff8aa0))
    m.socket('muzzle', 'bulb', (0, 0.9, -0.08))

    @m.clip('idle', 2.4)
    def idle(u):
        t = u * math.tau
        return {
            'body': {'scale': (1, 1 + math.sin(t) * 0.025, 1)},
            'bulb': {'scale': 1 + math.sin(t + 1) * 0.035, 'rot': (0, math.sin(t) * 0.06, 0)},
            'head': {'rot': (math.sin(t) * 0.04, math.sin(t * 0.5) * 0.12, 0)},
        }

    @m.clip('walk', 0.8)
    def walk(u):
        return merge(quad_walk(u, head='head', swing=0.55, bob=0.035), {'bulb': {'rot': (math.sin(u * math.tau * 2) * 0.05, 0, 0)}})

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        pump = max(0.0, 1 - abs(u - 0.35) / 0.3)
        # Crouch to load the bulb, then it pumps the leaves out.
        return {
            'root': {'loc': (0, -max(0, -s) * 0.06, 0)},
            'body': {'rot': (max(0, -s) * 0.12, 0, 0)},
            'bulb': {'scale': 1 + pump * 0.22, 'rot': (-max(0, s) * 0.15, 0, 0)},
            'head': {'rot': (-s * 0.15, 0, 0)},
            'jaw': {'rot': (max(0, s) * 0.25, 0, 0)},
        }

    faint_clip(m)
    return m
