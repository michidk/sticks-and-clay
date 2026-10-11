import math
import numpy as np

if __package__:
    from .materialcore import check, fracture_mask, linear, noise, scatter
else:
    from materialcore import check, fracture_mask, linear, noise, scatter

def build_material(params):
    p = check(params); n = p['size']; recipe = p['recipe']; seed = p['seed']
    mm_per_px = p['tileMetres'] * 1000 / n
    macro = noise(n, seed, 5)
    grain = noise(n, seed+1, min(n/3, p['tileMetres']*1000/max(p['featureMm']/8,1)))
    shape = macro*.12 + grain*.035
    variation = macro*.03 + grain*.02
    metal = np.zeros((n,n),np.float32)
    rough_delta=np.zeros((n,n),np.float32)
    warnings=[]
    counts = 0
    features = p['featureMm'] / mm_per_px
    if features < 1.5: warnings.append(f"Feature size {p['featureMm']} mm occupies {features:.2f} pixels; individual shapes are unresolved.")
    # Sample texel centres so a feature on a tile boundary has symmetric
    # coverage in its first and last texels, including subpixel board gaps.
    u,v = np.meshgrid((np.arange(n)+.5)/n,(np.arange(n)+.5)/n)
    if recipe == 'gravel':
        particles,regions,counts = scatter(n,seed+2,features,p['coverage'],p['burial'],p['sizeSpread'])
        shape += particles
        variation += regions
        fines=np.clip(1-particles*3,0,1)
        variation-=fines*.10
        rough_delta+=fines*.10-(1-fines)*.06
    elif recipe == 'sand':
        cycles = max(1,round(p['tileMetres']*1000/max(p['featureMm'],1)))
        phase=math.tau*cycles*u + .6*noise(n,seed+4,3)
        shape = .18*np.sin(phase)*(1+.15*macro) + grain*.04
        variation = grain*.018
    elif recipe == 'stone':
        cracks = fracture_mask(n,seed+2,round(n/max(features,2)),.04)
        shape -= cracks * p['coverage']*.7
        variation -= cracks*.08
    elif recipe == 'wood':
        cycles = max(2,round(p['tileMetres']*1000/max(p['featureMm'],1)))
        boards=max(2,round(p['tileMetres']*1000/120))
        board_id=np.floor(u*boards).astype(int)
        rng=np.random.default_rng(seed+9)
        tone=rng.uniform(-.12,.12,boards)[board_id]
        knots=np.zeros((n,n),np.float32)
        for _ in range(max(1,round(p['tileMetres']**2*3))):
            cx,cy=rng.random(2)
            dx=(u-cx+.5)%1-.5; dy=(v-cy+.5)%1-.5
            knots=np.maximum(knots,np.exp(-((dx/.025)**2+(dy/.045)**2)))
        rings = np.sin(math.tau*cycles*u + macro*.35+knots*5)
        edge=np.minimum((u*boards)%1,1-(u*boards)%1)
        gaps=np.exp(-edge*120)
        checks=np.maximum(0,noise(n,seed+12,cycles)-1.5)*p['wear']*.15
        shape = rings*.13 + grain*.015 - gaps*.5-checks
        variation = rings*.12 + grain*.012+tone-knots*.25-gaps*.2
        rough_delta+=gaps*.15+checks*.2+p['wear']*.05
    elif recipe == 'brick':
        rows = max(2,round(p['tileMetres']*1000/max(p['featureMm'],1)))
        rows += rows % 2
        cols = max(1,round(rows/2))
        row = np.floor(v*rows).astype(int)
        x = (u*cols+(row%2)*.5)%1; y=(v*rows)%1
        mortar = (np.minimum(x,1-x)<.045) | (np.minimum(y,1-y)<.065)
        unit=(row*cols+np.floor((u*cols+(row%2)*.5)%cols).astype(int))
        tone=np.random.default_rng(seed+8).uniform(-.18,.18,rows*cols)[unit]
        edge=np.minimum(np.minimum(x,1-x),np.minimum(y,1-y))
        damage=np.clip((.1-edge)*8,0,1)*np.clip(grain,0,1)*p['wear']
        shape = np.where(mortar,-.5,.35)-damage*.25+grain*.025
        variation = np.where(mortar,-.18,.05+tone)-damage*.09+macro*.035
        rough_delta+=mortar*.12+damage*.08
    else:
        field=noise(n,seed+2,max(2,n/max(features,2)))
        exposed = (field > (2.6-3.8*p['wear'])) & (p['wear']>0)
        scratches=(np.sin(math.tau*max(2,round(p['tileMetres']*40))*u+.25*macro)>.985)&(grain>.4)
        exposed |= scratches & (p['wear']>.15)
        metal = exposed.astype(np.float32)
        shape = grain*.015 - metal*.1
        variation = grain*.018 - metal*.12
    base = linear([int(p['color'][i:i+2],16)/255 for i in (1,3,5)])
    albedo = np.clip(base[None,None,:]*(1+variation[...,None]),.001,.95)
    if recipe == 'painted_metal':
        # Neutral reflective base color only on exposed metallic texels.
        albedo = np.where(metal[...,None]>.5, np.array([.56,.58,.6]),albedo)
    cavities=np.clip((shape.mean()-shape)*2,0,1)
    deposit=p['dirt']*cavities
    albedo=albedo*(1-deposit[...,None]*.4)+np.array([.09,.065,.04])*deposit[...,None]*.4
    albedo*=1-p['moisture']*.32
    roughness = np.clip(p['roughness'] + rough_delta + grain*.025 + deposit*.15 - p['moisture']*.35 - metal*.25,.05,1)
    metal*=1-deposit
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
        for radius_mm in np.geomspace(max(p['featureMm']/16,.5),max(p['featureMm'],2),6):
            step=max(1,radius_mm/mm_per_px)
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
                warnings=warnings+(['Particle count capped; requested density is not fully resolved.'] if counts==2048 else []))
