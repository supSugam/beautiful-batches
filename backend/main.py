from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import os
from pathlib import Path
from PIL import Image
from io import BytesIO

app = FastAPI()

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
