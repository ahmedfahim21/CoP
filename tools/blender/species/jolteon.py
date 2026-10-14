import math
from rig import Model, breath, clamp01, faint_clip, gallop, merge, strike

YELLOW = 0xf8d23a
COLLAR = 0xf8f4e8


def build() -> Model:
    m = Model('jolteon', height=1.05, attack_style='cast', attack_duration=0.45)
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.42, 0), 'root')
    m.bone('spikes', (0, 0.52, -0.05), 'body')
    m.bone('head', (0, 0.58, 0.26), 'body')
    m.bone('collar', (0, 0.55, 0.22), 'head')
    m.bone('tail', (0, 0.48, -0.32), 'body')
    legs = {'legFL': (0.11, 0.2), 'legFR': (-0.11, 0.2), 'legBL': (0.12, -0.2), 'legBR': (-0.12, -0.2)}
    for name, (x, z) in legs.items():
        m.bone(name, (x, 0.36, z), 'body')
    m.blob('body', (0, 0.42, 0), (0.2, 0.18, 0.32), YELLOW)
    m.blob('head', (0, 0.7, 0.34), (0.17, 0.16, 0.18), YELLOW)
    m.blob('head', (0, 0.66, 0.5), (0.08, 0.07, 0.1), YELLOW)
    for name, (x, z) in legs.items():
        m.limb(name, (x, 0.36, z), (x, 0.06, z + 0.02), 0.048, YELLOW, family=f'leg_{name}')
        m.blob(name, (x, 0.035, z + 0.05), (0.055, 0.03, 0.075), COLLAR, family=f'leg_{name}')
    bc = (0, 0.42, 0)
    for i in range(12):
        z = -0.3 + (i % 4) * 0.15
        side = (i // 4) - 1
        with m.on(bc, (side * 0.13, 0.55, z), sink=0.05):
            m.cone('spikes', (side * 0.14, 0.6, z), 0.065, 0.22, YELLOW, rot=(-1.2, 0, side * 0.6))
    for i in range(10):
        a = i / 10 * math.tau
        m.cone('collar', (math.cos(a) * 0.15, 0.55 + math.sin(a) * 0.11, 0.2), 0.065, 0.22, COLLAR, rot=(0, 0, a - math.pi / 2))
    hc = (0, 0.7, 0.32)
    for side in (1, -1):
        with m.on(hc, (side * 0.11, 0.86, 0.32), sink=0.04):
            m.cone('head', (side * 0.12, 0.94, 0.3), 0.075, 0.34, YELLOW, rot=(0, 0, -side * 0.3), squash=(1, 0.5))
        m.eye('head', (side * 0.08, 0.74, 0.47), 0.04, sclera=True, iris=0x3a2a1a, yaw=side * 0.5, tall=1, on=hc)
    with m.on(hc, (0, 0.68, 0.6), sink=0.006):
        m.sphere('head', (0, 0.68, 0.6), 0.02, 0x2a2a2a, material='gloss')
    for i in range(3):
        m.cone('tail', (0, 0.58, -0.38), 0.07, 0.24, YELLOW, rot=(-0.6, (i - 1) * 0.4, (i - 1) * 0.4))
    m.socket('muzzle', 'head', (0, 0.68, 0.62))

    @m.clip('idle', 1.6)
    def idle(u):
        t = u * math.tau
        return {'body': {'scale': (1, breath(u, 3), 1)}, 'tail': {'rot': (0, math.sin(t * 2) * 0.3, 0)}, 'head': {'rot': (0, math.sin(t) * 0.15, 0)}, 'spikes': {'scale': 1 + max(0, math.sin(t * 4)) * 0.04}}

    @m.clip('walk', 0.5)
    def walk(u):
        return merge(gallop(u, head='head', swing=0.75, bob=0.06), {'tail': {'rot': (0.2, math.sin(u * math.tau) * 0.25, 0)}})

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        bristle = clamp01(1 - abs(u - 0.25) / 0.3)
        # Thunder Shock: the coat bristles, then the head snaps forward.
        return {'spikes': {'scale': 1 + bristle * 0.35}, 'collar': {'scale': 1 + bristle * 0.25}, 'head': {'rot': (-s * 0.25, 0, 0)}, 'body': {'loc': (0, -bristle * 0.03, 0)}}

    faint_clip(m)
    return m
