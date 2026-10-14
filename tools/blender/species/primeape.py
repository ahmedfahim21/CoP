import math
from rig import Model, biped_walk, breath, clamp01, faint_clip, merge, strike

FUR = 0xf0e2c8
LIMB = 0x7a5a3a
NOSE = 0xe8a8a0


def build() -> Model:
    m = Model('primeape', height=1.15, attack_style='punch', attack_duration=0.35)
    m.bone('root', (0, 0, 0))
    m.bone('hips', (0, 0.3, 0), 'root')
    m.bone('legL', (0.16, 0.3, 0), 'hips')
    m.bone('legR', (-0.16, 0.3, 0), 'hips')
    m.bone('ball', (0, 0.5, 0), 'hips')
    m.bone('armL', (0.4, 0.68, 0.06), 'ball')
    m.bone('armR', (-0.4, 0.68, 0.06), 'ball')
    m.blob('ball', (0, 0.7, 0), (0.42, 0.4, 0.4), FUR, stiffness=1.8)
    for i in range(12):
        a = i / 12 * math.tau
        m.blob('ball', (math.cos(a) * 0.4, 0.7 + math.sin(a) * 0.38, -0.05), (0.09, 0.09, 0.09), FUR)
    for side, leg in ((1, 'legL'), (-1, 'legR')):
        m.limb(leg, (side * 0.16, 0.34, 0), (side * 0.17, 0.08, 0.02), 0.065, LIMB, family=f'leg{side}')
        m.blob(leg, (side * 0.17, 0.05, 0.06), (0.08, 0.05, 0.12), LIMB, family=f'leg{side}')
    for side, arm in ((1, 'armL'), (-1, 'armR')):
        m.limb(arm, (side * 0.38, 0.68, 0.06), (side * 0.48, 0.42, 0.12), 0.06, LIMB, family=f'arm{side}')
        m.blob(arm, (side * 0.5, 0.36, 0.13), (0.09, 0.09, 0.09), LIMB, family=f'arm{side}')
    hc = (0, 0.7, 0)
    with m.on(hc, (0, 0.66, 0.4), sink=0.04):
        m.sphere('ball', (0, 0.66, 0.4), (0.12, 0.09, 0.08), NOSE)
        for side in (1, -1):
            m.sphere('ball', (side * 0.04, 0.66, 0.47), 0.022, 0x3a2216, material='gloss')
    for side in (1, -1):
        m.eye('ball', (side * 0.15, 0.82, 0.34), 0.04, sclera=True, iris=0x2a2a2a, yaw=side * 0.35, tall=0.6, on=hc)
        with m.on(hc, (side * 0.15, 0.9, 0.36), sink=0.01):
            m.box('ball', (side * 0.15, 0.9, 0.36), (0.15, 0.04, 0.04), LIMB, rot=(0, 0, side * 0.5), bevel=0.4)
        with m.on(hc, (side * 0.3, 1.0, 0.0), sink=0.05):
            m.cone('ball', (side * 0.33, 1.04, 0.0), 0.08, 0.16, FUR, rot=(0, 0, -side * 0.6))
    m.socket('muzzle', 'armR', (-0.5, 0.36, 0.22))

    @m.clip('idle', 1.4)
    def idle(u):
        t = u * math.tau
        # Never still: bouncing on its toes, fists up.
        return {'ball': {'scale': (1, breath(u, 2, 0.03), 1)}, 'root': {'loc': (0, abs(math.sin(t * 2)) * 0.04, 0)}, 'armL': {'rot': (-0.6 + math.sin(t * 2) * 0.1, 0, 0)}, 'armR': {'rot': (-0.6 - math.sin(t * 2) * 0.1, 0, 0)}}

    @m.clip('walk', 0.5)
    def walk(u):
        return biped_walk(u, body='hips', swing=0.8, arm_swing=0.7, bob=0.08, lean=0.1)

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        flurry = math.sin(clamp01(u) * math.pi * 4)
        return {'armL': {'rot': (-max(0, flurry) * 1.5 + min(0, s) * 0.4, 0, 0)}, 'armR': {'rot': (min(0, flurry) * 1.5 + min(0, s) * 0.4, 0, 0)}, 'ball': {'rot': (0, flurry * 0.2, 0)}}

    faint_clip(m)
    return m
