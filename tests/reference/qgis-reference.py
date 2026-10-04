"""Run only in the pinned QGIS 3.44.0 container; stdout is independent evidence."""
import json, sys, math, os
from qgis.core import Qgis, QgsPointXY, QgsApplication
from qgis.analysis import QgsGcpTransformerInterface as T
from osgeo import gdal, osr
app = QgsApplication([], False)
app.initQgis()
source = json.load(sys.stdin)
models = {'linear':'Linear','helmert':'Helmert','polynomial1':'PolynomialOrder1','polynomial2':'PolynomialOrder2','polynomial3':'PolynomialOrder3','projective':'Projective','thinPlateSpline':'ThinPlateSpline'}
records=[]
for fixture in source:
    transformer=T.create(getattr(T.TransformMethod, models[fixture['model']]))
    # QGIS source GCPs are y-up. The raster transformer is then asked to invert Y.
    ps=[QgsPointXY(*[p['image'][0], -p['image'][1]]) for p in fixture['gcps'] if p['enabled']]
    qs=[QgsPointXY(*p['target']) for p in fixture['gcps'] if p['enabled']]
    try:
        valid=transformer.updateParametersFromGcps(ps, qs, True)
        forward=[transformer.transform(*p) for p in fixture['checkpoints']] if valid else []
        backward=[transformer.transform(q[1],q[2],True) for q in forward] if valid else []
        residuals=[]
        if valid:
            for p in fixture['gcps']:
                if not p['enabled']: continue
                ok,x,y=transformer.transform(*p['image'])
                back_ok,bx,by=transformer.transform(*p['target'],True)
                residuals.append({'id':p['id'],'vector':[x-p['target'][0],y-p['target'][1]],'pixels':math.hypot(bx-p['image'][0],by-p['image'][1]) if back_ok else None})
        rmse=math.sqrt(sum(r['vector'][0]**2+r['vector'][1]**2 for r in residuals)/len(residuals)) if residuals else None
        records.append({**fixture,'valid':valid,'qgisForward':forward,'qgisBackward':backward,'qgisResiduals':residuals,'qgisRmse':rmse,'minimum':transformer.minimumGcpCount()})
    except Exception as e:
        records.append({**fixture,'valid':False,'error':str(e)})
result={'qgis':Qgis.QGIS_VERSION,'gdal':gdal.VersionInfo('--version'),'proj':'.'.join(map(str,[osr.GetPROJVersionMajor(),osr.GetPROJVersionMinor(),osr.GetPROJVersionMicro()])), 'digest':'sha256:d573fb911eebe29fcf81419868f5d41e8ff7b384d9775cca819cdef2c3989ce6','records':records}
def finite(value):
    if isinstance(value,float) and not math.isfinite(value): return None
    if isinstance(value,(list,tuple)): return [finite(v) for v in value]
    if isinstance(value,dict): return {k:finite(v) for k,v in value.items()}
    return value
print(json.dumps(finite(result),indent=2),flush=True)
os._exit(0)
