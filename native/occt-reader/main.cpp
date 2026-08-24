#include <iostream>
#include <string>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Interface_Static.hxx>
#include <Interface_Check.hxx>
#include <XSControl_TransferReader.hxx>
#include <XSControl_WorkSession.hxx>
#include <Transfer_TransientProcess.hxx>
#include <TopoDS_Shape.hxx>

int main(int argc, char* argv[])
{
    if (argc != 2)
    {
        std::cerr << "Usage: occt-reader <file.step>" << std::endl;
        return 1;
    }

    const std::string filePath = argv[1];

    std::cout << "Reading STEP:" << std::endl;
    std::cout << filePath << std::endl;

    STEPControl_Reader reader;

    const IFSelect_ReturnStatus status =
        reader.ReadFile(filePath.c_str());

    std::cout << "ReadFile status: "
              << status << std::endl;

    if (status != IFSelect_RetDone)
    {
        std::cerr << "STEP read failed." << std::endl;

        switch (status)
        {
        case IFSelect_RetError:
            std::cerr << "Status meaning: RetError" << std::endl;
            break;

        case IFSelect_RetFail:
            std::cerr << "Status meaning: RetFail" << std::endl;
            break;

        case IFSelect_RetVoid:
            std::cerr << "Status meaning: RetVoid" << std::endl;
            break;

        case IFSelect_RetStop:
            std::cerr << "Status meaning: RetStop" << std::endl;
            break;

        default:
            std::cerr << "Status meaning: unknown" << std::endl;
            break;
        }

        return 2;
    }

    std::cout << "STEP read OK" << std::endl;

    const Standard_Integer roots =
        reader.NbRootsForTransfer();

    std::cout << "Roots: "
              << roots << std::endl;

    const Standard_Integer transferred =
        reader.TransferRoots();

    std::cout << "Transferred: "
              << transferred << std::endl;

    const TopoDS_Shape shape =
        reader.OneShape();

    if (shape.IsNull())
    {
        std::cerr << "Resulting shape is null"
                  << std::endl;
        return 3;
    }

    std::cout << "Shape created successfully"
              << std::endl;

    return 0;
}