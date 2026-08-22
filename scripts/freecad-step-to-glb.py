import os
import FreeCAD
import Part
import Import


def main():
    source = os.environ.get("ENGINEERINGHUB_STEP_INPUT")
    output = os.environ.get("ENGINEERINGHUB_MESH_OUTPUT")

    if not source or not output:
        print("Usage: FreeCADCmd -c \"exec(open(script).read())\" with ENGINEERINGHUB_STEP_INPUT and ENGINEERINGHUB_MESH_OUTPUT set")
        return 2

    source = os.path.abspath(source)
    output = os.path.abspath(output)
    print(f"[FreeCAD] STEP -> GLB: {source}", flush=True)

    doc = None
    try:
        doc = FreeCAD.newDocument("STEPImport")

        # Part.Shape.read() is not the STEP importer. Use FreeCAD's Import
        # module so STEP files are parsed through the normal STEP importer.
        Import.insert(source, doc.Name)
        doc.recompute()

        objects = [obj for obj in doc.Objects if hasattr(obj, "Shape") and not obj.Shape.isNull()]
        if not objects:
            raise RuntimeError("FreeCAD imported no STEP shapes")

        # FreeCADCmd is headless, so there is no GUI view provider to create
        # triangulation data automatically. The glTF exporter needs that data.
        for obj in objects:
            obj.Shape.tessellate(0.1)

        os.makedirs(os.path.dirname(output), exist_ok=True)
        Import.export(objects, output)

        if not os.path.isfile(output) or os.path.getsize(output) == 0:
            raise RuntimeError("FreeCAD did not create a GLB file")

        print(f"[FreeCAD] wrote {output} ({os.path.getsize(output)} bytes)", flush=True)
        return 0
    finally:
        if doc is not None:
            try:
                FreeCAD.closeDocument(doc.Name)
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
