"""CadQuery construction evidence. Measurements are in millimetres; exports are derived."""
import math
import cadquery as cq
from cadquery import cqgi
from OCP.TopAbs import TopAbs_REVERSED


def execute(source):
    model = cqgi.parse(source)
    result = model.build()
    if not result.success:
        raise RuntimeError(str(result.exception)) from result.exception
    shapes = []
    captured = [(item.shape, item.options or {}) for item in result.results]
    if not captured and result.env.get('result') is not None:
        captured = [(result.env['result'], {})]
    for index, (value, options) in enumerate(captured):
        if isinstance(value, cq.Assembly):
            value = value.toCompound()
        if isinstance(value, cq.Workplane):
            value = cq.Compound.makeCompound([item for item in value.vals() if isinstance(item, cq.Shape)])
        if not isinstance(value, cq.Shape):
            raise ValueError('show_object must expose CadQuery geometry')
        solids = value.Solids()
        if not value.isValid() or not solids or any(not s.isValid() or s.Volume() <= 0 for s in solids):
            raise ValueError('CAD geometry must contain valid positive-volume solids')
        shapes.append((str(options.get('name') or options.get('id') or f'part_{index + 1}'), value))
    if not shapes:
        raise ValueError('Expose at least one CAD solid using show_object(result) or result = ...')
    return shapes


def measure(shapes):
    combined = cq.Compound.makeCompound([shape for _, shape in shapes])
    bounds = combined.BoundingBox()
    cylinders = []
    for face in combined.Faces():
        if face.geomType() != 'CYLINDER':
            continue
        surface = face._geomAdaptor().Cylinder()
        axis = surface.Axis()
        point, direction = axis.Location(), axis.Direction()
        bore = face.wrapped.Orientation() == TopAbs_REVERSED
        entry = {'diameterMm': 2 * surface.Radius(), 'axis': [direction.X(), direction.Y(), direction.Z()],
                 'locationMm': [point.X(), point.Y(), point.Z()], 'bore': bore}
        # A cylindrical surface can be split into multiple faces; avoid counting a seam twice.
        if not any(abs(c['diameterMm'] - entry['diameterMm']) < 1e-6 and c['bore'] == bore
                   and all(abs(a - b) < 1e-6 for a, b in zip(c['locationMm'], entry['locationMm']))
                   and all(abs(a - b) < 1e-6 for a, b in zip(c['axis'], entry['axis'])) for c in cylinders):
            cylinders.append(entry)
    return {'units': 'mm', 'dimensionsMm': {'x': bounds.xlen, 'y': bounds.ylen, 'z': bounds.zlen},
            'boundsMm': {'min': [bounds.xmin, bounds.ymin, bounds.zmin], 'max': [bounds.xmax, bounds.ymax, bounds.zmax]},
            'volumeMm3': combined.Volume(), 'solidCount': len(combined.Solids()), 'valid': combined.isValid(),
            'parts': [name for name, _ in shapes], 'cylindricalFaces': cylinders,
            'limitations': ['Cylindrical bore surfaces do not establish thread fit, through-hole status or manufacturing suitability.',
                            'Wall thickness, stress, tolerancing stacks and physical fit need explicit additional evidence.']}


def check(metrics, requirements):
    checks = []
    for requirement in requirements:
        kind, target = requirement['kind'], requirement['value']
        tolerance = requirement.get('tolerance', .05)
        actual = None
        if kind in ('x', 'y', 'z'):
            actual = metrics['dimensionsMm'][kind]
        elif kind == 'solid_count':
            actual = metrics['solidCount']
        elif kind == 'volume':
            actual = metrics['volumeMm3']
        elif kind == 'bore_count':
            actual = sum(c['bore'] for c in metrics['cylindricalFaces'])
        elif kind == 'bore_diameter':
            matches = [c['diameterMm'] for c in metrics['cylindricalFaces'] if c['bore']]
            actual = min(matches, key=lambda v: abs(v - target)) if matches else None
        if actual is not None and not math.isfinite(actual):
            actual = None
        checks.append({**requirement, 'actual': actual,
                       'state': 'unknown' if actual is None else 'passed' if abs(actual - target) <= tolerance else 'failed'})
    return checks
