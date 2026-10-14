import math
from rig import Model, faint_clip, strike

BLUE = 0x3c78c8
BELLY = 0xf2e2b4
CREST = 0xe9eef7
MOUTH = 0xa8263a

# Resting curve: leans back out of the coil, then arcs forward into an S.
REST = [-0.45, -0.25, 0.15, 0.4, 0.45, 0.3]


def build() -> Model:
    m = Model('gyarados', height=2.8, attack_style='bite', attack_duration=0.65)
    m.bone('root', (0, 0, 0))
    m.bone('coil', (0, 0.3, -0.6), 'root')
    # The neck is a chain of segments; positions follow the resting S so the mesh is built posed.
    pts = [(0.0, 0.3, -0.2)]
    angle = 0.0
    for i in range(6):
        angle += REST[i]
        x, y, z = pts[-1]
        pts.append((0.0, y + math.cos(angle) * 0.34, z + math.sin(angle) * 0.34))
    parent = 'root'
    for i in range(6):
        m.bone(f'seg{i}', pts[i], parent)
        parent = f'seg{i}'
    m.bone('head', pts[6], parent)
    hx, hy, hz = pts[6]
    m.bone('jaw', (0, hy - 0.1, hz + 0.08), 'head')
    for i in range(4):
        a = i / 4 * math.pi * 1.4
        m.blob('coil', (math.sin(a) * 0.48, 0.3, -0.6 - math.cos(a) * 0.38 - 0.05), (0.34 - i * 0.04, 0.27, 0.34 - i * 0.04), BLUE)
    for i in range(6):
        a, b = pts[i], pts[i + 1]
        r = 0.32 - i * 0.025
        m.limb(f'seg{i}', a, b, r, BLUE)
        mid = tuple((p + q) / 2 for p, q in zip(a, b))
        m.blob(f'seg{i}', (0, mid[1], mid[2] + r * 0.45), (r * 0.78, 0.2, r * 0.5), BELLY)
        with m.on(mid, (0, mid[1] + 0.05, mid[2] - r)):
            m.cone(f'seg{i}', (0, mid[1] + 0.05, mid[2] - r - 0.05), 0.07, 0.24, CREST, rot=(-1.0, 0, 0), squash=(0.4, 1))
    m.blob('head', (0, hy + 0.05, hz + 0.12), (0.34, 0.28, 0.4), BLUE, family='head')
    m.blob('jaw', (0, hy - 0.14, hz + 0.28), (0.27, 0.1, 0.32), BLUE, family='jaw')
    m.sphere('jaw', (0, hy - 0.08, hz + 0.3), (0.22, 0.06, 0.28), MOUTH)
    hc = (0, hy + 0.05, hz + 0.1)
    for side in (1, -1):
        m.cone('jaw', (side * 0.13, hy - 0.04, hz + 0.52), 0.03, 0.09, 0xfbf7ee)
        m.eye('head', (side * 0.17, hy + 0.16, hz + 0.34), 0.06, sclera=True, iris=0x2a2a2a, yaw=side * 0.6, tall=0.8, on=hc, family='head')
        with m.on(hc, (side * 0.16, hy + 0.24, hz + 0.34), sink=0.01, family='head'):
            m.box('head', (side * 0.16, hy + 0.24, hz + 0.34), (0.15, 0.035, 0.03), 0x223a6a, rot=(0, 0, side * 0.45), bevel=0.4)
        m.cylinder('head', (side * 0.36, hy - 0.02, hz + 0.32), 0.015, 0.022, 0.55, CREST, rot=(0.6, 0, side * 1.1))
        m.cone('head', (side * 0.13, hy + 0.36, hz - 0.08), 0.08, 0.36, BLUE, rot=(-0.6, 0, -side * 0.4))
    m.flat('head', [(0, 0), (0.12, 0.3), (0.04, 0.22), (0, 0.42), (-0.04, 0.22), (-0.12, 0.3)], 0.03, CREST, pos=(0, hy + 0.26, hz - 0.12), rot=(-0.4, 0, 0))
    m.socket('muzzle', 'jaw', (0, hy - 0.1, hz + 0.62))

    def wave(t, amp_x, amp_z, phase=0.0):
        return {f'seg{i}': {'rot': (math.sin(t - i * 0.7) * amp_x, 0, math.sin(t * 0.7 - i * 0.6 + phase) * amp_z)} for i in range(6)}

    @m.clip('idle', 3.0)
    def idle(u):
        t = u * math.tau
        pose = wave(t, 0.06, 0.05)
        pose['jaw'] = {'rot': (0.08 + max(0, math.sin(t * 2)) * 0.06, 0, 0)}
        pose['coil'] = {'scale': (1, 1 + math.sin(t) * 0.02, 1)}
        return pose

    @m.clip('walk', 1.4)
    def walk(u):
        t = u * math.tau
        pose = wave(t * 2, 0.11, 0.12)
        pose['coil'] = {'rot': (0, math.sin(t) * 0.3, 0)}
        return pose

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        pose = wave(0, 0, 0)
        pose['seg3'] = {'rot': (s * 0.35, 0, 0)}
        pose['seg5'] = {'rot': (s * 0.3, 0, 0)}
        pose['head'] = {'rot': (-s * 0.2, 0, 0)}
        pose['jaw'] = {'rot': (max(0, s) * 0.55 + 0.08, 0, 0)}
        return pose

    faint_clip(m)
    return m
