import math
from rig import Model, charge, faint_clip, strike

RED = 0xe23b2f
WHITE = 0xf3f1ea


def build() -> Model:
    m = Model('voltorb', height=0.95, attack_style='explode', attack_duration=0.35)
    m.bone('root', (0, 0, 0))
    m.bone('ball', (0, 0.4, 0), 'root')
    m.dome('ball', (0, 0.4, 0), 0.4, RED, material=charge(0xffffff))
    m.dome('ball', (0, 0.4, 0), 0.4, WHITE, rot=(math.pi, 0, 0), material='gloss')
    m.torus('ball', (0, 0.4, 0), 0.4, 0.014, 0x2a2a2a, rot=(math.pi / 2, 0, 0))
    for side in (1, -1):
        with m.frame((side * 0.13, 0.45, 0.355), (0, side * 0.35, 0)):
            m.sphere('ball', (0, 0, 0), (0.08, 0.06, 0.028), WHITE, material='gloss')
            m.sphere('ball', (-side * 0.015, -0.005, 0.02), (0.035, 0.038, 0.016), 0x1c1c22, material='gloss')
            m.box('ball', (0, 0.075, 0.01), (0.15, 0.03, 0.03), 0x1c1c22, rot=(0, 0, side * 0.35), bevel=0.4)
    m.socket('muzzle', 'ball', (0, 0.4, 0.4))

    @m.clip('idle', 1.2)
    def idle(u):
        t = u * math.tau
        return {'ball': {'rot': (0, 0, math.sin(t * 3) * 0.04), 'loc': (0, abs(math.sin(t)) * 0.02, 0)}}

    @m.clip('walk', 0.6)
    def walk(u):
        t = u * math.tau
        # Hop-roll: rock forward and bounce, face stays readable.
        return {'root': {'loc': (0, abs(math.sin(t)) * 0.14, 0)}, 'ball': {'rot': (math.sin(t) * 0.35, 0, 0)}}

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        # Swell up and tremble before blowing.
        return {'ball': {'scale': 1 + u * 0.45, 'rot': (0, 0, math.sin(u * 60) * 0.08 * u)}}

    faint_clip(m)
    return m
