import math
from rig import Model, faint_clip, strike

PURPLE = 0x8a6ab0
MARK = 0xf0e2c0


def build() -> Model:
    m = Model('koffing', height=1.0, attack_style='slam', attack_duration=0.6, fly_height=1.3)
    m.bone('root', (0, 0, 0))
    m.bone('ball', (0, 0.5, 0), 'root')
    m.bone('mouth', (0, 0.48, 0.36), 'ball')
    m.blob('ball', (0, 0.5, 0), 0.42, PURPLE)
    for x, y, z in ((0.3, 0.75, 0.1), (-0.28, 0.78, 0.05), (0.05, 0.88, -0.15), (-0.25, 0.4, -0.3), (0.3, 0.3, -0.2)):
        d = (x, y - 0.5, z)
        n = math.sqrt(sum(c * c for c in d))
        rot = (math.atan2(d[2], d[1]), 0, -math.atan2(d[0], d[1]))
        m.cylinder('ball', (x, y, z), 0.05, 0.07, 0.1, 0x6e5294, rot=rot)
        del n
    hc = (0, 0.5, 0)
    with m.on(hc, (0, 0.33, 0.37), sink=0.01):
        m.sphere('ball', (0, 0.33, 0.37), (0.07, 0.06, 0.03), MARK)
        m.box('ball', (0, 0.26, 0.37), (0.16, 0.025, 0.02), MARK, rot=(0, 0, 0.8), bevel=0.5)
        m.box('ball', (0, 0.26, 0.37), (0.16, 0.025, 0.02), MARK, rot=(0, 0, -0.8), bevel=0.5)
    for side in (1, -1):
        m.eye('ball', (side * 0.13, 0.62, 0.36), 0.05, sclera=True, iris=0x2a2a2a, yaw=side * 0.35, tall=1.2, on=hc)
    with m.on(hc, (0, 0.48, 0.42), sink=0.02):
        m.sphere('mouth', (0, 0.48, 0.42), (0.16, 0.05, 0.03), 0x3a1a3a)
        for side in (1, -1):
            m.cone('mouth', (side * 0.07, 0.5, 0.43), 0.02, 0.05, 0xfbf7ee, rot=(math.pi, 0, 0))
    m.socket('muzzle', 'ball', (0, 0.1, 0))

    @m.clip('idle', 2.8)
    def idle(u):
        t = u * math.tau
        puff = 1 + math.sin(t * 2) * 0.04
        return {'root': {'loc': (0, math.sin(t) * 0.12, 0)}, 'ball': {'rot': (math.sin(t) * 0.08, math.sin(t * 0.5) * 0.2, math.sin(t * 1.5) * 0.1), 'scale': (puff, 1 / puff, puff)}}

    @m.clip('walk', 1.4)
    def walk(u):
        t = u * math.tau
        return {'root': {'loc': (0, math.sin(t) * 0.1, 0)}, 'ball': {'rot': (0.1, 0, math.sin(t) * 0.08)}}

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        # Sludge: inflate, then dip and spit downward.
        return {'ball': {'scale': 1 + max(0, -s) * 0.15}, 'root': {'loc': (0, -max(0, s) * 0.35, 0)}, 'mouth': {'scale': (1, 1 + max(0, s) * 1.4, 1)}}

    faint_clip(m, fall=1.2)
    return m
