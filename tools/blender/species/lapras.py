import math
from rig import Model, faint_clip, strike

BLUE = 0x5aa7da
CREAM = 0xf3e7c6
SHELL = 0x8d92a3
KNOB = 0x6d7284


def build() -> Model:
    m = Model('lapras', height=1.75, attack_style='cast', attack_duration=0.6)
    m.bone('root', (0, 0, 0))
    m.bone('hull', (0, 0.36, 0), 'root')
    m.bone('neck', (0, 0.5, 0.42), 'hull')
    m.bone('upper', (0, 0.95, 0.5), 'neck')
    m.bone('head', (0, 1.3, 0.56), 'upper')
    fl = {'finFL': (0.42, 0.32), 'finFR': (-0.42, 0.32), 'finBL': (0.36, -0.42), 'finBR': (-0.36, -0.42)}
    for name, (x, z) in fl.items():
        m.bone(name, (x, 0.28, z), 'hull')
    m.blob('hull', (0, 0.36, 0), (0.52, 0.3, 0.62), BLUE)
    m.blob('hull', (0, 0.3, 0.14), (0.44, 0.24, 0.5), CREAM)
    m.blob('hull', (0, 0.5, -0.1), (0.5, 0.36, 0.55), SHELL, family='shell')
    m.limb('neck', (0, 0.5, 0.42), (0, 0.95, 0.5), 0.13, BLUE, family='neck')
    m.limb('upper', (0, 0.95, 0.5), (0, 1.25, 0.55), 0.115, BLUE, family='neck')
    m.blob('head', (0, 1.35, 0.62), (0.2, 0.17, 0.26), BLUE, family='neck')
    for name, (x, z) in fl.items():
        side = 1 if x > 0 else -1
        m.blob(name, (x + side * 0.16, 0.24, z), (0.28, 0.06, 0.13), BLUE, family=f'fin_{name}', rot=(0, side * 0.4, 0))
    for x, z in ((0, 0.05), (0.22, -0.08), (-0.22, -0.08), (0.12, -0.34), (-0.12, -0.34), (0, -0.52)):
        with m.on((0, 0.4, -0.1), (x, 0.8, z), sink=0.05, family='shell'):
            m.cone('hull', (x, 0.85, z), 0.08, 0.2, KNOB)
    hc = (0, 1.34, 0.6)
    with m.on(hc, (0, 1.53, 0.62), sink=0.03, family='neck'):
        m.cone('head', (0, 1.55, 0.64), 0.045, 0.16, CREAM, rot=(-0.3, 0, 0))
    for side in (1, -1):
        m.eye('head', (side * 0.12, 1.4, 0.8), 0.045, yaw=side * 0.6, on=hc, family='neck')
        with m.on(hc, (side * 0.15, 1.48, 0.5), sink=0.03, family='neck'):
            m.cone('head', (side * 0.15, 1.5, 0.52), 0.05, 0.17, BLUE, rot=(-0.6, 0, -side * 0.5))
    m.socket('muzzle', 'head', (0, 1.3, 0.9))

    def fins(t, amt):
        out = {}
        for name, (x, z) in fl.items():
            side = 1 if x > 0 else -1
            phase = 0 if (x > 0) == (z > 0) else math.pi
            out[name] = {'rot': (0, 0, side * math.sin(t + phase) * amt)}
        return out

    @m.clip('idle', 3.0)
    def idle(u):
        t = u * math.tau
        pose = fins(t, 0.08)
        pose.update({'hull': {'loc': (0, math.sin(t) * 0.02, 0)}, 'neck': {'rot': (math.sin(t) * 0.05, 0, math.sin(t) * 0.05)}, 'head': {'rot': (math.sin(t + 1) * 0.06, 0, 0)}})
        return pose

    @m.clip('walk', 1.2)
    def walk(u):
        t = u * math.tau
        pose = fins(t, 0.45)
        pose.update({'hull': {'loc': (0, math.sin(t) * 0.04, 0), 'rot': (math.sin(t + 1) * 0.04, 0, math.sin(t * 0.5) * 0.05)}, 'neck': {'rot': (math.sin(t + 0.5) * 0.06, 0, 0)}})
        return pose

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        return {'neck': {'rot': (-s * 0.35, 0, 0)}, 'upper': {'rot': (-s * 0.15, 0, 0)}, 'head': {'rot': (s * 0.25, 0, 0)}}

    faint_clip(m)
    return m
