import math
from rig import Model, faint_clip, merge, strike

PINK = 0xf7a9c6
INNER = 0x6a3550
TEAL = 0x2f8fb8


def build() -> Model:
    m = Model('jigglypuff', height=0.95, attack_style='cast', attack_duration=0.6)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.4, 0), 'root')
    m.bone('earL', (0.2, 0.68, 0), 'body')
    m.bone('earR', (-0.2, 0.68, 0), 'body')
    m.bone('armL', (0.33, 0.4, 0.04), 'body')
    m.bone('armR', (-0.33, 0.4, 0.04), 'body')
    m.bone('legL', (0.14, 0.12, 0.04), 'body')
    m.bone('legR', (-0.14, 0.12, 0.04), 'body')

    # A balloon: one round body that is also the head.
    m.blob('body', (0, 0.42, 0), (0.37, 0.36, 0.35), PINK)
    for side, ear, arm, leg in ((1, 'earL', 'armL', 'legL'), (-1, 'earR', 'armR', 'legR')):
        with m.frame((side * 0.2, 0.7, -0.02), (0, 0, -side * 0.35)):
            m.cone(ear, (0, 0.06, 0), 0.11, 0.2, PINK, squash=(1, 0.5))
            m.cone(ear, (0, 0.05, 0.03), 0.06, 0.13, INNER, squash=(1, 0.3))
        m.blob(arm, (side * 0.36, 0.38, 0.06), (0.07, 0.09, 0.06), PINK, family=f'arm{side}')
        m.blob(leg, (side * 0.15, 0.06, 0.08), (0.1, 0.06, 0.12), PINK, family=f'leg{side}')
    bc = (0, 0.42, 0)
    # The forehead curl.
    with m.on(bc, (0, 0.74, 0.12), sink=0.02):
        m.torus('body', (0, 0.76, 0.12), 0.07, 0.035, PINK, rot=(0, 0, 0.6), arc=math.tau * 0.8)
    for side in (1, -1):
        m.eye('body', (side * 0.13, 0.48, 0.32), 0.075, sclera=True, iris=TEAL, yaw=side * 0.35, tall=1.05, on=bc)
    with m.on(bc, (0, 0.33, 0.35), sink=0.01):
        m.sphere('body', (0, 0.33, 0.35), (0.05, 0.025, 0.02), INNER)
    m.socket('muzzle', 'body', (0, 0.36, 0.42))

    @m.clip('idle', 2.0)
    def idle(u):
        t = u * math.tau
        return {
            'body': {'scale': (1 + math.sin(t * 2) * 0.03, 1 - math.sin(t * 2) * 0.03, 1 + math.sin(t * 2) * 0.03)},
            'earL': {'rot': (0, 0, math.sin(t) * 0.08)}, 'earR': {'rot': (0, 0, -math.sin(t) * 0.08)},
            'armL': {'rot': (0, 0, math.sin(t * 2) * 0.15)}, 'armR': {'rot': (0, 0, -math.sin(t * 2) * 0.15)},
        }

    @m.clip('walk', 0.5)
    def walk(u):
        t = u * math.tau
        # Bouncy hops, squashing on each landing.
        hop = abs(math.sin(t))
        return {
            'root': {'loc': (0, hop * 0.14, 0)},
            'body': {'scale': (1 + (1 - hop) * 0.08, 1 - (1 - hop) * 0.08, 1 + (1 - hop) * 0.08), 'rot': (0.1, 0, 0)},
            'legL': {'rot': (math.sin(t) * 0.5, 0, 0)}, 'legR': {'rot': (-math.sin(t) * 0.5, 0, 0)},
            'armL': {'rot': (0, 0, 0.4 * hop)}, 'armR': {'rot': (0, 0, -0.4 * hop)},
        }

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        # Takes a deep breath (puffs up), then sings.
        puff = 1 + max(0, -s) * 0.25 + max(0, s) * 0.08
        return merge({'body': {'scale': (puff, puff, puff), 'rot': (-s * 0.12, 0, 0)}},
                     {'armL': {'rot': (0, 0, max(0, s) * 0.9)}, 'armR': {'rot': (0, 0, -max(0, s) * 0.9)}})

    faint_clip(m)
    return m
