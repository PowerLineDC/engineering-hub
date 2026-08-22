import json
import math
import os
import re
from datetime import datetime, timezone

import FreeCAD
import Part

ROOT = os.path.abspath(os.environ.get("ENGINEERINGHUB_CQE_ASSEMBLY_ROOT", ""))
OUTPUT = os.path.abspath(os.environ.get("ENGINEERINGHUB_CQE_ANALYSIS_OUTPUT", ""))

def vec(v): return {"x": round(float(v.x), 6), "y": round(float(v.y), 6), "z": round(float(v.z), 6)}
def bbox_data(b): return {"xmin": round(float(b.XMin),6), "ymin": round(float(b.YMin),6), "zmin": round(float(b.ZMin),6), "xmax": round(float(b.XMax),6), "ymax": round(float(b.YMax),6), "zmax": round(float(b.ZMax),6), "dx": round(float(b.XLength),6), "dy": round(float(b.YLength),6), "dz": round(float(b.ZLength),6)}
def shape_stats(shape):
    if shape is None or shape.isNull(): return None
    try: center = vec(shape.CenterOfMass)
    except Exception: center = None
    return {"bbox": bbox_data(shape.BoundBox), "centerOfMass": center, "volume": round(float(shape.Volume),6), "area": round(float(shape.Area),6), "solids": len(shape.Solids), "shells": len(shape.Shells), "faces": len(shape.Faces), "edges": len(shape.Edges)}
def parsed_size(filename):
    m = re.search(r"R5CQEN(\d{2})(\d{2})(\d{2})", filename, re.I)
    if not m: return None
    return {"heightMm": int(m.group(1))*100, "widthDm": int(m.group(2)), "depthDm": int(m.group(3)), "widthMm": int(m.group(2))*100, "depthMm": int(m.group(3))*100, "source": m.group(0)}
def solid_record(index, solid):
    return {"index": index, "shape": shape_stats(solid)}

def assembly_record(source):
    filename = os.path.basename(source)
    print(f"[FreeCAD] reading {filename} with Part.read", flush=True)
    shape = Part.read(source)
    if shape is None or shape.isNull(): raise RuntimeError("Part.read returned an empty shape")
    solids = list(shape.Solids)
    if not solids:
        stack = list(shape.Compounds)
        while stack:
            item = stack.pop()
            if item.Solids: solids.extend(item.Solids)
            else: stack.extend(item.Compounds)
    records = [solid_record(i, solid) for i, solid in enumerate(solids)]
    b = shape.BoundBox
    print(f"[FreeCAD] read {filename}: solids={len(records)} bbox={b.XLength:.1f}x{b.YLength:.1f}x{b.ZLength:.1f}", flush=True)
    return {"file": filename, "path": source, "parsedArticleSize": parsed_size(filename), "objectCount": len(records), "shapeObjectCount": len(records), "assemblyBBox": bbox_data(b), "objects": records, "leafShapeObjects": records, "importMethod": "Part.read"}

def main():
    print("[FreeCAD] CQE analyzer started", flush=True)
    if not os.path.isdir(ROOT): raise RuntimeError(f"Assembly root does not exist: {ROOT}")
    files = sorted([os.path.join(ROOT,n) for n in os.listdir(ROOT) if os.path.isfile(os.path.join(ROOT,n)) and re.search(r"\.(step|stp)$",n,re.I)], key=lambda p: os.path.basename(p).lower())
    print(f"[FreeCAD] files={len(files)}", flush=True)
    assemblies, failures = [], []
    for source in files:
        try: assemblies.append(assembly_record(source))
        except Exception as exc:
            print(f"[FreeCAD] FAILED {os.path.basename(source)}: {exc}", flush=True)
            failures.append({"file": os.path.basename(source), "error": str(exc)})
    result = {"schemaVersion": 2, "generatedAtUtc": datetime.now(timezone.utc).isoformat(), "units": "mm", "sourceDirectory": ROOT, "assemblyCount": len(assemblies), "failedCount": len(failures), "assemblies": assemblies, "failures": failures, "notes": ["STEP geometry is read with Part.read in headless FreeCAD.", "Component geometry is represented by solid bounding boxes and centers in the imported STEP coordinate system.", "No geometry is modified during analysis."]}
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT,"w",encoding="utf-8") as f: json.dump(result,f,ensure_ascii=False,indent=2); f.write("\n")
    print(f"[CQE analysis] analyzed={len(assemblies)} failed={len(failures)}", flush=True)
    print(f"[CQE analysis] wrote {OUTPUT} ({os.path.getsize(OUTPUT)} bytes)", flush=True)

main()
