import math
from rig import Model, clamp01, faint_clip, strike

TEAL = 0x2f6f80
CREAM = 0xf1e3c4
CLAW = 0xfbf7ee


def build() -> Model:
    m = Model('snorlax', height=2.6, attack_style='slam', attack_duration=0.75)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.4, 0), 'root')
    m.bone('footL', (0.38, 0.12, 0.2), 'root')
    m.bone('footR', (-0.38, 0.12, 0.2), 'root')
    m.bone('armL', (0.74, 1.25, 0.08), 'body')
    m.bone('armR', (-0.74, 1.25, 0.08), 'body')
    m.bone('head', (0, 1.6, 0.06), 'body')
    m.blob('body', (0, 0.95, 0), (0.82, 0.85, 0.7), TEAL)
    m.blob('body', (0, 0.9, 0.2), (0.68, 0.7, 0.52), CREAM)
    # The head sits on the body as its own mass, so the cream face stays readable.
    m.blob('head', (0, 1.86, 0.1), (0.5, 0.4, 0.42), TEAL, family='head')
    m.blob('head', (0, 1.8, 0.26), (0.42, 0.32, 0.3), CREAM, family='head')
    for side, foot in ((1, 'footL'), (-1, 'footR')):
        m.blob(foot, (side * 0.38, 0.12, 0.25), (0.26, 0.13, 0.33), CREAM, family=f'foot{side}')
        for dx in (-0.1, 0, 0.1):
            m.cone(foot, (side * 0.38 + dx, 0.18, 0.56), 0.035, 0.08, CLAW, rot=(math.pi / 2.4, 0, 0))
    for side, arm in ((1, 'armL'), (-1, 'armR')):
        m.limb(arm, (side * 0.74, 1.25, 0.08), (side * 0.86, 0.85, 0.12), 0.19, TEAL, family=f'arm{side}')
        for dz in (-0.07, 0, 0.07):
            m.cone(arm, (side * 0.88, 0.64, 0.14 + dz), 0.03, 0.09, CLAW, rot=(math.pi, 0, 0))
    hc = (0, 1.84, 0.1)
    for side in (1, -1):
        with m.on(hc, (side * 0.36, 2.15, 0.0), sink=0.06, family='head'):
            m.cone('head', (side * 0.36, 2.18, 0.0), 0.13, 0.22, TEAL, rot=(0, 0, -side * 0.35))
        with m.on(hc, (side * 0.15, 1.88, 0.42), sink=0.008, family='head'):
            m.box('head', (side * 0.15, 1.88, 0.42), (0.14, 0.022, 0.02), 0x2a2a2a, rot=(0, 0, side * 0.12), bevel=0.5)
    with m.on(hc, (0, 1.68, 0.44), sink=0.01, family='head'):
        m.box('head', (0, 1.68, 0.44), (0.3, 0.025, 0.02), 0x5a2a2a, bevel=0.5)
        for side in (1, -1):
            m.cone('head', (side * 0.07, 1.71, 0.45), 0.025, 0.06, CLAW)
    m.socket('muzzle', 'body', (0, 0.6, 0.85))

    @m.clip('idle', 3.0)
    def idle(u):
        t = u * math.tau
        b = math.sin(t) * 0.03
        return {'body': {'scale': (1 - b, 1 + b, 1)}, 'head': {'rot': (0, 0, math.sin(t) * 0.05)}, 'armL': {'rot': (0, 0, math.sin(t) * 0.04)}, 'armR': {'rot': (0, 0, -math.sin(t) * 0.04)}}

    @m.clip('walk', 1.6)
    def walk(u):
        t = u * math.tau
        s = math.sin(t)
        # Waddle: the whole body rolls and each planted foot carries it.
        return {
            'body': {'rot': (0, 0, s * 0.11), 'loc': (0, abs(s) * 0.07, 0)},
            'footL': {'loc': (0, max(0, s) * 0.08, s * 0.18)},
            'footR': {'loc': (0, max(0, -s) * 0.08, -s * 0.18)},
            'armL': {'rot': (s * 0.2, 0, 0)}, 'armR': {'rot': (-s * 0.2, 0, 0)},
        }

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        up = clamp01(-s / 0.55)
        down = clamp01(s)
        # Body slam: rise up with arms overhead, then crash down.
        return {
            'armL': {'rot': (0, 0, up * 2.2 - down * 1.0)}, 'armR': {'rot': (0, 0, -up * 2.2 + down * 1.0)},
            'body': {'loc': (0, up * 0.35, 0), 'rot': (-up * 0.15 + down * 0.25, 0, 0), 'scale': (1 - up * 0.04 + down * 0.08, 1 + up * 0.12 - down * 0.1, 1)},
        }

    faint_clip(m)
    return m
