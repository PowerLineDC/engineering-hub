#include <fstream>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>
#include <filesystem>
#include <algorithm>
#include <cstdio>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Interface_InterfaceModel.hxx>
#include <XSControl_WorkSession.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <Poly_Triangulation.hxx>
#include <TopLoc_Location.hxx>
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <GProp_GProps.hxx>
#include <BRepGProp.hxx>
#include <gp_Pnt.hxx>

namespace
{
    const char* statusName(IFSelect_ReturnStatus status)
    {
        switch (status)
        {
            case IFSelect_RetVoid: return "RetVoid";
            case IFSelect_RetDone: return "RetDone";
            case IFSelect_RetError: return "RetError";
            case IFSelect_RetFail: return "RetFail";
            case IFSelect_RetStop: return "RetStop";
            default: return "Unknown";
        }
    }

    std::string printablePrefix(const std::string& bytes)
    {
        std::string result;
        for (unsigned char c : bytes)
        {
            if (c >= 32 && c <= 126) result.push_back(static_cast<char>(c));
            else result.push_back('.');
        }
        return result;
    }

    void inspectRawStepFile(const std::string& path)
    {
        std::ifstream input(path, std::ios::binary);
        if (!input)
        {
            std::cerr << "RAW STEP inspection: cannot open file" << std::endl;
            return;
        }

        std::string prefix(4096, '\0');
        input.read(prefix.data(), static_cast<std::streamsize>(prefix.size()));
        prefix.resize(static_cast<std::size_t>(input.gcount()));

        std::cerr << "RAW STEP prefix bytes: " << prefix.size() << std::endl;
        std::cerr << "RAW STEP prefix: " << printablePrefix(prefix.substr(0, 160)) << std::endl;
        std::cerr << "RAW STEP ISO-10303-21 at byte 0: " << (prefix.rfind("ISO-10303-21", 0) == 0 ? "yes" : "no") << std::endl;
        std::cerr << "RAW STEP HEADER section in prefix: " << (prefix.find("HEADER;") != std::string::npos ? "yes" : "no") << std::endl;
        std::cerr << "RAW STEP DATA section in prefix: " << (prefix.find("DATA;") != std::string::npos ? "yes" : "no") << std::endl;
        std::cerr << "RAW STEP ENDSEC in prefix: " << (prefix.find("ENDSEC;") != std::string::npos ? "yes" : "no") << std::endl;
        std::cerr << "RAW STEP END-ISO marker in prefix: " << (prefix.find("END-ISO-10303-21") != std::string::npos ? "yes" : "no") << std::endl;

        input.clear();
        input.seekg(0, std::ios::end);
        const std::streamoff totalSize = input.tellg();
        const std::streamoff tailSize = std::min<std::streamoff>(4096, totalSize);
        input.seekg(totalSize - tailSize, std::ios::beg);
        std::string tail(static_cast<std::size_t>(tailSize), '\0');
        input.read(tail.data(), tailSize);
        tail.resize(static_cast<std::size_t>(input.gcount()));
        std::cerr << "RAW STEP tail: " << printablePrefix(tail.substr(tail.size() > 160 ? tail.size() - 160 : 0)) << std::endl;
        std::cerr << "RAW STEP END-ISO marker in tail: " << (tail.find("END-ISO-10303-21") != std::string::npos ? "yes" : "no") << std::endl;
    }

    std::filesystem::path makeAsciiStepCopy(const std::filesystem::path& source)
    {
        const std::filesystem::path tempDir = std::filesystem::temp_directory_path();
        const std::filesystem::path target = tempDir / "engineeringhub_occt_input.step";
        std::error_code ec;
        std::filesystem::copy_file(source, target, std::filesystem::copy_options::overwrite_existing, ec);
        if (ec) throw std::runtime_error("Cannot create ASCII STEP copy: " + ec.message());
        return target;
    }

    void printReaderDiagnostics(STEPControl_Reader& reader)
    {
        Handle(XSControl_WorkSession) ws = reader.WS();
        if (ws.IsNull())
        {
            std::cerr << "  WorkSession: null" << std::endl;
            return;
        }

        Handle(Interface_InterfaceModel) model = ws->Model();
        if (model.IsNull())
        {
            std::cerr << "  Interface model: null" << std::endl;
            std::cerr << "  OCCT could not create a STEP interface model from this file." << std::endl;
            return;
        }

        std::cerr << "  Interface entities: " << model->NbEntities() << std::endl;
        std::cerr << "  Roots available: " << reader.NbRootsForTransfer() << std::endl;
    }

    void writeJson(const std::string& path, const std::string& stepPath, const TopoDS_Shape& shape, Standard_Integer roots, Standard_Integer transferred)
    {
        Bnd_Box box;
        BRepBndLib::Add(shape, box);
        Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
        box.Get(xmin, ymin, zmin, xmax, ymax, zmax);

        GProp_GProps props;
        BRepGProp::VolumeProperties(shape, props);

        Standard_Integer solids = 0;
        Standard_Integer shells = 0;
        Standard_Integer faces = 0;
        for (TopExp_Explorer it(shape, TopAbs_SOLID); it.More(); it.Next()) ++solids;
        for (TopExp_Explorer it(shape, TopAbs_SHELL); it.More(); it.Next()) ++shells;
        for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) ++faces;

        std::ofstream out(path, std::ios::trunc);
        if (!out) throw std::runtime_error("Cannot write JSON: " + path);

        const auto escapeJson = [](const std::string& value) {
            std::string result;
            for (char c : value) {
                if (c == '\\') result += "\\\\";
                else if (c == '"') result += "\\\"";
                else if (c == '\n') result += "\\n";
                else if (c == '\r') result += "\\r";
                else result += c;
            }
            return result;
        };

        out << std::setprecision(15);
        out << "{\n";
        out << "  \"stepFile\": \"" << escapeJson(stepPath) << "\",\n";
        out << "  \"roots\": " << roots << ",\n";
        out << "  \"transferred\": " << transferred << ",\n";
        out << "  \"solids\": " << solids << ",\n";
        out << "  \"shells\": " << shells << ",\n";
        out << "  \"faces\": " << faces << ",\n";
        out << "  \"boundingBox\": {\n";
        out << "    \"min\": [" << xmin << ", " << ymin << ", " << zmin << "],\n";
        out << "    \"max\": [" << xmax << ", " << ymax << ", " << zmax << "],\n";
        out << "    \"size\": [" << xmax - xmin << ", " << ymax - ymin << ", " << zmax - zmin << "]\n";
        out << "  },\n";
        out << "  \"volume\": " << props.Mass() << "\n";
        out << "}\n";
    }

    void writeObj(const std::string& path, const TopoDS_Shape& shape)
    {
        BRepMesh_IncrementalMesh mesher(shape, 0.5, Standard_False, 0.5, Standard_True);
        if (!mesher.IsDone()) throw std::runtime_error("OCCT triangulation failed");

        std::ofstream out(path, std::ios::trunc);
        if (!out) throw std::runtime_error("Cannot write OBJ: " + path);

        out << std::setprecision(9);
        out << "# Engineering Hub / Open CASCADE tessellation\n";

        Standard_Integer vertexOffset = 1;
        Standard_Integer triangleCount = 0;

        for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next())
        {
            const TopoDS_Face face = TopoDS::Face(it.Current());
            TopLoc_Location location;
            Handle(Poly_Triangulation) triangulation = BRep_Tool::Triangulation(face, location);
            if (triangulation.IsNull()) continue;

            const gp_Trsf transform = location.Transformation();
            const Standard_Integer nodes = triangulation->NbNodes();
            for (Standard_Integer i = 1; i <= nodes; ++i)
            {
                const gp_Pnt point = triangulation->Node(i).Transformed(transform);
                out << "v " << point.X() << " " << point.Y() << " " << point.Z() << "\n";
            }

            const bool reversed = face.Orientation() == TopAbs_REVERSED;
            for (Standard_Integer i = 1; i <= triangulation->NbTriangles(); ++i)
            {
                Standard_Integer n1, n2, n3;
                triangulation->Triangle(i).Get(n1, n2, n3);
                if (reversed) std::swap(n2, n3);
                out << "f " << vertexOffset + n1 - 1 << " " << vertexOffset + n2 - 1 << " " << vertexOffset + n3 - 1 << "\n";
                ++triangleCount;
            }
            vertexOffset += nodes;
        }

        std::cerr << "OBJ triangles: " << triangleCount << std::endl;
    }
}

int main(int argc, char* argv[])
{
    if (argc < 2 || argc > 4)
    {
        std::cerr << "Usage: occt-reader <file.step> [output.json] [output.obj]" << std::endl;
        return 1;
    }

    const std::string filePath = argv[1];
    const std::string jsonPath = argc >= 3 ? argv[2] : "";
    const std::string objPath = argc >= 4 ? argv[3] : "";

    std::error_code ec;
    const auto fileSize = std::filesystem::file_size(filePath, ec);
    if (ec)
    {
        std::cerr << "Cannot access STEP file: " << filePath << std::endl;
        std::cerr << "Filesystem error: " << ec.message() << std::endl;
        return 2;
    }
    std::cerr << "STEP file: " << filePath << std::endl;
    std::cerr << "STEP size: " << fileSize << " bytes" << std::endl;
    inspectRawStepFile(filePath);

    std::filesystem::path asciiStepPath;
    try
    {
        asciiStepPath = makeAsciiStepCopy(std::filesystem::u8path(filePath));
        std::cerr << "OCCT STEP input copy: " << asciiStepPath.string() << std::endl;
    }
    catch (const std::exception& error)
    {
        std::cerr << "STEP path normalization failed: " << error.what() << std::endl;
        return 3;
    }

    STEPControl_Reader reader;
    const IFSelect_ReturnStatus status = reader.ReadFile(asciiStepPath.string().c_str());
    std::cerr << "STEP ReadFile status: " << static_cast<int>(status) << " (" << statusName(status) << ")" << std::endl;

    if (status != IFSelect_RetDone)
    {
        printReaderDiagnostics(reader);
        std::cerr << "STEP read failed. The file was not accepted by OCCT STEPControl_Reader." << std::endl;
        std::error_code removeEc;
        std::filesystem::remove(asciiStepPath, removeEc);
        return 4;
    }

    const Standard_Integer roots = reader.NbRootsForTransfer();
    std::cerr << "STEP roots: " << roots << std::endl;

    const Standard_Integer transferred = reader.TransferRoots();
    std::cerr << "STEP transferred roots: " << transferred << std::endl;

    const TopoDS_Shape shape = reader.OneShape();
    if (shape.IsNull())
    {
        std::cerr << "Resulting shape is null after successful STEP transfer" << std::endl;
        std::error_code removeEc;
        std::filesystem::remove(asciiStepPath, removeEc);
        return 5;
    }

    try
    {
        if (!jsonPath.empty()) writeJson(jsonPath, filePath, shape, roots, transferred);
        if (!objPath.empty()) writeObj(objPath, shape);
    }
    catch (const std::exception& error)
    {
        std::error_code removeEc;
        std::filesystem::remove(asciiStepPath, removeEc);
        std::cerr << "Geometry processing failed: " << error.what() << std::endl;
        return 6;
    }

    std::error_code removeEc;
    std::filesystem::remove(asciiStepPath, removeEc);

    std::cout << "STEP read OK" << std::endl;
    std::cout << "Roots: " << roots << std::endl;
    std::cout << "Transferred: " << transferred << std::endl;
    std::cout << "Shape created successfully" << std::endl;
    return 0;
}
