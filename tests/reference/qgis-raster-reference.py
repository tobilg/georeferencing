"""Independent QGIS/GDAL reference; runs in the pinned container, never shipped.
Uses GDAL's public warp C ABI with the actual QGIS transformer as callback.
No package transformation or resampling code is imported.
"""
import json, sys, ctypes as C, ctypes.util, base64, zlib, faulthandler, os
faulthandler.dump_traceback_later(45, repeat=True)
import numpy as np
from osgeo import gdal, osr
from qgis.core import QgsApplication, QgsPointXY, Qgis
from qgis.analysis import QgsGcpTransformerInterface as T
app=QgsApplication([],False); app.initQgis()
lib=C.CDLL(ctypes.util.find_library('gdal'))
lib.GDALVersionInfo.restype=C.c_char_p
P=C.c_void_p; I=C.c_int; D=C.c_double
# Prefix through pTransformerArg, stable public GDALWarpOptions ABI in 3.8.4.
class Options(C.Structure):
    _fields_=[('strings',P),('memory',D),('resampler',I),('dataType',I),('src',P),('dst',P),('bands',I),('srcBands',P),('dstBands',P),('srcAlpha',I),('dstAlpha',I),('srcNoData',P),('srcNoDataImag',P),('dstNoData',P),('dstNoDataImag',P),('progress',P),('progressArg',P),('transform',P),('transformArg',P)]
def bind(name,restype,argtypes):
    f=getattr(lib,name); f.restype=restype; f.argtypes=argtypes; return f
create=bind('GDALCreateWarpOptions',C.POINTER(Options),[])
initBands=bind('GDALWarpInitDefaultBandMapping',None,[C.POINTER(Options),I])
createOp=bind('GDALCreateWarpOperation',P,[C.POINTER(Options)])
warp=bind('GDALChunkAndWarpImage',I,[P,I,I,I,I])
destroy=bind('GDALDestroyWarpOperation',None,[P])
destroyOptions=bind('GDALDestroyWarpOptions',None,[C.POINTER(Options)])
setOpt=bind('CSLSetNameValue',P,[P,C.c_char_p,C.c_char_p])
callbackType=C.CFUNCTYPE(I,P,I,I,C.POINTER(D),C.POINTER(D),C.POINTER(D),C.POINTER(I))
methods={'linear':'Linear','helmert':'Helmert','polynomial1':'PolynomialOrder1','polynomial2':'PolynomialOrder2','polynomial3':'PolynomialOrder3','projective':'Projective','thinPlateSpline':'ThinPlateSpline'}
records=[]
for case in json.load(sys.stdin):
    print(case['model'],case['resampler'],case.get('scale'),file=sys.stderr,flush=True)
    t=T.create(getattr(T.TransformMethod,methods[case['model']]))
    assert t.updateParametersFromGcps([QgsPointXY(p['image'][0],-p['image'][1]) for p in case['gcps'] if p['enabled']], [QgsPointXY(*p['target']) for p in case['gcps'] if p['enabled']],True)
    source=np.frombuffer(base64.b64decode(case['source']),dtype=np.uint8).reshape(case['sourceHeight'],case['sourceWidth'],4)
    src=gdal.GetDriverByName('MEM').Create('',case['sourceWidth'],case['sourceHeight'],4,gdal.GDT_Byte)
    for b in range(4): src.GetRasterBand(b+1).WriteArray(source[:,:,b])
    width,height=case['width'],case['height']; bounds=case['bounds']
    dst=gdal.GetDriverByName('MEM').Create('',width,height,4,gdal.GDT_Byte)
    dx=(bounds[2]-bounds[0])/width; dy=(bounds[3]-bounds[1])/height
    targetCrs=case.get('crs','EPSG:3857')
    a=osr.SpatialReference(); a.SetFromUserInput(case.get('workingCrs','EPSG:3857')); a.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    b=osr.SpatialReference(); b.SetFromUserInput(targetCrs); b.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    toOutput=osr.CoordinateTransformation(a,b); toWorking=osr.CoordinateTransformation(b,a)
    @callbackType
    def transform(arg,inverse,count,x,y,z,success):
        for i in range(count):
            if inverse:
                wx,wy=bounds[0]+x[i]*dx,bounds[3]-y[i]*dy
                if targetCrs!=case.get('workingCrs','EPSG:3857'): wx,wy,*_=toWorking.TransformPoint(wx,wy)
                ok,xx,yy=t.transform(wx,wy,True)
            else:
                ok,xx,yy=t.transform(x[i],y[i])
                if targetCrs!=case.get('workingCrs','EPSG:3857'): xx,yy,*_=toOutput.TransformPoint(xx,yy)
                xx=(xx-bounds[0])/dx; yy=(bounds[3]-yy)/dy
            x[i],y[i],success[i]=xx,yy,int(ok)
        return 1
    opt=create(); initBands(opt,3 if case.get('alpha') else 4)
    opt.contents.src=int(src.this); opt.contents.dst=int(dst.this)
    opt.contents.resampler=['nearest','bilinear','cubic','cubicSpline','lanczos'].index(case['resampler'])
    opt.contents.transform=C.cast(transform,P)
    if case.get('alpha'): opt.contents.srcAlpha=4; opt.contents.dstAlpha=4
    # Full destination initialized to transparent black; no approximate transformer.
    opt.contents.strings=setOpt(opt.contents.strings,b'INIT_DEST',b'0')
    for k,v in case.get('warpOptions',{}).items(): opt.contents.strings=setOpt(opt.contents.strings,k.encode(),str(v).encode())
    op=createOp(opt); assert op, gdal.GetLastErrorMsg()
    assert warp(op,0,0,width,height)==0, gdal.GetLastErrorMsg()
    out=np.moveaxis(dst.ReadAsArray(),0,-1).tobytes()
    record={k:v for k,v in case.items() if k!='source'}
    record['rgbaZlib']=base64.b64encode(zlib.compress(out,9)).decode()
    records.append(record)
    destroy(op)
    destroyOptions(opt)
print(json.dumps({'qgis':Qgis.QGIS_VERSION,'gdal':gdal.VersionInfo('--version'),'records':records}),flush=True)
# All datasets/options are released above. Avoid Qt/GDAL registry destructor ordering
# under the amd64 reference container on ARM macOS; the isolated process owns no files.
os._exit(0)
