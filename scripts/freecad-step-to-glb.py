import sys
import os
import FreeCAD
import Part
import Mesh


def main():
    if len(sys.argv) != 3:
        print("Usage: FreeCADCmd <script> <input.step> <output.stl>")
        return 2

    source = os.path.abspath(sys.argv[1])
    output = os.path.abspath(sys.argv[2])
    print(f"[FreeCAD] STEP -> mesh: {source}")

    doc = None
    try:
        doc = FreeCAD.newDocument("STEPImport")
        shape = Part.Shape()
        shape.read(source)

        if shape.isNull():
            raise RuntimeError("FreeCAD could not read STEP geometry")

        obj = doc.addObject("Part::Feature", "STEP")
        obj.Shape = shape
        doc.recompute()

        os.makedirs(os.path.dirname(output), exist_ok=True)
        Mesh.export([obj], output)

        if not os.path.isfile(output) or os.path.getsize(output) == 0:
            raise RuntimeError("FreeCAD did not create a mesh file")

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
