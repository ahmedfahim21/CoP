import math
from charmander import flame
from rig import Model, faint_clip, flap, merge, strike

ORANGE = 0xf0803c
CREAM = 0xf8d796
WING_IN = 0x2f7fa0
WING = [(0, 0), (0.2, 0.3), (0.55, 0.55), (0.95, 0.62), (0.85, 0.42), (0.92, 0.22), (0.7, 0.2), (0.72, 0.02), (0.5, 0.06), (0.42, -0.12), (0.2, -0.04)]


def build() -> Model:
    m = Model('charizard', height=1.9, attack_style='breath', attack_duration=0.7, fly_height=1.0)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.62, 0), 'root')
    m.bone('neck', (0, 0.95, 0.12), 'body')
    m.bone('head', (0, 1.2, 0.22), 'neck')
    m.bone('jaw', (0, 1.15, 0.32), 'head')
    m.bone('wingL', (0.15, 0.85, -0.18), 'body')
    m.bone('wingR', (-0.15, 0.85, -0.18), 'body')
    m.bone('legL', (0.2, 0.36, 0.02), 'body')
    m.bone('legR', (-0.2, 0.36, 0.02), 'body')
    m.bone('armL', (0.27, 0.78, 0.15), 'body')
    m.bone('armR', (-0.27, 0.78, 0.15), 'body')
    m.bone('tail1', (0, 0.36, -0.24), 'body')
    m.bone('tail2', (0, 0.2, -0.55), 'tail1')
    m.bone('flame', (0, 0.45, -0.8), 'tail2')
    m.blob('body', (0, 0.62, 0), (0.33, 0.42, 0.3), ORANGE, rot=(0.25, 0, 0))
    m.blob('body', (0, 0.58, 0.13), (0.26, 0.34, 0.18), CREAM, rot=(0.25, 0, 0))
    m.limb('neck', (0, 0.9, 0.1), (0, 1.15, 0.2), 0.11, ORANGE)
    m.blob('head', (0, 1.25, 0.26), (0.2, 0.17, 0.22), ORANGE)
    m.blob('jaw', (0, 1.16, 0.42), (0.13, 0.08, 0.15), ORANGE)
    for side, leg, arm in ((1, 'legL', 'armL'), (-1, 'legR', 'armR')):
        m.blob(leg, (side * 0.2, 0.3, 0.02), (0.13, 0.16, 0.13), ORANGE, family=f'leg{side}')
        m.limb(leg, (side * 0.2, 0.25, 0.04), (side * 0.2, 0.08, 0.08), 0.07, ORANGE, family=f'leg{side}')
        m.blob(leg, (side * 0.2, 0.05, 0.14), (0.08, 0.05, 0.12), ORANGE, family=f'leg{side}')
        m.limb(arm, (side * 0.27, 0.78, 0.15), (side * 0.32, 0.62, 0.25), 0.055, ORANGE, family=f'arm{side}')
    m.limb('tail1', (0, 0.36, -0.22), (0, 0.22, -0.52), 0.1, ORANGE, family='tail')
    m.limb('tail2', (0, 0.22, -0.52), (0, 0.42, -0.78), 0.07, ORANGE, family='tail')
    flame(m, 'flame', (0, 0.45, -0.8), 1.2)
    hc = (0, 1.24, 0.25)
    for side in (1, -1):
        with m.on(hc, (side * 0.1, 1.38, 0.12), sink=0.03):
            m.cone('head', (side * 0.1, 1.42, 0.08), 0.045, 0.24, CREAM, rot=(-1.1, 0, -side * 0.3))
        m.eye('head', (side * 0.1, 1.3, 0.38), 0.04, sclera=True, iris=0x3d7fb5, yaw=side * 0.5, tall=1.1, on=hc)
    for side, bone in ((1, 'wingL'), (-1, 'wingR')):
        ry = 0 if side > 0 else math.pi
        m.flat(bone, WING, 0.025, ORANGE, pos=(side * 0.15, 0.85, -0.18), rot=(-math.pi / 2 + 0.25, ry, 0), scale=1.2)
        m.flat(bone, WING, 0.025, WING_IN, pos=(side * 0.15, 0.83, -0.18), rot=(-math.pi / 2 + 0.25, ry, 0), scale=1.1)
    m.socket('muzzle', 'jaw', (0, 1.2, 0.58))

    def beat(u, cycles, amt=0.55):
        f = flap(u * cycles)
        return {'wingL': {'rot': (0, -0.25, f * amt)}, 'wingR': {'rot': (0, 0.25, -f * amt)}, 'root': {'loc': (0, -f * 0.12, 0)}}

    def flick(u, cycles=11):
        f = 1 + math.sin(u * math.tau * cycles) * 0.12 + math.sin(u * math.tau * cycles * 1.7) * 0.08
        return {'flame': {'scale': (1 / f, f, 1 / f)}}

    @m.clip('idle', 2.0)
    def idle(u):
        t = u * math.tau
        return merge(beat(u, 3), flick(u), {
            'tail1': {'rot': (math.sin(t) * 0.12, 0, math.sin(t * 2) * 0.12)},
            'legL': {'rot': (math.sin(t * 3) * 0.08, 0, 0)}, 'legR': {'rot': (-math.sin(t * 3) * 0.08, 0, 0)},
            'neck': {'rot': (math.sin(t) * 0.05, 0, 0)},
        })

    @m.clip('walk', 1.0)
    def walk(u):
        return merge(beat(u, 2, 0.65), flick(u, 6), {'body': {'rot': (0.15, 0, 0)}, 'tail1': {'rot': (0.2, 0, math.sin(u * math.tau) * 0.15)}})

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        return merge(beat(u, 2), flick(u, 6), {'neck': {'rot': (s * 0.5, 0, 0)}, 'head': {'rot': (-s * 0.15, 0, 0)}, 'jaw': {'rot': (max(0, s) * 0.5, 0, 0)}})

    faint_clip(m, fall=1.0)
    return m
