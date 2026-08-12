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
#  LOAD CXR-AGE AI MODEL (DenseNet121)
# ==========================================
# หมายเหตุหน่วยความจำ: ไฟล์ checkpoint ต้นฉบับจาก fastai (~245MB) มี key 'opt' ติดมาด้วย
# ซึ่งคือ state ของ Adam optimizer (exp_avg/exp_avg_sq) ที่ไม่จำเป็นต้องใช้ตอน inference เลย
# แต่ทำให้ตอนโหลดพีคหน่วยความจำไปเกิน 512MB (พังบน hosting free tier ทั่วไปทันที)
# ไฟล์นี้ถูก re-save ไว้ล่วงหน้าให้เหลือแค่ state_dict ของโมเดล (87MB) ด้วยสคริปต์แยกต่างหาก
# ทำให้พีคหน่วยความจำตอนโหลด+รันจริงอยู่ที่ราว 425MB เท่านั้น
MODEL_PATH = "PLCO_Fine_Tuned_120419.pth"
device = torch.device("cpu") # รันบน CPU ได้สบายๆ

def load_cxr_model():
    # 1. สร้างโครงสร้าง DenseNet121
    model = models.densenet121(weights=None)

    # FastAI head มักจะเปลี่ยน output เป็น 1 (สำหรับการทำ Regression ทำนายอายุ)
    num_ftrs = model.classifier.in_features
    model.classifier = nn.Linear(num_ftrs, 1)

    try:
        # โหลด state_dict ที่ทำความสะอาดไว้ล่วงหน้าแล้ว (ไม่มี optimizer state ติดมา)
        # weights_only=True ทั้งประหยัดหน่วยความจำกว่าและปลอดภัยกว่า (ไม่ unpickle object ใดๆ นอกจาก tensor)
        clean_state_dict = torch.load(MODEL_PATH, map_location=device, weights_only=True)

        # โหลดเข้าโมเดลแบบยืดหยุ่น
        model.load_state_dict(clean_state_dict, strict=False)
        model.to(device)
        model.eval()
        print("✅ โหลด CXR-Age AI Model (DenseNet-121) สำเร็จ!")
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
                output = cxr_model(input_tensor)
                predicted_age = output.item()

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