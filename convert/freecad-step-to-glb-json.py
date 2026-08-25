import json
import os
import FreeCAD
import Import


def vector_dict(v):
    return {"x": float(v.x), "y": float(v.y), "z": float(v.z)}


def main():
    source = os.environ.get("ENGINEERINGHUB_STEP_INPUT")
    glb_output = os.environ.get("ENGINEERINGHUB_GLB_OUTPUT")
    json_output = os.environ.get("ENGINEERINGHUB_JSON_OUTPUT")

    if not source or not glb_output or not json_output:
        print("ENGINEERINGHUB_STEP_INPUT, ENGINEERINGHUB_GLB_OUTPUT and ENGINEERINGHUB_JSON_OUTPUT are required")
        return 2

    source = os.path.abspath(source)
    glb_output = os.path.abspath(glb_output)
    json_output = os.path.abspath(json_output)

    doc = None
    try:
        doc = FreeCAD.newDocument("STEPImport")
        Import.insert(source, doc.Name)
        doc.recompute()

        objects = [obj for obj in doc.Objects if hasattr(obj, "Shape") and not obj.Shape.isNull()]
        if not objects:
            raise RuntimeError("FreeCAD imported no STEP shapes")

        for obj in objects:
            obj.Shape.tessellate(0.1)

        os.makedirs(os.path.dirname(glb_output), exist_ok=True)
        os.makedirs(os.path.dirname(json_output), exist_ok=True)
        Import.export(objects, glb_output)

        if not os.path.isfile(glb_output) or os.path.getsize(glb_output) == 0:
            raise RuntimeError("FreeCAD did not create a GLB file")

        shapes = [obj.Shape for obj in objects]
        solids = sum(len(shape.Solids) for shape in shapes)
        shells = sum(len(shape.Shells) for shape in shapes)
        faces = sum(len(shape.Faces) for shape in shapes)
        edges = sum(len(shape.Edges) for shape in shapes)
        vertices = sum(len(shape.Vertexes) for shape in shapes)

        bbox = None
        for shape in shapes:
            current = shape.BoundBox
            if bbox is None:
                bbox = current
            else:
                bbox.add(current)

        geometry = {
            "objects": len(objects),
            "solids": solids,
            "shells": shells,
            "faces": faces,
            "edges": edges,
            "vertices": vertices,
        }

        if bbox is not None:
            geometry["boundingBox"] = {
                "min": {"x": float(bbox.XMin), "y": float(bbox.YMin), "z": float(bbox.ZMin)},
                "max": {"x": float(bbox.XMax), "y": float(bbox.YMax), "z": float(bbox.ZMax)},
                "size": {"x": float(bbox.XLength), "y": float(bbox.YLength), "z": float(bbox.ZLength)},
            }

        data = {
            "source": os.path.basename(source),
            "glb": os.path.basename(glb_output),
            "name": os.path.splitext(os.path.basename(source))[0],
            "format": "STEP",
            "geometry": geometry,
            "objects": [
                {
                    "name": str(obj.Label),
                    "type": str(obj.TypeId),
                    "solids": len(obj.Shape.Solids),
                    "faces": len(obj.Shape.Faces),
                    "edges": len(obj.Shape.Edges),
                    "vertices": len(obj.Shape.Vertexes),
                }
                for obj in objects
            ],
        }

        with open(json_output, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")

        print("[FreeCAD] GLB and JSON written", flush=True)
        return 0
    finally:
        if doc is not None:
            try:
                FreeCAD.closeDocument(doc.Name)
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
