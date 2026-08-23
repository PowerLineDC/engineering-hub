import json
import math
import os
import re
from datetime import datetime, timezone

import FreeCAD
import Part

ASSEMBLY_ROOT = os.path.abspath(os.environ.get('ENGINEERINGHUB_CQE_ASSEMBLY_ROOT', ''))
OUTPUT_ROOT = os.path.abspath(os.environ.get('ENGINEERINGHUB_CQE_ANALYSIS_OUTPUT', ''))
LIBRARY_ROOT = os.path.abspath(os.environ.get('ENGINEERINGHUB_CQE_LIBRARY_ROOT', ''))

TOLERANCE_MM = 1.0
VOLUME_RATIO_MIN = 0.98
AREA_RATIO_MIN = 0.98

COMPONENT_RELATIVE_ROOTS = [
    os.path.join('Osnovnyye_elementy_korpusa_CQE_N', 'Osnovnie_elementi_korpusa_CQE N', 'R5NCPE_R5NCPTE', 'Двери для корпусов CQE N', 'Двери сплошные для корпусов CQE N'),
    os.path.join('Osnovnyye_elementy_korpusa_CQE_N', 'Osnovnie_elementi_korpusa_CQE N', 'R5NCPE_R5NCPTE', 'Двери для корпусов CQE N', 'Двери сплошные двустворчатые для корпусов CQE N'),
    os.path.join('Osnovnyye_elementy_korpusa_CQE_N', 'Osnovnie_elementi_korpusa_CQE N', 'R5NCRE'),
    os.path.join('Osnovnyye_elementy_korpusa_CQE_N', 'Osnovnie_elementi_korpusa_CQE N', 'R5NKMN'),
    os.path.join('Osnovnyye_elementy_korpusa_CQE_N', 'Osnovnie_elementi_korpusa_CQE N', 'R5NKTB'),
]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def round6(value):
    return round(float(value), 6)


def vec(v):
    return {'x': round6(v.x), 'y': round6(v.y), 'z': round6(v.z)}


def bbox_data(b):
    return {
        'xmin': round6(b.XMin), 'ymin': round6(b.YMin), 'zmin': round6(b.ZMin),
        'xmax': round6(b.XMax), 'ymax': round6(b.YMax), 'zmax': round6(b.ZMax),
        'dx': round6(b.XLength), 'dy': round6(b.YLength), 'dz': round6(b.ZLength),
    }


def shape_stats(shape):
    return {
        'bbox': bbox_data(shape.BoundBox),
        'center': vec(shape.CenterOfMass),
        'volume': round6(shape.Volume),
        'area': round6(shape.Area),
        'solids': len(shape.Solids),
        'shells': len(shape.Shells),
        'faces': len(shape.Faces),
        'edges': len(shape.Edges),
    }


def sorted_dims(stats):
    return sorted([stats['bbox']['dx'], stats['bbox']['dy'], stats['bbox']['dz']])


def signature(stats):
    return 'x'.join(str(round(v / TOLERANCE_MM) * int(TOLERANCE_MM)) for v in sorted_dims(stats))


def relative_path(file_path):
    return os.path.relpath(file_path, LIBRARY_ROOT).replace(os.sep, '/')


def find_step_files(root):
    result = []
    if not os.path.isdir(root):
        return result
    for current, dirs, files in os.walk(root):
        dirs[:] = sorted(dirs, key=str.lower)
        for name in files:
            if re.search(r'\.(step|stp)$', name, re.I):
                result.append(os.path.join(current, name))
    return sorted(result, key=lambda p: relative_path(p).lower())


def collect_solid_shapes(shape):
    solids = list(shape.Solids)
    if solids:
        return solids
    compounds = list(shape.Compounds)
    result = []
    while compounds:
        item = compounds.pop()
        item_solids = list(item.Solids)
        if item_solids:
            result.extend(item_solids)
        else:
            compounds.extend(list(item.Compounds))
    return result or ([shape] if not shape.isNull() else [])


def read_step_shapes(filename):
    shape = Part.read(filename)
    if shape is None or shape.isNull():
        raise RuntimeError('Part.read returned an empty shape')
    return collect_solid_shapes(shape)


def make_record(shape, index):
    stats = shape_stats(shape)
    return {
        'index': index,
        **stats,
        'signature': signature(stats),
    }


def assembly_box(objects):
    if not objects:
        return None
    xmin = min(o['bbox']['xmin'] for o in objects)
    ymin = min(o['bbox']['ymin'] for o in objects)
    zmin = min(o['bbox']['zmin'] for o in objects)
    xmax = max(o['bbox']['xmax'] for o in objects)
    ymax = max(o['bbox']['ymax'] for o in objects)
    zmax = max(o['bbox']['zmax'] for o in objects)
    return {
        'xmin': xmin, 'ymin': ymin, 'zmin': zmin,
        'xmax': xmax, 'ymax': ymax, 'zmax': zmax,
        'dx': round6(xmax - xmin), 'dy': round6(ymax - ymin), 'dz': round6(zmax - zmin),
        'center': {
            'x': round6((xmin + xmax) / 2),
            'y': round6((ymin + ymax) / 2),
            'z': round6((zmin + zmax) / 2),
        },
    }


def dimension_distance(a, b):
    da = sorted_dims(a)
    db = sorted_dims(b)
    return math.sqrt(sum((da[i] - db[i]) ** 2 for i in range(3)))


def ratio(a, b):
    if a <= 0 or b <= 0:
        return 0.0
    return min(a, b) / max(a, b)


def match_data(obj, component):
    distance = dimension_distance(obj, component)
    max_dim = max(sorted_dims(obj), default=1.0)
    max_dim = max(max_dim, max(sorted_dims(component), default=1.0), 1.0)
    dimension_score = max(0.0, 1.0 - distance / max_dim)
    volume_ratio = ratio(obj['volume'], component['volume'])
    area_ratio = ratio(obj['area'], component['area'])
    score = 0.55 * dimension_score + 0.30 * volume_ratio + 0.15 * area_ratio
    accepted = distance <= TOLERANCE_MM or (volume_ratio >= VOLUME_RATIO_MIN and area_ratio >= AREA_RATIO_MIN)
    return {
        'accepted': accepted,
        'score': round6(score),
        'dimensionDistanceMm': round6(distance),
        'volumeRatio': round6(volume_ratio),
        'areaRatio': round6(area_ratio),
    }


def relative_position(obj, box):
    return {
        'centerFromAssemblyCenter': {
            'x': round6(obj['center']['x'] - box['center']['x']),
            'y': round6(obj['center']['y'] - box['center']['y']),
            'z': round6(obj['center']['z'] - box['center']['z']),
        },
        'bboxFromAssemblyMin': {
            'x': round6(obj['bbox']['xmin'] - box['xmin']),
            'y': round6(obj['bbox']['ymin'] - box['ymin']),
            'z': round6(obj['bbox']['zmin'] - box['zmin']),
        },
        'bboxToAssemblyMax': {
            'x': round6(box['xmax'] - obj['bbox']['xmax']),
            'y': round6(box['ymax'] - obj['bbox']['ymax']),
            'z': round6(box['zmax'] - obj['bbox']['zmax']),
        },
    }


def classify_role(obj, box):
    b = obj['bbox']
    near_bottom = abs(b['zmin'] - box['zmin']) <= 5
    near_top = abs(b['zmax'] - box['zmax']) <= 5
    large_x = b['dx'] > box['dx'] * 0.65
    large_y = b['dy'] > box['dy'] * 0.65
    vertical = b['dz'] > max(b['dx'], b['dy']) * 3
    if near_bottom and large_x and large_y:
        return 'base'
    if near_top and large_x and large_y:
        return 'roof'
    if vertical and b['dz'] > box['dz'] * 0.35:
        return 'post'
    if b['dx'] > box['dx'] * 0.65 and b['dz'] > box['dz'] * 0.5:
        return 'door-or-panel'
    return 'other'


def parse_article_size(filename):
    m = re.search(r'R5CQEN(\d{2})(\d{2})(\d{2})', filename, re.I)
    if not m:
        return None
    return {
        'heightMm': int(m.group(1)) * 100,
        'widthMm': int(m.group(2)) * 100,
        'depthMm': int(m.group(3)) * 100,
        'sourceCode': m.group(0),
    }


def component_catalog():
    files = []
    missing = []
    for index, relative_root in enumerate(COMPONENT_RELATIVE_ROOTS, 1):
        absolute_root = os.path.join(LIBRARY_ROOT, relative_root)
        found = find_step_files(absolute_root)
        if not found:
            missing.append({'catalogIndex': index, 'path': relative_root})
        for filename in found:
            files.append({
                'file': filename,
                'fileName': os.path.basename(filename),
                'libraryPath': relative_path(filename),
                'catalogIndex': index,
                'catalogPath': relative_path(absolute_root),
            })
    unique = {}
    for item in files:
        unique[item['file']] = item
    return list(unique.values()), missing


def read_component_catalog(catalog):
    records = []
    failures = []
    for i, item in enumerate(catalog, 1):
        try:
            print(f'[FreeCAD] component {i}/{len(catalog)}: {item["fileName"]}', flush=True)
            shapes = read_step_shapes(item['file'])
            item_record = {
                **item,
                'geometryOk': True,
                'shapeCount': len(shapes),
                'shapes': [make_record(shape, j) for j, shape in enumerate(shapes)],
            }
            records.append(item_record)
        except Exception as exc:
            failure = {**item, 'geometryOk': False, 'error': str(exc), 'shapeCount': 0, 'shapes': []}
            records.append(failure)
            failures.append(failure)
            print(f'[FreeCAD] COMPONENT FAILED: {item["fileName"]}: {exc}', flush=True)
    return records, failures


def analyze_assembly(filename, component_shapes):
    print(f'[FreeCAD] assembly: {os.path.basename(filename)}', flush=True)
    shapes = read_step_shapes(filename)
    objects = [make_record(shape, i) for i, shape in enumerate(shapes)]
    box = assembly_box(objects)

    analyzed_objects = []
    named = {}
    unmatched = []

    for obj in objects:
        candidates = []
        for component in component_shapes:
            match = match_data(obj, component['geometry'])
            if match['accepted']:
                candidates.append((match, component))
        candidates.sort(key=lambda pair: pair[0]['score'], reverse=True)

        best = candidates[0] if candidates else None
        role = classify_role(obj, box)
        position = relative_position(obj, box)

        result = {
            'assemblyObjectIndex': obj['index'],
            'geometricRole': role,
            'geometry': obj,
            'relativePosition': position,
            'matched': bool(best),
            'bestMatch': None,
            'alternatives': [],
        }

        if best:
            match, component = best
            result['bestMatch'] = {
                'fileName': component['fileName'],
                'libraryPath': component['libraryPath'],
                'catalogIndex': component['catalogIndex'],
                'catalogPath': component['catalogPath'],
                'componentShapeIndex': component['geometry']['index'],
                'componentGeometry': component['geometry'],
                **match,
            }
            for alternative_match, alternative_component in candidates[:5]:
                result['alternatives'].append({
                    'fileName': alternative_component['fileName'],
                    'libraryPath': alternative_component['libraryPath'],
                    'catalogIndex': alternative_component['catalogIndex'],
                    'componentShapeIndex': alternative_component['geometry']['index'],
                    **alternative_match,
                })

            key = component['libraryPath']
            if key not in named:
                named[key] = {
                    'fileName': component['fileName'],
                    'libraryPath': key,
                    'catalogIndex': component['catalogIndex'],
                    'catalogPath': component['catalogPath'],
                    'count': 0,
                    'assemblyObjectIndexes': [],
                    'geometricRoles': [],
                }
            named[key]['count'] += 1
            named[key]['assemblyObjectIndexes'].append(obj['index'])
            if role not in named[key]['geometricRoles']:
                named[key]['geometricRoles'].append(role)
        else:
            unmatched.append(obj['index'])

        analyzed_objects.append(result)

    return {
        'schemaVersion': 1,
        'generatedAtUtc': now_iso(),
        'units': 'mm',
        'analyzer': 'scripts/analyze-cqe-assemblies.mjs + freecad-analyze-cqe-assemblies.py',
        'tolerances': {
            'dimensionMm': TOLERANCE_MM,
            'volumeRatioMin': VOLUME_RATIO_MIN,
            'areaRatioMin': AREA_RATIO_MIN,
        },
        'assembly': {
            'fileName': os.path.basename(filename),
            'absolutePath': filename,
            'libraryPath': relative_path(filename),
            'parsedArticleSize': parse_article_size(os.path.basename(filename)),
            'objectCount': len(objects),
            'bbox': box,
        },
        'components': sorted(named.values(), key=lambda x: x['libraryPath'].lower()),
        'objects': analyzed_objects,
        'unmatchedAssemblyObjectIndexes': unmatched,
    }


def main():
    print('[FreeCAD] CQE per-assembly component analyzer started', flush=True)
    if not os.path.isdir(ASSEMBLY_ROOT):
        raise RuntimeError(f'Assembly root does not exist: {ASSEMBLY_ROOT}')
    os.makedirs(OUTPUT_ROOT, exist_ok=True)

    assembly_files = find_step_files(ASSEMBLY_ROOT)
    assembly_files = [p for p in assembly_files if os.path.dirname(p) == ASSEMBLY_ROOT]
    if not assembly_files:
        raise RuntimeError(f'No STEP/STP assemblies found in {ASSEMBLY_ROOT}')

    catalog, missing = component_catalog()
    print(f'[FreeCAD] assemblies={len(assembly_files)}', flush=True)
    print(f'[FreeCAD] component files={len(catalog)}', flush=True)
    for item in missing:
        print(f'[FreeCAD] WARNING missing catalog: {item["path"]}', flush=True)

    component_records, component_failures = read_component_catalog(catalog)
    component_shapes = []
    for record in component_records:
        if not record.get('geometryOk'):
            continue
        for shape in record['shapes']:
            component_shapes.append({'fileName': record['fileName'], 'libraryPath': record['libraryPath'], 'catalogIndex': record['catalogIndex'], 'catalogPath': record['catalogPath'], 'geometry': shape})

    reports = []
    failures = []

    for index, filename in enumerate(assembly_files, 1):
        try:
            report = analyze_assembly(filename, component_shapes)
            safe_name = re.sub(r'\.(step|stp)$', '', os.path.basename(filename), flags=re.I)
            report_file = os.path.join(OUTPUT_ROOT, safe_name + '.json')
            with open(report_file, 'w', encoding='utf-8') as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
                f.write('\n')
            reports.append({
                'fileName': os.path.basename(filename),
                'libraryPath': relative_path(filename),
                'reportFile': os.path.relpath(report_file, OUTPUT_ROOT).replace(os.sep, '/'),
                'componentCount': len(report['components']),
                'objectCount': report['assembly']['objectCount'],
                'unmatchedObjectCount': len(report['unmatchedAssemblyObjectIndexes']),
            })
            print(f'[FreeCAD] {index}/{len(assembly_files)} -> {os.path.basename(report_file)} components={len(report["components"])} unmatched={len(report["unmatchedAssemblyObjectIndexes"])}', flush=True)
        except Exception as exc:
            failure = {'fileName': os.path.basename(filename), 'libraryPath': relative_path(filename), 'error': str(exc)}
            failures.append(failure)
            print(f'[FreeCAD] FAILED {os.path.basename(filename)}: {exc}', flush=True)

    index_report = {
        'schemaVersion': 1,
        'generatedAtUtc': now_iso(),
        'units': 'mm',
        'assemblyDirectory': relative_path(ASSEMBLY_ROOT),
        'outputDirectory': relative_path(OUTPUT_ROOT),
        'assemblyCount': len(assembly_files),
        'successfulReports': len(reports),
        'failedReports': len(failures),
        'componentCatalogFileCount': len(catalog),
        'componentCatalogGeometryFailures': len(component_failures),
        'componentCatalogRoots': [relative_path(os.path.join(LIBRARY_ROOT, p)) for p in COMPONENT_RELATIVE_ROOTS],
        'missingCatalogRoots': missing,
        'reports': reports,
        'failures': failures,
        'componentGeometryFailures': component_failures,
    }
    with open(os.path.join(OUTPUT_ROOT, '_index.json'), 'w', encoding='utf-8') as f:
        json.dump(index_report, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print(f'[CQE analyzer] reports={len(reports)} failed={len(failures)}', flush=True)
    print(f'[CQE analyzer] component files={len(catalog)} geometry failures={len(component_failures)}', flush=True)
    print(f'[CQE analyzer] output={OUTPUT_ROOT}', flush=True)


main()
