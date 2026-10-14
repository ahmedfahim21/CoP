import math
from rig import Model, charge, faint_clip, merge, strike

YELLOW = 0xf8d030
BROWN = 0x9a5b2a
RED = 0xe8483b
BLACK = 0x26221f


def build() -> Model:
    m = Model('pikachu', height=1.25, attack_style='cast', attack_duration=0.55)
    m.bone('root', (0, 0, 0))
    m.bone('hips', (0, 0.3, 0), 'root')
    m.bone('legL', (0.12, 0.24, 0), 'hips')
    m.bone('legR', (-0.12, 0.24, 0), 'hips')
    m.bone('chest', (0, 0.5, 0), 'hips')
    m.bone('armL', (0.2, 0.55, 0.08), 'chest')
    m.bone('armR', (-0.2, 0.55, 0.08), 'chest')
    m.bone('head', (0, 0.68, 0.02), 'chest')
    m.bone('earL', (0.16, 1.02, 0), 'head')
    m.bone('earR', (-0.16, 1.02, 0), 'head')
    m.bone('tail', (0, 0.34, -0.2), 'hips')

    # Pear-shaped body flowing into a big round head.
    m.blob('hips', (0, 0.34, 0), (0.25, 0.22, 0.22), YELLOW)
    m.blob('chest', (0, 0.52, 0.01), (0.22, 0.2, 0.19), YELLOW)
    m.blob('head', (0, 0.86, 0.03), (0.35, 0.29, 0.3), YELLOW)
    m.blob('head', (0, 0.8, 0.16), (0.2, 0.15, 0.16), YELLOW)  # muzzle bulge
    for side, bone in ((1, 'legL'), (-1, 'legR')):
        m.blob(bone, (side * 0.13, 0.12, 0.04), (0.09, 0.12, 0.1), YELLOW, family=f'leg{side}')
        m.blob(bone, (side * 0.14, 0.03, 0.08), (0.085, 0.045, 0.13), YELLOW, family=f'leg{side}')
    for side, bone in ((1, 'armL'), (-1, 'armR')):
        m.limb(bone, (side * 0.2, 0.55, 0.08), (side * 0.27, 0.45, 0.16), 0.055, YELLOW, family=f'arm{side}')
    # Ears: long tapered cones with black tips.
    for side, bone in ((1, 'earL'), (-1, 'earR')):
        with m.frame((side * 0.16, 1.02, 0), (0, 0, -side * 0.38)):
            m.blob(bone, (0, 0.06, 0), (0.09, 0.12, 0.06), YELLOW, family=f'ear{side}')
            m.cone(bone, (0, 0.24, 0), 0.085, 0.42, YELLOW, squash=(1, 0.62))
            m.cone(bone, (0, 0.4, 0), 0.042, 0.14, BLACK, squash=(1, 0.62))
    # Face, seated on the head's real surface.
    head_c = (0, 0.84, 0.0)
    for side in (1, -1):
        m.eye('head', (side * 0.13, 0.9, 0.27), 0.055, yaw=side * 0.38, on=head_c)
        with m.on(head_c, (side * 0.235, 0.78, 0.2), sink=0.012):
            m.sphere('head', (side * 0.235, 0.78, 0.2), (0.08, 0.075, 0.035), RED, rot=(0, side * 0.85, 0), material=charge(0xffd84a))
    with m.on(head_c, (0, 0.84, 0.33), sink=0.008):
        m.sphere('head', (0, 0.84, 0.33), 0.018, BLACK, material='gloss')
    with m.on(head_c, (0, 0.76, 0.31), sink=0.01):
        m.sphere('head', (0, 0.76, 0.31), (0.05, 0.022, 0.02), 0x7a2b22)
    # Brown back stripes.
    with m.on((0, 0.56, 0), (0, 0.58, -0.17), sink=0.025):
        m.sphere('chest', (0, 0.58, -0.17), (0.17, 0.035, 0.05), BROWN, rot=(0.3, 0, 0))
    with m.on((0, 0.4, 0), (0, 0.42, -0.21), sink=0.025):
        m.sphere('hips', (0, 0.42, -0.21), (0.15, 0.033, 0.05), BROWN, rot=(0.2, 0, 0))
    # Lightning-bolt tail.
    with m.frame((0, 0.34, -0.2), (-0.45, 0, 0)):
        m.box('tail', (0, 0.06, 0), (0.07, 0.16, 0.05), BROWN, bevel=0.3)
        m.flat('tail', [(-0.04, 0.1), (0.12, 0.28), (0.03, 0.32), (0.2, 0.56), (-0.12, 0.42), (-0.02, 0.36), (-0.14, 0.18)], 0.05, YELLOW, rot=(0, math.pi / 2, 0))
    m.socket('muzzle', 'head', (0, 0.82, 0.36))

    @m.clip('idle', 2.0)
    def idle(u):
        t = u * math.tau
        flick = max(0.0, math.sin(t * 2) - 0.75) * 2.4
        return {
            'chest': {'scale': (1, 1 + math.sin(t * 2) * 0.025, 1)},
            'head': {'rot': (math.sin(t) * 0.04, math.sin(t) * 0.06, 0)},
            'earL': {'rot': (0, 0, -flick * 0.3 + math.sin(t * 2) * 0.03)},
            'earR': {'rot': (0, 0, math.sin(t * 2 + 1) * 0.03)},
            'tail': {'rot': (0, 0, math.sin(t * 2) * 0.25)},
            'armL': {'rot': (math.sin(t) * 0.05, 0, 0)},
            'armR': {'rot': (-math.sin(t) * 0.05, 0, 0)},
        }

    @m.clip('walk', 0.7)
    def walk(u):
        t = u * math.tau
        s = math.sin(t)
        return {
            'root': {'loc': (0, abs(math.cos(t)) * 0.07, 0)},
            'hips': {'rot': (0.12, 0, math.sin(t) * 0.05)},
            'legL': {'rot': (s * 0.8, 0, 0)},
            'legR': {'rot': (-s * 0.8, 0, 0)},
            'armL': {'rot': (-s * 0.6, 0, 0)},
            'armR': {'rot': (s * 0.6, 0, 0)},
            'head': {'rot': (-0.07, 0, -math.sin(t) * 0.04)},
            # Ears and tail trail the bounce a little.
            'earL': {'rot': (math.cos(t * 2) * 0.12, 0, 0)},
            'earR': {'rot': (math.cos(t * 2) * 0.12, 0, 0)},
            'tail': {'rot': (math.sin(t * 2 - 0.8) * 0.15, 0, math.sin(t - 0.6) * 0.2)},
        }

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        # Rears back while the cheeks charge, then thrusts its whole head forward.
        return merge(
            {'hips': {'rot': (s * 0.28, 0, 0)}, 'head': {'rot': (-s * 0.2, 0, 0)}},
            {'armL': {'rot': (-max(0, -s) * 0.9, 0, -0.4 * max(0, s))}, 'armR': {'rot': (-max(0, -s) * 0.9, 0, 0.4 * max(0, s))}},
            {'earL': {'rot': (-s * 0.3, 0, 0)}, 'earR': {'rot': (-s * 0.3, 0, 0)}},
        )

    faint_clip(m)
    return m
