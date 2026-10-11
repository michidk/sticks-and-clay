if __package__:
    from .materialcore import *
else:
    from materialcore import *

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
        expected=(p['size'],p['size'],3) if name in ('albedo','normal') else (p['size'],p['size'])
        if array.shape != expected: raise ValueError('Invalid channel dimensions: '+name)
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
    opposing=Image.new('RGB',(512,280),(244,241,232))
    labels=ImageDraw.Draw(opposing)
    for index,direction in enumerate((light,light*np.array([-1,-1,1]))):
        labels.text((index*256+8,8),'Light '+str(index+1),fill=(35,60,42))
        opposing.paste(image(srgb(shade(result['albedo'],normal,result['roughness'],result['metallic'],result['ao'],direction))).resize((256,256)),(index*256,24))
    opposing.save(out/'lighting.png')
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
