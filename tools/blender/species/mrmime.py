import math
from rig import Model, biped_walk, breath, faint_clip, merge, strike

WHITE = 0xf3eef0
PINK = 0xf5a0b0
BLUE = 0x4a7ad8
RED = 0xd8344a


def build() -> Model:
    m = Model('mrmime', height=1.35, attack_style='cast', attack_duration=0.5)
    m.bone('root', (0, 0, 0))
    m.bone('hips', (0, 0.42, 0), 'root')
    m.bone('legL', (0.13, 0.42, 0), 'hips')
    m.bone('legR', (-0.13, 0.42, 0), 'hips')
    m.bone('chest', (0, 0.6, 0), 'hips')
    m.bone('armL', (0.26, 0.8, 0.02), 'chest')
    m.bone('armR', (-0.26, 0.8, 0.02), 'chest')
    m.bone('handL', (0.3, 0.48, 0.02), 'armL')
    m.bone('handR', (-0.3, 0.48, 0.02), 'armR')
    m.bone('head', (0, 0.92, 0.02), 'chest')
    m.blob('chest', (0, 0.68, 0), (0.25, 0.27, 0.22), WHITE)
    for side in (1, -1):
        m.blob('chest', (side * 0.22, 0.82, 0), (0.1, 0.08, 0.09), PINK)
    m.blob('head', (0, 1.1, 0.02), (0.21, 0.2, 0.2), PINK, family='head')
    for side, leg in ((1, 'legL'), (-1, 'legR')):
        m.limb(leg, (side * 0.13, 0.42, 0), (side * 0.13, 0.08, 0.02), 0.05, PINK, family=f'leg{side}')
        m.blob(leg, (side * 0.13, 0.05, 0.08), (0.1, 0.06, 0.15), RED, family=f'leg{side}')
    for side, arm, hand in ((1, 'armL', 'handL'), (-1, 'armR', 'handR')):
        m.limb(arm, (side * 0.26, 0.8, 0.02), (side * 0.3, 0.52, 0.02), 0.042, PINK, family=f'arm{side}')
        m.sphere(hand, (side * 0.3, 0.42, 0.04), (0.1, 0.12, 0.05), WHITE)
        for dx in (-0.05, -0.017, 0.017, 0.05):
            m.cylinder(hand, (side * 0.3 + dx, 0.3, 0.04), 0.022, 0.024, 0.08, WHITE)
    for y in (0.75, 0.62):
        with m.on((0, 0.68, 0), (0, y, 0.22), sink=0.02):
            m.sphere('chest', (0, y, 0.22), 0.045, RED, material='gloss')
    hc = (0, 1.1, 0.02)
    for side in (1, -1):
        with m.on(hc, (side * 0.18, 1.25, 0.0), sink=0.05, family='head'):
            m.sphere('head', (side * 0.19, 1.27, 0.0), (0.1, 0.12, 0.1), BLUE)
        m.eye('head', (side * 0.08, 1.14, 0.18), 0.035, sclera=True, iris=0x2a2a3a, yaw=side * 0.4, tall=1.1, on=hc, family='head')
        with m.on(hc, (side * 0.13, 1.04, 0.16), sink=0.006, family='head'):
            m.sphere('head', (side * 0.13, 1.04, 0.16), (0.035, 0.022, 0.012), 0xf27a8e)
    with m.on(hc, (0, 1.01, 0.2), sink=0.008, family='head'):
        m.sphere('head', (0, 1.01, 0.2), (0.045, 0.018, 0.015), 0xb04a5a)
    m.socket('muzzle', 'handR', (-0.3, 0.42, 0.12))

    def wall(u, amount):
        # Palms out, feeling along an invisible wall.
        feel = math.sin(u * math.tau)
        return {'armL': {'rot': (-1.3 * amount, 0, 0)}, 'armR': {'rot': (-1.3 * amount, 0, 0)}, 'handL': {'rot': (1.3 * amount, 0, 0), 'loc': (0, feel * 0.04 * amount, 0)}, 'handR': {'rot': (1.3 * amount, 0, 0), 'loc': (0, -feel * 0.04 * amount, 0)}}

    @m.clip('idle', 2.0)
    def idle(u):
        return merge(wall(u, 1.0), {'chest': {'scale': (1, breath(u, 2), 1)}, 'hips': {'rot': (0, 0, math.sin(u * math.tau) * 0.04)}})

    @m.clip('walk', 0.75)
    def walk(u):
        return biped_walk(u, head='head', swing=0.55, arm_swing=0.4, bob=0.05)

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        s = strike(u)
        # Psybeam: both hands thrust forward.
        return {'armL': {'rot': (-0.4 - max(0, s) * 1.2, 0, 0.2)}, 'armR': {'rot': (-0.4 - max(0, s) * 1.2, 0, -0.2)}, 'hips': {'rot': (s * 0.12, 0, 0)}}

    faint_clip(m)
    return m
