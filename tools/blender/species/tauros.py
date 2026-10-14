import math
from rig import Model, faint_clip, gallop, merge, strike

HIDE = 0xb5835a
MANE = 0x6b4a2e
HORN = 0xefe2c4
HOOF = 0x3e3a36


def build() -> Model:
    m = Model('tauros', height=1.35, attack_style='kick', attack_duration=0.5)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.62, 0), 'root')
    m.bone('head', (0, 0.68, 0.5), 'body')
    m.bone('tails', (0, 0.74, -0.52), 'body')
    legs = {'legFL': (0.18, 0.3), 'legFR': (-0.18, 0.3), 'legBL': (0.18, -0.36), 'legBR': (-0.18, -0.36)}
    for name, (x, z) in legs.items():
        m.bone(name, (x, 0.48, z), 'body')
    m.blob('body', (0, 0.62, -0.06), (0.33, 0.29, 0.48), HIDE)
    for x, y, z in ((0, 0.84, 0.22), (0.22, 0.7, 0.26), (-0.22, 0.7, 0.26), (0, 0.6, 0.34)):
        m.blob('body', (x, y, z), (0.22, 0.19, 0.18), MANE)
    m.blob('head', (0, 0.68, 0.56), (0.2, 0.18, 0.22), HIDE)
    m.blob('head', (0, 0.6, 0.72), (0.13, 0.1, 0.1), 0xd7a982)
    for name, (x, z) in legs.items():
        m.limb(name, (x, 0.5, z), (x, 0.08, z), 0.075, HIDE, family=f'leg_{name}')
        m.cylinder(name, (x, 0.04, z), 0.07, 0.08, 0.08, HOOF)
    hc = (0, 0.68, 0.55)
    for side in (1, -1):
        with m.frame((side * 0.16, 0.8, 0.5), (0.5, 0, -side * 1.1)):
            m.cone('head', (0, 0.17, 0), 0.05, 0.38, HORN)
        m.eye('head', (side * 0.11, 0.74, 0.7), 0.035, sclera=True, iris=0x3a2216, yaw=side * 0.6, tall=0.8, on=hc)
        with m.on(hc, (side * 0.11, 0.8, 0.7), sink=0.01):
            m.box('head', (side * 0.11, 0.8, 0.7), (0.1, 0.025, 0.03), 0x3a2216, rot=(0, 0, side * 0.5), bevel=0.4)
    for i, sx in enumerate((-1, 0, 1)):
        with m.frame((sx * 0.07, 0.74, -0.52), (-0.4, 0, sx * 0.25)):
            m.cylinder('tails', (0, -0.2, -0.05), 0.02, 0.02, 0.38, MANE, rot=(-0.4, 0, 0))
            m.sphere('tails', (0, -0.42, -0.14), 0.05, MANE)
    m.socket('muzzle', 'head', (0, 0.66, 0.85))

    @m.clip('idle', 2.4)
    def idle(u):
        t = u * math.tau
        return {'head': {'rot': (0.05 + math.sin(t) * 0.05, 0, 0)}, 'tails': {'rot': (0, math.sin(t * 3) * 0.25, 0)}, 'legFL': {'rot': (max(0, math.sin(t * 2)) * 0.3, 0, 0)}, 'body': {'scale': (1, 1 + math.sin(t * 2) * 0.02, 1)}}

    @m.clip('walk', 0.6)
    def walk(u):
        return merge(gallop(u, swing=0.7, bob=0.06), {'tails': {'rot': (0, math.sin(u * math.tau * 2) * 0.3, 0)}})

    @m.clip('charge', 0.4)
    def charge(u):
        # Head down, horns forward, tails whipping: full Take Down gallop.
        return merge(gallop(u, swing=1.0, bob=0.12), {'head': {'rot': (0.55, 0, 0)}, 'tails': {'rot': (0.3, math.sin(u * math.tau * 2) * 0.5, 0)}})

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        return {'head': {'rot': (0.05 + s * 0.5, 0, 0)}, 'root': {'loc': (0, 0, max(0, s) * 0.25)}}

    faint_clip(m)
    return m
