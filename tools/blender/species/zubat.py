import math
from rig import Model, faint_clip, flap, merge, strike

BLUE = 0x5a8fd8
MEMBRANE = 0x8c6fd1
MOUTH = 0x5a1a2e
WING = [(0, 0.06), (0.22, 0.14), (0.46, 0.12), (0.6, 0.02), (0.5, -0.06), (0.42, 0.0), (0.33, -0.1), (0.24, -0.02), (0.13, -0.1), (0.04, -0.04)]


def build() -> Model:
    m = Model('zubat', height=0.75, attack_style='bite', attack_duration=0.4, fly_height=1.45)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.25, 0), 'root')
    m.bone('wingL', (0.16, 0.28, -0.02), 'body')
    m.bone('wingR', (-0.16, 0.28, -0.02), 'body')
    m.bone('legs', (0, 0.06, -0.02), 'body')
    m.blob('body', (0, 0.25, 0), (0.21, 0.23, 0.2), BLUE)
    for side in (1, -1):
        with m.frame((side * 0.11, 0.42, -0.02), (0, 0, -side * 0.3)):
            m.cone('body', (0, 0.15, 0), 0.09, 0.32, BLUE, squash=(1, 0.45))
            m.cone('body', (0, 0.13, 0.025), 0.055, 0.22, MEMBRANE, squash=(1, 0.3))
        m.cylinder('legs', (side * 0.07, -0.06, -0.03), 0.018, 0.018, 0.34, BLUE, rot=(0.2, 0, 0))
    with m.on((0, 0.24, 0), (0, 0.2, 0.2), sink=0.03):
        m.sphere('body', (0, 0.2, 0.2), (0.14, 0.1, 0.06), MOUTH)
        for side in (1, -1):
            m.cone('body', (side * 0.05, 0.27, 0.22), 0.025, 0.06, 0xfbf7ee, rot=(math.pi, 0, 0))
    m.flat('wingL', WING, 0.02, MEMBRANE, pos=(0.16, 0.28, -0.02), rot=(-math.pi / 2, 0, 0))
    m.flat('wingR', WING, 0.02, MEMBRANE, pos=(-0.16, 0.28, -0.02), rot=(-math.pi / 2, math.pi, 0))
    m.socket('muzzle', 'body', (0, 0.2, 0.24))

    def beat(u, cycles):
        f = flap(u * cycles)
        return {'wingL': {'rot': (0, 0, f * 0.85)}, 'wingR': {'rot': (0, 0, -f * 0.85)}, 'body': {'loc': (0, -f * 0.05, 0)}, 'legs': {'rot': (f * 0.15, 0, 0)}}

    @m.clip('idle', 1.0)
    def idle(u):
        return merge(beat(u, 5), {'root': {'loc': (0, math.sin(u * math.tau) * 0.06, 0)}})

    @m.clip('walk', 0.6)
    def walk(u):
        return merge(beat(u, 4), {'body': {'rot': (0.18, 0, 0)}})

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        return merge(beat(u, 3), {'body': {'loc': (0, -max(0, s) * 0.3, s * 0.25), 'rot': (s * 0.5, 0, 0)}})

    faint_clip(m, fall=1.4)
    return m
