import math
from rig import Model, faint_clip, flap, merge, strike

ORANGE = 0xf2a54a
BELLY = 0xf6e2a8
WING = 0x3f9c8c


def build() -> Model:
    m = Model('dragonite', height=2.0, attack_style='punch', attack_duration=0.55, fly_height=1.0)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.6, 0), 'root')
    m.bone('head', (0, 1.25, 0.08), 'body')
    m.bone('wingL', (0.16, 1.0, -0.3), 'body')
    m.bone('wingR', (-0.16, 1.0, -0.3), 'body')
    m.bone('armL', (0.3, 0.98, 0.12), 'body')
    m.bone('armR', (-0.3, 0.98, 0.12), 'body')
    m.bone('legL', (0.2, 0.3, 0.02), 'body')
    m.bone('legR', (-0.2, 0.3, 0.02), 'body')
    m.bone('tail', (0, 0.35, -0.3), 'body')

    # Pear-shaped, round belly, a smaller round head.
    m.blob('body', (0, 0.62, 0), (0.42, 0.5, 0.36), ORANGE)
    m.blob('body', (0, 0.6, 0.16), (0.32, 0.4, 0.22), BELLY)
    m.blob('body', (0, 1.05, 0.04), (0.2, 0.18, 0.18), ORANGE)  # neck
    m.blob('head', (0, 1.38, 0.12), (0.22, 0.2, 0.22), ORANGE)
    m.blob('head', (0, 1.32, 0.3), (0.13, 0.1, 0.11), ORANGE)  # snout
    for side, arm, leg in ((1, 'armL', 'legL'), (-1, 'armR', 'legR')):
        m.limb(arm, (side * 0.3, 0.98, 0.12), (side * 0.4, 0.8, 0.26), 0.07, ORANGE, family=f'arm{side}')
        m.blob(leg, (side * 0.22, 0.2, 0.04), (0.14, 0.18, 0.14), ORANGE, family=f'leg{side}')
        m.blob(leg, (side * 0.23, 0.05, 0.14), (0.1, 0.05, 0.13), ORANGE, family=f'leg{side}')
    m.limb('tail', (0, 0.35, -0.28), (0, 0.18, -0.72), 0.13, ORANGE, family='tail')
    # Belly bands.
    belly = (0, 0.6, 0)
    for y in (0.4, 0.58, 0.76):
        with m.on(belly, (0, y, 0.36), sink=0.012):
            m.sphere('body', (0, y, 0.36), (0.2, 0.012, 0.03), 0xd8bc80)
    hc = (0, 1.38, 0.12)
    for side in (1, -1):
        m.eye('head', (side * 0.09, 1.43, 0.3), 0.045, sclera=True, iris=0x2a2a30, yaw=side * 0.4, tall=1.0, on=hc)
        # Antennae with round tips, and little horn nubs.
        with m.on(hc, (side * 0.06, 1.56, 0.16), sink=0.02):
            m.cylinder('head', (side * 0.09, 1.66, 0.18), 0.012, 0.016, 0.22, ORANGE, rot=(0.35, 0, -side * 0.35))
            m.sphere('head', (side * 0.13, 1.76, 0.22), 0.03, ORANGE)
    with m.on(hc, (0, 1.52, 0.2), sink=0.02):
        m.cone('head', (0, 1.55, 0.22), 0.04, 0.09, BELLY, rot=(0.4, 0, 0))
    # Small wings, comically small for the body.
    wing = [(0, 0), (0.18, 0.2), (0.4, 0.34), (0.5, 0.18), (0.38, 0.12), (0.42, 0.0), (0.24, 0.04)]
    for side, bone in ((1, 'wingL'), (-1, 'wingR')):
        ry = 0 if side > 0 else math.pi
        m.flat(bone, wing, 0.03, WING, pos=(side * 0.16, 1.0, -0.3), rot=(-math.pi / 2 + 0.4, ry, 0), scale=1.7)
    m.socket('muzzle', 'head', (0, 1.32, 0.42))

    def beat(u, cycles, amt=0.7):
        f = flap(u * cycles)
        return {'wingL': {'rot': (0, -0.2, f * amt)}, 'wingR': {'rot': (0, 0.2, -f * amt)}, 'root': {'loc': (0, -f * 0.1, 0)}}

    @m.clip('idle', 2.0)
    def idle(u):
        t = u * math.tau
        return merge(beat(u, 4), {
            'tail': {'rot': (math.sin(t) * 0.1, math.sin(t * 2) * 0.15, 0)},
            'head': {'rot': (math.sin(t) * 0.05, math.sin(t * 0.5) * 0.1, 0)},
            'legL': {'rot': (math.sin(t * 2) * 0.08, 0, 0)}, 'legR': {'rot': (-math.sin(t * 2) * 0.08, 0, 0)},
        })

    @m.clip('walk', 1.0)
    def walk(u):
        return merge(beat(u, 3, 0.85), {'body': {'rot': (0.18, 0, 0)}, 'tail': {'rot': (0.25, 0, math.sin(u * math.tau) * 0.15)}})

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        # A big overhead swing with the right arm.
        return merge(beat(u, 2), {'armR': {'rot': (-max(0, -s) * 2.2 + max(0, s) * 0.6, 0, 0)}, 'body': {'rot': (s * 0.18, -s * 0.2, 0)}, 'head': {'rot': (-s * 0.1, 0, 0)}})

    faint_clip(m, fall=1.0)
    return m
