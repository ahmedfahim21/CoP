import math
from rig import Model, breath, faint_clip, merge, strike

BROWN = 0xb08a5a
CREAM = 0xf0e2c0
COIL = 0x8a6a42


def build() -> Model:
    m = Model('hitmonlee', height=1.55, attack_style='kick', attack_duration=0.45)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.82, 0), 'root')
    m.bone('torso', (0, 0.95, 0), 'body')
    m.bone('armL', (0.3, 1.12, 0.04), 'torso')
    m.bone('armR', (-0.3, 1.12, 0.04), 'torso')
    for side, n in ((1, 'L'), (-1, 'R')):
        m.bone(f'hip{n}', (side * 0.14, 0.82, 0), 'body')
        m.bone(f'knee{n}', (side * 0.14, 0.4, 0), f'hip{n}')
    m.blob('torso', (0, 1.12, 0), (0.3, 0.32, 0.27), BROWN)
    for side, n in ((1, 'L'), (-1, 'R')):
        m.limb(f'hip{n}', (side * 0.14, 0.85, 0), (side * 0.14, 0.42, 0), 0.08, BROWN, family=f'leg{n}')
        for y in (0.72, 0.62, 0.52):
            m.torus(f'hip{n}', (side * 0.14, y, 0), 0.085, 0.016, COIL, rot=(math.pi / 2, 0, 0))
        m.limb(f'knee{n}', (side * 0.14, 0.4, 0), (side * 0.14, 0.08, 0.02), 0.06, BROWN, family=f'shin{n}')
        m.blob(f'knee{n}', (side * 0.14, 0.05, 0.08), (0.1, 0.05, 0.16), CREAM, family=f'shin{n}')
    for side, arm in ((1, 'armL'), (-1, 'armR')):
        m.limb(arm, (side * 0.3, 1.12, 0.04), (side * 0.38, 0.85, 0.1), 0.05, BROWN, family=f'arm{side}')
        m.sphere(arm, (side * 0.39, 0.8, 0.11), 0.07, CREAM)
    hc = (0, 1.12, 0)
    for side in (1, -1):
        m.eye('torso', (side * 0.1, 1.3, 0.24), 0.045, sclera=True, iris=0x2a2a2a, yaw=side * 0.35, tall=0.7, on=hc)
    with m.on(hc, (0, 1.38, 0.24), sink=0.02):
        m.box('torso', (0, 1.38, 0.24), (0.3, 0.05, 0.05), 0x5a4228, rot=(0.2, 0, 0), bevel=0.4)
    m.socket('muzzle', 'kneeR', (-0.14, 0.04, 0.2))

    @m.clip('idle', 1.6)
    def idle(u):
        t = u * math.tau
        bounce = abs(math.sin(t * 2))
        return {'body': {'loc': (0, -bounce * 0.05, 0)}, 'kneeL': {'rot': (bounce * 0.15, 0, 0)}, 'kneeR': {'rot': (bounce * 0.15, 0, 0)}, 'torso': {'scale': (1, breath(u, 2), 1)}, 'armL': {'rot': (-0.4, 0, 0)}, 'armR': {'rot': (-0.4, 0, 0)}}

    @m.clip('walk', 0.7)
    def walk(u):
        t = u * math.tau
        s = math.sin(t)
        # Bouncy, springing gait.
        return {'body': {'loc': (0, abs(math.cos(t)) * 0.1, 0), 'rot': (0.08, 0, 0)}, 'hipL': {'rot': (s * 0.6, 0, 0)}, 'hipR': {'rot': (-s * 0.6, 0, 0)}, 'kneeL': {'rot': (max(0, -s) * 0.7, 0, 0)}, 'kneeR': {'rot': (max(0, s) * 0.7, 0, 0)}, 'armL': {'rot': (0.4 - s * 0.4, 0, 0)}, 'armR': {'rot': (0.4 + s * 0.4, 0, 0)}}

    @m.clip('leap', 1.0)
    def leap(u):
        # Jump Kick in the air: left knee tucked, right leg shooting out for the landing.
        return {'hipL': {'rot': (-1.3, 0, 0)}, 'kneeL': {'rot': (2.0, 0, 0)}, 'hipR': {'rot': (-0.5, 0, 0)}, 'armL': {'rot': (0, 0, 0.8)}, 'armR': {'rot': (0, 0, -0.8)}, 'body': {'rot': (-0.15, 0, 0)}}

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        return {'hipR': {'rot': (-max(0, s) * 1.6 + min(0, s) * -0.5, 0, 0)}, 'kneeR': {'rot': (max(0, -s) * 1.2, 0, 0)}, 'body': {'rot': (-max(0, s) * 0.25, 0, 0)}}

    faint_clip(m)
    return m
