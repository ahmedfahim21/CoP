import math
from rig import Model, faint_clip, gallop, merge, strike

COAT = 0xf0883a
FLUFF = 0xf6e8c0
STRIPE = 0x2a2420
NOSE = 0x2a2420


def build() -> Model:
    m = Model('arcanine', height=1.5, attack_style='bite', attack_duration=0.5)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.66, 0), 'root')
    m.bone('head', (0, 0.98, 0.42), 'body')
    m.bone('jaw', (0, 0.98, 0.62), 'head')
    m.bone('tail', (0, 0.78, -0.45), 'body')
    legs = {'legFL': (0.17, 0.3), 'legFR': (-0.17, 0.3), 'legBL': (0.17, -0.3), 'legBR': (-0.17, -0.3)}
    for name, (x, z) in legs.items():
        m.bone(name, (x, 0.58, z), 'body')

    m.blob('body', (0, 0.66, 0), (0.28, 0.26, 0.46), COAT)
    # Cream ruff round the neck and chest.
    m.blob('body', (0, 0.8, 0.3), (0.3, 0.26, 0.2), FLUFF)
    m.blob('head', (0, 1.08, 0.48), (0.22, 0.2, 0.22), COAT)
    m.blob('head', (0, 1.0, 0.68), (0.12, 0.1, 0.13), FLUFF)  # muzzle
    m.blob('jaw', (0, 0.93, 0.66), (0.09, 0.05, 0.1), FLUFF)
    m.blob('head', (0, 1.25, 0.42), (0.16, 0.08, 0.12), FLUFF)  # cream tuft on top
    for name, (x, z) in legs.items():
        fam = f'leg_{name}'
        m.limb(name, (x, 0.6, z), (x, 0.14, z), 0.085, COAT, family=fam)
        m.blob(name, (x, 0.07, z + 0.04), (0.08, 0.06, 0.1), COAT, family=fam)
    # Bushy cream tail.
    m.blob('tail', (0, 0.9, -0.58), (0.14, 0.2, 0.14), FLUFF, family='tail', rot=(-0.7, 0, 0))
    m.blob('tail', (0, 1.02, -0.7), (0.11, 0.14, 0.11), FLUFF, family='tail', rot=(-0.9, 0, 0))
    # Black tiger stripes on the back and flanks.
    bc = (0, 0.66, 0)
    for i, z in enumerate((-0.25, -0.05, 0.15)):
        for side in (1, -1):
            with m.on(bc, (side * 0.22, 0.78, z), sink=0.02):
                m.sphere('body', (side * 0.22, 0.78, z), (0.03, 0.1, 0.035), STRIPE, rot=(0, 0, -side * 0.6))
        with m.on(bc, (0, 0.9, z - 0.05), sink=0.02):
            m.sphere('body', (0, 0.9, z - 0.05), (0.14, 0.02, 0.035), STRIPE)
    hc = (0, 1.08, 0.48)
    for side in (1, -1):
        m.eye('head', (side * 0.1, 1.12, 0.66), 0.045, sclera=True, iris=0x4a2a1a, yaw=side * 0.45, tall=1.0, on=hc)
        with m.on(hc, (side * 0.13, 1.22, 0.4), sink=0.03):
            m.cone('head', (side * 0.13, 1.28, 0.4), 0.07, 0.18, COAT, rot=(-0.2, 0, -side * 0.35), squash=(1, 0.6))
    with m.on(hc, (0, 1.04, 0.8), sink=0.01):
        m.sphere('head', (0, 1.04, 0.8), (0.04, 0.03, 0.025), NOSE, material='gloss')
    m.socket('muzzle', 'jaw', (0, 0.98, 0.8))

    @m.clip('idle', 2.2)
    def idle(u):
        t = u * math.tau
        return {
            'body': {'scale': (1, 1 + math.sin(t * 2) * 0.02, 1)},
            'head': {'rot': (math.sin(t) * 0.05, math.sin(t * 0.5) * 0.15, 0)},
            'tail': {'rot': (0, math.sin(t * 3) * 0.3, 0)},
        }

    @m.clip('walk', 0.5)
    def walk(u):
        return merge(gallop(u, head='head', swing=0.8, bob=0.08), {'tail': {'rot': (math.sin(u * math.tau) * 0.15, 0, 0)}})

    @m.clip('charge', 0.35)
    def charge(u):
        # Extreme Speed: flat out, head low, tail streaming.
        return merge(gallop(u, head='head', swing=1.05, bob=0.12), {'body': {'rot': (0.08, 0, 0)}, 'head': {'rot': (0.2, 0, 0)}, 'tail': {'rot': (0.6, 0, 0)}})

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        return {'body': {'rot': (s * 0.15, 0, 0)}, 'head': {'rot': (s * 0.35, 0, 0)}, 'jaw': {'rot': (max(0, -s) * 0.6, 0, 0)}, 'legFL': {'rot': (-max(0, s) * 0.4, 0, 0)}}

    faint_clip(m)
    return m
