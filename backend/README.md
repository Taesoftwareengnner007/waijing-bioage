---
title: Waijing BioAge API
emoji: 🧬
colorFrom: green
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# วัยจริง | WAIJING — Backend API

FastAPI backend สำหรับคำนวณอายุชีวภาพ:

- `POST /api/v1/predict/phenoage` — คำนวณ PhenoAge จากผลเลือด 9 ค่า (Liu, Levine et al., PLoS Medicine 2018, ฉบับแก้ไข 2019)
- `POST /api/v1/predict/cxr-age` — คำนวณอายุจากภาพเอกซเรย์ทรวงอกด้วยโมเดล DenseNet-121 (CXR-Age, Raghu et al. 2021)

## รันบนเครื่องตัวเอง

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

## ตัวแปรแวดล้อม (env vars)

| ชื่อ | ค่าเริ่มต้น | ใช้ทำอะไร |
|---|---|---|
| `ALLOWED_ORIGINS` | `*` (เปิดทุกโดเมน) | โดเมนของ frontend ที่อนุญาตให้เรียก API ได้ (คั่นด้วย `,` ถ้ามีหลายโดเมน) — ตอน deploy จริงควรตั้งเป็น URL ของเว็บจริงเท่านั้น |

ไม่ใช่เครื่องมือวินิจฉัยทางการแพทย์ — ดูรายละเอียดข้อจำกัดใน disclaimer ของหน้าเว็บ
