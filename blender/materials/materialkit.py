"""Seeded periodic material recipes, physical height derivatives and channel evidence.

Arrays have PNG row order (top to bottom); tangent +V points up the image.
Color is computed in linear space. No directional lighting enters base color.
"""
import hashlib
import json
import math
import pathlib
import platform
import numpy as np
from PIL import Image, ImageDraw, __version__ as pillow_version

VERSION = '1.0.0'
RECIPES = ('sand', 'gravel', 'stone', 'wood', 'brick', 'painted_metal')


def linear(rgb):
    a = np.asarray(rgb, dtype=np.float32)
    return np.where(a <= .04045, a / 12.92, ((a + .055) / 1.055) ** 2.4)


def srgb(rgb):
    a = np.clip(rgb, 0, 1)
    return np.where(a <= .0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - .055)


def noise(size, seed, scale):
    """Band-limited Fourier field. Every operator wraps on the same tile."""
    rng = np.random.default_rng(seed)
    white = rng.normal(size=(size, size))
    f = np.fft.fftfreq(size) * size
    radius = np.hypot(f[:, None], f[None, :])
    spectrum = np.fft.fft2(white) * np.exp(-.5 * (radius / max(scale, 1)) ** 2)
    spectrum[0, 0] = 0
    field = np.fft.ifft2(spectrum).real.astype(np.float32)
    return field / max(float(field.std()), 1e-6)


def check(params):
    p = dict(recipe='gravel', size=512, seed=1, tileMetres=1, color='#80796b',
             roughness=.8, reliefMm=12, featureMm=35, coverage=.65, wear=.25)
    p.update(params)
    if p['recipe'] not in RECIPES or type(p['size']) is not int or p['size'] not in (64,128,256,512,1024):
        raise ValueError('Unsupported recipe or texture size')
    if type(p['seed']) is not int or not 0 <= p['seed'] <= 2147483647: raise ValueError('Invalid seed')
    for key, lo, hi in [('tileMetres',.1,20),('roughness',.05,1),('reliefMm',.1,100),
                        ('featureMm',.5,500),('coverage',0,1),('wear',0,1)]:
        value = p[key]
        if not isinstance(value,(int,float)) or isinstance(value,bool) or not math.isfinite(value) or not lo <= value <= hi:
            raise ValueError('Invalid '+key)
    color = p['color']
    if not isinstance(color,str) or len(color)!=7 or not color.startswith('#'): raise ValueError('Invalid color')
    try: int(color[1:],16)
    except ValueError: raise ValueError('Invalid color') from None
    return p


def scatter(size, seed, diameter_px, coverage):
    """Raised rounded particles with wrapped footprints and individual color regions."""
    rng = np.random.default_rng(seed)
    height = np.zeros((size,size),np.float32)
    region = np.zeros_like(height)
    diameter_px = max(2, min(diameter_px, size / 3))
    count = min(2048, round(coverage * size * size / (math.pi * (diameter_px / 2) ** 2)))
    for _ in range(count):
        radius = max(1, diameter_px * rng.uniform(.3,.7))
        cx, cy = rng.uniform(0,size,2)
        extent = math.ceil(radius)
        x = np.arange(math.floor(cx)-extent,math.floor(cx)+extent+1)
        y = np.arange(math.floor(cy)-extent,math.floor(cy)+extent+1)
        r2 = ((x[None,:]-cx)/radius)**2 + ((y[:,None]-cy)/radius)**2
        shape = np.sqrt(np.clip(1-r2,0,1)) * rng.uniform(.5,1)
        index = np.ix_(y % size,x % size)
        previous = height[index]
        mask = shape > previous
        height[index] = np.maximum(previous,shape)
        region[index] = np.where(mask,rng.uniform(-.22,.22),region[index])
    return height,region,count


def build_material(params):
    p = check(params); n = p['size']; recipe = p['recipe']; seed = p['seed']
    mm_per_px = p['tileMetres'] * 1000 / n
    macro = noise(n, seed, 5)
    grain = noise(n, seed+1, min(n/3, p['tileMetres']*1000/max(p['featureMm']/8,1)))
    shape = macro*.12 + grain*.035
    variation = macro*.03 + grain*.02
    metal = np.zeros((n,n),np.float32)
    counts = 0
    features = p['featureMm'] / mm_per_px
    u,v = np.meshgrid(np.arange(n)/n,np.arange(n)/n)
    if recipe == 'gravel':
        particles,regions,counts = scatter(n,seed+2,features,p['coverage'])
        shape += particles
        variation += regions
    elif recipe == 'sand':
        cycles = max(1,round(p['tileMetres']*1000/max(p['featureMm'],1)))
        shape = .18*np.sin(math.tau*cycles*u + .25*macro) + grain*.04
        variation = grain*.018
    elif recipe == 'stone':
        cracks = np.exp(-np.abs(noise(n,seed+2,max(2,n/max(features,2))))*24)
        shape -= cracks * p['coverage']*.7
        variation -= cracks*.08
    elif recipe == 'wood':
        cycles = max(2,round(p['tileMetres']*1000/max(p['featureMm'],1)))
        rings = np.sin(math.tau*cycles*u + macro*.35)
        shape = rings*.13 + grain*.015
        variation = rings*.12 + grain*.012
    elif recipe == 'brick':
        rows = max(2,round(p['tileMetres']*1000/max(p['featureMm'],1)))
        rows += rows % 2
        cols = max(1,round(rows/2))
        row = np.floor(v*rows).astype(int)
        x = (u*cols+(row%2)*.5)%1; y=(v*rows)%1
        mortar = (np.minimum(x,1-x)<.045) | (np.minimum(y,1-y)<.065)
        shape = np.where(mortar,-.5,.35)+grain*.025
        variation = np.where(mortar,-.18,.05)+macro*.035
    else:
        exposed = noise(n,seed+2,max(2,n/max(features,2))) > (1.9-3*p['wear'])
        metal = exposed.astype(np.float32)
        shape = grain*.015 - metal*.1
        variation = grain*.018 - metal*.12
    base = linear([int(p['color'][i:i+2],16)/255 for i in (1,3,5)])
    albedo = np.clip(base[None,None,:]*(1+variation[...,None]),.001,.95)
    if recipe == 'painted_metal':
        # Neutral reflective base color only on exposed metallic texels.
        albedo = np.where(metal[...,None]>.5, np.array([.56,.58,.6]),albedo)
    roughness = np.clip(p['roughness'] + grain*.025 + p['wear']*.04 - metal*.25,.05,1)
    centered = shape - shape.mean()
    height_mm = centered * (p['reliefMm'] / max(float(np.ptp(shape)),1e-8))
    height_mm = height_mm.astype(np.float32)
    dx = (np.roll(height_mm,-1,1)-np.roll(height_mm,1,1))/(2*mm_per_px)
    dy = (np.roll(height_mm,-1,0)-np.roll(height_mm,1,0))/(2*mm_per_px)
    normal = np.stack([-dx,dy,np.ones_like(dx)],-1)
    normal /= np.linalg.norm(normal,axis=-1,keepdims=True)
    occlusion = np.zeros((n,n),np.float32)
    for angle in np.arange(8)*math.tau/8:
        horizon = np.zeros_like(occlusion)
        for step in (1,2,4,8):
            ox,oy=round(math.cos(angle)*step),round(math.sin(angle)*step)
            distance=max(math.hypot(ox,oy)*mm_per_px,1e-6)
            slope=(np.roll(height_mm,(oy,ox),(0,1))-height_mm)/distance
            horizon=np.maximum(horizon,slope)
        occlusion += horizon / np.sqrt(1+horizon*horizon)
    ao=np.clip(1-occlusion/8,0,1)
    window=max(float(np.abs(height_mm).max()),1e-8)
    height=height_mm/(2*window)+.5
    return dict(albedo=albedo,roughness=roughness,metallic=metal,normal=normal*.5+.5,
                height=height,ao=ao,heightWindowMm=[-window,window],particles=counts,
                warnings=(['Particle count capped; increase feature size for resolved grains.'] if counts==2048 else []))


def seam_ratio(array):
    values=[]
    for axis in (0,1):
        edge=np.abs(np.take(array,0,axis)-np.take(array,-1,axis)).mean()
        adjacent=np.abs(np.diff(array,axis=axis)).mean()
        values.append(float(edge/max(float(adjacent),1e-6)))
    return max(values)


def image(array):
    return Image.fromarray(np.round(np.clip(array,0,1)*255).astype(np.uint8))


def shade(albedo, normal, roughness, metallic, ao, light):
    """Small GGX preview shader; exported maps remain unlit."""
    view=np.array([0.,0.,1.]); half=light+view; half/=np.linalg.norm(half)
    nl=np.maximum(0,(normal*light).sum(-1)); nv=np.maximum(.001,normal[:,:,2])
    nh=np.maximum(0,(normal*half).sum(-1)); vh=max(0,float(view@half))
    alpha=np.maximum(roughness,.1)**2; a2=alpha*alpha
    distribution=a2/(math.pi*np.maximum((nh*nh*(a2-1)+1)**2,1e-6))
    k=(roughness+1)**2/8
    geometry=(nl/(nl*(1-k)+k))*(nv/(nv*(1-k)+k))
    f0=.04*(1-metallic[...,None])+albedo*metallic[...,None]
    fresnel=f0+(1-f0)*(1-vh)**5
    specular=fresnel*(distribution*geometry/np.maximum(4*nl*nv,1e-6))[...,None]
    diffuse=(1-fresnel)*(1-metallic[...,None])*albedo/math.pi
    return .18*albedo*ao[...,None]+(diffuse+specular)*nl[...,None]*2.5


def save(result, params, directory):
    p=check(params); out=pathlib.Path(directory); out.mkdir(parents=True,exist_ok=True)
    maps={name:result[name] for name in ('albedo','roughness','metallic','normal','height','ao')}
    report={'seamRatios':{},'channelRanges':{},'warnings':list(result['warnings'])}
    for name,array in maps.items():
        if not np.isfinite(array).all() or array.min()<0 or array.max()>1:
            raise ValueError('Invalid channel '+name)
        report['seamRatios'][name]=seam_ratio(array)
        report['channelRanges'][name]=[float(array.min()),float(array.max())]
        if report['seamRatios'][name]>2: report['warnings'].append(name+': inspect wrap seams in the repeated preview')
        if name=='height':
            Image.fromarray(np.round(array*65535).astype(np.uint16)).save(out/(name+'.png'))
        else: image(srgb(array) if name=='albedo' else array).save(out/(name+'.png'))
    packed=np.stack([result['ao'],result['roughness'],result['metallic']],-1)
    image(packed).save(out/'orm.png')
    normal=result['normal']*2-1
    light=np.array([.4,-.45,.8]); light/=np.linalg.norm(light)
    preview=srgb(shade(result['albedo'],normal,result['roughness'],result['metallic'],result['ao'],light))
    tile=image(preview).resize((256,256),Image.Resampling.LANCZOS)
    review=Image.new('RGB',(768,750),(244,241,232)); draw=ImageDraw.Draw(review)
    draw.text((12,12),'Repeated material / 1:1 crop / sphere / exported channels',fill=(35,60,42))
    for y in range(2):
        for x in range(2): review.paste(tile,(x*256,40+y*256))
    crop=image(srgb(result['albedo'])).crop((0,0,min(p['size'],256),min(p['size'],256)))
    review.paste(crop,(512,40))
    # UV-mapped sphere preview: tangent normal transformed into sphere frame.
    grid=np.linspace(-1,1,256); sx,sy=np.meshgrid(grid,-grid); mask=sx*sx+sy*sy<1
    sz=np.sqrt(np.maximum(0,1-sx*sx-sy*sy)); u=(np.arctan2(sx,sz)/math.tau+.5)%1
    v=np.arccos(np.clip(sy,-1,1))/math.pi
    ix=(u*p['size']).astype(int)%p['size']; iy=np.minimum((v*p['size']).astype(int),p['size']-1)
    world=np.stack([sx,sy,sz],-1); tangent=np.stack([sz,np.zeros_like(sx),-sx],-1)
    tangent/=np.maximum(np.linalg.norm(tangent,axis=-1,keepdims=True),1e-6)
    bitangent=np.cross(world,tangent); sampled=normal[iy,ix]
    perturbed=tangent*sampled[...,:1]+bitangent*sampled[...,1:2]+world*sampled[...,2:3]
    perturbed/=np.maximum(np.linalg.norm(perturbed,axis=-1,keepdims=True),1e-6)
    sphere=srgb(shade(result['albedo'][iy,ix],perturbed,result['roughness'][iy,ix],result['metallic'][iy,ix],result['ao'][iy,ix],light))
    sphere=np.where(mask[...,None],sphere,np.array([244,241,232])/255)
    review.paste(image(sphere),(512,304))
    for index,(name,array) in enumerate(maps.items()):
        draw.text((index*128+4,580),name,fill=(35,60,42))
        review.paste(image(srgb(array) if name=='albedo' else array).resize((128,128)),(index*128,604))
    review.save(out/'review.png')
    report['normalConvention']='OpenGL +Y; PNG rows top to bottom'
    report['albedoMeanLinear']=[float(x) for x in result['albedo'].mean(axis=(0,1))]
    report['roughnessMean']=float(result['roughness'].mean())
    metadata=dict(version=VERSION,parameters=p,heightWindowMm=result['heightWindowMm'],
                  heightZero=.5,physicalTileMetres=p['tileMetres'],particles=result['particles'],
                  colorSpaces={'albedo':'sRGB','otherMaps':'linear'},
                  packedORM={'R':'ao','G':'roughness','B':'metallic'},validation=report,
                  toolchain={'python':platform.python_version(),'numpy':np.__version__,'pillow':pillow_version})
    (out/'material.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    files={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(out.glob('*')) if path.is_file() and path.name!='manifest.json'}
    (out/'manifest.json').write_text(json.dumps({'files':files},indent=2),encoding='utf-8')
    return metadata
