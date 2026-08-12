FROM python:3.11-slim

WORKDIR /app

# ติดตั้ง torch/torchvision รุ่น CPU-only ก่อน — เบากว่ารุ่น CUDA เต็มหลาย GB
# และ Hugging Face Spaces (CPU Basic ฟรี) ไม่มี GPU ให้ใช้อยู่แล้ว
RUN pip install --no-cache-dir torch==2.13.0 torchvision==0.28.0 \
    --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Hugging Face Spaces (Docker SDK) คาดว่าแอปจะฟังที่พอร์ต 7860 โดย default
EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
