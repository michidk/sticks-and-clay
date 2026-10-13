"""Seeded periodic material recipes, physical height derivatives and channel evidence.

Arrays have PNG row order (top to bottom); tangent +V points up the image.
Color is computed in linear space. No directional lighting enters base color.
"""
import math
import numpy as np

VERSION = '2.0.0'
RECIPES = ('sand', 'gravel', 'stone', 'wood', 'brick', 'painted_metal')


def linear(rgb):
    a = np.asarray(rgb, dtype=np.float32)
    return np.where(a <= .04045, a / 12.92, ((a + .055) / 1.055) ** 2.4)


def srgb(rgb):
    a = np.clip(rgb, 0, 1)
    return np.where(a <= .0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - .055)


def noise(size, seed, scale):
    """Band-limited Fourier field. Every operator wraps on the same tile."""
    f = np.fft.fftfreq(size) * size
    radius = np.hypot(f[:, None], f[None, :])
    # Coefficients depend on integer world frequencies, not array shape.
    key=f[:,None]*127.1+f[None,:]*311.7+seed*17.13
    phase=np.mod(np.sin(key)*43758.5453,1)*math.tau
    magnitude=np.sqrt(-2*np.log(np.maximum(np.mod(np.sin(key+19.19)*15731.743,1),1e-7)))
    spectrum = magnitude*np.exp(1j*phase)*np.exp(-.5 * (radius / max(scale, 1)) ** 2)
    spectrum[0, 0] = 0
    field = np.fft.ifft2(spectrum).real.astype(np.float32)
    return field / max(float(field.std()), 1e-6)


def check(params):
    p = dict(recipe='gravel', size=512, seed=1, tileMetres=1, color='#80796b',
             roughness=.8, reliefMm=12, featureMm=35, coverage=.65, wear=.25,
             moisture=0., dirt=0., burial=.35, sizeSpread=.45, calibration=0.)
    p.update(params)
    if p['recipe'] not in RECIPES or type(p['size']) is not int or p['size'] not in (64,128,256,512,1024):
        raise ValueError('Unsupported recipe or texture size')
    if type(p['seed']) is not int or not 0 <= p['seed'] <= 2147483647: raise ValueError('Invalid seed')
    for key, lo, hi in [('tileMetres',.1,20),('roughness',.05,1),('reliefMm',.1,100),
                        ('featureMm',.5,500),('coverage',0,1),('wear',0,1),
                        ('moisture',0,1),('dirt',0,1),('burial',0,1),('sizeSpread',0,1),('calibration',0,1)]:
        value = p[key]
        if not isinstance(value,(int,float)) or isinstance(value,bool) or not math.isfinite(value) or not lo <= value <= hi:
            raise ValueError('Invalid '+key)
    color = p['color']
    if not isinstance(color,str) or len(color)!=7 or not color.startswith('#'): raise ValueError('Invalid color')
    try: int(color[1:],16)
    except ValueError: raise ValueError('Invalid color') from None
    return p


def scatter(size, seed, diameter_px, coverage, burial=.35, spread=.45):
    """Raised rounded particles with wrapped footprints and individual color regions."""
    rng = np.random.default_rng(seed)
    height = np.zeros((size,size),np.float32)
    region = np.zeros_like(height)
    if diameter_px < 1.5: return height,region,0
    count = min(2048, round(coverage * size * size / (math.pi * (diameter_px / 2) ** 2)))
    for _ in range(count):
        radius = diameter_px*.5*np.clip(rng.lognormal(-spread*spread/2,spread),.3,2.5)
        aspect = rng.uniform(.6,1.)
        cx, cy = rng.uniform(0,size,2)
        extent = math.ceil(radius)
        x = np.arange(math.floor(cx)-extent,math.floor(cx)+extent+1)
        y = np.arange(math.floor(cy)-extent,math.floor(cy)+extent+1)
        r2 = ((x[None,:]-cx)/radius)**2 + ((y[:,None]-cy)/(radius*aspect))**2
        shape = np.maximum(0,np.sqrt(np.clip(1-r2,0,1))-burial)*rng.uniform(.6,1)
        index = np.ix_(y % size,x % size)
        previous = height[index]
        mask = shape > previous
        height[index] = np.maximum(previous,shape)
        region[index] = np.where(mask,rng.uniform(-.22,.22),region[index])
    return height,region,count

def fracture_mask(size, seed, cells, width=.05):
    """Connected periodic Voronoi boundaries, with stable cell identities."""
    cells=max(2,min(128,int(cells)))
    y,x=np.mgrid[:size,:size]/size*cells
    ix,iy=np.floor(x).astype(int),np.floor(y).astype(int)
    rng=np.random.default_rng(seed);centers=rng.uniform(.15,.85,(cells,cells,2))
    first=np.full((size,size),np.inf);second=first.copy()
    for dy in (-1,0,1):
        for dx in (-1,0,1):
            jitter=centers[(iy+dy)%cells,(ix+dx)%cells]
            distance=np.hypot(x-(ix+dx+jitter[:,:,0]),y-(iy+dy+jitter[:,:,1]))
            second=np.minimum(second,np.maximum(first,distance));first=np.minimum(first,distance)
    return np.exp(-(second-first)/max(width,.001)).astype(np.float32)

def derive_surface(height_mm, tile_metres):
    """Recompute tangent normals and local cavity AO after height composition."""
    mm_per_px=tile_metres*1000/height_mm.shape[0]
    dx=(np.roll(height_mm,-1,1)-np.roll(height_mm,1,1))/(2*mm_per_px)
    dy=(np.roll(height_mm,-1,0)-np.roll(height_mm,1,0))/(2*mm_per_px)
    normal=np.stack([-dx,dy,np.ones_like(dx)],-1)
    normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    cavity=np.zeros_like(height_mm)
    for axis in (0,1):
        for sign in (-1,1):cavity+=np.maximum(0,np.roll(height_mm,sign,axis)-height_mm)/mm_per_px
    return normal*.5+.5,np.clip(1-cavity/4,0,1)

def layer(base, coating, mask, tile_metres):
    """Blend channels with one physical region mask, then derive the surface."""
    mask=np.asarray(mask,dtype=np.float32)
    if mask.shape!=base['height'].shape or not np.isfinite(mask).all() or mask.min()<0 or mask.max()>1:
        raise ValueError('Layer mask must match the surface and be in [0,1]')
    out=dict(base)
    for name in ('albedo','roughness','metallic'):
        weight=mask[...,None] if name=='albedo' else mask
        out[name]=base[name]*(1-weight)+coating[name]*weight
    def physical(result):
        lo,hi=result['heightWindowMm'];return lo+result['height']*(hi-lo)
    height=physical(base)*(1-mask)+physical(coating)*mask
    window=max(float(np.abs(height).max()),1e-8)
    out['height']=height/(2*window)+.5;out['heightWindowMm']=[-window,window]
    out['normal'],out['ao']=derive_surface(height,tile_metres)
    out['warnings']=list(dict.fromkeys(base['warnings']+coating['warnings']))
    return out
