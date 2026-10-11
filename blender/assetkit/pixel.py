"""Deterministic palette and outline processing on rendered linear RGBA arrays."""
import numpy as np


def rgb(value):
    if not isinstance(value,str) or len(value)!=7 or value[0]!='#': raise ValueError('Colors use #rrggbb')
    c=np.array([int(value[i:i+2],16)/255 for i in (1,3,5)],dtype=np.float32)
    return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)


def process(sheet, cell_size, colors=16, palette=None, outline=None):
    if not 2<=colors<=32: raise ValueError('Pixel palettes use 2 to 32 colors')
    result=sheet.copy(); alpha=result[:,:,3]>=.5
    pixels=result[:,:,:3][alpha]
    if palette:
        if len(palette)>32: raise ValueError('Palette has too many colors')
        centers=np.array([rgb(c) for c in palette])
    elif len(pixels):
        sample=pixels[np.linspace(0,len(pixels)-1,min(4096,len(pixels)),dtype=int)]
        centers=np.unique(sample,axis=0)
        if len(centers)>colors:
            centers=centers[np.linspace(0,len(centers)-1,colors,dtype=int)]
            for _ in range(12):
                labels=np.square(sample[:,None,:]-centers[None,:,:]).sum(axis=2).argmin(axis=1)
                for i in range(len(centers)):
                    if np.any(labels==i): centers[i]=sample[labels==i].mean(axis=0)
    else: centers=np.zeros((1,3))
    if len(pixels):
        mapped=np.empty_like(pixels)
        for start in range(0,len(pixels),8192):
            chunk=pixels[start:start+8192]
            mapped[start:start+8192]=centers[np.square(chunk[:,None,:]-centers[None,:,:]).sum(axis=2).argmin(axis=1)]
        result[:,:,:3][alpha]=mapped
    result[:,:,3]=alpha.astype(np.float32); result[:,:,:3][~alpha]=0
    if outline:
        ink=rgb(outline)
        for y in range(0,len(result),cell_size):
            for x in range(0,result.shape[1],cell_size):
                cell=alpha[y:y+cell_size,x:x+cell_size]; expanded=np.zeros_like(cell)
                expanded[1:] |= cell[:-1]; expanded[:-1] |= cell[1:]; expanded[:,1:] |= cell[:,:-1]; expanded[:,:-1] |= cell[:,1:]
                border=expanded & ~cell
                result[y:y+cell_size,x:x+cell_size,:3][border]=ink
                result[y:y+cell_size,x:x+cell_size,3][border]=1
    return result
