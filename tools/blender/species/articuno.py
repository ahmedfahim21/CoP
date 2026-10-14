import math
from rig import Model, faint_clip, flap, merge, strike

ICE = 0x7cc6f0
ICE_DARK = 0x4a8fc8
WHITE = 0xeaf6ff
BEAK = 0x8a8f98
WING = [(0, 0.06), (0.35, 0.18), (0.8, 0.22), (1.15, 0.12), (1.05, 0.02), (0.95, -0.06), (0.82, 0.0), (0.7, -0.1), (0.55, -0.02), (0.4, -0.12), (0.25, -0.04), (0.08, -0.1)]


def bird(m: Model, color: int, beak: int, wing_key: str, wing_outline, wing_color: int, tip_color: int):
    """Shared legendary-bird body: torso, neck, head and two wings."""
    m.bone('root', (0, 0, 0))
    m.bone('body', (0, 0.4, 0), 'root')
    m.bone('neck', (0, 0.58, 0.22), 'body')
    m.bone('head', (0, 0.88, 0.32), 'neck')
    m.bone('wingL', (0.15, 0.52, 0.02), 'body')
    m.bone('wingR', (-0.15, 0.52, 0.02), 'body')
    m.bone('tail', (0, 0.32, -0.32), 'body')
    m.blob('body', (0, 0.4, 0), (0.24, 0.28, 0.34), color, rot=(0.3, 0, 0))
    m.limb('neck', (0, 0.55, 0.2), (0, 0.85, 0.3), 0.085, color)
    m.blob('head', (0, 0.93, 0.36), (0.14, 0.13, 0.16), color)
    m.cone('head', (0, 0.91, 0.56), 0.05, 0.16, beak, rot=(math.pi / 2, 0, 0))
    for side, bone in ((1, 'wingL'), (-1, 'wingR')):
        ry = 0 if side > 0 else math.pi
        m.flat(bone, wing_outline, 0.03, wing_color, pos=(side * 0.15, 0.52, 0.02), rot=(-math.pi / 2 + 0.15, ry, 0), scale=1.15)
        m.flat(bone, wing_outline, 0.03, tip_color, pos=(side * 0.15, 0.5, 0.02), rot=(-math.pi / 2 + 0.15, ry, 0), scale=(1.2, 0.55, 1))
    hc = (0, 0.92, 0.34)
    for side in (1, -1):
        m.eye('head', (side * 0.08, 0.96, 0.46), 0.035, sclera=True, iris=0x8a2a3a, yaw=side * 0.7, tall=0.75, on=hc)
    m.socket('muzzle', 'head', (0, 0.9, 0.62))


def flight(m: Model, cycles_idle: float, amount: float, fall: float):
    @m.clip('idle', 2.4)
    def idle(u):
        f = flap(u * cycles_idle)
        return {'wingL': {'rot': (0, 0, f * amount)}, 'wingR': {'rot': (0, 0, -f * amount)}, 'root': {'loc': (0, -f * 0.12 + math.sin(u * math.tau) * 0.06, 0)}, 'neck': {'rot': (math.sin(u * math.tau) * 0.05, 0, 0)}, 'tail': {'rot': (math.sin(u * math.tau * 2) * 0.12, 0, 0)}}

    @m.clip('walk', 1.0)
    def walk(u):
        f = flap(u * 2)
        return {'wingL': {'rot': (0, 0, f * amount * 1.1)}, 'wingR': {'rot': (0, 0, -f * amount * 1.1)}, 'root': {'loc': (0, -f * 0.12, 0)}, 'body': {'rot': (0.12, 0, 0)}, 'tail': {'rot': (math.sin(u * math.tau * 2 - 1) * 0.15, 0, 0)}}

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        f = flap(u * 2)
        flare = max(0.0, 1 - abs(u - 0.3) / 0.4)
        return {'wingL': {'rot': (0, 0, f * amount + flare * 0.5)}, 'wingR': {'rot': (0, 0, -f * amount - flare * 0.5)}, 'neck': {'rot': (s * 0.45, 0, 0)}, 'head': {'rot': (-s * 0.2, 0, 0)}}

    faint_clip(m, fall=fall)


def build() -> Model:
    m = Model('articuno', height=1.4, attack_style='cast', attack_duration=0.6, fly_height=1.7)
    bird(m, ICE, BEAK, 'articuno', WING, ICE, WHITE)
    for i in range(3):
        m.cone('head', (0, 1.04 + i * 0.03, 0.3 - i * 0.06), 0.04, 0.3 - i * 0.05, ICE_DARK, rot=(-1.1 - i * 0.2, 0, 0))
    # Long ribbon tail feathers.
    for sx in (-1, 0, 1):
        for i in range(4):
            m.box('tail', (sx * 0.08, 0.3 - i * 0.02, -0.4 - i * 0.24), (0.09 - i * 0.012, 0.02, 0.26), ICE_DARK if i % 2 else ICE, rot=(0.1, sx * 0.15, 0), bevel=0.3)
    flight(m, 1.0, 0.6, 1.7)
    return m
