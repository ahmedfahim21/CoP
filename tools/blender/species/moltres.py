import math
from articuno import bird, flight
from rig import Model, glow

GOLD = 0xf3c43a
BEAK = 0xb0905a
FLAME_OUT = 0xff8c1a
FLAME_IN = 0xffe07a
WING = [(0, 0.04), (0.3, 0.2), (0.7, 0.3), (1.1, 0.26), (0.95, 0.12), (1.05, 0.04), (0.82, 0.02), (0.88, -0.1), (0.6, -0.04), (0.5, -0.14), (0.3, -0.04), (0.1, -0.1)]


def fire(m: Model, bone: str, pos, rot, size):
    with m.frame(pos, rot, size):
        m.cone(bone, (0, 0.17, 0), 0.1, 0.4, FLAME_OUT, material=glow(0xff6a00))
        m.cone(bone, (0, 0.11, 0.02), 0.055, 0.26, FLAME_IN, material=glow(0xffc030))


def build() -> Model:
    m = Model('moltres', height=1.4, attack_style='beam', attack_duration=0.4, fly_height=1.6)
    bird(m, GOLD, BEAK, 'moltres', WING, GOLD, FLAME_OUT)
    for i in range(4):
        fire(m, 'head', (0, 1.02 + i * 0.02, 0.32 - i * 0.07), (-0.9 - i * 0.2, 0, 0), 0.9 - i * 0.12)
    for i in range(4):
        fire(m, 'tail', ((i - 1.5) * 0.08, 0.32, -0.36), (1.9, 0, (i - 1.5) * 0.25), 1.3)
    for side, bone in ((1, 'wingL'), (-1, 'wingR')):
        for i in range(5):
            fire(m, bone, (side * (0.42 + i * 0.2), 0.52, -0.1 - (i % 2) * 0.05), (-1.5, 0, -side * 0.2), 0.9)
    flight(m, 1.2, 0.55, 1.6)
    return m
