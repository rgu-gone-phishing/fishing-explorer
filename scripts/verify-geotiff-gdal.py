"""Independent development check using an existing GDAL shared library.
Not a dependency of Fishing Explorer. Usage: TIFF_PATH ORIGINAL_BUNDLE_JSON
"""
import datetime
import ctypes as C
import ctypes.util
import hashlib
import json
import math
import sys
library = ctypes.util.find_library('gdal')
if not library:
    raise SystemExit('GDAL shared library unavailable; interoperability not verified.')
g = C.CDLL(library)
def api(name, result, args):
    f = getattr(g, name); f.restype = result; f.argtypes = args; return f
api('GDALAllRegister', None, [])()
version=api('GDALVersionInfo',C.c_char_p,[C.c_char_p])(b'RELEASE_NAME').decode()
open_ds = api('GDALOpen', C.c_void_p, [C.c_char_p, C.c_int])
close = api('GDALClose', None, [C.c_void_p])
width_of = api('GDALGetRasterXSize', C.c_int, [C.c_void_p])
height_of = api('GDALGetRasterYSize', C.c_int, [C.c_void_p])
band_count = api('GDALGetRasterCount', C.c_int, [C.c_void_p])
band_of = api('GDALGetRasterBand', C.c_void_p, [C.c_void_p, C.c_int])
dtype = api('GDALGetRasterDataType', C.c_int, [C.c_void_p])
transform = api('GDALGetGeoTransform', C.c_int, [C.c_void_p, C.POINTER(C.c_double)])
projection = api('GDALGetProjectionRef', C.c_char_p, [C.c_void_p])
metadata = api('GDALGetMetadataItem', C.c_char_p, [C.c_void_p,C.c_char_p,C.c_char_p])
no_data = api('GDALGetRasterNoDataValue', C.c_double, [C.c_void_p,C.POINTER(C.c_int)])
unit = api('GDALGetRasterUnitType', C.c_char_p, [C.c_void_p])
read = api('GDALRasterIO', C.c_int, [C.c_void_p,C.c_int,C.c_int,C.c_int,C.c_int,C.c_int,C.c_void_p,C.c_int,C.c_int,C.c_int,C.c_int,C.c_int])
srs_new=api('OSRNewSpatialReference',C.c_void_p,[C.c_char_p]);srs_code=api('OSRGetAuthorityCode',C.c_char_p,[C.c_void_p,C.c_char_p]);srs_free=api('OSRDestroySpatialReference',None,[C.c_void_p])
a=json.load(open(sys.argv[2],encoding='utf8'));q=a['query'];ds=open_ds(sys.argv[1].encode(),0)
assert ds, 'GDAL could not open TIFF'
try:
    w,h=width_of(ds),height_of(ds); assert band_count(ds)==1 and w*h<=4_000_000
    b=band_of(ds,1);assert dtype(b)==7, 'Expected Float64'
    m=json.loads(metadata(ds,b'TIFFTAG_IMAGEDESCRIPTION',None));assert unit(b).decode()==a['manifest']['units']
    srs=srs_new(projection(ds))
    try: assert srs_code(srs,None)==b'4326', 'Expected EPSG:4326'
    finally:srs_free(srs)
    valid=C.c_int();assert math.isnan(no_data(b,C.byref(valid))) and valid.value
    gt=(C.c_double*6)();assert transform(ds,gt)==0 and gt[1]>0 and gt[5]<0 and gt[2]==gt[4]==0
    pixels=(C.c_double*(w*h))();assert read(b,0,0,0,w,h,pixels,w,h,7,0,0)==0
    group_key={'GEARTYPE':'geartype','FLAG':'flag','VESSEL_ID':'vesselId','VESSEL_TYPE':'vesselType'}.get(q['grouping']);expected={}
    for r in a['rows']:
        selected_start=m['selection'].get('start') or q['start'];selected_end=m['selection'].get('end') or q['end']
        if q['interval']=='DAILY' and not selected_start<=r['date'][:10]<selected_end:continue
        if q['interval']=='MONTHLY':
            year,month=map(int,r['date'][:7].split('-'));month_start=datetime.date(year,month,1).isoformat();month_end=datetime.date(year+int(month==12),1 if month==12 else month+1,1).isoformat()
            if max(q['start'],month_start)<selected_start or min(q['end'],month_end)>selected_end:continue
        if q['interval']=='ENTIRE':assert selected_start==q['start'] and selected_end==q['end']
        group=(r.get(group_key) or 'Unspecified') if group_key else 'All detections'
        if m['selection']['time'] and r['date']!=m['selection']['time']:continue
        if m['selection']['group'] and group!=m['selection']['group']:continue
        x,y=round(r['lon']/q['grid']),round(r['lat']/q['grid']);expected[x,y]=expected.get((x,y),0)+r.get('detections',r.get('hours'))
    seen=set();missing=0
    for y in range(h):
        for x in range(w):
            centre=(gt[0]+(x+.5)*gt[1],gt[3]+(y+.5)*gt[5]);k=(round(centre[0]/q['grid']),round(centre[1]/q['grid']));value=pixels[y*w+x]
            if k in expected:assert math.isclose(value,expected[k],rel_tol=1e-12,abs_tol=1e-12),(k,value,expected[k]);seen.add(k)
            else:assert math.isnan(value),(k,value);missing+=1
    assert seen==set(expected)
    print(json.dumps({'reader':'GDAL shared library','version':version,'crs':'EPSG:4326','sampleType':'Float64','width':w,'height':h,'geotransform':list(gt),'nodata':'NaN','units':unit(b).decode(),'matchedPopulatedPixels':len(seen),'verifiedMissingPixels':missing,'sha256':hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest()}))
finally:close(ds)
