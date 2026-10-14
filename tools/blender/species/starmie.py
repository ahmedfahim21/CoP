import math
from rig import Model, charge, faint_clip, glow

PURPLE = 0x7a5aaa
GOLD = 0xd8b84a


def star(r, inner):
    pts = []
    for i in range(10):
        a = i / 10 * math.tau + math.pi / 2
        rr = r if i % 2 == 0 else inner
        pts.append((math.cos(a) * rr, math.sin(a) * rr))
    return pts


def build() -> Model:
    m = Model('starmie', height=1.4, attack_style='cast', attack_duration=0.35)
    m.bone('root', (0, 0, 0))
    m.bone('wheel', (0, 0.72, 0), 'root')
    m.bone('front', (0, 0.72, 0.04), 'wheel')
    m.bone('back', (0, 0.72, -0.04), 'wheel')
    m.flat('front', star(0.62, 0.25), 0.1, PURPLE, pos=(0, 0.72, 0.04))
    m.flat('back', star(0.54, 0.22), 0.07, GOLD, pos=(0, 0.72, -0.05), rot=(0, 0, math.pi / 5), material='metal')
    m.sphere('wheel', (0, 0.72, 0.12), (0.13, 0.13, 0.08), 0xe0304a, material=charge(0xff3050))
    m.torus('wheel', (0, 0.72, 0.1), 0.14, 0.03, GOLD, material='metal')
    m.socket('muzzle', 'wheel', (0, 0.72, 0.2))

    @m.clip('idle', 2.0)
    def idle(u):
        t = u * math.tau
        return {'root': {'loc': (0, math.sin(t) * 0.05, 0)}, 'front': {'rot': (0, 0, t)}, 'back': {'rot': (0, 0, -t * 0.5)}}

    @m.clip('walk', 0.6)
    def walk(u):
        t = u * math.tau
        # Rolls on edge; the two stars counter-rotate.
        return {'root': {'loc': (0, math.sin(t * 2) * 0.04, 0)}, 'wheel': {'rot': (-0.15, 0, 0)}, 'front': {'rot': (0, 0, t * 2)}, 'back': {'rot': (0, 0, -t)}}

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        return {'front': {'rot': (0, 0, u * math.tau * 2)}, 'wheel': {'scale': 1 + max(0, 1 - abs(u - 0.3) / 0.3) * 0.12}}

    faint_clip(m)
    return m
