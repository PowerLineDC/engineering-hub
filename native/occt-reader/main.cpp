#include <fstream>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>
#include <filesystem>
#include <vector>
#include <algorithm>
#include <cmath>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
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
struct ShapeInfo
{
    TopoDS_Shape shape;
    double sx = 0, sy = 0, sz = 0;
    double volume = 0;
};

std::filesystem::path makeInputCopy(const std::filesystem::path& source, const std::string& name)
{
    const auto target = std::filesystem::path("C:/EngineeringHub_OCCT") / name;
    std::error_code ec;
    std::filesystem::create_directories(target.parent_path(), ec);
    if (ec) throw std::runtime_error("Cannot create OCCT input directory: " + ec.message());
    std::filesystem::copy_file(source, target, std::filesystem::copy_options::overwrite_existing, ec);
    if (ec) throw std::runtime_error("Cannot copy STEP: " + ec.message());
    return target;
}

TopoDS_Shape readStep(const std::filesystem::path& source, const std::string& copyName)
{
    const auto input = makeInputCopy(source, copyName);
    STEPControl_Reader reader;
    const IFSelect_ReturnStatus status = reader.ReadFile(input.string().c_str());
    if (status != IFSelect_RetDone)
    {
        std::filesystem::remove(input);
        throw std::runtime_error("STEP ReadFile failed");
    }
    const Standard_Integer transferred = reader.TransferRoots();
    if (transferred <= 0)
    {
        std::filesystem::remove(input);
        throw std::runtime_error("STEP transfer failed");
    }
    TopoDS_Shape shape = reader.OneShape();
    std::filesystem::remove(input);
    if (shape.IsNull()) throw std::runtime_error("OCCT returned null shape");
    return shape;
}

ShapeInfo getInfo(const TopoDS_Shape& shape)
{
    ShapeInfo info;
    info.shape = shape;
    Bnd_Box box;
    BRepBndLib::Add(shape, box);
    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
    info.sx = xmax - xmin;
    info.sy = ymax - ymin;
    info.sz = zmax - zmin;
    GProp_GProps props;
    BRepGProp::VolumeProperties(shape, props);
    info.volume = props.Mass();
    return info;
}

double relativeError(double a, double b)
{
    return std::abs(a - b) / std::max({std::abs(a), std::abs(b), 1.0});
}

bool matchesReference(const ShapeInfo& candidate, const ShapeInfo& reference)
{
    std::vector<double> a{candidate.sx, candidate.sy, candidate.sz};
    std::vector<double> b{reference.sx, reference.sy, reference.sz};
    std::sort(a.begin(), a.end());
    std::sort(b.begin(), b.end());
    const bool sizeMatch = relativeError(a[0], b[0]) < 0.01 &&
                           relativeError(a[1], b[1]) < 0.01 &&
                           relativeError(a[2], b[2]) < 0.01;
    const bool volumeMatch = reference.volume <= 0 || relativeError(candidate.volume, reference.volume) < 0.05;
    return sizeMatch && volumeMatch;
}

void writeObj(const std::string& path, const TopoDS_Shape& shape)
{
    BRepMesh_IncrementalMesh mesher(shape, 0.5, Standard_False, 0.5, Standard_True);
    if (!mesher.IsDone()) throw std::runtime_error("OCCT triangulation failed");
    std::ofstream out(path, std::ios::trunc);
    if (!out) throw std::runtime_error("Cannot write OBJ: " + path);
    out << std::setprecision(9);
    out << "# Engineering Hub / Open CASCADE component\n";
    Standard_Integer vertexOffset = 1;
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
        }
        vertexOffset += nodes;
    }
}

void writeSingleJson(const std::string& path, const std::string& stepPath, const TopoDS_Shape& shape, int roots, int transferred)
{
    const ShapeInfo info = getInfo(shape);
    std::ofstream out(path, std::ios::trunc);
    if (!out) throw std::runtime_error("Cannot write JSON: " + path);
    out << std::setprecision(15);
    out << "{\n  \"stepFile\": \"" << stepPath << "\",\n";
    out << "  \"roots\": " << roots << ",\n  \"transferred\": " << transferred << ",\n";
    out << "  \"boundingBox\": {\"min\": [0,0,0], \"max\": [" << info.sx << "," << info.sy << "," << info.sz << "], \"size\": [" << info.sx << "," << info.sy << "," << info.sz << "]},\n";
    out << "  \"volume\": " << info.volume << "\n}\n";
}

void writeAssemblyJson(const std::string& jsonPath, const std::string& assemblyPath, const std::string& referencePath, const std::filesystem::path& componentDir, const TopoDS_Shape& assembly, const TopoDS_Shape& reference)
{
    const ShapeInfo ref = getInfo(reference);
    std::vector<ShapeInfo> solids;
    for (TopExp_Explorer it(assembly, TopAbs_SOLID); it.More(); it.Next())
        solids.push_back(getInfo(it.Current()));

    std::error_code ec;
    std::filesystem::create_directories(componentDir, ec);
    if (ec) throw std::runtime_error("Cannot create component cache: " + ec.message());

    std::vector<int> postIndices;
    for (std::size_t i = 0; i < solids.size(); ++i)
    {
        if (matchesReference(solids[i], ref)) postIndices.push_back(static_cast<int>(i));
    }

    std::ofstream out(jsonPath, std::ios::trunc);
    if (!out) throw std::runtime_error("Cannot write assembly JSON: " + jsonPath);
    out << std::setprecision(15);
    out << "{\n  \"assemblyFile\": \"" << assemblyPath << "\",\n";
    out << "  \"referenceFile\": \"" << referencePath << "\",\n";
    out << "  \"reference\": {\"size\": [" << ref.sx << "," << ref.sy << "," << ref.sz << "], \"volume\": " << ref.volume << "},\n";
    out << "  \"solidCount\": " << solids.size() << ",\n  \"postCount\": " << postIndices.size() << ",\n  \"components\": [\n";

    for (std::size_t i = 0; i < solids.size(); ++i)
    {
        const bool isPost = std::find(postIndices.begin(), postIndices.end(), static_cast<int>(i)) != postIndices.end();
        const std::string type = isPost ? "post" : "other";
        const std::string name = type + "-" + std::to_string(i + 1);
        const auto obj = componentDir / (name + ".obj");
        writeObj(obj.string(), solids[i].shape);
        out << "    {\"id\": \"" << name << "\", \"type\": \"" << type << "\", \"modelUrl\": \"/api/cad/component?file=" << obj.filename().string() << "\", \"size\": [" << solids[i].sx << "," << solids[i].sy << "," << solids[i].sz << "], \"volume\": " << solids[i].volume << "}";
        if (i + 1 < solids.size()) out << ",";
        out << "\n";
    }
    out << "  ]\n}\n";
}
}

int wmain(int argc, wchar_t* argv[])
{
    if (argc < 2 || argc > 6)
    {
        std::wcerr << L"Usage: occt-reader <assembly.step> [output.json] [output.obj] [reference.step] [component-dir]" << std::endl;
        return 1;
    }

    const std::filesystem::path assemblyPath(argv[1]);
    const std::string jsonPath = argc >= 3 ? std::filesystem::path(argv[2]).string() : "";
    const std::string objPath = argc >= 4 ? std::filesystem::path(argv[3]).string() : "";
    const std::filesystem::path referencePath = argc >= 5 ? std::filesystem::path(argv[4]) : std::filesystem::path();
    const std::filesystem::path componentDir = argc >= 6 ? std::filesystem::path(argv[5]) : std::filesystem::path();

    try
    {
        const TopoDS_Shape assembly = readStep(assemblyPath, "engineeringhub_assembly.step");
        if (!referencePath.empty())
        {
            const TopoDS_Shape reference = readStep(referencePath, "engineeringhub_post_reference.step");
            if (jsonPath.empty() || componentDir.empty()) throw std::runtime_error("Component recognition requires output JSON and component directory");
            writeAssemblyJson(jsonPath, assemblyPath.string(), referencePath.string(), componentDir, assembly, reference);
            std::cout << "STEP assembly recognition OK" << std::endl;
            return 0;
        }

        int roots = 1;
        int transferred = 1;
        if (!jsonPath.empty()) writeSingleJson(jsonPath, assemblyPath.string(), assembly, roots, transferred);
        if (!objPath.empty()) writeObj(objPath, assembly);
        std::cout << "STEP read OK" << std::endl;
        std::cout << "Shape created successfully" << std::endl;
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << "Geometry processing failed: " << error.what() << std::endl;
        return 6;
    }
}
