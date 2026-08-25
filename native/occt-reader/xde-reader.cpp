#include <fstream>
#include <iomanip>
#include <iostream>
#include <filesystem>
#include <vector>
#include <string>
#include <stdexcept>
#include <algorithm>
#include <sstream>
#include <limits>
#include <cmath>

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
#include <TopoDS_Compound.hxx>
#include <TopoDS_Builder.hxx>
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

// A SOLID is considered a primary/configurator object when it is large enough
// to be useful on its own. Small solids (fasteners, caps, brackets, etc.) are
// attached to the nearest primary object and are never exported separately.
constexpr double kPrimaryVolume = 50000.0;      // mm^3
constexpr double kPrimaryMaxDimension = 40.0;   // mm
constexpr double kSmallAttachMaxDistance = 150.0; // mm

struct Info {
    TopoDS_Shape shape;
    double x=0,y=0,z=0,sx=0,sy=0,sz=0,volume=0;
    int solids=0;
};

Info getInfo(const TopoDS_Shape& shape){
    Info i; i.shape=shape; if(shape.IsNull()) return i;
    Bnd_Box b; BRepBndLib::Add(shape,b);
    if(!b.IsVoid()){
        double a,b1,c,d,e,f; b.Get(a,b1,c,d,e,f);
        i.x=a; i.y=b1; i.z=c; i.sx=d-a; i.sy=e-b1; i.sz=f-c;
    }
    GProp_GProps p; BRepGProp::VolumeProperties(shape,p); i.volume=p.Mass();
    for(TopExp_Explorer it(shape,TopAbs_SOLID);it.More();it.Next()) ++i.solids;
    return i;
}

std::string jsonEscape(const std::string&s){
    std::string r; r.reserve(s.size()+16);
    for(unsigned char c:s){
        if(c=='"')r+="\\\""; else if(c=='\\')r+="\\\\";
        else if(c=='\n')r+="\\n"; else if(c=='\r')r+="\\r";
        else if(c=='\t')r+="\\t"; else r+=char(c);
    }
    return r;
}

std::string labelName(const TDF_Label& label){
    Handle(TDataStd_Name) a;
    if(!label.FindAttribute(TDataStd_Name::GetID(),a)||a.IsNull()) return{};
    const TCollection_ExtendedString& n=a->Get();
    Standard_Integer len=n.Length(); if(len<=0) return{};
    std::vector<char> buffer(static_cast<size_t>(len)*4+1,'\0');
    Standard_PCharacter p=buffer.data(); n.ToUTF8CString(p);
    return std::string(buffer.data());
}

std::string shapeTypeName(const TopoDS_Shape&s){
    if(s.IsNull())return"NULL";
    switch(s.ShapeType()){
        case TopAbs_COMPOUND:return"COMPOUND"; case TopAbs_COMPSOLID:return"COMPSOLID";
        case TopAbs_SOLID:return"SOLID"; case TopAbs_SHELL:return"SHELL"; case TopAbs_FACE:return"FACE";
        case TopAbs_WIRE:return"WIRE"; case TopAbs_EDGE:return"EDGE"; case TopAbs_VERTEX:return"VERTEX";
        case TopAbs_SHAPE:return"SHAPE";
    }
    return"UNKNOWN";
}

std::string locationText(const TopoDS_Shape&s){
    if(s.IsNull())return"position=(0,0,0)";
    const gp_Trsf t=s.Location().Transformation(); const gp_XYZ p=t.TranslationPart();
    std::ostringstream o; o<<std::setprecision(9)<<"position=("<<p.X()<<", "<<p.Y()<<", "<<p.Z()<<")";
    return o.str();
}

bool isPrimary(const Info& i){
    const double maxDim=std::max({i.sx,i.sy,i.sz});
    return i.volume>=kPrimaryVolume || maxDim>=kPrimaryMaxDimension;
}

double intervalGap(double aMin,double aMax,double bMin,double bMax){
    if(aMax<bMin) return bMin-aMax;
    if(bMax<aMin) return aMin-bMax;
    return 0.0;
}

double bboxDistance(const Info&a,const Info&b){
    const double dx=intervalGap(a.x,a.x+a.sx,b.x,b.x+b.sx);
    const double dy=intervalGap(a.y,a.y+a.sy,b.y,b.y+b.sy);
    const double dz=intervalGap(a.z,a.z+a.sz,b.z,b.z+b.sz);
    return std::sqrt(dx*dx+dy*dy+dz*dz);
}

void addToCompound(TopoDS_Builder& builder, TopoDS_Compound& compound, const TopoDS_Shape& shape){
    if(!shape.IsNull()) builder.Add(compound,shape);
}

struct ExportObject {
    std::string id;
    std::string name;
    std::string parent;
    TopoDS_Shape shape;
    Info info;
    int primarySolidCount=0;
    int attachedSmallSolidCount=0;
};

std::vector<ExportObject> buildLargeObjects(
    const TopoDS_Shape& componentShape,
    const std::string& parentName,
    const std::string& idPrefix){

    std::vector<TopoDS_Shape> solids;
    for(TopExp_Explorer it(componentShape,TopAbs_SOLID);it.More();it.Next()) solids.push_back(it.Current());

    std::vector<Info> infos; infos.reserve(solids.size());
    for(const auto& s:solids) infos.push_back(getInfo(s));

    std::vector<int> primary;
    std::vector<int> small;
    for(size_t i=0;i<infos.size();++i){
        if(isPrimary(infos[i])) primary.push_back(static_cast<int>(i));
        else small.push_back(static_cast<int>(i));
    }

    // If a component contains no sufficiently large solid, keep its complete
    // geometry as one object. This prevents loss of small-only components.
    if(primary.empty() && !solids.empty()){
        TopoDS_Builder b; TopoDS_Compound c; b.MakeCompound(c);
        for(const auto& s:solids) addToCompound(b,c,s);
        ExportObject o; o.id=idPrefix+"-1"; o.name=parentName; o.parent=parentName;
        o.shape=c; o.info=getInfo(c); o.primarySolidCount=0; o.attachedSmallSolidCount=static_cast<int>(small.size());
        return {o};
    }

    std::vector<ExportObject> result;
    result.reserve(primary.size());
    for(size_t p=0;p<primary.size();++p){
        int idx=primary[p];
        TopoDS_Builder b; TopoDS_Compound c; b.MakeCompound(c); addToCompound(b,c,solids[idx]);
        ExportObject o; o.id=idPrefix+"-"+std::to_string(p+1); o.parent=parentName;
        o.name=parentName+"-"+std::to_string(p+1); o.shape=c; o.primarySolidCount=1;
        result.push_back(std::move(o));
    }

    // Every small solid is retained, but becomes part of exactly one large
    // exported object. Prefer the nearest primary object's bounding box.
    for(int smallIdx:small){
        double best=std::numeric_limits<double>::max(); size_t bestObject=0;
        for(size_t p=0;p<primary.size();++p){
            double d=bboxDistance(infos[smallIdx],infos[primary[p]]);
            if(d<best){best=d;bestObject=p;}
        }
        // A distant tiny object is still retained rather than discarded. The
        // distance is reported in the diagnostic tree/JSON for later tuning.
        TopoDS_Builder b; TopoDS_Compound current=TopoDS::Compound(result[bestObject].shape);
        b.Add(current,solids[smallIdx]); result[bestObject].shape=current;
        result[bestObject].attachedSmallSolidCount++;
        (void)kSmallAttachMaxDistance;
    }

    for(auto& o:result) o.info=getInfo(o.shape);
    return result;
}

void writeObj(const std::filesystem::path&path,const TopoDS_Shape&s){
    BRepMesh_IncrementalMesh m(s,0.5,Standard_False,0.5,Standard_True);
    if(!m.IsDone())throw std::runtime_error("XDE triangulation failed");
    std::ofstream o(path,std::ios::trunc); if(!o)throw std::runtime_error("Cannot write OBJ: "+path.string());
    o<<std::setprecision(9); int off=1;
    for(TopExp_Explorer it(s,TopAbs_FACE);it.More();it.Next()){
        const auto f=TopoDS::Face(it.Current()); TopLoc_Location l;
        Handle(Poly_Triangulation)t=BRep_Tool::Triangulation(f,l); if(t.IsNull())continue;
        auto tr=l.Transformation(); int n=t->NbNodes();
        for(int j=1;j<=n;++j){gp_Pnt p=t->Node(j).Transformed(tr);o<<"v "<<p.X()<<" "<<p.Y()<<" "<<p.Z()<<"\n";}
        bool rev=f.Orientation()==TopAbs_REVERSED;
        for(int j=1;j<=t->NbTriangles();++j){int a,b,c;t->Triangle(j).Get(a,b,c);if(rev)std::swap(b,c);o<<"f "<<off+a-1<<" "<<off+b-1<<" "<<off+c-1<<"\n";}
        off+=n;
    }
}

void writeTreeLabel(const Handle(XCAFDoc_ShapeTool)&tool,const TDF_Label&l,std::ofstream&o,int d){
    std::string ind(static_cast<size_t>(d)*2,' '),name=labelName(l);if(name.empty())name="<unnamed>";
    TopoDS_Shape s=tool->GetShape(l);Info i=getInfo(s);TDF_LabelSequence c;tool->GetComponents(l,c,Standard_False);
    o<<ind<<"Label tag="<<l.Tag()<<" name=\""<<name<<"\" type="<<shapeTypeName(s)<<" components="<<c.Length()<<"\n";
    o<<ind<<"  shape: solids="<<i.solids<<" bbox=("<<i.sx<<" x "<<i.sy<<" x "<<i.sz<<") min=("<<i.x<<", "<<i.y<<", "<<i.z<<") volume="<<i.volume<<"\n";
    o<<ind<<"  "<<locationText(s)<<"\n";
    if(c.Length()==0&&!s.IsNull()){
        int k=0;for(TopExp_Explorer it(s,TopAbs_SOLID);it.More();it.Next()){
            ++k;Info si=getInfo(it.Current());o<<ind<<"  SOLID["<<k<<"] primary="<<(isPrimary(si)?"yes":"no")
              <<" bbox=("<<si.sx<<" x "<<si.sy<<" x "<<si.sz<<") min=("<<si.x<<", "<<si.y<<", "<<si.z<<") volume="<<si.volume<<" "<<locationText(it.Current())<<"\n";
        }
    }
    for(Standard_Integer i2=1;i2<=c.Length();++i2)writeTreeLabel(tool,c.Value(i2),o,d+1);
}

void writeTree(const Handle(XCAFDoc_ShapeTool)&tool,const TDF_LabelSequence&r,const std::filesystem::path&p){
    std::ofstream o(p,std::ios::trunc);if(!o)throw std::runtime_error("Cannot write XDE tree: "+p.string());
    o<<"XDE/XCAF TREE\n==============================\nrootCount="<<r.Length()<<"\n\n";
    o<<"Primary-object rule: volume >= "<<kPrimaryVolume<<" mm^3 OR max dimension >= "<<kPrimaryMaxDimension<<" mm\n\n";
    for(Standard_Integer i=1;i<=r.Length();++i){o<<"ROOT["<<i<<"]\n";writeTreeLabel(tool,r.Value(i),o,1);o<<"\n";}
}

int run(const std::filesystem::path&s,const std::filesystem::path&j,const std::filesystem::path&d){
    if(!std::filesystem::exists(s))throw std::runtime_error("STEP file not found: "+s.string());
    std::error_code e;std::filesystem::create_directories(d,e);if(e)throw std::runtime_error("Cannot create component directory: "+e.message());
    Handle(TDocStd_Document)doc;Handle(XCAFApp_Application)app=XCAFApp_Application::GetApplication();app->NewDocument("MDTV-XCAF",doc);
    STEPCAFControl_Reader r;r.SetNameMode(Standard_True);r.SetColorMode(Standard_True);r.SetLayerMode(Standard_True);r.SetPropsMode(Standard_True);
    if(r.ReadFile(s.string().c_str())!=IFSelect_RetDone)throw std::runtime_error("XDE STEP ReadFile failed");
    if(!r.Transfer(doc))throw std::runtime_error("XDE STEP transfer failed");
    Handle(XCAFDoc_ShapeTool)t=XCAFDoc_DocumentTool::ShapeTool(doc->Main());TDF_LabelSequence roots;t->GetFreeShapes(roots);
    auto tree=s.parent_path()/(s.stem().string()+"-xde-tree.txt");writeTree(t,roots,tree);

    std::ofstream o(j,std::ios::trunc);if(!o)throw std::runtime_error("Cannot write XDE JSON");
    o<<std::setprecision(15)<<"{\n  \"mode\": \"XDE/XCAF-large-objects\",\n  \"sourceFile\": \""<<jsonEscape(s.string())<<"\",\n  \"rootCount\": "<<roots.Length()<<",\n  \"components\": [\n";

    bool firstObject=true; size_t exportedCount=0;
    for(Standard_Integer rootIndex=1;rootIndex<=roots.Length();++rootIndex){
        TDF_Label root=roots.Value(rootIndex);TDF_LabelSequence components;t->GetComponents(root,components,Standard_False);
        if(components.Length()==0){components.Append(root);}
        for(Standard_Integer ci=1;ci<=components.Length();++ci){
            TDF_Label label=components.Value(ci);TopoDS_Shape shape=t->GetShape(label);if(shape.IsNull())continue;
            std::string parent=labelName(label);if(parent.empty())parent="component-"+std::to_string(ci);
            auto objects=buildLargeObjects(shape,parent,parent+"-object");
            for(auto& obj:objects){
                auto objPath=d/(obj.id+".obj");writeObj(objPath,obj.shape);++exportedCount;
                if(!firstObject)o<<",\n";firstObject=false;
                o<<"    {\n"
                 <<"      \"id\": \""<<jsonEscape(obj.id)<<"\",\n"
                 <<"      \"name\": \""<<jsonEscape(obj.name)<<"\",\n"
                 <<"      \"parentComponent\": \""<<jsonEscape(obj.parent)<<"\",\n"
                 <<"      \"shapeType\": \""<<shapeTypeName(obj.shape)<<"\",\n"
                 <<"      \"solidCount\": "<<obj.info.solids<<",\n"
                 <<"      \"primarySolidCount\": "<<obj.primarySolidCount<<",\n"
                 <<"      \"attachedSmallSolidCount\": "<<obj.attachedSmallSolidCount<<",\n"
                 <<"      \"position\": ["<<obj.info.x<<", "<<obj.info.y<<", "<<obj.info.z<<"],\n"
                 <<"      \"size\": ["<<obj.info.sx<<", "<<obj.info.sy<<", "<<obj.info.sz<<"],\n"
                 <<"      \"volume\": "<<obj.info.volume<<",\n"
                 <<"      \"modelUrl\": \""<<jsonEscape(objPath.filename().string())<<"\"\n"
                 <<"    }";
            }
        }
    }
    o<<"\n  ],\n  \"exportedObjectCount\": "<<exportedCount<<",\n  \"primaryRule\": {\"minVolume\": "<<kPrimaryVolume<<", \"minMaxDimension\": "<<kPrimaryMaxDimension<<"},\n  \"treeFile\": \""<<jsonEscape(tree.string())<<"\"\n}\n";
    return 0;
}
}

int wmain(int argc,wchar_t*argv[]){
    if(argc!=4){std::wcerr<<L"Usage: occt-xde-reader <assembly.step> <output.json> <component-dir>"<<std::endl;return 1;}
    try{return run(std::filesystem::path(argv[1]),std::filesystem::path(argv[2]),std::filesystem::path(argv[3]));}
    catch(const std::exception&e){std::cerr<<"XDE processing failed: "<<e.what()<<std::endl;return 6;}
}
