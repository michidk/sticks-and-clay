"""Normalize a BMP starting image using the workshop's Pillow dependency."""
import sys
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 40_000_000
with Image.open(sys.argv[1]) as image:
    if image.width * image.height > 40_000_000:
        raise ValueError('Starting image exceeds 40 million pixels')
    image = ImageOps.exif_transpose(image).convert('RGBA')
    image.thumbnail((2048, 2048))
    image.save(sys.argv[2], 'PNG')
