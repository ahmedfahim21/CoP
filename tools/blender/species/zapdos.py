import math
from articuno import bird, flight
from rig import Model, charge

YELLOW = 0xf5d23a
BLACK = 0x2a2a2a
BEAK = 0xe88a2a
WING = [(0, 0.05), (0.3, 0.22), (0.5, 0.14), (0.68, 0.34), (0.86, 0.2), (1.12, 0.36), (1.0, 0.1), (1.1, 0.02), (0.8, 0.0), (0.86, -0.12), (0.6, -0.04), (0.55, -0.16), (0.35, -0.05), (0.25, -0.16), (0.1, -0.06)]


def build() -> Model:
    m = Model('zapdos', height=1.45, attack_style='cast', attack_duration=0.55, fly_height=1.75)
    bird(m, YELLOW, BEAK, 'zapdos', WING, YELLOW, BLACK)
    for i in range(5):
        m.cone('head', ((i - 2) * 0.03, 1.04, 0.32 - i * 0.02), 0.035, 0.24, YELLOW, rot=(-0.9 - i * 0.15, 0, (i - 2) * 0.25))
    for i in range(5):
        m.cone('tail', ((i - 2) * 0.06, 0.32, -0.45), 0.05, 0.36, BLACK if i % 2 else YELLOW, rot=(-1.9, 0, (i - 2) * 0.3))
    for i in range(5):
        m.cone('body', ((i - 2) * 0.07, 0.3, 0.25), 0.06, 0.2, YELLOW, rot=(1.4, 0, (i - 2) * 0.2))
    # Electric sacs on the wing roots light up when it calls down Thunder.
    for side, bone in ((1, 'wingL'), (-1, 'wingR')):
        m.sphere(bone, (side * 0.25, 0.53, 0.05), 0.05, 0xfff27a, material=charge(0xfff27a))
    flight(m, 1.4, 0.6, 1.75)
    return m
