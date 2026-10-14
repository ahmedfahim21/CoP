import math
from rig import Model, biped_walk, breath, clamp01, faint_clip, merge, strike

SKIN = 0xf2c9a0
JEANS = 0x3b4f8f
WHITE = 0xf3f1ea


def make(look: str) -> Model:
    red = look == 'red'
    top = 0xd63a35 if red else 0x6a4fb3
    hair = 0x2b2018 if red else 0x8a5a2b
    shoe = 0xd63a35 if red else 0x3a3a3a
    m = Model(look, height=1.9, attack_style='throw', attack_duration=0.6)
    m.bone('root', (0, 0, 0))
    m.bone('hips', (0, 0.55, 0), 'root')
    m.bone('legL', (0.11, 0.55, 0), 'hips')
    m.bone('legR', (-0.11, 0.55, 0), 'hips')
    m.bone('chest', (0, 0.65, 0), 'hips')
    m.bone('armL', (0.25, 1.05, 0), 'chest')
    m.bone('armR', (-0.25, 1.05, 0), 'chest')
    m.bone('foreL', (0.27, 0.8, 0), 'armL')
    m.bone('foreR', (-0.27, 0.8, 0), 'armR')
    m.bone('head', (0, 1.15, 0.01), 'chest')
    m.bone('ball', (-0.28, 0.56, 0.05), 'foreR')

    # Chibi build: big head, compact body.
    m.blob('hips', (0, 0.6, 0), (0.18, 0.12, 0.13), JEANS, family='hips')
    m.blob('chest', (0, 0.88, 0), (0.22, 0.25, 0.16), top, family='torso')
    if red:
        m.blob('chest', (0, 0.9, 0.08), (0.12, 0.2, 0.08), WHITE, family='torso')
        m.box('chest', (0, 0.9, -0.2), (0.3, 0.34, 0.16), 0xf2c14e, bevel=0.3)  # backpack
    else:
        m.sphere('chest', (0, 1.02, 0.15), (0.05, 0.035, 0.02), 0x2a2a2a, material='gloss')
    for side, bone, fore in ((1, 'legL', None), (-1, 'legR', None)):
        m.limb(bone, (side * 0.11, 0.55, 0), (side * 0.11, 0.14, 0.01), 0.085, JEANS, family=f'leg{side}')
        m.box(bone, (side * 0.11, 0.06, 0.05), (0.16, 0.11, 0.27), shoe, bevel=0.4)
    for side, arm, fore in ((1, 'armL', 'foreL'), (-1, 'armR', 'foreR')):
        sleeve = WHITE if red else top
        m.limb(arm, (side * 0.25, 1.05, 0), (side * 0.27, 0.82, 0), 0.07, sleeve, family=f'arm{side}')
        m.limb(fore, (side * 0.27, 0.8, 0), (side * 0.28, 0.62, 0), 0.06, SKIN, family=f'fore{side}')
        m.sphere(fore, (side * 0.28, 0.56, 0.0), 0.068, SKIN)
    # Head with hair or cap.
    m.blob('head', (0, 1.4, 0.02), (0.26, 0.27, 0.25), SKIN)
    hc = (0, 1.4, 0.02)
    for side in (1, -1):
        m.eye('head', (side * 0.09, 1.42, 0.22), 0.03, tall=1.5, on=hc)
        m.sphere('head', (side * 0.25, 1.38, 0.0), (0.05, 0.07, 0.05), SKIN)
    with m.on(hc, (0, 1.3, 0.25), sink=0.01):
        m.box('head', (0, 1.3, 0.25), (0.07, 0.015, 0.015), 0x8a4a3a, bevel=0.5)
    if red:
        m.dome('head', (0, 1.44, 0.0), (0.27, 0.22, 0.27), hair)
        m.dome('head', (0, 1.5, 0.01), (0.28, 0.2, 0.28), 0xd63a35)
        m.cylinder('head', (0, 1.5, 0.2), 0.2, 0.2, 0.03, 0xd63a35, rot=(1.4, 0, 0))
        m.box('head', (0, 1.6, 0.21), (0.16, 0.1, 0.03), WHITE, rot=(-0.35, 0, 0))
    else:
        m.dome('head', (0, 1.44, -0.01), (0.28, 0.25, 0.28), hair)
        for i in range(9):
            a = i / 9 * math.tau
            m.cone('head', (math.cos(a) * 0.17, 1.62, math.sin(a) * 0.15 - 0.02), 0.08, 0.24, hair, rot=(math.sin(a) * 0.8, 0, -math.cos(a) * 0.8))
    # Poké Ball in the throwing hand.
    m.dome('ball', (-0.28, 0.5, 0.05), 0.08, 0xe5483f, material='gloss')
    m.dome('ball', (-0.28, 0.5, 0.05), 0.08, WHITE, rot=(math.pi, 0, 0), material='gloss')
    m.socket('muzzle', 'ball', (-0.28, 0.5, 0.05))

    @m.clip('idle', 3.0)
    def idle(u):
        t = u * math.tau
        return {
            'chest': {'scale': (1, breath(u, 2, 0.015), 1), 'rot': (0, 0, math.sin(t) * 0.02)},
            'armL': {'rot': (0, 0, 0.12 + math.sin(t) * 0.03)},
            'armR': {'rot': (-0.2, 0, -0.15)},
            'foreR': {'rot': (-0.5, 0, 0)},
            'head': {'rot': (0, math.sin(t) * 0.15, 0)},
            'ball': {'scale': 1.0},
        }

    @m.clip('dormant', 3.0)
    def dormant(u):
        t = u * math.tau
        # Arms crossed, nodding off.
        return {
            'armL': {'rot': (-0.9, 0, 0.6)}, 'armR': {'rot': (-0.9, 0, -0.6)},
            'foreL': {'rot': (-1.4, 0, 0)}, 'foreR': {'rot': (-1.4, 0, 0)},
            'head': {'rot': (0.25 + max(0, math.sin(t)) * 0.12, 0, 0)},
            'chest': {'scale': (1, breath(u, 1, 0.02), 1)},
            'ball': {'scale': 0.0001},
        }

    @m.clip('walk', 0.8)
    def walk(u):
        return biped_walk(u, arms=('armL', 'armR'), head='head', swing=0.5, arm_swing=0.4, bob=0.04, lean=0.05)

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        cock = clamp01(-s / 0.55)
        through = clamp01(s)
        # Overhand throw: wind up behind the head, whip through, follow down.
        return merge({
            'armR': {'rot': (-0.2 - cock * 2.4 + through * 1.3, 0, -0.15)},
            'foreR': {'rot': (-0.4 - cock * 0.9, 0, 0)},
            'chest': {'rot': (through * 0.12, cock * 0.4 - through * 0.3, 0)},
            'armL': {'rot': (-cock * 0.6, 0, 0.3)},
            'legL': {'rot': (-through * 0.25, 0, 0)},
            # The ball leaves the hand at release and is back for the next wind-up.
            'ball': {'scale': 1.0 if u < 0.36 or u > 0.9 else 0.0001},
        })

    faint_clip(m)
    return m


def models():
    return [make('red'), make('blue')]
