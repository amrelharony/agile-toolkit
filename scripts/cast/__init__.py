"""The cast rig builder's modules (scripts/build-cast-rigs.py). Pure numpy + Pillow.

A regular package, so nothing of the same name elsewhere on sys.path can shadow it.
Whoever imports it has scripts/ on sys.path already (the CLI and the tests insert
it), which is also where the modules find mascot_heads.py's generic helpers.
"""

import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
