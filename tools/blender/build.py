"""
Builds every character model into apps/client/public/models/*.glb plus manifest.json.

  pnpm models                     # all
  pnpm models -- pikachu gengar   # some
"""
import importlib
import json
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'species'))

import rig  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out_dir = os.path.abspath(args[0])
only = set(args[1:])
os.makedirs(out_dir, exist_ok=True)

manifest_path = os.path.join(out_dir, 'manifest.json')
manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}

species = sorted(f[:-3] for f in os.listdir(os.path.join(HERE, 'species')) if f.endswith('.py') and not f.startswith('_'))
failed = []
for name in species:
    module = importlib.import_module(name)
    for model in module.models() if hasattr(module, 'models') else [module.build()]:
        if only and model.name not in only:
            continue
        try:
            entry = rig.build(model, os.path.join(out_dir, f'{model.name}.glb'))
            manifest[model.name] = entry
            print(f'BUILT {model.name}: {entry["triangles"]} tris, clips {entry["clips"]}', flush=True)
        except Exception:
            traceback.print_exc()
            failed.append(model.name)

with open(manifest_path, 'w') as f:
    json.dump(dict(sorted(manifest.items())), f, indent=2)
    f.write('\n')
if failed:
    print('FAILED', ', '.join(failed), flush=True)
    sys.exit(1)
