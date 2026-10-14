import math
from rig import Model, biped_walk, breath, faint_clip, glow, merge, strike

ORANGE = 0xf2894a
CREAM = 0xf7d58f
FLAME_OUT = 0xff8c1a
FLAME_IN = 0xffe07a


def flame(m: Model, bone: str, pos, size=1.0, rot=(0, 0, 0)):
    with m.frame(pos, rot, size):
        m.cone(bone, (0, 0.12, 0), 0.1, 0.32, FLAME_OUT, material=glow(0xff6a00))
        m.cone(bone, (0.035, 0.07, 0.02), 0.06, 0.2, FLAME_OUT, material=glow(0xff6a00), rot=(0, 0, -0.4))
        m.cone(bone, (0, 0.08, 0.03), 0.055, 0.2, FLAME_IN, material=glow(0xffc030))


def build() -> Model:
    m = Model('charmander', height=1.2, attack_style='breath', attack_duration=0.55)
    m.bone('root', (0, 0, 0))
    m.bone('hips', (0, 0.3, 0), 'root')
    m.bone('legL', (0.12, 0.26, 0), 'hips')
    m.bone('legR', (-0.12, 0.26, 0), 'hips')
    m.bone('chest', (0, 0.48, 0), 'hips')
    m.bone('armL', (0.19, 0.56, 0.06), 'chest')
    m.bone('armR', (-0.19, 0.56, 0.06), 'chest')
    m.bone('head', (0, 0.66, 0.02), 'chest')
    m.bone('tail1', (0, 0.3, -0.16), 'hips')
    m.bone('tail2', (0, 0.32, -0.4), 'tail1')
    m.bone('flame', (0, 0.48, -0.52), 'tail2')

    m.blob('hips', (0, 0.34, 0), (0.22, 0.22, 0.2), ORANGE)
    m.blob('chest', (0, 0.52, 0.01), (0.19, 0.18, 0.17), ORANGE)
    m.blob('chest', (0, 0.42, 0.1), (0.16, 0.2, 0.1), CREAM)  # belly
    m.blob('head', (0, 0.86, 0.02), (0.29, 0.27, 0.28), ORANGE)
    m.blob('head', (0, 0.8, 0.2), (0.17, 0.12, 0.14), ORANGE)  # snout
    for side, bone in ((1, 'legL'), (-1, 'legR')):
        fam = f'leg{side}'
        m.limb(bone, (side * 0.12, 0.26, 0), (side * 0.13, 0.08, 0.02), 0.08, ORANGE, family=fam)
        m.blob(bone, (side * 0.13, 0.05, 0.06), (0.09, 0.05, 0.13), ORANGE, family=fam)
    for side, bone in ((1, 'armL'), (-1, 'armR')):
        m.limb(bone, (side * 0.19, 0.56, 0.06), (side * 0.27, 0.44, 0.15), 0.05, ORANGE, family=f'arm{side}')
        for dz in (-0.025, 0.025):
            m.cone(bone, (side * 0.28, 0.41, 0.17 + dz), 0.014, 0.04, 0xfbf7ee, rot=(math.pi * 0.8, 0, 0))
    m.limb('tail1', (0, 0.3, -0.12), (0, 0.32, -0.38), 0.075, ORANGE, family='tail')
    m.limb('tail2', (0, 0.32, -0.38), (0, 0.46, -0.5), 0.055, ORANGE, family='tail')
    flame(m, 'flame', (0, 0.47, -0.52))
    hc = (0, 0.84, 0.0)
    for side in (1, -1):
        m.eye('head', (side * 0.11, 0.92, 0.25), 0.058, sclera=True, iris=0x2f6fbf, yaw=side * 0.4, tall=1.2, on=hc)
        with m.on(hc, (side * 0.04, 0.83, 0.33), sink=0.005):
            m.sphere('head', (side * 0.04, 0.83, 0.33), 0.012, 0x3a2216, material='gloss')
    with m.on(hc, (0, 0.75, 0.3), sink=0.01):
        m.box('head', (0, 0.75, 0.3), (0.15, 0.02, 0.02), 0x6a2a1a, rot=(0, 0, 0), bevel=0.5)
    m.socket('muzzle', 'head', (0, 0.8, 0.34))

    def flicker(u, cycles=7):
        f = 1 + math.sin(u * math.tau * cycles) * 0.13 + math.sin(u * math.tau * cycles * 1.7) * 0.08
        return {'flame': {'scale': (1 / f, f, 1 / f)}}

    @m.clip('idle', 2.0)
    def idle(u):
        t = u * math.tau
        return merge(flicker(u, 13), {
            'chest': {'scale': (1, breath(u, 2), 1)},
            'tail1': {'rot': (0, math.sin(t) * 0.25, 0)},
            'tail2': {'rot': (math.sin(t * 2) * 0.1, 0, 0)},
            'head': {'rot': (math.sin(t) * 0.04, math.sin(t) * 0.08, 0)},
        })

    @m.clip('walk', 0.7)
    def walk(u):
        t = u * math.tau
        return merge(biped_walk(u, head='head', swing=0.75, bob=0.06), flicker(u, 5),
                     {'tail1': {'rot': (0, math.sin(t - 0.8) * 0.3, 0)}, 'tail2': {'rot': (0, math.sin(t - 1.4) * 0.25, 0)}})

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        return merge(flicker(u, 6), {
            'hips': {'rot': (s * 0.22, 0, 0)},
            'head': {'rot': (-s * 0.25, 0, 0)},
            'armL': {'rot': (-max(0, -s) * 0.8, 0, 0)},
            'armR': {'rot': (-max(0, -s) * 0.8, 0, 0)},
            'flame': {'scale': 1 + max(0, s) * 0.4},
        })

    faint_clip(m)
    return m
