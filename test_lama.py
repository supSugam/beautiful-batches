import cv2
import numpy as np
from PIL import Image
from iopaint.model_manager import ModelManager
from iopaint.schema import InpaintRequest

device = "cpu"
model = ModelManager(name="lama", device=device)
# Create a pure blue RGB image [R=0, G=0, B=255]
img = np.zeros((100, 100, 3), dtype=np.uint8)
img[:, :] = [0, 0, 255] 
mask = np.zeros((100, 100), dtype=np.uint8)
mask[20:80, 20:80] = 255

req = InpaintRequest()
res = model(img, mask, req)

# Print center color of the output
print("Input center color:", img[50, 50])
print("Output center color:", res[50, 50])
