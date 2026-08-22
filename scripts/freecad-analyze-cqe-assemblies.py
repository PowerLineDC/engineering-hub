import json
import math
import os
import re
from datetime import datetime, timezone

import FreeCAD
import Import


ROOT = os.path.abspath(os.environ.get("ENGINEERINGHUB_CQE_ASSEMBLY_ROOT", ""))
OUTPUT = os.path.abspath(os.environ.get("ENGINEERINGHUB_CQE_ANALYSIS_OUTPUT", ""))



def vec(v):
    return {"x": round(float(v.x), 6), "y": round(float(v.y), 6), "z": round(float(v.z), 6)}


def bbox_data(box):
    return {
        "xmin": round(float(box.XMin), 6),
        "ymin": round(float(box.YMin), 6),
        "zmin": round(float(box.ZMin), 6),
        "xmax": round(float(box.XMax), 6),
        "ymax": round(float(box.YMax), 6),
        "zmax": round(float(box.ZMax), 6),
        "dx": round(float(box.XLength), 6),
        "dy": round(float(box.YLength), 6),
        "dz": round(float(box.ZLength), 6),
    }


def rotation_data(rotation):
    axis = rotation.Axis
    return {
        "axis": vec(axis),
        "angleDeg": round(float(rotation.Angle) * 180.0 / math.pi, 6),
    }


def placement_data(placement):
    return {
        "base": vec(placement.Base),
        "rotation": rotation_data(placement.Rotation),
    }


def shape_stats(shape):
    if shape is None or shape.isNull():
        return None

    box = shape.BoundBox
    try:
        center = shape.CenterOfMass
        center_data = vec(center)
    except Exception:
        center_data = None

    try:
        volume = float(shape.Volume)
    except Exception:
        volume = None

    try:
        area = float(shape.Area)
    except Exception:
        area = None

    try:
        solids = len(shape.Solids)
    except Exception:
        solids = None

    try:
        shells = len(shape.Shells)
    except Exception:
        shells = None

    try:
        faces = len(shape.Faces)
    except Exception:
        faces = None

    try:
        edges = len(shape.Edges)
    except Exception:
        edges = None

    return {
        "bbox": bbox_data(box),
        "centerOfMass": center_data,
        "volume": round(volume, 6) if volume is not None else None,
        "area": round(area, 6) if area is not None else None,
        "solids": solids,
        "shells": shells,
        "faces": faces,
        "edges": edges,
    }


def parsed_size(filename):
    # CQE article convention: R5CQEN + HH + WW + DD + suffix.
    match = re.search(r"R5CQEN(\d{2})(\d{2})(\d{2})", filename, re.IGNORECASE)
    if not match:
        return None
    return {
        "heightMm": int(match.group(1)) * 100,
        "widthDm": int(match.group(2)),
        "depthDm": int(match.group(3)),
        "widthMm": int(match.group(2)) * 100,
        "depthMm": int(match.group(3)) * 100,
        "source": match.group(0),
    }


def object_record(obj):
    shape = getattr(obj, "Shape", None)
    stats = shape_stats(shape) if shape is not None else None

    out_names = []
    for child in getattr(obj, "OutList", []) or []:
        out_names.append(getattr(child, "Name", ""))

    group_names = []
    for child in getattr(obj, "Group", []) or []:
        group_names.append(getattr(child, "Name", ""))

    record = {
        "name": getattr(obj, "Name", ""),
        "label": getattr(obj, "Label", ""),
        "typeId": getattr(obj, "TypeId", ""),
        "isVisible": bool(getattr(obj, "Visibility", False)),
        "placement": placement_data(obj.Placement) if hasattr(obj, "Placement") else None,
        "children": out_names,
        "groupMembers": group_names,
        "shape": stats,
    }

    # Preserve useful STEP importer metadata when available.
    properties = {}
    for prop in getattr(obj, "PropertiesList", []) or []:
        try:
            value = getattr(obj, prop)
            if isinstance(value, (str, int, float, bool)) or value is None:
                properties[prop] = value
            elif hasattr(value, "x") and hasattr(value, "y") and hasattr(value, "z"):
                properties[prop] = vec(value)
            else:
                text = str(value)
                if len(text) <= 500:
                    properties[prop] = text
        except Exception:
            pass
    if properties:
        record["properties"] = properties

    return record


def assembly_record(source):
    filename = os.path.basename(source)
    doc = None
    try:
        print(f"[FreeCAD] importing {filename}", flush=True)
        doc = FreeCAD.newDocument("CQE_Analysis")
        Import.insert(source, doc.Name)
        doc.recompute()

        objects = [obj for obj in doc.Objects if hasattr(obj, "Shape") and not obj.Shape.isNull()]
        if not objects:
            raise RuntimeError("FreeCAD imported no STEP shapes")

        records = [object_record(obj) for obj in objects]

        assembly_box = None
        for obj in objects:
            try:
                box = obj.Shape.BoundBox
                if assembly_box is None:
                    assembly_box = box
                else:
                    assembly_box.add(box)
            except Exception:
                pass

        # Identify leaf shape objects. These are especially useful when the STEP
        # importer exposes an assembly hierarchy: they are the lowest-level
        # geometric components rather than parent compounds.
        names_with_children = {r["name"] for r in records if r["children"]}
        leaf_records = [r for r in records if r["name"] not in names_with_children and r["shape"] is not None]

        return {
            "file": filename,
            "path": source,
            "parsedArticleSize": parsed_size(filename),
            "objectCount": len(records),
            "shapeObjectCount": len(records),
            "assemblyBBox": bbox_data(assembly_box) if assembly_box is not None else None,
            "objects": records,
            "leafShapeObjects": leaf_records,
        }
    finally:
        if doc is not None:
            try:
                FreeCAD.closeDocument(doc.Name)
            except Exception:
                pass


def main():
    if not ROOT or not os.path.isdir(ROOT):
        raise RuntimeError("ENGINEERINGHUB_CQE_ASSEMBLY_ROOT is missing or does not exist")
    if not OUTPUT:
        raise RuntimeError("ENGINEERINGHUB_CQE_ANALYSIS_OUTPUT is missing")

    files = sorted(
        [os.path.join(ROOT, name) for name in os.listdir(ROOT)
         if os.path.isfile(os.path.join(ROOT, name)) and re.search(r"\.(step|stp)$", name, re.IGNORECASE)],
        key=lambda p: os.path.basename(p).lower(),
    )

    if not files:
        raise RuntimeError(f"No STEP/STP files found in {ROOT}")

    assemblies = []
    failures = []
    for source in files:
        try:
            assemblies.append(assembly_record(source))
        except Exception as exc:
            print(f"[FreeCAD] FAILED {os.path.basename(source)}: {exc}", flush=True)
            failures.append({"file": os.path.basename(source), "error": str(exc)})

    result = {
        "schemaVersion": 1,
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "units": "mm",
        "sourceDirectory": ROOT,
        "assemblyCount": len(assemblies),
        "failedCount": len(failures),
        "assemblies": assemblies,
        "failures": failures,
        "notes": [
            "Coordinates and bounding boxes are reported in the coordinate system imported by FreeCAD from each STEP file.",
            "No geometry is modified during analysis.",
            "leafShapeObjects are the lowest-level shape objects exposed by the STEP importer and are intended for component/position comparison.",
        ],
    }

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(f"[CQE analysis] analyzed={len(assemblies)} failed={len(failures)}")
    print(f"[CQE analysis] wrote {OUTPUT} ({os.path.getsize(OUTPUT)} bytes)", flush=True)


if __name__ == "__main__":
    main()
