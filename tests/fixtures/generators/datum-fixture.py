"""Tiny synthetic NTv2 grid, encoded from the published NTv2 record format.
Expected shifts are read with independent native GDAL/PROJ, not package code.
"""
import struct, pathlib, subprocess, json
root=pathlib.Path(__file__).resolve().parents[3]
records=[]
def field(name,value,kind='d'):
    records.append(name.encode().ljust(8)+ (value.encode().ljust(8) if kind=='s' else struct.pack('<'+kind,value).ljust(8,b'\0')))
for name,v in [('NUM_OREC',11),('NUM_SREC',11),('NUM_FILE',1)]: field(name,v,'i')
for name,v in [('GS_TYPE','SECONDS'),('VERSION','SYNTH001'),('SYSTEM_F','TEST'),('SYSTEM_T','WGS84')]:field(name,v,'s')
for name,v in [('MAJOR_F',6378137.),('MINOR_F',6356752.314245179),('MAJOR_T',6378137.),('MINOR_T',6356752.314245179)]:field(name,v)
for name,v in [('SUB_NAME','LOCAL'),('PARENT','NONE'),('CREATED','20261002'),('UPDATED','20261002')]:field(name,v,'s')
for name,v in [('S_LAT',47*3600.),('N_LAT',49*3600.),('E_LONG',-10*3600.),('W_LONG',-8*3600.),('LAT_INC',3600.),('LONG_INC',3600.)]:field(name,v)
field('GS_COUNT',9,'i')
records.extend(struct.pack('<ffff',1.,2.,0.,0.) for _ in range(9))
field('END','', 's')
path=root/'tests/fixtures/constant-shift.gsb';path.write_bytes(b''.join(records))
source=f'+proj=longlat +ellps=WGS84 +nadgrids={path} +type=crs'
points=[[9.,48.],[8.25,47.25],[9.75,48.75]]
result=subprocess.check_output(['gdaltransform','-s_srs',source,'-t_srs','EPSG:4326'],input=''.join(f'{x} {y}\n' for x,y in points),text=True)
expected=[list(map(float,line.split()))[:2] for line in result.splitlines()]
evidence={'gdal':subprocess.check_output(['gdalinfo','--version'],text=True).strip(),'source':source.replace(str(path),'constant-shift.gsb'),'target':'EPSG:4326','input':points,'expected':expected,'provenance':'Synthetic NTv2: constant +1 second latitude, +2 seconds west longitude. Native GDAL/PROJ supplies independent coordinates.'}
(root/'tests/fixtures/datum-grid.json').write_text(json.dumps(evidence,indent=2)+'\n')
print(json.dumps(evidence,indent=2))
