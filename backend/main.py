import json
from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict
import os
import zipfile
from pathlib import Path
from PIL import Image
from io import BytesIO

app = FastAPI()
# ... (existing middleware and cache)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory thumbnail cache
_thumb_cache = {}


class CropRequest(BaseModel):
    files: List[str]
    x: int
    y: int
    width: int
    height: int
    output_dir: Optional[str] = None


@app.get("/")
def read_root():
    return {"status": "ok", "app": "Beautiful Datasets"}


@app.get("/api/images")
def list_images(
    path: str = Query(...),
    recursive: bool = True,
    page: int = 1,
    page_size: int = 0,
):
    if not os.path.exists(path) or not os.path.isdir(path):
        raise HTTPException(status_code=404, detail="Directory not found")

    images = []
    valid_ext = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tiff", ".tif"}

    try:
        if recursive:
            for root, _, files in os.walk(path):
                for f in files:
                    if Path(f).suffix.lower() in valid_ext:
                        rel = str(Path(root, f).relative_to(path))
                        images.append(rel)
        else:
            for entry in os.scandir(path):
                if entry.is_file() and Path(entry.path).suffix.lower() in valid_ext:
                    images.append(entry.name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    images.sort()
    total = len(images)

    if page_size > 0:
        start = (page - 1) * page_size
        images = images[start : start + page_size]

    return {"path": path, "images": images, "total": total, "page": page}


@app.get("/api/thumb")
def get_thumbnail(path: str = Query(...), size: int = 200):
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Image not found")

    cache_key = f"{path}:{size}:{os.path.getmtime(path)}"

    if cache_key in _thumb_cache:
        return StreamingResponse(BytesIO(_thumb_cache[cache_key]), media_type="image/jpeg")

    try:
        with Image.open(path) as img:
            img.thumbnail((size, size), Image.LANCZOS)
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            buf = BytesIO()
            img.save(buf, format="JPEG", quality=80)
            data = buf.getvalue()
            _thumb_cache[cache_key] = data
            return StreamingResponse(BytesIO(data), media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/image")
def get_image(path: str = Query(...)):
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path)


@app.post("/api/process-bulk")
async def process_bulk(
    files: List[UploadFile] = File(...),
    config: str = Form(...) # JSON string
):
    try:
        cfg = json.loads(config)
        # cfg: { "format": "png", "quality": 90, "crops": { "id": { coordinates, transforms } } }
        
        output_format = cfg.get("format", "png").upper()
        if output_format == "JPG":
            output_format = "JPEG"
        quality = cfg.get("quality", 90)
        crops = cfg.get("crops", {})

        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
            for upload_file in files:
                # We use the filename as the key to match with crops data
                # Frontend should ensure filenames are unique or we use a mapping
                filename = upload_file.filename
                
                # Try to find crop data by filename or some ID
                # In this setup, we'll assume the frontend sends IDs as filenames or we match by index
                # Let's assume the frontend sends a mapping: { filename: crop_data }
                img_data = crops.get(filename)
                
                contents = await upload_file.read()
                img = Image.open(BytesIO(contents))
                
                if img_data:
                    coords = img_data.get("coordinates")
                    transforms = img_data.get("transforms", {})
                    rotate = transforms.get("rotate", 0)
                    flip = transforms.get("flip", {"horizontal": False, "vertical": False})
                    
                    # 1. Apply Transforms
                    if rotate != 0:
                        img = img.rotate(-rotate, expand=True) # Pillow rotate is counter-clockwise
                    if flip.get("horizontal"):
                        img = img.transpose(Image.FLIP_LEFT_RIGHT)
                    if flip.get("vertical"):
                        img = img.transpose(Image.FLIP_TOP_BOTTOM)
                    
                    # 2. Apply Crop
                    if coords:
                        # Pillow crop is (left, top, right, bottom)
                        img = img.crop((
                            coords["left"],
                            coords["top"],
                            coords["left"] + coords["width"],
                            coords["top"] + coords["height"]
                        ))

                # Save to buffer
                img_buffer = BytesIO()
                # Handle alpha channel for JPEG
                if output_format == "JPEG" and img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                
                img.save(img_buffer, format=output_format, quality=quality)
                
                # Add to ZIP
                ext = ".jpg" if output_format == "JPEG" else f".{output_format.lower()}"
                zip_file.writestr(f"{Path(filename).stem}{ext}", img_buffer.getvalue())

        zip_buffer.seek(0)
        return StreamingResponse(
            zip_buffer,
            media_type="application/x-zip-compressed",
            headers={"Content-Disposition": f"attachment; filename=processed_images.zip"}
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/crop")
def crop_images(request: CropRequest):
    processed = []
    errors = []

    output_dir = request.output_dir
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    for file_path in request.files:
        try:
            with Image.open(file_path) as img:
                cropped = img.crop((
                    request.x,
                    request.y,
                    request.x + request.width,
                    request.y + request.height,
                ))
                p = Path(file_path)
                if output_dir:
                    new_path = Path(output_dir) / p.name
                else:
                    new_path = p.parent / f"{p.stem}_cropped{p.suffix}"
                cropped.save(new_path)
                processed.append(str(new_path))
        except Exception as e:
            errors.append({"file": file_path, "error": str(e)})

    return {"processed": processed, "errors": errors}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
