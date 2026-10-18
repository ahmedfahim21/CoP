import math
from rig import Model, faint_clip, strike

SHELL = 0xf5ded2
CRACK = 0x8a6a5a


def egg(m: Model, bone: str, x: float, z: float, lean: float, look: float):
    with m.frame((x, 0, z), (0, look, lean)):
        m.blob(bone, (0, 0.26, 0), (0.17, 0.24, 0.17), SHELL, family=bone)
        ec = (0, 0.26, 0)
        for side in (1, -1):
            m.eye(bone, (side * 0.06, 0.3, 0.15), 0.04, sclera=True, iris=0x2a2a30, yaw=side * 0.3, tall=1.1, on=ec, family=bone)
        with m.on(ec, (0, 0.2, 0.17), sink=0.008, family=bone):
            m.sphere(bone, (0, 0.2, 0.17), (0.03, 0.012, 0.01), 0x5a3a3a)
        # A crack zigzagging across the back of the shell.
        with m.on(ec, (0.02, 0.36, -0.15), sink=0.01, family=bone):
            m.flat(bone, [(-0.08, 0), (-0.04, 0.03), (0, -0.01), (0.04, 0.03), (0.08, 0), (0.04, 0.012), (0, -0.026), (-0.04, 0.012)], 0.012, CRACK, pos=(0.02, 0.36, -0.15))


def build() -> Model:
    # One unit is a pair of eggs; the card brings three pairs.
    m = Model('exeggcute', height=0.62, attack_style='cast', attack_duration=0.5)
    m.bone('root', (0, 0, 0))
    m.bone('eggA', (0.12, 0.02, 0.02), 'root')
    m.bone('eggB', (-0.13, 0.02, -0.06), 'root')
    egg(m, 'eggA', 0.12, 0.02, -0.12, 0.2)
    egg(m, 'eggB', -0.13, -0.06, 0.15, -0.25)
    m.socket('muzzle', 'eggA', (0.1, 0.3, 0.2))

    @m.clip('idle', 1.6)
    def idle(u):
        t = u * math.tau
        return {'eggA': {'rot': (0, 0, math.sin(t) * 0.08)}, 'eggB': {'rot': (0, 0, math.sin(t + 1.6) * 0.08)}}

    @m.clip('walk', 0.5)
    def walk(u):
        t = u * math.tau
        # The two eggs hop in turn.
        return {
            'eggA': {'loc': (0, max(0.0, math.sin(t)) * 0.12, 0), 'rot': (0.15, 0, math.sin(t) * 0.12)},
            'eggB': {'loc': (0, max(0.0, -math.sin(t)) * 0.12, 0), 'rot': (0.15, 0, -math.sin(t) * 0.12)},
        }

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        return {'eggA': {'rot': (-s * 0.35, 0, 0), 'loc': (0, max(0, s) * 0.06, 0)}, 'eggB': {'rot': (-s * 0.25, 0, 0)}}

    faint_clip(m)
    return m
