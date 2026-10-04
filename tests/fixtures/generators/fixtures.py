"""Deterministic synthetic source, no external imagery or expected fitter output."""
import struct, zlib, pathlib, subprocess
root = pathlib.Path(__file__).resolve().parent.parent
def chunk(t, data):
    return struct.pack('>I',len(data)) + t + data + struct.pack('>I',zlib.crc32(t+data))
w=h=100
rows=[]
for y in range(h):
    row=bytearray([0])
    for x in range(w):
        color = (255,40,20,255) if 20<=x<30 and 30<=y<40 else (x*2,y*2,70,255)
        if x%10==0 or y%10==0: color=(240,240,220,255)
        row.extend(color)
    rows.append(row)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
(root/'grid.png').write_bytes(png)

# All orientation cases use an asymmetric four-quadrant source. JPEG encoding
# is delegated to native GDAL; orientation is an explicit TIFF/EXIF short tag.
w,h=80,40
colors=[(255,0,0),(0,255,0),(0,0,255),(255,255,0)]
rows=[]
for y in range(h):
    row=bytearray([0])
    for x in range(w): row.extend(colors[(2 if y>=h//2 else 0)+(1 if x>=w//2 else 0)])
    rows.append(row)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
(root/'quadrants.png').write_bytes(png)
subprocess.run(['gdal_translate','-q','-of','JPEG','-co','QUALITY=100',str(root/'quadrants.png'),str(root/'quadrants.jpg')],check=True)
jpeg=(root/'quadrants.jpg').read_bytes()
for orientation in range(1,9):
    tiff=b'II'+struct.pack('<HIH',42,8,1)+struct.pack('<HHI',274,3,1)+struct.pack('<H',orientation)+b'\0\0'+struct.pack('<I',0)
    exif=b'Exif\0\0'+tiff
    (root/f'exif-{orientation}.jpg').write_bytes(jpeg[:2]+b'\xff\xe1'+struct.pack('>H',len(exif)+2)+exif+jpeg[2:])
subprocess.run(['gdal_translate','-q','-of','GTiff','-co','COMPRESS=LZW',str(root/'grid.png'),str(root/'grid-lzw.tif')],check=True)
subprocess.run(['gdal_translate','-q','-of','GTiff','-ot','UInt16',str(root/'grid.png'),str(root/'unsupported-16bit.tif')],check=True)

# Metadata-only PNG orientation variants (same raster samples and CRC-correct chunks).
import struct, zlib
original=(root/'quadrants.png').read_bytes()
for orientation in range(1,9):
    exif=b'II'+struct.pack('<HIH',42,8,1)+struct.pack('<HHIHHI',274,3,1,orientation,0,0)
    tag=b'eXIf'+exif
    chunk=struct.pack('>I',len(exif))+tag+struct.pack('>I',zlib.crc32(tag))
    (root/f'exif-{orientation}.png').write_bytes(original[:33]+chunk+original[33:])
