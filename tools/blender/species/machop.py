import math
from rig import Model, biped_walk, breath, clamp01, faint_clip, merge, strike

GREY = 0x9db0c2
DARK = 0x71849a
CREST = 0x9c7a62


def build() -> Model:
    m = Model('machop', height=1.4, attack_style='punch', attack_duration=0.45)
    m.bone('root', (0, 0, 0))
    m.bone('hips', (0, 0.4, 0), 'root')
    m.bone('legL', (0.14, 0.38, 0), 'hips')
    m.bone('legR', (-0.14, 0.38, 0), 'hips')
    m.bone('chest', (0, 0.6, 0), 'hips')
    m.bone('armL', (0.31, 0.76, 0), 'chest')
    m.bone('armR', (-0.31, 0.76, 0), 'chest')
    m.bone('foreL', (0.36, 0.5, 0), 'armL')
    m.bone('foreR', (-0.36, 0.5, 0), 'armR')
    m.bone('head', (0, 0.92, 0.02), 'chest')
    m.blob('hips', (0, 0.42, 0), (0.24, 0.12, 0.17), 0x4a5566)
    m.blob('chest', (0, 0.66, 0), (0.3, 0.3, 0.22), GREY)
    for side in (1, -1):
        m.blob('chest', (side * 0.11, 0.75, 0.13), (0.12, 0.08, 0.07), GREY)
    m.blob('head', (0, 1.08, 0.02), (0.23, 0.23, 0.22), GREY)
    for side, leg in ((1, 'legL'), (-1, 'legR')):
        m.limb(leg, (side * 0.14, 0.38, 0), (side * 0.15, 0.06, 0.02), 0.095, GREY, family=f'leg{side}')
        m.blob(leg, (side * 0.15, 0.04, 0.06), (0.11, 0.05, 0.15), DARK, family=f'leg{side}')
    for side, arm, fore in ((1, 'armL', 'foreL'), (-1, 'armR', 'foreR')):
        m.blob(arm, (side * 0.31, 0.76, 0), (0.1, 0.1, 0.1), GREY, family=f'arm{side}')
        m.limb(arm, (side * 0.32, 0.74, 0), (side * 0.36, 0.52, 0), 0.075, GREY, family=f'arm{side}')
        m.limb(fore, (side * 0.36, 0.5, 0), (side * 0.37, 0.3, 0.02), 0.1, GREY, family=f'fore{side}')
        m.blob(fore, (side * 0.37, 0.25, 0.02), (0.12, 0.12, 0.12), DARK, family=f'fore{side}')
    hc = (0, 1.06, 0.0)
    for x, h, tilt in ((0.09, 0.15, -0.35), (0, 0.2, 0), (-0.09, 0.15, 0.35)):
        with m.on(hc, (x, 1.27, 0.02), sink=0.04):
            m.cone('head', (x, 1.27 + h * 0.3, 0.02), 0.065, h, CREST, rot=(-0.15, 0, tilt), squash=(0.55, 1.5))
    for side in (1, -1):
        m.eye('head', (side * 0.09, 1.11, 0.2), 0.04, sclera=True, iris=0xd53b2f, yaw=side * 0.35, tall=1.1, on=hc)
        with m.on(hc, (side * 0.09, 1.18, 0.21), sink=0.008):
            m.box('head', (side * 0.09, 1.18, 0.21), (0.1, 0.022, 0.02), 0x2a2f38, rot=(0, 0, side * 0.3), bevel=0.4)
    with m.on(hc, (0, 0.98, 0.2), sink=0.02):
        m.sphere('head', (0, 0.98, 0.2), (0.09, 0.04, 0.05), 0xe6dccb)
    for y in (0.6, 0.52):
        with m.on((0, 0.62, 0), (0, y, 0.21), sink=0.004):
            m.box('chest', (0, y, 0.21), (0.16, 0.012, 0.02), DARK, bevel=0.5)
    m.socket('muzzle', 'foreR', (-0.37, 0.22, 0.08))

    @m.clip('idle', 2.0)
    def idle(u):
        t = u * math.tau
        guard = {'armL': {'rot': (-0.4, 0, 0.1)}, 'armR': {'rot': (-0.4, 0, -0.1)}, 'foreL': {'rot': (-1.0, 0, 0)}, 'foreR': {'rot': (-1.0, 0, 0)}}
        return merge(guard, {'chest': {'scale': (1, breath(u, 2), 1)}, 'hips': {'loc': (0, -abs(math.sin(t * 2)) * 0.02, 0)}, 'head': {'rot': (0, math.sin(t) * 0.1, 0)}})

    @m.clip('walk', 0.75)
    def walk(u):
        guard = {'foreL': {'rot': (-1.0, 0, 0)}, 'foreR': {'rot': (-1.0, 0, 0)}}
        return merge(biped_walk(u, head='head', swing=0.65, arm_swing=0.5, bob=0.05), guard)

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        # Right straight: chamber back, then drive the fist forward with a torso twist.
        return {
            'armR': {'rot': (-0.4 - max(0, s) * 1.25 + min(0, s) * -0.9, 0, -0.1)},
            'foreR': {'rot': (-1.0 + max(0, s) * 0.9, 0, 0)},
            'armL': {'rot': (-0.4, 0, 0.1)}, 'foreL': {'rot': (-1.0, 0, 0)},
            'chest': {'rot': (0, -s * 0.35, 0)},
            'root': {'loc': (0, 0, max(0, s) * 0.12)},
        }

    faint_clip(m)
    return m
