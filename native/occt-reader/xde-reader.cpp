#include <fstream>
#include <iomanip>
#include <iostream>
#include <filesystem>
#include <vector>
#include <string>
#include <stdexcept>
#include <algorithm>

#include <IFSelect_ReturnStatus.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <TDocStd_Document.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDataStd_Name.hxx>
#include <TCollection_ExtendedString.hxx>
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

namespace {
struct Info {
    TopoDS_Shape shape;
    double x=0,y=0,z=0,sx=0,sy=0,sz=0,volume=0;
    int solids=0;
};

Info getInfo(const TopoDS_Shape& shape) {
    Info i; i.shape=shape;
    if(shape.IsNull()) return i;

    Bnd_Box b; BRepBndLib::Add(shape,b);
    if(!b.IsVoid()) {
        double minX,minY,minZ,maxX,maxY,maxZ;
        b.Get(minX,minY,minZ,maxX,maxY,maxZ);
        i.x=minX; i.y=minY; i.z=minZ;
        i.sx=maxX-minX; i.sy=maxY-minY; i.sz=maxZ-minZ;
    }

    GProp_GProps p;
    BRepGProp::VolumeProperties(shape,p);
    i.volume=p.Mass();

    for(TopExp_Explorer it(shape,TopAbs_SOLID);it.More();it.Next()) ++i.solids;
    return i;
}

std::string jsonEscape(const std::string& s) {
    std::string r; r.reserve(s.size()+16);
    for(unsigned char c:s) {
        if(c=='"') r+="\\\"";
        else if(c=='\\') r+="\\\\";
        else if(c=='\n') r+="\\n";
        else if(c=='\r') r+="\\r";
        else if(c=='\t') r+="\\t";
        else r+=char(c);
    }
    return r;
}

std::string labelName(const TDF_Label& label) {
    Handle(TDataStd_Name) nameAttr;
    if(!label.FindAttribute(TDataStd_Name::GetID(), nameAttr) || nameAttr.IsNull()) return {};
    const TCollection_ExtendedString& name = nameAttr->Get();
    const Standard_Integer length = name.LengthOfCString();
    if(length <= 0) return {};
    std::vector<char> buffer(static_cast<size_t>(length) + 1, '\0');
    char* utf8Buffer = buffer.data();
    name.ToUTF8CString(utf8Buffer);
    return std::string(buffer.data());
}

std::string shapeTypeName(const TopoDS_Shape& shape) {
    if(shape.IsNull()) return "NULL";
    switch(shape.ShapeType()) {
        case TopAbs_COMPOUND: return "COMPOUND";
        case TopAbs_COMPSOLID: return "COMPSOLID";
        case TopAbs_SOLID: return "SOLID";
        case TopAbs_SHELL: return "SHELL";
        case TopAbs_FACE: return "FACE";
        case TopAbs_WIRE: return "WIRE";
        case TopAbs_EDGE: return "EDGE";
        case TopAbs_VERTEX: return "VERTEX";
        case TopAbs_SHAPE: return "SHAPE";
    }
    return "UNKNOWN";
}

std::string locationText(const TopoDS_Shape& shape) {
    if(shape.IsNull()) return "position=(0,0,0)";
    const gp_Trsf trsf = shape.Location().Transformation();
    const gp_XYZ t = trsf.TranslationPart();
    std::ostringstream out;
    out << std::setprecision(9)
        << "position=(" << t.X() << ", " << t.Y() << ", " << t.Z() << ")";
    return out.str();
}

void writeObj(const std::filesystem::path& path,const TopoDS_Shape& shape) {
    BRepMesh_IncrementalMesh mesher(shape,0.5,Standard_False,0.5,Standard_True);
    if(!mesher.IsDone()) throw std::runtime_error("XDE triangulation failed");
    std::ofstream out(path,std::ios::trunc);
    if(!out) throw std::runtime_error("Cannot write OBJ: "+path.string());
    out<<std::setprecision(9); int offset=1;
    for(TopExp_Explorer it(shape,TopAbs_FACE);it.More();it.Next()) {
        const auto face=TopoDS::Face(it.Current());
        TopLoc_Location loc;
        Handle(Poly_Triangulation) tri=BRep_Tool::Triangulation(face,loc);
        if(tri.IsNull()) continue;
        const auto tr=loc.Transformation(); int nodes=tri->NbNodes();
        for(int n=1;n<=nodes;++n){
            gp_Pnt p=tri->Node(n).Transformed(tr);
            out<<"v "<<p.X()<<" "<<p.Y()<<" "<<p.Z()<<"\n";
        }
        bool rev=face.Orientation()==TopAbs_REVERSED;
        for(int n=1;n<=tri->NbTriangles();++n){
            int a,b,c; tri->Triangle(n).Get(a,b,c);
            if(rev) std::swap(b,c);
            out<<"f "<<offset+a-1<<" "<<offset+b-1<<" "<<offset+c-1<<"\n";
        }
        offset+=nodes;
    }
}

void collectLeaves(const Handle(XCAFDoc_ShapeTool)& tool,const TDF_Label& label,std::vector<TDF_Label>& leaves) {
    TDF_LabelSequence children;
    tool->GetComponents(label,children,Standard_False);
    if(children.Length()==0) { leaves.push_back(label); return; }
    for(Standard_Integer i=1;i<=children.Length();++i) collectLeaves(tool,children.Value(i),leaves);
}

void writeTreeLabel(const Handle(XCAFDoc_ShapeTool)& tool,
                    const TDF_Label& label,
                    std::ofstream& out,
                    int depth) {
    const std::string indent(static_cast<size_t>(depth)*2, ' ');
    std::string name=labelName(label);
    if(name.empty()) name="<unnamed>";

    TopoDS_Shape shape=tool->GetShape(label);
    Info info=getInfo(shape);

    out << indent << "Label tag=" << label.Tag()
        << " name=\"" << name << "\""
        << " type=" << shapeTypeName(shape)
        << " components=";

    TDF_LabelSequence children;
    tool->GetComponents(label,children,Standard_False);
    out << children.Length() << "\n";

    out << indent << "  shape: solids=" << info.solids
        << " bbox=(" << info.sx << " x " << info.sy << " x " << info.sz << ")"
        << " min=(" << info.x << ", " << info.y << ", " << info.z << ")"
        << " volume=" << info.volume << "\n";
    out << indent << "  " << locationText(shape) << "\n";

    if(children.Length()==0 && !shape.IsNull()) {
        int solidIndex=0;
        for(TopExp_Explorer it(shape,TopAbs_SOLID);it.More();it.Next()) {
            ++solidIndex;
            TopoDS_Shape solid=it.Current();
            Info si=getInfo(solid);
            out << indent << "  SOLID[" << solidIndex << "]"
                << " bbox=(" << si.sx << " x " << si.sy << " x " << si.sz << ")"
                << " min=(" << si.x << ", " << si.y << ", " << si.z << ")"
                << " volume=" << si.volume
                << " " << locationText(solid) << "\n";
        }
    }

    for(Standard_Integer i=1;i<=children.Length();++i) {
        writeTreeLabel(tool,children.Value(i),out,depth+1);
    }
}

void writeTree(const Handle(XCAFDoc_ShapeTool)& tool,
               const TDF_LabelSequence& roots,
               const std::filesystem::path& treePath) {
    std::ofstream out(treePath,std::ios::trunc);
    if(!out) throw std::runtime_error("Cannot write XDE tree: "+treePath.string());
    out << "XDE/XCAF TREE\n"
        << "==============================\n"
        << "rootCount=" << roots.Length() << "\n\n";

    for(Standard_Integer i=1;i<=roots.Length();++i) {
        out << "ROOT[" << i << "]\n";
        writeTreeLabel(tool,roots.Value(i),out,1);
        out << "\n";
    }
}

int run(const std::filesystem::path& source,
        const std::filesystem::path& jsonPath,
        const std::filesystem::path& componentDir) {
    if(!std::filesystem::exists(source)) throw std::runtime_error("STEP file not found: "+source.string());

    std::error_code ec;
    std::filesystem::create_directories(componentDir,ec);
    if(ec) throw std::runtime_error("Cannot create component directory: "+ec.message());

    Handle(TDocStd_Document) doc;
    Handle(XCAFApp_Application) app=XCAFApp_Application::GetApplication();
    app->NewDocument("MDTV-XCAF",doc);

    STEPCAFControl_Reader reader;
    reader.SetNameMode(Standard_True);
    reader.SetColorMode(Standard_True);
    reader.SetLayerMode(Standard_True);
    reader.SetPropsMode(Standard_True);

    if(reader.ReadFile(source.string().c_str())!=IFSelect_RetDone)
        throw std::runtime_error("XDE STEP ReadFile failed");
    if(!reader.Transfer(doc))
        throw std::runtime_error("XDE STEP transfer failed");

    Handle(XCAFDoc_ShapeTool) tool=XCAFDoc_DocumentTool::ShapeTool(doc->Main());
    TDF_LabelSequence roots;
    tool->GetFreeShapes(roots);

    const std::filesystem::path treePath =
        jsonPath.parent_path() / (jsonPath.stem().string()+"-xde-tree.txt");
    writeTree(tool,roots,treePath);

    std::vector<TDF_Label> leaves;
    for(Standard_Integer i=1;i<=roots.Length();++i)
        collectLeaves(tool,roots.Value(i),leaves);

    std::ofstream out(jsonPath,std::ios::trunc);
    if(!out) throw std::runtime_error("Cannot write XDE JSON");

    out<<std::setprecision(15)
       <<"{\n"
       <<"  \"mode\": \"XDE/XCAF\",\n"
       <<"  \"sourceFile\": \""<<jsonEscape(source.string())<<"\",\n"
       <<"  \"rootCount\": "<<roots.Length()<<",\n"
       <<"  \"componentCount\": "<<leaves.size()<<",\n"
       <<"  \"treeFile\": \""<<jsonEscape(treePath.string())<<"\",\n"
       <<"  \"components\": [\n";

    for(size_t i=0;i<leaves.size();++i) {
        TDF_Label label=leaves[i];
        TopoDS_Shape shape=tool->GetShape(label);
        if(shape.IsNull()) continue;

        Info info=getInfo(shape);
        std::string name=labelName(label);
        if(name.empty()) name="component-"+std::to_string(i+1);
        std::string id="component-"+std::to_string(i+1);
        auto obj=componentDir/(id+".obj");
        writeObj(obj,shape);

        out<<"    {\"id\":\""<<id
            <<"\",\"name\":\""<<jsonEscape(name)
            <<"\",\"labelTag\":"<<label.Tag()
            <<",\"shapeType\":\""<<shapeTypeName(shape)<<"\""
            <<",\"solidCount\":"<<info.solids
            <<",\"position\":["<<info.x<<","<<info.y<<","<<info.z<<"]"
            <<",\"size\":["<<info.sx<<","<<info.sy<<","<<info.sz<<"]"
            <<",\"volume\":"<<info.volume
            <<",\"modelUrl\":\"/api/cad/xde-component?file="<<obj.filename().string()<<"\"}"
            <<(i+1<leaves.size()?",":"")<<"\n";
    }

    out<<"  ]\n}\n";
    return 0;
}
}

int wmain(int argc,wchar_t* argv[]) {
    if(argc!=4) {
        std::wcerr<<L"Usage: occt-xde-reader <assembly.step> <output.json> <component-dir>"<<std::endl;
        return 1;
    }
    try {
        return run(std::filesystem::path(argv[1]),
                   std::filesystem::path(argv[2]),
                   std::filesystem::path(argv[3]));
    }
    catch(const std::exception& e) {
        std::cerr<<"XDE processing failed: "<<e.what()<<std::endl;
        return 6;
    }
}
