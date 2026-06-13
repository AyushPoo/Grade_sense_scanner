import io
import os
import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from docaligner import DocAligner

app = FastAPI(title="GradeSense DocTr & DocAligner Service")

# ----------------- DOCALIGNER INITIALIZATION -----------------
# We use the highly accurate fastvit_sa24 model
try:
    aligner = DocAligner(model_cfg='fastvit_sa24')
except Exception as e:
    print(f"Error loading DocAligner model: {e}")
    aligner = None

# ----------------- DOCTR MODEL LOAD -----------------
# DocTr requires U2NETP and GeoTr helper scripts downloaded by Dockerfile
try:
    from seg import U2NETP
    from GeoTr import GeoTr
    
    class GeoTr_Seg(nn.Module):
        def __init__(self):
            super(GeoTr_Seg, self).__init__()
            self.msk = U2NETP(3, 1)
            self.GeoTr = GeoTr(num_attn_layers=6)

        def forward(self, x):
            msk, _1, _2, _3, _4, _5, _6 = self.msk(x)
            msk = (msk > 0.5).float()
            x = msk * x
            bm = self.GeoTr(x)
            bm = (2 * (bm / 286.8) - 1) * 0.99
            return bm

    def reload_model(model, path=""):
        if not bool(path):
            return model
        model_dict = model.state_dict()
        pretrained_dict = torch.load(path, map_location='cpu')
        pretrained_dict = {k[7:]: v for k, v in pretrained_dict.items() if k[7:] in model_dict}
        model_dict.update(pretrained_dict)
        model.load_state_dict(model_dict)
        return model

    def reload_segmodel(model, path=""):
        if not bool(path):
            return model
        model_dict = model.state_dict()
        pretrained_dict = torch.load(path, map_location='cpu')
        pretrained_dict = {k[6:]: v for k, v in pretrained_dict.items() if k[6:] in model_dict}
        model_dict.update(pretrained_dict)
        model.load_state_dict(model_dict)
        return model

    # Initialize and load weights
    GeoTr_Seg_model = GeoTr_Seg()
    reload_segmodel(GeoTr_Seg_model.msk, './model_pretrained/seg.pth')
    reload_model(GeoTr_Seg_model.GeoTr, './model_pretrained/geotr.pth')
    GeoTr_Seg_model.eval()
    
    # Compile model for PyTorch 2.x acceleration
    # GeoTr_Seg_model = torch.compile(GeoTr_Seg_model)
    doctr_loaded = True
except Exception as e:
    print(f"Error loading DocTr models: {e}")
    doctr_loaded = False


# Helper function to order corners: Top-Left, Top-Right, Bottom-Right, Bottom-Left
def order_corners(pts):
    pts = np.array(pts, dtype="float32")
    sums = pts.sum(axis=1)
    diffs = np.diff(pts, axis=1).flatten()
    
    tl = pts[np.argmin(sums)]
    br = pts[np.argmax(sums)]
    tr = pts[np.argmin(diffs)]
    bl = pts[np.argmax(diffs)]
    
    return {
        "topLeft": {"x": float(tl[0]), "y": float(tl[1])},
        "topRight": {"x": float(tr[0]), "y": float(tr[1])},
        "bottomRight": {"x": float(br[0]), "y": float(br[1])},
        "bottomLeft": {"x": float(bl[0]), "y": float(bl[1])}
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "docaligner_loaded": aligner is not None,
        "doctr_loaded": doctr_loaded
    }


@app.post("/detect-corners")
async def detect_corners(file: UploadFile = File(...)):
    if aligner is None:
        raise HTTPException(status_code=500, detail="DocAligner model not loaded")
        
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail="Could not decode image")
            
        h, w, _ = img.shape
        
        # DocAligner prediction
        # Returns a list of 4 points [[x, y], [x, y], [x, y], [x, y]]
        corners_list = aligner(img)
        
        if not corners_list or len(corners_list) != 4:
            return {
                "detected": False,
                "message": "No document detected or corner counts mismatched"
            }
            
        # Order the corners deterministically
        ordered = order_corners(corners_list)
        
        return {
            "detected": True,
            "corners": ordered,
            "width": w,
            "height": h
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/dewarp")
async def dewarp_image(file: UploadFile = File(...)):
    if not doctr_loaded:
        raise HTTPException(status_code=500, detail="DocTr model not loaded")
        
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail="Could not decode image")
            
        h, w, _ = img.shape
        
        # Prepare image for DocTr (RGB, normalized, 288x288)
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        im_ori = img_rgb / 255.0
        im = cv2.resize(im_ori, (288, 288))
        im = im.transpose(2, 0, 1)
        im = torch.from_numpy(im).float().unsqueeze(0)
        
        # Run inference
        with torch.no_grad():
            bm = GeoTr_Seg_model(im)
            bm = bm.cpu()
            bm0 = cv2.resize(bm[0, 0].numpy(), (w, h))
            bm1 = cv2.resize(bm[0, 1].numpy(), (w, h))
            bm0 = cv2.blur(bm0, (3, 3))
            bm1 = cv2.blur(bm1, (3, 3))
            lbl = torch.from_numpy(np.stack([bm0, bm1], axis=2)).unsqueeze(0)
            
            # Apply grid sampling to warp/dewarp original image
            img_ori_tensor = torch.from_numpy(im_ori).permute(2, 0, 1).unsqueeze(0).float()
            out = F.grid_sample(img_ori_tensor, lbl, align_corners=True)
            
            # Convert back to numpy uint8
            img_geo = ((out[0] * 255).permute(1, 2, 0).numpy()).astype(np.uint8)
            img_geo_bgr = cv2.cvtColor(img_geo, cv2.COLOR_RGB2BGR)
            
        # Encode back to JPEG and return
        _, buffer = cv2.imencode('.jpg', img_geo_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
        return StreamingResponse(io.BytesIO(buffer.tobytes()), media_type="image/jpeg")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
