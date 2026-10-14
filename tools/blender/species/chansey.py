import math
from rig import Model, biped_walk, breath, charge, clamp01, faint_clip, merge, strike

PINK = 0xf5b5c5
PINK_DARK = 0xe591a8
EGG = 0xfbf6ec


def build() -> Model:
    m = Model('chansey', height=1.25, attack_style='punch', attack_duration=0.45)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.3, 0), 'root')
    m.bone('legL', (0.15, 0.16, 0.02), 'body')
    m.bone('legR', (-0.15, 0.16, 0.02), 'body')
    m.bone('armL', (0.36, 0.56, 0.12), 'body')
    m.bone('armR', (-0.36, 0.56, 0.12), 'body')
    m.bone('egg', (0, 0.48, 0.34), 'body')
    m.blob('body', (0, 0.56, 0), (0.42, 0.47, 0.38), PINK)
    m.blob('body', (0, 0.4, 0.24), (0.24, 0.15, 0.12), 0xfbe2e8)  # pouch
    for side, leg in ((1, 'legL'), (-1, 'legR')):
        m.blob(leg, (side * 0.16, 0.1, 0.08), (0.11, 0.07, 0.14), PINK, family=f'leg{side}')
    for side, arm in ((1, 'armL'), (-1, 'armR')):
        m.limb(arm, (side * 0.36, 0.56, 0.12), (side * 0.46, 0.45, 0.16), 0.06, PINK, family=f'arm{side}')
    m.sphere('egg', (0, 0.48, 0.38), (0.085, 0.11, 0.085), EGG, material=charge(0xffd6e8))
    hc = (0, 0.6, 0)
    for side in (1, -1):
        m.eye('body', (side * 0.13, 0.8, 0.35), 0.036, tall=1.4, on=hc)
        with m.on(hc, (side * 0.22, 0.7, 0.32), sink=0.006):
            m.sphere('body', (side * 0.22, 0.7, 0.32), (0.04, 0.025, 0.012), 0xf08aa6)
        for dy, ln in ((0.92, 0.2), (0.8, 0.24), (0.68, 0.18)):
            with m.on(hc, (side * 0.4, dy, -0.02), sink=0.05):
                m.cone('body', (side * 0.44, dy, -0.02), 0.05, ln, PINK_DARK, rot=(0, 0, -side * (1.3 + (dy - 0.6))))
    with m.on(hc, (0, 0.7, 0.4), sink=0.006):
        m.box('body', (0, 0.7, 0.4), (0.07, 0.014, 0.012), 0xb45a6e, bevel=0.5)
    m.socket('muzzle', 'body', (0, 0.6, 0.45))

    @m.clip('idle', 2.0)
    def idle(u):
        t = u * math.tau
        return {'body': {'scale': (1, breath(u, 2, 0.03), 1), 'rot': (0, 0, math.sin(t) * 0.04)}, 'armL': {'rot': (0, 0, math.sin(t * 2) * 0.08)}, 'armR': {'rot': (0, 0, -math.sin(t * 2) * 0.08)}}

    @m.clip('walk', 0.6)
    def walk(u):
        return biped_walk(u, body='body', swing=0.5, arm_swing=0.3, bob=0.06, lean=0.06, roll=0.08)

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        return {'armL': {'rot': (-max(0, s) * 1.1, 0, 0)}, 'armR': {'rot': (-max(0, s) * 1.1, 0, 0)}, 'body': {'rot': (max(0, s) * 0.12, 0, 0)}}

    @m.clip('special', 1.0, loop=False)
    def special(u):
        # Soft-Boiled: both arms up, the egg lifted high, a happy hop.
        k = math.sin(clamp01(u) * math.pi)
        return {'armL': {'rot': (0, 0, k * 2.1)}, 'armR': {'rot': (0, 0, -k * 2.1)}, 'egg': {'loc': (0, k * 0.62, -k * 0.25)}, 'root': {'loc': (0, k * 0.15, 0)}}

    faint_clip(m)
    return m
