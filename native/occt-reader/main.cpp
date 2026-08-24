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
struct ShapeInfo {
    TopoDS_Shape shape;
    double minX=0,minY=0,minZ=0,maxX=0,maxY=0,maxZ=0;
    double sx=0,sy=0,sz=0,volume=0;
};

TopoDS_Shape readStep(const std::filesystem::path& source, const std::string& copyName) {
    const auto target=std::filesystem::path("C:/EngineeringHub_OCCT")/copyName;
    std::error_code ec; std::filesystem::create_directories(target.parent_path(),ec);
    if(ec) throw std::runtime_error("Cannot create OCCT input directory: "+ec.message());
    std::filesystem::copy_file(source,target,std::filesystem::copy_options::overwrite_existing,ec);
    if(ec) throw std::runtime_error("Cannot copy STEP: "+ec.message());
    STEPControl_Reader reader;
    const auto status=reader.ReadFile(target.string().c_str());
    if(status!=IFSelect_RetDone) { std::filesystem::remove(target); throw std::runtime_error("STEP ReadFile failed"); }
    const auto transferred=reader.TransferRoots();
    if(transferred<=0) { std::filesystem::remove(target); throw std::runtime_error("STEP transfer failed"); }
    TopoDS_Shape shape=reader.OneShape(); std::filesystem::remove(target);
    if(shape.IsNull()) throw std::runtime_error("OCCT returned null shape");
    return shape;
}

ShapeInfo getInfo(const TopoDS_Shape& shape) {
    ShapeInfo info; info.shape=shape;
    Bnd_Box box; BRepBndLib::Add(shape,box);
    box.Get(info.minX,info.minY,info.minZ,info.maxX,info.maxY,info.maxZ);
    info.sx=info.maxX-info.minX; info.sy=info.maxY-info.minY; info.sz=info.maxZ-info.minZ;
    GProp_GProps props; BRepGProp::VolumeProperties(shape,props); info.volume=props.Mass();
    return info;
}

double rel(double a,double b){ return std::abs(a-b)/std::max({std::abs(a),std::abs(b),1.0}); }

bool matchesPost(const ShapeInfo& c,const ShapeInfo& r) {
    std::vector<double> a{c.sx,c.sy,c.sz},b{r.sx,r.sy,r.sz};
    std::sort(a.begin(),a.end()); std::sort(b.begin(),b.end());
    const bool size=rel(a[0],b[0])<0.015 && rel(a[1],b[1])<0.015 && rel(a[2],b[2])<0.015;
    const bool volume=r.volume<=0 || rel(c.volume,r.volume)<0.08;
    return size && volume;
}

void writeObj(const std::string& path,const TopoDS_Shape& shape) {
    BRepMesh_IncrementalMesh mesher(shape,0.5,Standard_False,0.5,Standard_True);
    if(!mesher.IsDone()) throw std::runtime_error("OCCT triangulation failed");
    std::ofstream out(path,std::ios::trunc); if(!out) throw std::runtime_error("Cannot write OBJ: "+path);
    out<<std::setprecision(9); int offset=1;
    for(TopExp_Explorer it(shape,TopAbs_FACE);it.More();it.Next()) {
        const auto face=TopoDS::Face(it.Current()); TopLoc_Location loc;
        Handle(Poly_Triangulation) tri=BRep_Tool::Triangulation(face,loc); if(tri.IsNull()) continue;
        const auto tr=loc.Transformation(); const int nodes=tri->NbNodes();
        for(int i=1;i<=nodes;++i){ const gp_Pnt p=tri->Node(i).Transformed(tr); out<<"v "<<p.X()<<" "<<p.Y()<<" "<<p.Z()<<"\n"; }
        const bool rev=face.Orientation()==TopAbs_REVERSED;
        for(int i=1;i<=tri->NbTriangles();++i){ int a,b,c; tri->Triangle(i).Get(a,b,c); if(rev) std::swap(b,c); out<<"f "<<offset+a-1<<" "<<offset+b-1<<" "<<offset+c-1<<"\n"; }
        offset+=nodes;
    }
}

void writeAssemblyJson(const std::string& jsonPath,const std::string& assemblyPath,const std::string& referencePath,const std::filesystem::path& dir,const TopoDS_Shape& assembly,const TopoDS_Shape& reference) {
    const ShapeInfo ref=getInfo(reference); std::vector<ShapeInfo> solids;
    for(TopExp_Explorer it(assembly,TopAbs_SOLID);it.More();it.Next()) solids.push_back(getInfo(it.Current()));
    std::error_code ec; std::filesystem::create_directories(dir,ec); if(ec) throw std::runtime_error("Cannot create component cache: "+ec.message());
    std::vector<int> posts; for(size_t i=0;i<solids.size();++i) if(matchesPost(solids[i],ref)) posts.push_back((int)i);

    // If the STEP exposes four matching solids, these are the four physical posts.
    std::ofstream out(jsonPath,std::ios::trunc); if(!out) throw std::runtime_error("Cannot write assembly JSON");
    out<<std::setprecision(15)<<"{\n";
    out<<"  \"assemblyFile\": \""<<assemblyPath<<"\",\n";
    out<<"  \"referenceFile\": \""<<referencePath<<"\",\n";
    out<<"  \"solidCount\": "<<solids.size()<<",\n";
    out<<"  \"postCount\": "<<posts.size()<<",\n  \"components\": [\n";
    for(size_t i=0;i<solids.size();++i){
        const bool isPost=std::find(posts.begin(),posts.end(),(int)i)!=posts.end();
        const auto& s=solids[i]; const std::string type=isPost?"post":"other"; const std::string id=type+"-"+std::to_string(i+1);
        const auto obj=dir/(id+".obj"); writeObj(obj.string(),s.shape);
        out<<"    {\"id\":\""<<id<<"\",\"type\":\""<<type<<"\",\"modelUrl\":\"/api/cad/component?file="<<obj.filename().string()<<"\",\"position\":["<<s.minX<<","<<s.minY<<","<<s.minZ<<"],\"size\":["<<s.sx<<","<<s.sy<<","<<s.sz<<"]}"<<(i+1<solids.size()?",":"")<<"\n";
    }
    out<<"  ]\n}\n";
}
}

int wmain(int argc,wchar_t* argv[]) {
    if(argc<2 || argc>6){ std::wcerr<<L"Usage: occt-reader <assembly.step> [output.json] [output.obj] [reference.step] [component-dir]"<<std::endl; return 1; }
    const std::filesystem::path assemblyPath(argv[1]);
    const std::string jsonPath=argc>=3?std::filesystem::path(argv[2]).string():"";
    const std::string objPath=argc>=4?std::filesystem::path(argv[3]).string():"";
    const std::filesystem::path referencePath=argc>=5?std::filesystem::path(argv[4]):std::filesystem::path();
    const std::filesystem::path componentDir=argc>=6?std::filesystem::path(argv[5]):std::filesystem::path();
    try {
        const auto assembly=readStep(assemblyPath,"engineeringhub_assembly.step");
        if(!referencePath.empty()){
            const auto reference=readStep(referencePath,"engineeringhub_post_reference.step");
            if(jsonPath.empty()||componentDir.empty()) throw std::runtime_error("Component recognition requires output JSON and component directory");
            writeAssemblyJson(jsonPath,assemblyPath.string(),referencePath.string(),componentDir,assembly,reference);
            std::cout<<"STEP assembly recognition OK"<<std::endl; return 0;
        }
        if(!jsonPath.empty()){
            const auto info=getInfo(assembly); std::ofstream out(jsonPath); out<<"{\"roots\":1,\"transferred\":1,\"boundingBox\":{\"size\":["<<info.sx<<","<<info.sy<<","<<info.sz<<"]},\"volume\":"<<info.volume<<"}\n";
        }
        if(!objPath.empty()) writeObj(objPath,assembly);
        std::cout<<"STEP read OK"<<std::endl; return 0;
    } catch(const std::exception& e){ std::cerr<<"Geometry processing failed: "<<e.what()<<std::endl; return 6; }
}
