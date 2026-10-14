import math
from rig import Model, biped_walk, breath, faint_clip, merge, strike

BLUE = 0x7cc7ea
SHELL = 0xb07a3c
RIM = 0xf2e1b4
BELLY = 0xf4d67c


def build() -> Model:
    m = Model('squirtle', height=1.2, attack_style='cast', attack_duration=0.5)
    m.bone('root', (0, 0, 0))
    m.bone('hips', (0, 0.3, 0), 'root')
    m.bone('legL', (0.12, 0.25, 0), 'hips')
    m.bone('legR', (-0.12, 0.25, 0), 'hips')
    m.bone('chest', (0, 0.48, 0), 'hips')
    m.bone('armL', (0.21, 0.56, 0.05), 'chest')
    m.bone('armR', (-0.21, 0.56, 0.05), 'chest')
    m.bone('head', (0, 0.68, 0.02), 'chest')
    m.bone('tail', (0, 0.28, -0.24), 'hips')

    m.blob('hips', (0, 0.36, 0), (0.22, 0.22, 0.19), BLUE)
    m.blob('chest', (0, 0.5, 0.0), (0.2, 0.17, 0.17), BLUE)
    m.blob('head', (0, 0.88, 0.02), (0.3, 0.28, 0.29), BLUE)
    m.blob('head', (0, 0.8, 0.18), (0.16, 0.12, 0.13), BLUE)
    # Shell: plated belly and a domed back, then a cream rim around the join.
    m.blob('chest', (0, 0.44, 0.13), (0.19, 0.2, 0.09), BELLY, family='belly')
    m.blob('chest', (0, 0.45, -0.1), (0.25, 0.25, 0.17), SHELL, family='shell')
    with m.frame((0, 0.45, 0.02), (0, 0, 0)):
        m.torus('chest', (0, 0, 0), 0.235, 0.045, RIM, rot=(0, 0, 0))
    for y in (0.5, 0.42, 0.34):
        with m.on((0, 0.44, 0), (0, y, 0.2), sink=0.008, family='belly'):
            m.box('chest', (0, y, 0.2), (0.24, 0.012, 0.015), 0xc9a64e, bevel=0.6)
    for x, y, z in ((0, 0.6, -0.22), (0.14, 0.46, -0.24), (-0.14, 0.46, -0.24), (0, 0.32, -0.22)):
        with m.on((0, 0.45, -0.05), (x, y, z), sink=0.012, family='shell'):
            m.sphere('chest', (x, y, z), (0.08, 0.08, 0.02), 0x8a5a28, rot=(0.0, math.atan2(x, -0.2), 0))
    for side, bone in ((1, 'legL'), (-1, 'legR')):
        fam = f'leg{side}'
        m.limb(bone, (side * 0.12, 0.25, 0), (side * 0.13, 0.08, 0.02), 0.08, BLUE, family=fam)
        m.blob(bone, (side * 0.13, 0.05, 0.06), (0.09, 0.05, 0.12), BLUE, family=fam)
    for side, bone in ((1, 'armL'), (-1, 'armR')):
        m.limb(bone, (side * 0.21, 0.56, 0.05), (side * 0.29, 0.44, 0.13), 0.055, BLUE, family=f'arm{side}')
    with m.frame((0, 0.3, -0.36), (0, math.pi / 2, 0)):
        m.torus('tail', (0, 0.06, 0), 0.1, 0.05, BLUE, rot=(0, 0, 0), arc=math.tau * 0.8)
    hc = (0, 0.86, 0.0)
    for side in (1, -1):
        m.eye('head', (side * 0.12, 0.93, 0.26), 0.06, sclera=True, iris=0x7b3a2a, yaw=side * 0.4, tall=1.2, on=hc)
    with m.on(hc, (0, 0.79, 0.31), sink=0.01):
        m.box('head', (0, 0.79, 0.31), (0.14, 0.02, 0.02), 0x2c4f66, bevel=0.5)
    m.socket('muzzle', 'head', (0, 0.82, 0.34))

    @m.clip('idle', 2.0)
    def idle(u):
        t = u * math.tau
        return {
            'chest': {'scale': (1, breath(u, 2), 1)},
            'tail': {'rot': (0, math.sin(t) * 0.3, 0)},
            'head': {'rot': (math.sin(t) * 0.04, math.sin(t) * 0.08, 0)},
            'armL': {'rot': (math.sin(t) * 0.06, 0, 0)},
            'armR': {'rot': (-math.sin(t) * 0.06, 0, 0)},
        }

    @m.clip('walk', 0.7)
    def walk(u):
        return merge(biped_walk(u, head='head', swing=0.7, bob=0.06), {'tail': {'rot': (0, math.sin(u * math.tau - 0.8) * 0.35, 0)}})

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        # Puffs its cheeks back, then sprays forward with a little recoil.
        return {
            'hips': {'rot': (s * 0.25, 0, 0)},
            'head': {'rot': (-s * 0.22, 0, 0), 'scale': 1 + max(0, -s) * 0.06},
            'armL': {'rot': (-max(0, -s) * 0.6, 0, 0)},
            'armR': {'rot': (-max(0, -s) * 0.6, 0, 0)},
        }

    faint_clip(m)
    return m
