FROM python:3.11-slim

WORKDIR /app

# Install system dependencies needed for OpenCV, PyTorch, wget, and SciPy compilation fallback
RUN apt-get update && apt-get install -y \
    wget \
    libgl1 \
    libglib2.0-0 \
    build-essential \
    gfortran \
    libopenblas-dev \
    liblapack-dev \
    pkg-config \
    libturbojpeg0 \
    libturbojpeg0-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file from backend-doctr
COPY backend-doctr/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# Download DocTr code scripts and model weights from Hugging Face Space repository
RUN mkdir -p model_pretrained
RUN wget -O GeoTr.py https://huggingface.co/spaces/HaoFeng2019/DocTr/resolve/main/GeoTr.py
RUN wget -O seg.py https://huggingface.co/spaces/HaoFeng2019/DocTr/resolve/main/seg.py
RUN wget -O position_encoding.py https://huggingface.co/spaces/HaoFeng2019/DocTr/resolve/main/position_encoding.py
RUN wget -O extractor.py https://huggingface.co/spaces/HaoFeng2019/DocTr/resolve/main/extractor.py
RUN wget -O model_pretrained/seg.pth https://huggingface.co/spaces/HaoFeng2019/DocTr/resolve/main/model_pretrained/seg.pth
RUN wget -O model_pretrained/geotr.pth https://huggingface.co/spaces/HaoFeng2019/DocTr/resolve/main/model_pretrained/geotr.pth

# Trigger DocAligner model download during docker build to cache it inside the image
RUN python -c "from docaligner import DocAligner; DocAligner(model_cfg='fastvit_sa24')"

# Copy main code from backend-doctr
COPY backend-doctr/main.py .

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
