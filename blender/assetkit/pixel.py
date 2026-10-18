"""Deterministic palette and outline processing on rendered linear RGBA arrays, and the pixel-art checks per cell."""
import math
import numpy as np


def rgb(value):
    if not isinstance(value,str) or len(value)!=7 or value[0]!='#': raise ValueError('Colors use #rrggbb')
    c=np.array([int(value[i:i+2],16)/255 for i in (1,3,5)],dtype=np.float32)
    return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)


def oklab(linear):
    """Linear RGB (..., 3) to OKLab, where equal distances look about equally different. Clustering and palette
    matching use it so similar-looking colors merge and distinct hues stay apart."""
    c=np.maximum(np.asarray(linear,dtype=np.float64),0)
    lms=np.cbrt(c@np.array([[.4122214708,.2119034982,.0883024619],[.5363325363,.6806995451,.2817188376],[.0514459929,.1073969566,.6299787005]]))
    return lms@np.array([[.2104542553,1.9779984951,.0259040371],[.793617785,-2.428592205,.7827717662],[-.0040720468,.4505937099,-.808675766]])


def linear_from_oklab(lab):
    lms=np.asarray(lab,dtype=np.float64)@np.array([[1,1,1],[.3963377774,-.1055613458,-.0894841775],[.2158037573,-.0638541728,-1.291485548]])
    lms=lms**3
    out=lms@np.array([[4.0767416621,-1.2684380046,-.0041960863],[-3.3077115913,2.6097574011,-.7034186147],[.2309699292,-.3413193965,1.707815201]])
    return np.clip(out,0,1).astype(np.float32)


def _nearest(points,centers):
    """Index of the nearest center (OKLab) for every point, in bounded chunks."""
    out=np.empty(len(points),dtype=np.int64)
    for start in range(0,len(points),8192):
        chunk=points[start:start+8192]
        out[start:start+8192]=np.square(chunk[:,None,:]-centers[None,:,:]).sum(axis=2).argmin(axis=1)
    return out


def _cluster(sample,count):
    """k-means in OKLab, seeded deterministically across the lightness range; returns linear RGB centers."""
    lab=oklab(sample)
    unique=np.unique(np.round(lab,4),axis=0)
    if len(unique)<=count: return linear_from_oklab(unique)
    order=unique[np.argsort(unique[:,0],kind='stable')]
    centers=order[np.linspace(0,len(order)-1,count,dtype=int)].copy()
    for _ in range(12):
        labels=_nearest(lab,centers)
        for i in range(len(centers)):
            if np.any(labels==i): centers[i]=lab[labels==i].mean(axis=0)
    return linear_from_oklab(centers)


def luminance(linear):
    """Perceived brightness 0..1 of linear RGB, measured on the stored (sRGB-encoded) values like a Values panel."""
    encoded=np.where(linear<=.0031308,linear*12.92,1.055*np.maximum(linear,0)**(1/2.4)-.055)
    return np.clip(encoded,0,1)@np.array([.2126,.7152,.0722])


def auto_outline(centers,palette=False):
    """The outline for outline="auto": the darkest color darkened (in OKLab lightness), or, with a fixed palette, the
    palette's darkest color, so the outline stays on the palette."""
    lab=oklab(centers)
    darkest=lab[int(np.argmin(lab[:,0]))].copy()
    if palette: return centers[int(np.argmin(lab[:,0]))]
    darkest[0]*=.6; darkest[1:]*=.8
    return linear_from_oklab(darkest[None,:])[0]


def process(sheet, cell_size, colors=16, palette=None, outline=None):
    if not 2<=colors<=32: raise ValueError('Pixel palettes use 2 to 32 colors')
    result=sheet.copy(); alpha=result[:,:,3]>=.5
    pixels=result[:,:,:3][alpha]
    auto=outline=='auto'
    if palette:
        if len(palette)>colors: raise ValueError('Custom palette exceeds the color budget')
        centers=np.array([rgb(c) for c in palette],dtype=np.float32)
    elif len(pixels):
        sample=pixels[np.linspace(0,len(pixels)-1,min(4096,len(pixels)),dtype=int)]
        # An added outline color counts against the budget, so the art gets one color fewer.
        budget=colors-1 if outline else colors
        centers=_cluster(sample,max(1,budget))
    else: centers=np.zeros((1,3),dtype=np.float32)
    ink=None
    if outline and len(centers):
        ink=auto_outline(centers,bool(palette)) if auto else rgb(outline)
        if palette:
            # The outline is mapped into the supplied palette.
            ink=centers[_nearest(oklab(ink[None,:]),oklab(centers))[0]]
        elif not np.any(np.all(np.isclose(centers,ink,atol=1e-6),axis=1)):
            centers=np.concatenate([centers[:colors-1],ink[None,:]],axis=0)
    if len(pixels):
        result[:,:,:3][alpha]=centers[_nearest(oklab(pixels),oklab(centers))]
    result[:,:,3]=alpha.astype(np.float32); result[:,:,:3][~alpha]=0
    if ink is not None:
        for y in range(0,len(result),cell_size):
            for x in range(0,result.shape[1],cell_size):
                cell=alpha[y:y+cell_size,x:x+cell_size]; expanded=np.zeros_like(cell)
                expanded[1:] |= cell[:-1]; expanded[:-1] |= cell[1:]; expanded[:,1:] |= cell[:,:-1]; expanded[:,:-1] |= cell[:,1:]
                border=expanded & ~cell
                result[y:y+cell_size,x:x+cell_size,:3][border]=ink
                result[y:y+cell_size,x:x+cell_size,3][border]=1
    return result


def _runs(codes):
    """Start, length and drawn flag of every run of one color along each row of a 2D code array."""
    w=codes.shape[1]
    change=np.ones(codes.shape,dtype=bool); change[:,1:]=codes[:,1:]!=codes[:,:-1]
    ys,xs=np.nonzero(change)
    same_row=np.zeros(len(ys),dtype=bool); same_row[:-1]=ys[1:]==ys[:-1]
    ends=np.where(same_row,np.append(xs[1:],w),w)
    return xs,ends-xs,codes[ys,xs]>=0


def cell_checks(cell):
    """The pixel-art checks the 2D pixel review uses, for one top-down RGBA cell (linear floats): light-to-dark value
    range, the drawn pixel size (gcd of color runs: 2 means every pixel is a 2x2 block) with the share of one-pixel
    runs, and the feet (lowest opaque row). Warnings name the threshold crossed."""
    opaque=cell[:,:,3]>.5
    warnings=[]
    if not opaque.any(): return {'empty':True},['empty cell']
    values=np.sort(luminance(cell[:,:,:3][opaque]))
    value_range=float(values[int(.95*(len(values)-1))]-values[int(.05*(len(values)-1))])
    if value_range<.35: warnings.append(f'value range {value_range:.2f} (below 0.35): reads as mush at 1x')
    codes=np.where(opaque,np.round(cell[:,:,0]*255)*65536+np.round(cell[:,:,1]*255)*256+np.round(cell[:,:,2]*255),-1)
    scale=0; runs=singles=0
    for lines in (codes,codes.T):
        starts,lengths,drawn=_runs(lines)
        scale=math.gcd(scale,int(np.gcd.reduce(np.concatenate([starts,lengths]))))
        runs+=int(drawn.sum()); singles+=int((drawn&(lengths==1)).sum())
    single_share=singles/runs if runs else 0.
    if scale>=2 and runs>=16: warnings.append(f'every pixel is a {scale}x{scale} block (mixels); reduce zoom or raise the cell size')
    elif runs>=20 and single_share<.06: warnings.append(f'only {single_share:.0%} one-pixel runs: parts read as drawn at 2x')
    rows=np.where(opaque.any(axis=1))[0]
    return {'valueRange':round(value_range,2),'pixelScale':scale or 1,'singlePixelRunShare':round(single_share,3),
            'feetRow':int(rows[-1])},warnings
