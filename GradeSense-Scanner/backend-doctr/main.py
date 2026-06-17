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


@app.get("/")
def read_root():
    return {"status": "ok", "message": "GradeSense DocTr & DocAligner Service"}


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "docaligner_loaded": aligner is not None,
        "doctr_loaded": doctr_loaded
    }


def refine_quad_edges(img, quad_corners, search_dist=10, num_samples=15):
    h, w, _ = img.shape
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    
    pts = np.array(quad_corners, dtype=np.float32)
    fitted_lines = []
    
    for i in range(4):
        p1 = pts[i]
        p2 = pts[(i + 1) % 4]
        
        v = p2 - p1
        length = np.linalg.norm(v)
        if length < 10:
            return quad_corners
            
        u = v / length
        n = np.array([-u[1], u[0]], dtype=np.float32)
        
        edge_points = []
        for t in np.linspace(0.1, 0.9, num_samples):
            s = p1 + t * v
            gradients = []
            positions = []
            
            for k in range(-search_dist, search_dist + 1):
                pos = s + k * n
                px, py = int(round(pos[0])), int(round(pos[1]))
                
                if 0 <= px < w and 0 <= py < h:
                    positions.append(pos)
                    pos_ahead = pos + n
                    pos_behind = pos - n
                    ax, ay = int(round(pos_ahead[0])), int(round(pos_ahead[1]))
                    bx, by = int(round(pos_behind[0])), int(round(pos_behind[1]))
                    
                    if 0 <= ax < w and 0 <= ay < h and 0 <= bx < w and 0 <= by < h:
                        # n points INSIDE the paper. So pos_ahead is inside, pos_behind is outside.
                        # We want a transition from bright inside (paper) to darker outside (background).
                        val_inside = float(gray[ay, ax])
                        val_outside = float(gray[by, bx])
                        if val_inside > 150 and val_inside > val_outside + 15:
                            grad = val_inside - val_outside
                        else:
                            grad = 0.0
                        gradients.append(grad)
                    else:
                        gradients.append(0.0)
                else:
                    gradients.append(0.0)
                    positions.append(pos)
            
            if gradients:
                max_idx = np.argmax(gradients)
                if gradients[max_idx] > 10:
                    edge_points.append(positions[max_idx])
                    
        if len(edge_points) >= num_samples // 2:
            edge_points = np.array(edge_points, dtype=np.float32)
            [vx, vy, x0, y0] = cv2.fitLine(edge_points, cv2.DIST_L2, 0, 0.01, 0.01)
            fitted_lines.append((float(vx), float(vy), float(x0), float(y0)))
        else:
            vx, vy = u[0], u[1]
            x0, y0 = p1[0], p1[1]
            fitted_lines.append((float(vx), float(vy), float(x0), float(y0)))
            
    refined_corners = []
    for i in range(4):
        vx1, vy1, x1, y1 = fitted_lines[(i - 1) % 4]
        vx2, vy2, x2, y2 = fitted_lines[i]
        
        A1, B1 = vy1, -vx1
        C1 = vy1 * x1 - vx1 * y1
        
        A2, B2 = vy2, -vx2
        C2 = vy2 * x2 - vx2 * y2
        
        det = A1 * B2 - A2 * B1
        if abs(det) > 1e-5:
            ix = (B2 * C1 - B1 * C2) / det
            iy = (A1 * C2 - A2 * C1) / det
            
            orig = pts[i]
            if np.hypot(ix - orig[0], iy - orig[1]) < search_dist * 1.5:
                refined_corners.append([float(ix), float(iy)])
            else:
                refined_corners.append([float(orig[0]), float(orig[1])])
        else:
            refined_corners.append([float(pts[i][0]), float(pts[i][1])])
            
    return refined_corners


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
        
        if corners_list is None or len(corners_list) != 4:
            return {
                "detected": False,
                "message": "No document detected or corner counts mismatched"
            }
            
        # Refine corners with local edge refinement
        # Bypassed to prevent bedsheet patterns and text gradients from warping/skewing deep learning corners.
        # try:
        #     refined_list = refine_quad_edges(img, corners_list)
        #     corners_list = refined_list
        # except Exception as ref_err:
        #     print(f"[WARNING-REFINEMENT] Edge refinement failed, using raw corners: {ref_err}")
            
        # Order the corners deterministically
        ordered = order_corners(corners_list)
        
        return {
            "detected": True,
            "corners": ordered,
            "width": w,
            "height": h
        }
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[ERROR-DETECTION] Exception in detect-corners:\n{tb}")
        raise HTTPException(status_code=500, detail=f"Exception: {str(e)}\n{tb}")


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
