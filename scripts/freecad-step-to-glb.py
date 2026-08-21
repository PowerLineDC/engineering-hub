import sys
import os
import FreeCAD
import Import


def main():
    if len(sys.argv) != 3:
        print("Usage: FreeCADCmd -c \"exec(open('freecad-step-to-glb.py').read())\" -- input.step output.glb")
        return 2

    source = os.path.abspath(sys.argv[1])
    output = os.path.abspath(sys.argv[2])

    print(f"[FreeCAD] STEP -> GLB: {source}")
    doc = None
    try:
        doc = Import.open(source)
        if doc is None:
            raise RuntimeError("FreeCAD could not open STEP document")

        objects = [obj for obj in doc.Objects if hasattr(obj, "Shape") and not obj.Shape.isNull()]
        if not objects:
            raise RuntimeError("STEP document contains no exportable shapes")

        os.makedirs(os.path.dirname(output), exist_ok=True)
        Import.export(objects, output)

        if not os.path.isfile(output) or os.path.getsize(output) == 0:
            raise RuntimeError("FreeCAD did not create a valid GLB file")

        print(f"[FreeCAD] wrote {output} ({os.path.getsize(output)} bytes)")
        return 0
    finally:
        if doc is not None:
            try:
                FreeCAD.closeDocument(doc.Name)
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
