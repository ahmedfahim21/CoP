import math
from rig import Model, faint_clip, strike

BROWN = 0x8a5a3a
NOSE = 0xe58fa0
DIRT = 0x6b4a2a


def build() -> Model:
    m = Model('dugtrio', height=0.95, attack_style='bite', attack_duration=0.4)
    m.bone('root', (0, 0, 0))
    m.bone('mound', (0, 0.02, 0), 'root')
    heads = [(0, 0.12, 0.62), (0.25, -0.1, 0.48), (-0.25, -0.1, 0.5)]
    m.blob('mound', (0, 0.02, 0), (0.56, 0.17, 0.56), DIRT, family='mound')
    for x, z in ((0.4, 0.28), (-0.44, 0.1), (0.1, -0.48), (-0.28, -0.38), (0.48, -0.2)):
        m.sphere('mound', (x, 0.07, z), (0.11, 0.07, 0.11), 0x5a3c22, material='matte')
    for i, (x, z, h) in enumerate(heads):
        name = f'head{i}'
        m.bone(name, (x, 0.05, z), 'mound')
        fam = f'h{i}'
        m.limb(name, (x, 0.08, z), (x, h - 0.12, z), 0.16, BROWN, family=fam)
        m.blob(name, (x, h - 0.1, z), (0.17, 0.16, 0.16), BROWN, family=fam)
        with m.on((x, h - 0.12, z), (x, h - 0.12, z + 0.2), sink=0.03, family=fam):
            m.sphere(name, (x, h - 0.12, z + 0.2), (0.08, 0.065, 0.06), NOSE, material='gloss')
        for side in (1, -1):
            m.eye(name, (x + side * 0.06, h - 0.02, z + 0.15), 0.024, tall=1.7, on=(x, h - 0.05, z), family=fam)
    m.socket('muzzle', 'head0', (0, 0.5, 0.2))

    @m.clip('idle', 2.0)
    def idle(u):
        t = u * math.tau
        return {f'head{i}': {'loc': (0, max(0, math.sin(t * 1.5 + i * 2.1)) * 0.08, 0), 'rot': (0, 0, math.sin(t + i) * 0.08)} for i in range(3)}

    @m.clip('walk', 0.5)
    def walk(u):
        t = u * math.tau
        pose = {f'head{i}': {'loc': (0, abs(math.sin(t + i)) * 0.06, 0)} for i in range(3)}
        pose['mound'] = {'rot': (0, 0, math.sin(t * 2) * 0.04), 'scale': (1, 1 + math.sin(t * 2) * 0.08, 1)}
        return pose

    @m.clip('attack', 1.0, loop=False)
    def attack(u):
        # The heads hammer down in sequence.
        return {f'head{i}': {'rot': (max(0, strike(max(0.0, u - i * 0.08))) * 0.6 + min(0, strike(u)) * 0.2, 0, 0)} for i in range(3)}

    faint_clip(m)
    return m
