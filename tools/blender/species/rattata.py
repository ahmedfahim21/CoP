import math
from rig import Model, faint_clip, merge, quad_walk, strike

PURPLE = 0x9b6fc4
CREAM = 0xf1deb0
PINK = 0xe9a3bb
DARK = 0x3a2a44


def build() -> Model:
    m = Model('rattata', height=0.85, attack_style='bite', attack_duration=0.4)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.28, 0), 'root')
    m.bone('head', (0, 0.36, 0.22), 'body')
    m.bone('tail', (0, 0.28, -0.3), 'body')
    legs = {'legFL': (0.12, 0.15), 'legFR': (-0.12, 0.15), 'legBL': (0.13, -0.16), 'legBR': (-0.13, -0.16)}
    for name, (x, z) in legs.items():
        m.bone(name, (x, 0.2, z), 'body')
    m.blob('body', (0, 0.28, -0.02), (0.22, 0.18, 0.3), PURPLE)
    m.blob('body', (0, 0.22, 0.06), (0.17, 0.12, 0.22), CREAM)
    m.blob('head', (0, 0.42, 0.3), (0.21, 0.19, 0.2), PURPLE)
    m.blob('head', (0, 0.37, 0.44), (0.12, 0.09, 0.1), CREAM)
    for name, (x, z) in legs.items():
        fam = f'leg_{name}'
        m.limb(name, (x, 0.2, z), (x, 0.06, z + 0.02), 0.05, PURPLE, family=fam)
        m.blob(name, (x, 0.035, z + 0.05), (0.055, 0.03, 0.08), CREAM, family=fam)
    hc = (0, 0.4, 0.28)
    for side in (1, -1):
        with m.frame((side * 0.13, 0.56, 0.26), (0, 0, -side * 0.55)):
            m.sphere('head', (0, 0.07, 0), (0.12, 0.14, 0.035), PURPLE)
            m.sphere('head', (0, 0.07, 0.02), (0.085, 0.1, 0.025), PINK)
        m.eye('head', (side * 0.1, 0.47, 0.44), 0.045, sclera=True, iris=0xb02350, yaw=side * 0.45, on=hc)
        for dy in (0, -0.035):
            m.cylinder('head', (side * 0.15, 0.36 + dy, 0.47), 0.005, 0.005, 0.18, DARK, rot=(0, 0, side * (1.35 + dy * 4)))
    with m.on(hc, (0, 0.42, 0.56), sink=0.01):
        m.sphere('head', (0, 0.42, 0.56), 0.03, PINK, material='gloss')
    for dx in (0.022, -0.022):
        m.box('head', (dx, 0.3, 0.5), (0.04, 0.085, 0.02), 0xfbf7ee, rot=(0.15, 0, 0), bevel=0.2)
    with m.frame((0, 0.3, -0.42), (0, math.pi / 2, 0)):
        m.torus('tail', (0, 0.12, 0), 0.16, 0.028, PURPLE, arc=math.tau * 0.78)
    m.socket('muzzle', 'head', (0, 0.36, 0.55))

    @m.clip('idle', 1.6)
    def idle(u):
        t = u * math.tau
        sniff = max(0.0, math.sin(t * 3)) * 0.04
        return {'body': {'scale': (1, 1 + math.sin(t * 2) * 0.03, 1)}, 'head': {'rot': (-sniff, math.sin(t) * 0.15, 0)}, 'tail': {'rot': (0, math.sin(t * 2) * 0.35, 0)}}

    @m.clip('walk', 0.45)
    def walk(u):
        return merge(quad_walk(u, head='head', swing=0.85, bob=0.05), {'tail': {'rot': (0, math.sin(u * math.tau) * 0.4, 0)}})

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        return {'head': {'loc': (0, 0, s * 0.16), 'rot': (s * 0.35, 0, 0)}, 'body': {'rot': (s * 0.1, 0, 0)}}

    faint_clip(m)
    return m
