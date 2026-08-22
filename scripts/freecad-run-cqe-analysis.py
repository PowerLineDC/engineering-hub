import os
import runpy

script = os.environ.get("ENGINEERINGHUB_CQE_ANALYZER_SCRIPT")
if not script:
    raise RuntimeError("ENGINEERINGHUB_CQE_ANALYZER_SCRIPT is missing")

print(f"[FreeCAD] runner: {script}", flush=True)
runpy.run_path(script, run_name="__main__")
print("[FreeCAD] runner finished", flush=True)
