#include <fstream>
#include <iomanip>
#include <iostream>
#include <filesystem>
#include <vector>
#include <string>
#include <stdexcept>
#include <algorithm>
#include <sstream>

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
struct Info { TopoDS_Shape shape; double x=0,y=0,z=0,sx=0,sy=0,sz=0,volume=0; int solids=0; };
Info getInfo(const TopoDS_Shape& shape){Info i;i.shape=shape;if(shape.IsNull())return i;Bnd_Box b;BRepBndLib::Add(shape,b);if(!b.IsVoid()){double a,b1,c,d,e,f;b.Get(a,b1,c,d,e,f);i.x=a;i.y=b1;i.z=c;i.sx=d-a;i.sy=e-b1;i.sz=f-c;}GProp_GProps p;BRepGProp::VolumeProperties(shape,p);i.volume=p.Mass();for(TopExp_Explorer it(shape,TopAbs_SOLID);it.More();it.Next())++i.solids;return i;}
std::string jsonEscape(const std::string&s){std::string r;r.reserve(s.size()+16);for(unsigned char c:s){if(c=='"')r+="\\\"";else if(c=='\\')r+="\\\\";else if(c=='\n')r+="\\n";else if(c=='\r')r+="\\r";else if(c=='\t')r+="\\t";else r+=char(c);}return r;}
std::string labelName(const TDF_Label& label){Handle(TDataStd_Name) a;if(!label.FindAttribute(TDataStd_Name::GetID(),a)||a.IsNull())return{};const TCollection_ExtendedString& n=a->Get();Standard_Integer len=n.Length();if(len<=0)return{};std::vector<char> buffer(static_cast<size_t>(len)*4+1,'\0');Standard_PCharacter p=buffer.data();n.ToUTF8CString(p);return std::string(buffer.data());}
std::string shapeTypeName(const TopoDS_Shape&s){if(s.IsNull())return"NULL";switch(s.ShapeType()){case TopAbs_COMPOUND:return"COMPOUND";case TopAbs_COMPSOLID:return"COMPSOLID";case TopAbs_SOLID:return"SOLID";case TopAbs_SHELL:return"SHELL";case TopAbs_FACE:return"FACE";case TopAbs_WIRE:return"WIRE";case TopAbs_EDGE:return"EDGE";case TopAbs_VERTEX:return"VERTEX";case TopAbs_SHAPE:return"SHAPE";}return"UNKNOWN";}
std::string locationText(const TopoDS_Shape&s){if(s.IsNull())return"position=(0,0,0)";const gp_Trsf t=s.Location().Transformation();const gp_XYZ p=t.TranslationPart();std::ostringstream o;o<<std::setprecision(9)<<"position=("<<p.X()<<", "<<p.Y()<<", "<<p.Z()<<")";return o.str();}
void writeObj(const std::filesystem::path&path,const TopoDS_Shape&s){BRepMesh_IncrementalMesh m(s,0.5,Standard_False,0.5,Standard_True);if(!m.IsDone())throw std::runtime_error("XDE triangulation failed");std::ofstream o(path,std::ios::trunc);if(!o)throw std::runtime_error("Cannot write OBJ: "+path.string());o<<std::setprecision(9);int off=1;for(TopExp_Explorer it(s,TopAbs_FACE);it.More();it.Next()){const auto f=TopoDS::Face(it.Current());TopLoc_Location l;Handle(Poly_Triangulation)t=BRep_Tool::Triangulation(f,l);if(t.IsNull())continue;auto tr=l.Transformation();int n=t->NbNodes();for(int j=1;j<=n;++j){gp_Pnt p=t->Node(j).Transformed(tr);o<<"v "<<p.X()<<" "<<p.Y()<<" "<<p.Z()<<"\n";}bool rev=f.Orientation()==TopAbs_REVERSED;for(int j=1;j<=t->NbTriangles();++j){int a,b,c;t->Triangle(j).Get(a,b,c);if(rev)std::swap(b,c);o<<"f "<<off+a-1<<" "<<off+b-1<<" "<<off+c-1<<"\n";}off+=n;}}
void collectLeaves(const Handle(XCAFDoc_ShapeTool)&tool,const TDF_Label&l,std::vector<TDF_Label>&v){TDF_LabelSequence c;tool->GetComponents(l,c,Standard_False);if(c.Length()==0){v.push_back(l);return;}for(Standard_Integer i=1;i<=c.Length();++i)collectLeaves(tool,c.Value(i),v);}
void writeTreeLabel(const Handle(XCAFDoc_ShapeTool)&tool,const TDF_Label&l,std::ofstream&o,int d){std::string ind(static_cast<size_t>(d)*2,' '),name=labelName(l);if(name.empty())name="<unnamed>";TopoDS_Shape s=tool->GetShape(l);Info i=getInfo(s);TDF_LabelSequence c;tool->GetComponents(l,c,Standard_False);o<<ind<<"Label tag="<<l.Tag()<<" name=\""<<name<<"\" type="<<shapeTypeName(s)<<" components="<<c.Length()<<"\n";o<<ind<<"  shape: solids="<<i.solids<<" bbox=("<<i.sx<<" x "<<i.sy<<" x "<<i.sz<<") min=("<<i.x<<", "<<i.y<<", "<<i.z<<") volume="<<i.volume<<"\n";o<<ind<<"  "<<locationText(s)<<"\n";if(c.Length()==0&&!s.IsNull()){int k=0;for(TopExp_Explorer it(s,TopAbs_SOLID);it.More();it.Next()){++k;Info si=getInfo(it.Current());o<<ind<<"  SOLID["<<k<<"] bbox=("<<si.sx<<" x "<<si.sy<<" x "<<si.sz<<") min=("<<si.x<<", "<<si.y<<", "<<si.z<<") volume="<<si.volume<<" "<<locationText(it.Current())<<"\n";}}for(Standard_Integer i2=1;i2<=c.Length();++i2)writeTreeLabel(tool,c.Value(i2),o,d+1);}
void writeTree(const Handle(XCAFDoc_ShapeTool)&tool,const TDF_LabelSequence&r,const std::filesystem::path&p){std::ofstream o(p,std::ios::trunc);if(!o)throw std::runtime_error("Cannot write XDE tree: "+p.string());o<<"XDE/XCAF TREE\n==============================\nrootCount="<<r.Length()<<"\n\n";for(Standard_Integer i=1;i<=r.Length();++i){o<<"ROOT["<<i<<"]\n";writeTreeLabel(tool,r.Value(i),o,1);o<<"\n";}}
int run(const std::filesystem::path&s,const std::filesystem::path&j,const std::filesystem::path&d){if(!std::filesystem::exists(s))throw std::runtime_error("STEP file not found: "+s.string());std::error_code e;std::filesystem::create_directories(d,e);if(e)throw std::runtime_error("Cannot create component directory: "+e.message());Handle(TDocStd_Document)doc;Handle(XCAFApp_Application)app=XCAFApp_Application::GetApplication();app->NewDocument("MDTV-XCAF",doc);STEPCAFControl_Reader r;r.SetNameMode(Standard_True);r.SetColorMode(Standard_True);r.SetLayerMode(Standard_True);r.SetPropsMode(Standard_True);if(r.ReadFile(s.string().c_str())!=IFSelect_RetDone)throw std::runtime_error("XDE STEP ReadFile failed");if(!r.Transfer(doc))throw std::runtime_error("XDE STEP transfer failed");Handle(XCAFDoc_ShapeTool)t=XCAFDoc_DocumentTool::ShapeTool(doc->Main());TDF_LabelSequence roots;t->GetFreeShapes(roots);auto tree=s.parent_path()/(s.stem().string()+"-xde-tree.txt");writeTree(t,roots,tree);std::vector<TDF_Label>leaves;for(Standard_Integer i=1;i<=roots.Length();++i)collectLeaves(t,roots.Value(i),leaves);std::ofstream o(j,std::ios::trunc);if(!o)throw std::runtime_error("Cannot write XDE JSON");o<<std::setprecision(15)<<"{\n  \"mode\": \"XDE/XCAF\",\n  \"sourceFile\": \""<<jsonEscape(s.string())<<"\",\n  \"rootCount\": "<<roots.Length()<<",\n  \"componentCount\": "<<leaves.size()<<",\n  \"treeFile\": \""<<jsonEscape(tree.string())<<"\",\n  \"components\": [\n";for(size_t i=0;i<leaves.size();++i){auto l=leaves[i];auto sh=t->GetShape(l);if(sh.IsNull())continue;Info inf=getInfo(sh);std::string n=labelName(l);if(n.empty())n="component-"+std::to_string(i+1);std::string id="component-"+std::to_string(i+1);auto obj=d/(id+".obj");writeObj(obj,sh);o<<"    {\"id\":\""<<id<<"\",\"name\":\""<<jsonEscape(n)<<"\",\"labelTag\":"<<l.Tag()<<",\"shapeType\":\""<<shapeTypeName(sh)<<"\",\"solidCount\":"<<inf.solids<<",\"position\":["<<inf.x<<","<<inf.y<<","<<inf.z<<"],\"size\":["<<inf.sx<<","<<inf.sy<<","<<inf.sz<<"],\"volume\":"<<inf.volume<<"}"<<(i+1<leaves.size()?",":"")<<"\n";}o<<"  ]\n}\n";return 0;}
}
int wmain(int argc,wchar_t*argv[]){if(argc!=4){std::wcerr<<L"Usage: occt-xde-reader <assembly.step> <output.json> <component-dir>"<<std::endl;return 1;}try{return run(std::filesystem::path(argv[1]),std::filesystem::path(argv[2]),std::filesystem::path(argv[3]));}catch(const std::exception&e){std::cerr<<"XDE processing failed: "<<e.what()<<std::endl;return 6;}}
