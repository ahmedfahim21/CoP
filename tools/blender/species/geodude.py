import math
from rig import Model, faint_clip, strike

ROCK = 0x9a8f80
ROCK_DARK = 0x7a7064


def build() -> Model:
    m = Model('geodude', height=1.15, attack_style='punch', attack_duration=0.5)
    m.bone('root', (0, 0, 0))
    m.bone('rock', (0, 0.62, 0), 'root')
    m.bone('armL', (0.34, 0.6, 0.05), 'rock')
    m.bone('armR', (-0.34, 0.6, 0.05), 'rock')
    m.bone('fistL', (0.56, 0.35, 0.08), 'armL')
    m.bone('fistR', (-0.56, 0.35, 0.08), 'armR')
    m.blob('rock', (0, 0.62, 0), (0.37, 0.34, 0.36), ROCK, stiffness=1.6)
    # Lumps break up the sphere so it reads as stone.
    lumps = [(0.25, 0.85, 0.1), (-0.22, 0.88, 0.0), (0.05, 0.95, -0.15), (-0.28, 0.6, -0.2), (0.3, 0.55, -0.18), (0.0, 0.45, -0.3), (0.18, 0.75, -0.28)]
    for x, y, z in lumps:
        m.blob('rock', (x, y, z), (0.1, 0.08, 0.1), ROCK_DARK)
    for side, arm, fist in ((1, 'armL', 'fistL'), (-1, 'armR', 'fistR')):
        m.limb(arm, (side * 0.3, 0.6, 0.05), (side * 0.52, 0.4, 0.08), 0.085, ROCK, family=f'arm{side}')
        m.blob(fist, (side * 0.57, 0.33, 0.1), (0.14, 0.13, 0.15), ROCK, family=f'arm{side}')
        for dx in (-0.05, 0, 0.05):
            m.sphere(fist, (side * 0.57 + dx, 0.37, 0.24), 0.035, ROCK_DARK)
    hc = (0, 0.62, 0)
    for side in (1, -1):
        m.eye('rock', (side * 0.12, 0.7, 0.33), 0.045, sclera=True, iris=0x2a2a2a, yaw=side * 0.35, tall=0.75, on=hc)
        with m.on(hc, (side * 0.12, 0.79, 0.34), sink=0.01):
            m.box('rock', (side * 0.12, 0.79, 0.34), (0.16, 0.04, 0.05), 0x4a4238, rot=(0, 0, side * 0.4), bevel=0.4)
    with m.on(hc, (0, 0.54, 0.37), sink=0.008):
        m.box('rock', (0, 0.54, 0.37), (0.16, 0.02, 0.02), 0x4a4238, bevel=0.5)
    m.socket('muzzle', 'rock', (0, 0.62, 0.45))

    @m.clip('idle', 2.0)
    def idle(u):
        t = u * math.tau
        return {'root': {'loc': (0, math.sin(t) * 0.05, 0)}, 'rock': {'rot': (0.05, 0, math.sin(t) * 0.05)}, 'armL': {'rot': (math.sin(t) * 0.1, 0, 0)}, 'armR': {'rot': (-math.sin(t) * 0.1, 0, 0)}}

    @m.clip('walk', 0.8)
    def walk(u):
        t = u * math.tau
        s = math.sin(t)
        # Hauls itself along on its fists, lurching forward with each pull.
        return {'root': {'loc': (0, 0.04 + max(0, s) * 0.05, 0)}, 'rock': {'rot': (s * 0.12 + 0.05, 0, 0)}, 'armL': {'rot': (-s * 0.9, 0, 0)}, 'armR': {'rot': (s * 0.9, 0, 0)}}

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        # Double hammer: both fists up together, then slammed down.
        lift = min(0, s) * 2.0 + max(0, s) * 0.5
        return {'armL': {'rot': (lift, 0, min(0, s) * -0.5)}, 'armR': {'rot': (lift, 0, min(0, s) * 0.5)}, 'rock': {'rot': (max(0, s) * 0.2, 0, 0)}}

    faint_clip(m)
    return m
