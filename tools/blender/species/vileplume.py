import math
from rig import Model, faint_clip, merge, strike

BLUE = 0x3d5fae
PETAL = 0xd8402f
SPOT = 0xf2d4cc
CENTRE = 0x6a3a8a


def build() -> Model:
    m = Model('vileplume', height=1.25, attack_style='cast', attack_duration=0.6)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.32, 0), 'root')
    m.bone('flower', (0, 0.62, 0), 'body')
    m.bone('armL', (0.27, 0.36, 0.04), 'body')
    m.bone('armR', (-0.27, 0.36, 0.04), 'body')
    m.bone('legL', (0.12, 0.12, 0.02), 'body')
    m.bone('legR', (-0.12, 0.12, 0.02), 'body')

    m.blob('body', (0, 0.35, 0), (0.3, 0.29, 0.28), BLUE)
    for side, arm, leg in ((1, 'armL', 'legL'), (-1, 'armR', 'legR')):
        m.limb(arm, (side * 0.27, 0.38, 0.04), (side * 0.33, 0.26, 0.1), 0.06, BLUE, family=f'arm{side}')
        m.blob(leg, (side * 0.13, 0.06, 0.05), (0.09, 0.07, 0.1), BLUE, family=f'leg{side}')
    bc = (0, 0.35, 0)
    for side in (1, -1):
        m.eye('body', (side * 0.1, 0.4, 0.26), 0.05, sclera=True, iris=0xb03a3a, yaw=side * 0.3, tall=1.1, on=bc)
    with m.on(bc, (0, 0.28, 0.28), sink=0.01):
        m.sphere('body', (0, 0.28, 0.28), (0.06, 0.022, 0.02), 0x23305e)
    # The huge flower: five broad petals spotted white, a purple heart.
    for i in range(5):
        a = i / 5 * math.tau + 0.3
        with m.frame((math.sin(a) * 0.3, 0.68, math.cos(a) * 0.3), (0, a, 0)):
            m.sphere('flower', (0, 0, 0), (0.24, 0.06, 0.3), PETAL, rot=(0.18, 0, 0))
            for dx, dz in ((0.08, 0.05), (-0.09, 0.1), (0.02, 0.18), (-0.05, -0.04)):
                m.sphere('flower', (dx, 0.045 + dz * 0.15, dz), (0.04, 0.012, 0.035), SPOT, rot=(0.18, 0, 0))
    m.sphere('flower', (0, 0.7, 0), (0.15, 0.08, 0.15), CENTRE)
    m.socket('muzzle', 'flower', (0, 0.8, 0.1))

    @m.clip('idle', 2.4)
    def idle(u):
        t = u * math.tau
        return {
            'flower': {'rot': (math.sin(t) * 0.05, math.sin(t * 0.5) * 0.15, math.cos(t) * 0.05)},
            'body': {'scale': (1, 1 + math.sin(t * 2) * 0.02, 1)},
            'armL': {'rot': (math.sin(t) * 0.1, 0, 0)}, 'armR': {'rot': (-math.sin(t) * 0.1, 0, 0)},
        }

    @m.clip('walk', 0.8)
    def walk(u):
        t = u * math.tau
        s = math.sin(t)
        return {
            'root': {'loc': (0, abs(math.cos(t)) * 0.05, 0)},
            'body': {'rot': (0.06, 0, s * 0.07)},
            'flower': {'rot': (math.cos(t * 2) * 0.06, 0, -s * 0.06)},
            'legL': {'rot': (s * 0.7, 0, 0)}, 'legR': {'rot': (-s * 0.7, 0, 0)},
            'armL': {'rot': (-s * 0.4, 0, 0)}, 'armR': {'rot': (s * 0.4, 0, 0)},
        }

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        # Petal Dance: the flower spins and dips forward to fling its petals.
        return merge({'flower': {'rot': (s * 0.35, u * math.tau, 0)}, 'body': {'rot': (s * 0.12, 0, 0)}},
                     {'armL': {'rot': (0, 0, max(0, s) * 0.7)}, 'armR': {'rot': (0, 0, -max(0, s) * 0.7)}})

    faint_clip(m)
    return m
