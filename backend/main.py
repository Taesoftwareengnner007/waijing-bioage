from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import math
import io
import os
import sys
import torch
import torch.nn as nn
from torchvision import models, transforms


from PIL import Image

# จำกัด thread pool ของ torch ไว้ที่ 1 — เซิร์ฟเวอร์นี้รับทีละ request (ไม่ได้ทำ batch inference)
# การจำกัดไว้ช่วยลดหน่วยความจำที่เสียไปกับ thread-pool buffers โดยไม่กระทบความเร็วที่รับรู้ได้
torch.set_num_threads(1)

# บน Windows การรันผ่าน terminal ปกติ (cp1252) จะ crash ทันทีที่ print() เจอ emoji
# บังคับ stdout/stderr เป็น UTF-8 กันเซิร์ฟเวอร์ล่มตอนสตาร์ทอัพ
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

app = FastAPI(title="Biological Age API with Real AI")

# อนุญาต CORS สำหรับ Frontend
# ตั้งค่า ALLOWED_ORIGINS เป็น URL ของเว็บจริง (คั่นด้วย , ถ้ามีหลายโดเมน) ตอน deploy จริง
# เช่น ALLOWED_ORIGINS=https://waijing.vercel.app — ถ้าไม่ตั้งไว้ จะเปิดกว้างทุกโดเมน (เหมาะกับตอนพัฒนา/เดโมเท่านั้น)
_allowed_origins_env = os.environ.get("ALLOWED_ORIGINS", "*")
allowed_origins = ["*"] if _allowed_origins_env == "*" else [o.strip() for o in _allowed_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
#  LOAD CXR-AGE AI MODEL (ResNet-34, ไม่ใช่ DenseNet-121!)
# ==========================================
# เดิมโค้ดส่วนนี้เข้าใจผิดว่าไฟล์ checkpoint เป็น DenseNet-121 (ทั้งชื่อไฟล์และคอมเมนต์บอกแบบนั้น)
# แล้วสร้างโครงสร้าง classifier แบบ Linear ชั้นเดียวทับ — ผลคือ load_state_dict(strict=False)
# หา key ที่ตรงกันไม่เจอเลยสักตัว (0/237 keys) โมเดลจึงรันด้วยน้ำหนักสุ่มล้วนๆ มาตลอด
# (ตรวจสอบแล้วว่า strict=False กลืน error นี้แบบเงียบๆ ไม่มี exception ให้เห็น)
#
# ตรวจสอบ key names ในไฟล์จริงแล้วพบรูปแบบ conv1/bn1/conv2/bn2/downsample ซึ่งเป็นของ ResNet
# (ไม่ใช่ denselayer/norm1/norm2 แบบ DenseNet) จำนวน block ต่อ stage (3,4,6,3) ตรงกับ ResNet-34
# ส่วนหัว (head) เป็นแบบฉบับ fastai: AdaptiveConcatPool2d (max+avg pool ต่อกัน = 512*2 = 1024 มิติ)
# ตามด้วย Linear 1024→512→16→1 คั่นด้วย BatchNorm/ReLU/Dropout — ตรวจสอบกับ shape ของทุก key แล้ว
# ตรงกันเป๊ะ (0 missing_keys, 0 unexpected_keys) และทดสอบกับภาพ X-ray จริงจาก NIH ChestX-ray14
# 15 ภาพแล้วได้อายุที่สมเหตุสมผล (38-89 ปี, แปรผันตามภาพจริง) หลังผ่าน sigmoid ตามด้านล่าง
#
# หมายเหตุหน่วยความจำ: ไฟล์ checkpoint ต้นฉบับจาก fastai (~245MB) มี key 'opt' ติดมาด้วย
# ซึ่งคือ state ของ Adam optimizer (exp_avg/exp_avg_sq) ที่ไม่จำเป็นต้องใช้ตอน inference เลย
# แต่ทำให้ตอนโหลดพีคหน่วยความจำไปเกิน 512MB (พังบน hosting free tier ทั่วไปทันที)
# ไฟล์นี้ถูก re-save ไว้ล่วงหน้าให้เหลือแค่ state_dict ของโมเดล (87MB) ด้วยสคริปต์แยกต่างหาก
MODEL_PATH = "PLCO_Fine_Tuned_120419.pth"
device = torch.device("cpu") # รันบน CPU ได้สบายๆ


class AdaptiveConcatPool2d(nn.Module):
    """ต่อผลของ AdaptiveMaxPool2d และ AdaptiveAvgPool2d เข้าด้วยกัน (fastai's ทำแบบนี้เป็นค่าเริ่มต้น)"""
    def __init__(self, size=1):
        super().__init__()
        self.ap = nn.AdaptiveAvgPool2d(size)
        self.mp = nn.AdaptiveMaxPool2d(size)

    def forward(self, x):
        return torch.cat([self.mp(x), self.ap(x)], 1)


def build_cxr_age_model():
    resnet = models.resnet34(weights=None)
    # ตัด avgpool กับ fc เดิมทิ้ง เหลือ conv1, bn1, relu, maxpool, layer1-4
    body = nn.Sequential(*list(resnet.children())[:-2])

    head = nn.Sequential(
        AdaptiveConcatPool2d(1),
        nn.Flatten(),
        nn.BatchNorm1d(1024),
        nn.Dropout(0.25),
        nn.Linear(1024, 512),
        nn.ReLU(inplace=True),
        nn.BatchNorm1d(512),
        nn.Dropout(0.5),
        nn.Linear(512, 16),
        nn.ReLU(inplace=True),
        nn.BatchNorm1d(16),
        nn.Linear(16, 1),
    )
    return nn.Sequential(body, head)


def load_cxr_model():
    model = build_cxr_age_model()

    try:
        # weights_only=True ทั้งประหยัดหน่วยความจำกว่าและปลอดภัยกว่า (ไม่ unpickle object ใดๆ นอกจาก tensor)
        state_dict = torch.load(MODEL_PATH, map_location=device, weights_only=True)

        result = model.load_state_dict(state_dict, strict=True)
        model.to(device)
        model.eval()
        print("✅ โหลด CXR-Age AI Model (ResNet-34) สำเร็จ! (ทุก key ตรงกันหมด)")
        return model
    except Exception as e:
        print(f"⚠️ ไม่สามารถโหลดโมเดลได้ (จะใช้ค่าจำลองแทน): {e}")
        return None

# โหลดโมเดลขึ้น Memory เมื่อเริ่มสั่งรัน Server
cxr_model = load_cxr_model()

# Image Preprocessing Transform (สเปก 224x224 ตามเปเปอร์ CXR-Age)
img_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])


# ==========================================
# 🩸 1. API: PHENOAGE (BLOOD LABS)
# ==========================================
class BloodData(BaseModel):
    chronological_age: float = Field(..., gt=0, lt=120)
    albumin: float = Field(..., gt=0)
    creatinine: float = Field(..., gt=0)
    glucose: float = Field(..., gt=0)
    crp: float = Field(..., gt=0)
    lymphocyte_percent: float = Field(..., gt=0, le=100)
    mcv: float = Field(..., gt=0)
    rdw: float = Field(..., gt=0)
    wbc: float = Field(..., gt=0)
    alp: float = Field(..., gt=0)

@app.post("/api/v1/predict/phenoage")
def predict_phenoage(data: BloodData):
    # หน่วยที่สูตรต้องการ (ตาม Liu et al. PLoS Medicine 2018, ฉบับแก้ไข 2019):
    # Albumin g/L · Creatinine µmol/L · Glucose mmol/L · CRP mg/dL (ln)
    # แล็บไทยมักรายงาน g/dL, mg/dL, mg/dL, mg/L ตามลำดับ จึงแปลงหน่วยแบบยืดหยุ่น
    # (ค่าฐานเดิม, ค่าที่แปลงแล้ว) โดยเดาจากช่วงค่าปกติทางคลินิก
    albumin_g_l = data.albumin * 10.0 if data.albumin < 15 else data.albumin
    creatinine_umol = data.creatinine * 88.4 if data.creatinine < 20 else data.creatinine
    glucose_mmol = data.glucose / 18.0182 if data.glucose > 20 else data.glucose
    crp_mg_dl = data.crp / 10.0 if data.crp > 0.5 else data.crp

    if crp_mg_dl <= 0:
        raise HTTPException(status_code=400, detail="CRP ต้องมากกว่า 0 — ตรวจสอบหน่วย (มักรายงานเป็น mg/L)")

    ln_crp = math.log(crp_mg_dl)

    # สัมประสิทธิ์ทั้งหมดอ้างอิงฉบับแก้ไข 2019 (ไม่ใช่ต้นฉบับ 2018 ซึ่งพิมพ์ glucose และ RDW ผิด)
    xb = (
        -19.907
        - 0.0336 * albumin_g_l
        + 0.0095 * creatinine_umol
        + 0.1953 * glucose_mmol
        + 0.0954 * ln_crp
        - 0.0120 * data.lymphocyte_percent
        + 0.0268 * data.mcv
        + 0.3306 * data.rdw
        + 0.00188 * data.alp
        + 0.0554 * data.wbc
        + 0.0804 * data.chronological_age
    )

    # ขั้นที่ 2: แปลง xb เป็นความเสี่ยงเสียชีวิตใน 120 เดือน (M)
    gamma = 0.0076927
    exp_xb = math.exp(xb)
    mortality_score = 1 - math.exp(-1.51714 * exp_xb / gamma)

    if mortality_score >= 1:
        raise HTTPException(
            status_code=400,
            detail="คำนวณไม่ได้ (ค่าความเสี่ยงเกิน 1) — ตรวจสอบว่าใส่หน่วยถูกต้องหรือไม่ (ดูตารางแปลงหน่วยในเอกสารประกอบ)"
        )

    # ขั้นที่ 3: แปลง M กลับเป็นอายุ (ปี)
    val = -0.00553 * math.log(1 - mortality_score)
    pheno_age = 141.50 + (math.log(val) / 0.09165)

    return {
        "status": "success",
        "chronological_age": data.chronological_age,
        "pheno_age": round(pheno_age, 2),
        "age_delta": round(pheno_age - data.chronological_age, 2)
    }


# ==========================================
# 🫁 2. API: CXR-AGE (REAL AI IMAGE PROCESSING)
# ==========================================
@app.post("/api/v1/predict/cxr-age")
async def predict_cxr_age(file: UploadFile = File(...), chronological_age: float | None = Form(None)):
    try:
        # อ่านไฟล์รูปภาพที่อัปโหลดเข้ามา
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert('RGB')

        if cxr_model is not None:
            # แปลงภาพด้วย Transform แล้วส่งให้ AI ประมวลผล
            input_tensor = img_transform(image).unsqueeze(0).to(device)
            with torch.no_grad():
                raw_output = cxr_model(input_tensor).item()

            # โมเดลนี้เทรนให้ output ดิบเป็นค่าที่ต้องผ่าน sigmoid แล้วคูณ 100 ถึงจะได้อายุเป็นปี
            # (ตรวจสอบแล้วด้วยภาพ X-ray จริง 15 ภาพจาก NIH ChestX-ray14 — ถ้าใช้ output ดิบตรงๆ
            # จะได้ค่าใกล้ 0 ปีเสมอไม่ว่าภาพจะเป็นอะไร เพราะ output ดิบมีสเกลเล็กมาก [-2, 2] โดยประมาณ)
            predicted_age = 100.0 / (1.0 + math.exp(-raw_output))

            result = {
                "status": "success",
                "filename": file.filename,
                "cxr_biological_age": round(predicted_age, 2),
                # หมายเหตุ: โมเดลนี้ทำนายค่าตัวเลข (regression) ไม่ได้ให้ค่า "ความมั่นใจ" ทางสถิติมาด้วย
                # การแสดงเลข confidence แบบตายตัวในเวอร์ชันก่อนหน้าเป็นค่าที่ไม่มีที่มา จึงตัดออก
            }
        else:
            # Fallback หากหาไฟล์โมเดล .pth ไม่เจอ — ต้องระบุให้ชัดว่าไม่ใช่ผลจาก AI จริง
            result = {
                "status": "warning",
                "message": "ไม่พบไฟล์โมเดล CXR-Age (.pth) บนเซิร์ฟเวอร์ — นี่คือค่าจำลอง ไม่ใช่ผลจาก AI จริง",
                "filename": file.filename,
                "cxr_biological_age": None,
            }

        if chronological_age is not None and result.get("cxr_biological_age") is not None:
            result["chronological_age"] = chronological_age
            result["age_delta"] = round(result["cxr_biological_age"] - chronological_age, 2)

        return result

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"เกิดข้อผิดพลาดในการประมวลผลรูปภาพ: {str(e)}")