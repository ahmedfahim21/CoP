import math
from rig import Model, biped_walk, breath, faint_clip, merge, strike

SHELL = 0x8a8f7a
SHELL_DARK = 0x6c7060
SKIN = 0xb08a5a


def build() -> Model:
    m = Model('golem', height=1.7, attack_style='throw', attack_duration=0.8)
    m.bone('root', (0, 0, 0))
    m.bone('hips', (0, 0.35, 0), 'root')
    m.bone('legL', (0.24, 0.32, 0), 'hips')
    m.bone('legR', (-0.24, 0.32, 0), 'hips')
    m.bone('shell', (0, 0.6, 0), 'hips')
    m.bone('head', (0, 0.94, 0.5), 'shell')
    m.bone('armL', (0.52, 0.77, 0.15), 'shell')
    m.bone('armR', (-0.52, 0.77, 0.15), 'shell')
    m.bone('rock', (0, 1.57, 0.15), 'shell')
    m.blob('shell', (0, 0.82, 0), (0.58, 0.53, 0.55), SHELL, stiffness=1.6)
    plates = [(0.3, 1.15, 0.2), (-0.32, 1.12, 0.15), (0.0, 1.28, -0.1), (0.45, 0.85, -0.2), (-0.45, 0.82, -0.2), (0.0, 0.95, -0.48), (0.25, 0.55, -0.35), (-0.25, 0.55, -0.35), (0.38, 0.6, 0.3), (-0.38, 0.6, 0.3)]
    for i, (x, y, z) in enumerate(plates):
        m.blob('shell', (x, y, z), (0.17, 0.12, 0.17), SHELL_DARK if i % 2 else SHELL)
    m.blob('head', (0, 0.94, 0.52), (0.18, 0.15, 0.15), SKIN, family='head')
    for side, leg in ((1, 'legL'), (-1, 'legR')):
        m.limb(leg, (side * 0.24, 0.36, 0), (side * 0.25, 0.1, 0.03), 0.11, SKIN, family=f'leg{side}')
        m.blob(leg, (side * 0.25, 0.06, 0.08), (0.13, 0.07, 0.17), SKIN, family=f'leg{side}')
    for side, arm in ((1, 'armL'), (-1, 'armR')):
        m.limb(arm, (side * 0.52, 0.77, 0.15), (side * 0.6, 0.48, 0.2), 0.1, SKIN, family=f'arm{side}')
        m.blob(arm, (side * 0.62, 0.42, 0.22), (0.13, 0.12, 0.14), SKIN, family=f'arm{side}')
    hc = (0, 0.94, 0.5)
    for side in (1, -1):
        m.eye('head', (side * 0.07, 0.98, 0.65), 0.03, sclera=True, iris=0xa82a2a, yaw=side * 0.4, tall=0.8, on=hc, family='head')
        with m.on(hc, (side * 0.07, 1.03, 0.66), sink=0.008, family='head'):
            m.box('head', (side * 0.07, 1.03, 0.66), (0.08, 0.02, 0.02), 0x4a3a2a, rot=(0, 0, side * 0.4), bevel=0.4)
    m.blob('rock', (0, 1.57, 0.15), (0.22, 0.2, 0.22), SHELL_DARK, family='rock')
    m.socket('muzzle', 'shell', (0, 0.5, 0.6))

    def hidden():
        return {'rock': {'scale': 0.0001}}

    @m.clip('idle', 2.6)
    def idle(u):
        return merge(hidden(), {'shell': {'scale': (1, breath(u, 1, 0.02), 1)}, 'head': {'rot': (0, math.sin(u * math.tau) * 0.15, 0)}})

    @m.clip('walk', 1.0)
    def walk(u):
        return merge(hidden(), biped_walk(u, body='hips', swing=0.45, arm_swing=0.3, bob=0.06, lean=0.05))

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        lift = max(0, -s) / 0.55
        # Rollout: heave a boulder overhead with both hands, then bowl it.
        return {'rock': {'scale': 1.0 if u < 0.4 else 0.0001}, 'armL': {'rot': (-lift * 2.6 - max(0, s) * 1.2, 0, 0)}, 'armR': {'rot': (-lift * 2.6 - max(0, s) * 1.2, 0, 0)}, 'shell': {'rot': (max(0, s) * 0.35 - lift * 0.15, 0, 0)}}

    faint_clip(m)
    return m
