import json
import math
import os
import re
from datetime import datetime, timezone

import FreeCAD
import Import

ROOT = os.path.abspath(os.environ.get("ENGINEERINGHUB_CQE_ASSEMBLY_ROOT", ""))
OUTPUT = os.path.abspath(os.environ.get("ENGINEERINGHUB_CQE_ANALYSIS_OUTPUT", ""))

def vec(v): return {"x": round(float(v.x), 6), "y": round(float(v.y), 6), "z": round(float(v.z), 6)}
def bbox_data(b): return {"xmin": b.XMin, "ymin": b.YMin, "zmin": b.ZMin, "xmax": b.XMax, "ymax": b.YMax, "zmax": b.ZMax, "dx": b.XLength, "dy": b.YLength, "dz": b.ZLength}
def rotation_data(r): return {"axis": vec(r.Axis), "angleDeg": round(float(r.Angle) * 180 / math.pi, 6)}
def placement_data(p): return {"base": vec(p.Base), "rotation": rotation_data(p.Rotation)}

def shape_stats(shape):
    if shape is None or shape.isNull(): return None
    try: center = vec(shape.CenterOfMass)
    except Exception: center = None
    return {"bbox": bbox_data(shape.BoundBox), "centerOfMass": center,
            "volume": float(shape.Volume), "area": float(shape.Area),
            "solids": len(shape.Solids), "shells": len(shape.Shells),
            "faces": len(shape.Faces), "edges": len(shape.Edges)}

def parsed_size(filename):
    m = re.search(r"R5CQEN(\d{2})(\d{2})(\d{2})", filename, re.I)
    if not m: return None
    return {"heightMm": int(m.group(1))*100, "widthDm": int(m.group(2)), "depthDm": int(m.group(3)), "widthMm": int(m.group(2))*100, "depthMm": int(m.group(3))*100, "source": m.group(0)}

def object_record(obj):
    shape = getattr(obj, "Shape", None)
    return {"name": obj.Name, "label": obj.Label, "typeId": obj.TypeId,
            "isVisible": bool(getattr(obj, "Visibility", False)),
            "placement": placement_data(obj.Placement) if hasattr(obj, "Placement") else None,
            "children": [getattr(x, "Name", "") for x in getattr(obj, "OutList", []) or []],
            "groupMembers": [getattr(x, "Name", "") for x in getattr(obj, "Group", []) or []],
            "shape": shape_stats(shape) if shape is not None else None}

def assembly_record(source):
    filename = os.path.basename(source)
    print(f"[FreeCAD] importing {filename}", flush=True)
    doc = FreeCAD.newDocument("CQE_Analysis")
    try:
        Import.insert(source, doc.Name)
        doc.recompute()
        objects = [o for o in doc.Objects if hasattr(o, "Shape") and not o.Shape.isNull()]
        if not objects: raise RuntimeError("FreeCAD imported no STEP shapes")
        records = [object_record(o) for o in objects]
        box = None
        for o in objects:
            b = o.Shape.BoundBox
            if box is None: box = b
            else: box.add(b)
        parents = {r["name"] for r in records if r["children"]}
        return {"file": filename, "path": source, "parsedArticleSize": parsed_size(filename),
                "objectCount": len(records), "shapeObjectCount": len(records),
                "assemblyBBox": bbox_data(box) if box else None, "objects": records,
                "leafShapeObjects": [r for r in records if r["name"] not in parents and r["shape"] is not None]}
    finally:
        FreeCAD.closeDocument(doc.Name)

def main():
    print("[FreeCAD] CQE analyzer started", flush=True)
    if not os.path.isdir(ROOT): raise RuntimeError(f"Assembly root does not exist: {ROOT}")
    files = sorted([os.path.join(ROOT, n) for n in os.listdir(ROOT) if re.search(r"\.(step|stp)$", n, re.I)], key=lambda p: os.path.basename(p).lower())
    print(f"[FreeCAD] files={len(files)}", flush=True)
    assemblies, failures = [], []
    for source in files:
        try: assemblies.append(assembly_record(source))
        except Exception as exc:
            print(f"[FreeCAD] FAILED {os.path.basename(source)}: {exc}", flush=True)
            failures.append({"file": os.path.basename(source), "error": str(exc)})
    result = {"schemaVersion": 1, "generatedAtUtc": datetime.now(timezone.utc).isoformat(), "units": "mm", "sourceDirectory": ROOT, "assemblyCount": len(assemblies), "failedCount": len(failures), "assemblies": assemblies, "failures": failures}
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f: json.dump(result, f, ensure_ascii=False, indent=2); f.write("\n")
    print(f"[CQE analysis] analyzed={len(assemblies)} failed={len(failures)}", flush=True)
    print(f"[CQE analysis] wrote {OUTPUT} ({os.path.getsize(OUTPUT)} bytes)", flush=True)

main()
