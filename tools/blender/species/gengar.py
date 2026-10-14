import math
from rig import Model, biped_walk, breath, faint_clip, merge, strike

PURPLE = 0x6a4aa8
DARK = 0x4a3080


def build() -> Model:
    m = Model('gengar', height=1.35, attack_style='punch', attack_duration=0.5)
    m.bone('root', (0, 0, 0))
    m.bone('hips', (0, 0.3, 0), 'root')
    m.bone('legL', (0.17, 0.22, 0), 'hips')
    m.bone('legR', (-0.17, 0.22, 0), 'hips')
    m.bone('trunk', (0, 0.5, 0), 'hips')
    m.bone('armL', (0.42, 0.62, 0.08), 'trunk')
    m.bone('armR', (-0.42, 0.62, 0.08), 'trunk')
    m.blob('trunk', (0, 0.66, 0), (0.45, 0.42, 0.4), PURPLE)
    for side, leg in ((1, 'legL'), (-1, 'legR')):
        m.limb(leg, (side * 0.17, 0.25, 0), (side * 0.18, 0.08, 0.03), 0.09, PURPLE, family=f'leg{side}')
        m.blob(leg, (side * 0.18, 0.05, 0.07), (0.1, 0.05, 0.14), PURPLE, family=f'leg{side}')
    for side, arm in ((1, 'armL'), (-1, 'armR')):
        m.limb(arm, (side * 0.4, 0.62, 0.08), (side * 0.52, 0.45, 0.16), 0.075, PURPLE, family=f'arm{side}')
        for dz in (-0.04, 0, 0.04):
            m.cone(arm, (side * 0.55, 0.38, 0.19 + dz), 0.02, 0.07, PURPLE, rot=(math.pi, 0, 0))
    hc = (0, 0.66, 0)
    for x, y, z in ((0, 0.98, -0.32), (0.22, 0.86, -0.36), (-0.22, 0.86, -0.36), (0.3, 0.62, -0.33), (-0.3, 0.62, -0.33)):
        with m.on(hc, (x, y, z), sink=0.06):
            m.cone('trunk', (x, y, z - 0.05), 0.08, 0.24, PURPLE, rot=(-1.3, 0, x * 1.5))
    for side in (1, -1):
        with m.on(hc, (side * 0.26, 1.04, -0.02), sink=0.08):
            m.cone('trunk', (side * 0.28, 1.1, -0.04), 0.11, 0.32, PURPLE, rot=(0, 0, -side * 0.45))
        m.eye('trunk', (side * 0.16, 0.82, 0.36), 0.075, sclera=True, iris=0xd8344a, yaw=side * 0.35, tall=0.72, pitch=0.1, on=hc)
        with m.on(hc, (side * 0.16, 0.93, 0.36), sink=0.01):
            m.box('trunk', (side * 0.16, 0.93, 0.36), (0.16, 0.04, 0.03), DARK, rot=(0, 0, side * 0.35), bevel=0.4)
    # The grin: a red mouth with a band of teeth.
    with m.on(hc, (0, 0.56, 0.38), sink=0.025):
        m.sphere('trunk', (0, 0.56, 0.38), (0.26, 0.09, 0.05), 0x9a2238)
        m.box('trunk', (0, 0.58, 0.41), (0.42, 0.05, 0.03), 0xf4f1f8, rot=(0.2, 0, 0), bevel=0.4)
    m.socket('muzzle', 'armR', (-0.55, 0.4, 0.22))

    @m.clip('idle', 2.4)
    def idle(u):
        t = u * math.tau
        return {'trunk': {'rot': (0, math.sin(t) * 0.1, math.sin(t * 2) * 0.06), 'scale': (1, breath(u, 2), 1)}, 'armL': {'rot': (math.sin(t * 2) * 0.15, 0, -0.1)}, 'armR': {'rot': (-math.sin(t * 2) * 0.15, 0, 0.1)}, 'root': {'loc': (0, abs(math.sin(t * 2)) * 0.03, 0)}}

    @m.clip('walk', 0.6)
    def walk(u):
        # A sly, bouncing creep.
        return merge(biped_walk(u, body='hips', swing=0.6, arm_swing=0.5, bob=0.08, lean=0.1), {'trunk': {'rot': (0, math.sin(u * math.tau) * 0.12, 0)}})

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        return {'armR': {'rot': (0.3 - max(0, s) * 1.6 + min(0, s) * -0.8, 0, 0)}, 'armL': {'rot': (0.3 + max(0, s) * 0.6, 0, 0)}, 'trunk': {'rot': (0, -s * 0.4, 0)}, 'root': {'loc': (0, 0, max(0, s) * 0.2)}}

    faint_clip(m)
    return m
