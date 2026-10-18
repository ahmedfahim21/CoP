import math
from rig import Model, faint_clip, strike

SHELL = 0x6f5f94
RIM = 0x4e4270
SPIKE = 0xe2dcef
PEARL = 0x34343e


def build() -> Model:
    m = Model('cloyster', height=1.1, attack_style='cast', attack_duration=0.5)
    m.bone('root', (0, 0, 0))
    m.bone('shell', (0, 0.45, 0), 'root')
    m.bone('lid', (0, 0.55, -0.2), 'shell')
    m.bone('pearl', (0, 0.48, 0.05), 'shell')

    # Lower shell, and the lid that lifts open at the front.
    m.dome('shell', (0, 0.42, 0), (0.48, 0.32, 0.44), SHELL, rot=(math.pi + 0.2, 0, 0))
    m.dome('lid', (0, 0.48, -0.02), (0.48, 0.42, 0.44), SHELL, rot=(-0.35, 0, 0))
    m.torus('shell', (0, 0.44, 0.0), 0.46, 0.04, RIM, rot=(math.pi / 2 - 0.08, 0, 0))
    # Spikes all over the lid and round the rim.
    for i in range(7):
        a = (i / 6 - 0.5) * 2.4
        with m.frame((0, 0.5, -0.02), (-0.35, 0, 0)):
            m.cone('lid', (math.sin(a) * 0.36, 0.3 + math.cos(a) * 0.04, -0.08), 0.06, 0.24, SPIKE, rot=(-0.3, 0, -a * 0.8))
    for side in (1, -1):
        for k in range(3):
            y, z = 0.32 + k * 0.08, -0.15 + k * 0.12
            m.cone('shell', (side * 0.5, y, z), 0.05, 0.2, SPIKE, rot=(0, 0, -side * 1.35))
    # The pearl inside: a dark face with a horn.
    m.sphere('pearl', (0, 0.5, 0.08), 0.24, PEARL, material='gloss')
    m.cone('pearl', (0, 0.8, 0.06), 0.05, 0.18, SPIKE, rot=(-0.15, 0, 0))
    for side in (1, -1):
        with m.frame((side * 0.08, 0.55, 0.29), (0, side * 0.3, side * 0.3)):
            m.sphere('pearl', (0, 0, 0), (0.06 * 1.2, 0.035 * 1.2, 0.02), 0xf7f7f2, material='gloss')
            m.sphere('pearl', (-side * 0.012, -0.004, 0.015), (0.024, 0.024, 0.01), 0x1c1c22, material='gloss')
    m.sphere('pearl', (0, 0.42, 0.3), (0.05, 0.02, 0.015), 0x8c8ca0)
    m.socket('muzzle', 'pearl', (0, 0.5, 0.4))

    @m.clip('idle', 2.2)
    def idle(u):
        t = u * math.tau
        return {'lid': {'rot': (-0.05 - max(0, math.sin(t)) * 0.12, 0, 0)}, 'pearl': {'rot': (0, math.sin(t) * 0.15, 0)}}

    @m.clip('walk', 0.6)
    def walk(u):
        t = u * math.tau
        # Shuffles forward in hops, lid clapping a little.
        return {'root': {'loc': (0, abs(math.sin(t)) * 0.08, 0)}, 'shell': {'rot': (math.sin(t) * 0.1, 0, 0)}, 'lid': {'rot': (-abs(math.sin(t)) * 0.12, 0, 0)}}

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        # Opens wide, then snaps forward to fire the icicles.
        return {'lid': {'rot': (-max(0, -s) * 0.6 - max(0, s) * 0.2, 0, 0)}, 'shell': {'rot': (s * 0.15, 0, 0)}}

    faint_clip(m)
    return m
