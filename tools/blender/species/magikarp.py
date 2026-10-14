import math
from rig import Model, clamp01, faint_clip

ORANGE = 0xe8582c
BELLY = 0xf4e3c0
FIN = 0xf3d27a


def build() -> Model:
    m = Model('magikarp', height=1.05, attack_style='splash', attack_duration=0.7)
    m.bone('root', (0, 0, 0))
    m.bone('fish', (0, 0.25, 0), 'root')
    m.bone('tail', (0, 0.12, -0.05), 'fish')
    m.bone('finL', (0.22, 0.4, 0.05), 'fish')
    m.bone('finR', (-0.22, 0.4, 0.05), 'fish')
    m.bone('crown', (0, 0.78, -0.04), 'fish')
    # Stands on its tail: body is an upright oval.
    m.blob('fish', (0, 0.48, 0), (0.23, 0.36, 0.29), ORANGE)
    m.blob('fish', (0, 0.42, 0.11), (0.18, 0.28, 0.18), BELLY)
    m.blob('fish', (0, 0.52, 0.27), (0.1, 0.06, 0.06), 0xf1b2a0)  # lips
    for i in range(5):
        z = -0.2 + i * 0.09
        m.cone('crown', (0, 0.8 - abs(z) * 0.4, z - 0.02), 0.05, 0.16 + (i % 2) * 0.05, FIN, rot=(-0.35 + i * 0.12, 0, 0), squash=(0.4, 1))
    hc = (0, 0.5, 0)
    for side in (1, -1):
        m.eye('fish', (side * 0.15, 0.62, 0.2), 0.06, sclera=True, iris=0xd9c070, yaw=side * 0.7, tall=1, on=hc)
        m.cylinder('fish', (side * 0.11, 0.4, 0.31), 0.012, 0.016, 0.3, FIN, rot=(0.6, 0, side * 0.35))
        fin = 'finL' if side > 0 else 'finR'
        m.sphere(fin, (side * 0.27, 0.4, 0.05), (0.1, 0.03, 0.06), FIN)
        for y in (0.6, 0.45, 0.3):
            with m.on(hc, (side * 0.22, y, -0.05), sink=0.004):
                m.torus('fish', (side * 0.22, y, -0.05), 0.065, 0.012, 0xc4441c, rot=(0, side * 1.2, 0), arc=math.pi)
    m.flat('tail', [(0, 0), (0.22, -0.2), (0.08, -0.16), (0, -0.26), (-0.08, -0.16), (-0.22, -0.2)], 0.04, FIN, pos=(0, 0.14, -0.08), rot=(0, math.pi / 2, 0))
    m.socket('muzzle', 'fish', (0, 0.52, 0.33))

    @m.clip('idle', 1.4)
    def idle(u):
        t = u * math.tau
        return {'fish': {'rot': (0, 0, math.sin(t * 2) * 0.08)}, 'tail': {'rot': (0, math.sin(t * 4) * 0.4, 0)}, 'finL': {'rot': (0, 0, math.sin(t * 3) * 0.3)}, 'finR': {'rot': (0, 0, -math.sin(t * 3) * 0.3)}}

    @m.clip('walk', 0.7)
    def walk(u):
        t = u * math.tau
        hop = abs(math.sin(t))
        # Hop-flop: each stride is a pointless little jump with a sideways wobble.
        return {'root': {'loc': (0, hop * 0.28, 0)}, 'fish': {'rot': (-0.15, 0, math.sin(t) * 0.35)}, 'tail': {'rot': (0, math.sin(t * 3) * 0.5, 0)}}

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        # Splash: a big jump that achieves nothing.
        return {'root': {'loc': (0, math.sin(u * math.pi) * 0.9, 0)}, 'fish': {'rot': (0, 0, math.sin(u * math.pi * 4) * 0.4)}, 'tail': {'rot': (0, math.sin(u * math.pi * 8) * 0.6, 0)}}

    @m.clip('special', 1.0, loop=False)
    def special(u):
        # Evolving: it rises and stretches tall as the light builds.
        k = clamp01(u * 1.3)
        return {'root': {'loc': (0, k * 0.3, 0)}, 'fish': {'scale': (1 - k * 0.15, 1 + k * 0.35, 1 - k * 0.15), 'rot': (0, u * 4, 0)}}

    faint_clip(m)
    return m
