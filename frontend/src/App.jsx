import React, { useState } from 'react';

// URL ของ backend — ตั้งค่า VITE_API_URL ใน .env (หรือใน dashboard ของ hosting ที่ deploy จริง)
// ถ้าไม่ตั้งไว้ จะ fallback ไปที่ localhost:8000 สำหรับตอนพัฒนาบนเครื่อง
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

export default function App() {

  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'blood', 'cxr'



  // --- State สำหรับ PhenoAge (ผลเลือด 9 ค่า) ---

  const [bloodData, setBloodData] = useState({

    chronological_age: 20,

    albumin: 4.5,

    creatinine: 0.9,

    glucose: 90,

    crp: 0.1,

    lymphocyte_percent: 30,

    mcv: 88,

    rdw: 13,

    wbc: 6.5,

    alp: 65,

  });

  const [phenoResult, setPhenoResult] = useState(null);



  // --- State สำหรับ CXR-Age (ภาพ X-ray) ---

  const [selectedFile, setSelectedFile] = useState(null);

  const [previewUrl, setPreviewUrl] = useState(null);

  const [cxrChronoAge, setCxrChronoAge] = useState(20);

  const [cxrResult, setCxrResult] = useState(null);



  // --- State สำหรับการโหลดและข้อผิดพลาด ---

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');



  // --- Consent (PDPA) — เป็นสถานะฝั่งไคลเอนต์ในหน้าจอนี้เท่านั้น ไม่ถูกส่งหรือบันทึกที่ใดทั้งสิ้น ---

  const [consentChecked, setConsentChecked] = useState(false);



  // 🩸 1. ส่งข้อมูลผลเลือด 9 ค่าไป FastAPI

  const handleBloodSubmit = async (e) => {

    e.preventDefault();

    setLoading(true);

    setError('');

    try {

      const response = await fetch(`${API_URL}/api/v1/predict/phenoage`, {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify(bloodData),

      });

      const data = await response.json();

      if (!response.ok) {

        throw new Error(data.detail || 'คำนวณ PhenoAge ไม่สำเร็จ — ตรวจสอบค่าที่กรอกและหน่วยอีกครั้ง');

      }

      setPhenoResult(data);

    } catch (err) {

      setError(err.message || 'เกิดข้อผิดพลาดในการคำนวณผลเลือด กรุณาตรวจสอบว่า Backend รันอยู่หรือไม่');

    } finally {

      setLoading(false);

    }

  };



  // 🫁 2. ส่งภาพ X-ray ไปให้ AI (DenseNet-121) ประมวลผล

  const handleCxrSubmit = async (e) => {

    e.preventDefault();

    if (!selectedFile) return;

    setLoading(true);

    setError('');



    const formData = new FormData();

    formData.append('file', selectedFile);

    formData.append('chronological_age', cxrChronoAge);



    try {

      const response = await fetch(`${API_URL}/api/v1/predict/cxr-age`, {

        method: 'POST',

        body: formData,

      });

      const data = await response.json();

      if (!response.ok) {

        throw new Error(data.detail || 'ประมวลผลภาพเอกซเรย์ไม่สำเร็จ');

      }

      setCxrResult(data);

    } catch (err) {

      setError(err.message || 'เกิดข้อผิดพลาดในการประมวลผลรูปภาพ');

    } finally {

      setLoading(false);

    }

  };



  // "อายุร่างกายเบื้องต้น" — ค่าเฉลี่ยอย่างง่ายของสององค์ประกอบ (ยังไม่ได้ถ่วงน้ำหนัก/ปรับเทียบกับ
  // ประชากรไทย) งานวิจัยที่ทีมอ้างอิง (Tian et al., Nature Medicine 2023) ระบุชัดว่าการเอาอายุสองค่า
  // มาบวกหารสองตรงๆ ไม่ถูกต้อง เพราะสเกลของแต่ละฝั่งกระจายไม่เท่ากัน วิธีที่ถูกต้อง (หัก regression
  // bias + z-score ต่ออวัยวะ) ต้องมี "ประชากรอ้างอิงคนไทย" ซึ่งทีมยังไม่มี ค่านี้จึงเป็นเพียงตัวเลข
  // สื่อสารเบื้องต้น ไม่ใช่คะแนนทางคลินิกที่ผ่านการ validate
  const hasBothResults = Boolean(phenoResult && cxrResult);
  const hasAnyResult = Boolean(phenoResult || cxrResult);

  const overallBioAge = hasBothResults
    ? (phenoResult.pheno_age + cxrResult.cxr_biological_age) / 2
    : phenoResult ? phenoResult.pheno_age
    : cxrResult ? cxrResult.cxr_biological_age : null;

  const overallRefAge = phenoResult ? phenoResult.chronological_age : (cxrResult ? cxrResult.chronological_age : bloodData.chronological_age);

  const ageDeltaOverall = overallBioAge !== null ? (overallBioAge - overallRefAge).toFixed(1) : null;



  // สัดส่วนจริงที่แต่ละสัญญาณ "ดึง" อายุร่างกายออกจากอายุจริง — ใช้ขับกราฟ Organ Flow และแท่งกราฟ

  // (ไม่ใช่ตัวเลขสมมติแบบเดิม คำนวณจาก |age_delta| ของแต่ละฝั่งเทียบผลรวมทั้งสองฝั่ง)

  const phenoAbsDelta = phenoResult ? Math.abs(phenoResult.age_delta) : 0;

  const cxrAbsDelta = cxrResult ? Math.abs(cxrResult.age_delta) : 0;

  const totalAbsDelta = phenoAbsDelta + cxrAbsDelta;

  let phenoSharePct = 0;

  let cxrSharePct = 0;

  if (hasBothResults) {

    if (totalAbsDelta === 0) {

      phenoSharePct = 50;

      cxrSharePct = 50;

    } else {

      phenoSharePct = Math.round((phenoAbsDelta / totalAbsDelta) * 100);

      cxrSharePct = 100 - phenoSharePct;

    }

  } else if (phenoResult) {

    phenoSharePct = 100;

  } else if (cxrResult) {

    cxrSharePct = 100;

  }



  // ชื่อตัวแปรภาษาไทย

  const fieldLabels = {

    chronological_age: 'Chronological Age (อายุจริง)',

    albumin: 'Albumin (อัลบูมิน)',

    creatinine: 'Creatinine (ครีอะทีนีน)',

    glucose: 'Glucose (น้ำตาลในเลือด)',

    crp: 'CRP (การอักเสบ)',

    lymphocyte_percent: 'Lymphocyte %',

    mcv: 'MCV (ขนาดเม็ดเลือดแดง)',

    rdw: 'RDW (การกระจายเม็ดเลือด)',

    wbc: 'WBC (ปริมาณเม็ดเลือดขาว)',

    alp: 'ALP (อัลคาไลน์ ฟอสฟาเตส)',

  };



  return (

    <div style={{

      minHeight: '100vh',

      background: '#f4fbf7',

      fontFamily: "'SF Thonburi', -apple-system, sans-serif",

      color: '#0f172a',

      display: 'flex',

      width: '100vw',

      overflowX: 'hidden'

    }}>

     

      {/* 1. DESKTOP SIDEBAR (เมนูฝั่งซ้าย) */}

      <aside style={{

        width: '280px',

        background: '#ffffff',

        borderRight: '1px solid #e2e8f0',

        padding: '32px 24px',

        display: 'flex',

        flexDirection: 'column',

        justifyContent: 'space-between',

        height: '100vh',

        position: 'sticky',

        top: 0,

        boxSizing: 'border-box'

      }}>

        <div>

          {/* Logo Brand */}

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '40px' }}>

            <img

              src="/waijing-logo.png"

              alt="วัยจริง | WAIJING"

              style={{

                width: '42px',

                height: '42px',

                borderRadius: '12px',

                objectFit: 'cover',

                boxShadow: '0 8px 16px rgba(16, 185, 129, 0.3)'

              }}

            />

            <div>

              <h1 style={{ fontSize: '18px', fontWeight: '800', margin: 0, color: '#0f172a', letterSpacing: '-0.3px' }}>

                วัยจริง | WAIJING

              </h1>

              <span style={{ fontSize: '11px', color: '#10b981', fontWeight: '700' }}>Desktop Dashboard</span>

            </div>

          </div>



          {/* Navigation Links */}

          <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

            <button

              onClick={() => setActiveTab('dashboard')}

              style={{

                display: 'flex',

                alignItems: 'center',

                gap: '12px',

                padding: '14px 18px',

                borderRadius: '16px',

                border: 'none',

                background: activeTab === 'dashboard' ? '#10b981' : 'transparent',

                color: activeTab === 'dashboard' ? '#ffffff' : '#64748b',

                fontSize: '14px',

                fontWeight: '700',

                cursor: 'pointer',

                textAlign: 'left',

                transition: 'all 0.2s',

                boxShadow: activeTab === 'dashboard' ? '0 10px 20px -4px rgba(16, 185, 129, 0.4)' : 'none'

              }}

            >

              <span style={{ fontSize: '18px' }}></span> Overview Statistics

            </button>



            <button

              onClick={() => setActiveTab('blood')}

              style={{

                display: 'flex',

                alignItems: 'center',

                gap: '12px',

                padding: '14px 18px',

                borderRadius: '16px',

                border: 'none',

                background: activeTab === 'blood' ? '#10b981' : 'transparent',

                color: activeTab === 'blood' ? '#ffffff' : '#64748b',

                fontSize: '14px',

                fontWeight: '700',

                cursor: 'pointer',

                textAlign: 'left',

                transition: 'all 0.2s',

                boxShadow: activeTab === 'blood' ? '0 10px 20px -4px rgba(16, 185, 129, 0.4)' : 'none'

              }}

            >

              <span style={{ fontSize: '18px' }}></span> PhenoAge (Blood Test)

            </button>



            <button

              onClick={() => setActiveTab('cxr')}

              style={{

                display: 'flex',

                alignItems: 'center',

                gap: '12px',

                padding: '14px 18px',

                borderRadius: '16px',

                border: 'none',

                background: activeTab === 'cxr' ? '#10b981' : 'transparent',

                color: activeTab === 'cxr' ? '#ffffff' : '#64748b',

                fontSize: '14px',

                fontWeight: '700',

                cursor: 'pointer',

                textAlign: 'left',

                transition: 'all 0.2s',

                boxShadow: activeTab === 'cxr' ? '0 10px 20px -4px rgba(16, 185, 129, 0.4)' : 'none'

              }}

            >

              <span style={{ fontSize: '18px' }}></span> CXR-Age (AI X-Ray)

            </button>

            <button

              onClick={() => setActiveTab('summary')}

              style={{

                display: 'flex',

                alignItems: 'center',

                gap: '12px',

                padding: '14px 18px',

                borderRadius: '16px',

                border: 'none',

                background: activeTab === 'summary' ? '#10b981' : 'transparent',

                color: activeTab === 'summary' ? '#ffffff' : '#64748b',

                fontSize: '14px',

                fontWeight: '700',

                cursor: 'pointer',

                textAlign: 'left',

                transition: 'all 0.2s',

                boxShadow: activeTab === 'summary' ? '0 10px 20px -4px rgba(16, 185, 129, 0.4)' : 'none'

              }}

            >

              <span style={{ fontSize: '18px' }}>🖨️</span> ใบสรุปผล (Print)

            </button>

          </nav>

        </div>



        {/* User Card Bottom Sidebar */}

        <div style={{

          background: '#f8fafc',

          padding: '16px',

          borderRadius: '20px',

          border: '1px solid #f1f5f9',

          display: 'flex',

          alignItems: 'center',

          gap: '12px'

        }}>

          <div style={{

            width: '40px',

            height: '40px',

            borderRadius: '50%',

            background: '#e2e8f0',

            display: 'flex',

            alignItems: 'center',

            justifyContent: 'center',

            fontSize: '18px'

          }}>

            👤

          </div>

          <div>

            <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a' }}>BUk KungFu</div>

            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Patient ID: #9239</span>

          </div>

        </div>

      </aside>



      {/* 2. MAIN CONTENT AREA (เนื้อหาฝั่งขวาเต็มหน้าจอคอม) */}

      <main style={{

        flex: 1,

        padding: '40px 48px',

        overflowY: 'auto',

        maxHeight: '100vh',

        boxSizing: 'border-box'

      }}>

       

        {/* Top Header Bar */}

        <header style={{

          display: 'flex',

          justifyContent: 'space-between',

          alignItems: 'center',

          marginBottom: '36px'

        }}>

          <div>

            <h2 style={{ fontSize: '28px', fontWeight: '800', color: '#0f172a', margin: '0 0 6px 0', letterSpacing: '-0.5px' }}>

              {activeTab === 'dashboard' ? 'Health Analytics Dashboard' : activeTab === 'blood' ? 'PhenoAge Blood Test Analysis' : activeTab === 'cxr' ? 'CXR-Age AI Model Assessment' : 'ใบสรุปผลสำหรับผู้รับบริการ'}

            </h2>

            <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>

              ระบบประเมินและวิเคราะห์อายุชีวภาพด้วย AI และดัชนีชี้วัดทางการแพทย์

            </p>

          </div>



          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>

            <div style={{

              background: '#ffffff',

              padding: '10px 18px',

              borderRadius: '999px',

              border: '1px solid #e2e8f0',

              display: 'flex',

              alignItems: 'center',

              gap: '8px',

              fontSize: '13px',

              fontWeight: '700',

              color: '#0f172a'

            }}>

              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></span>

              FastAPI System Connected

            </div>

          </div>

        </header>



        {error && (

          <div style={{ background: '#fef2f2', border: '1px solid #fecdd3', color: '#dc2626', padding: '14px 20px', borderRadius: '16px', fontSize: '14px', marginBottom: '24px', fontWeight: '600' }}>

            ⚠️ {error}

          </div>

        )}

        {/* Disclaimer แสดงทุกหน้า ตามข้อ 8.3 ของข้อเสนอโครงการ — ไม่ใช่เครื่องมือวินิจฉัย และข้อมูลสุขภาพเป็นข้อมูลอ่อนไหวตาม PDPA */}
        <div style={{
          background: '#fffbeb',
          border: '1px solid #fde68a',
          color: '#92400e',
          padding: '14px 20px',
          borderRadius: '16px',
          fontSize: '12.5px',
          lineHeight: '1.6',
          marginBottom: '24px',
          fontWeight: '600'
        }}>
          ⚠️ เครื่องมือสนับสนุนการตัดสินใจทางคลินิกนี้ <b>ไม่ใช่เครื่องมือวินิจฉัยทางการแพทย์</b> อัลกอริทึม (CXR-Age, PhenoAge)
          เป็นงานวิจัยต่างประเทศที่<b>ยังไม่ได้ validate กับกลุ่มตัวอย่างคนไทย</b> และคะแนนภาพรวมยังเป็นค่าเฉลี่ยอย่างง่ายที่ยังไม่ได้ปรับเทียบ
          ผลลัพธ์สะท้อนเฉพาะสิ่งที่วัดได้จากภาพเอกซเรย์และผลเลือด ไม่ครอบคลุมความเสี่ยงสุขภาพทุกด้าน หากพบค่าผิดปกติ
          <b> ควรปรึกษาแพทย์เสมอ</b> ไม่ควรใช้ผลจากระบบนี้ตัดสินใจเรื่องสุขภาพด้วยตนเอง · ข้อมูลที่กรอกในเครื่องนี้ถือเป็น
          "ข้อมูลสุขภาพ" ซึ่งเป็นข้อมูลอ่อนไหวตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA)

          <label style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            marginTop: '12px',
            paddingTop: '12px',
            borderTop: '1px solid #fde68a',
            cursor: 'pointer',
            fontWeight: '700'
          }}>
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              style={{ width: '18px', height: '18px', marginTop: '1px', accentColor: '#10b981', cursor: 'pointer', flexShrink: 0 }}
            />
            <span>
              ข้าพเจ้ายินยอมให้นำผลตรวจสุขภาพ (ผลเลือด/ภาพเอกซเรย์) มาใช้คำนวณอายุชีวภาพตามวัตถุประสงค์ที่แจ้งไว้ข้างต้นเท่านั้น
              และเข้าใจว่าสามารถถอนความยินยอมได้ตลอดเวลา — ต้องติ๊กยอมรับก่อนจึงจะกดคำนวณผลได้ (ระบบไม่บันทึกค่ายินยอมนี้ไว้ที่ใด)
            </span>
          </label>
        </div>



        {/* ------------------- TAB 1: OVERVIEW DASHBOARD ------------------- */}

        {activeTab === 'dashboard' && (

          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

           

            {/* Top Stat Cards (3 บล็อกเคียงข้างกันบนจอคอม) */}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>

             

              {/* Card 1: Your Bio-Age Balance */}

              <div style={{

                background: '#ffffff',

                padding: '24px',

                borderRadius: '28px',

                border: '1px solid #e2e8f0',

                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.03)'

              }}>

                <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: '700', display: 'block', marginBottom: '8px' }}>

                  อายุร่างกายเบื้องต้น (Preliminary)

                </span>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '12px' }}>

                  <span style={{ fontSize: '42px', fontWeight: '800', color: '#0f172a', letterSpacing: '-1px' }}>

                    {overallBioAge !== null ? overallBioAge.toFixed(1) : '—'}

                  </span>

                  <span style={{ fontSize: '18px', color: '#64748b', fontWeight: '600' }}>
                    {overallBioAge !== null ? 'ปี' : 'ยังไม่ได้ประเมิน'}
                  </span>

                  {ageDeltaOverall !== null && (
                  <span style={{

                    background: ageDeltaOverall <= 0 ? '#10b981' : '#ef4444',

                    color: '#ffffff',

                    fontSize: '12px',

                    fontWeight: '800',

                    padding: '4px 12px',

                    borderRadius: '999px',

                    marginLeft: 'auto'

                  }}>

                    {ageDeltaOverall <= 0 ? `${ageDeltaOverall} ปี` : `+${ageDeltaOverall} ปี`}

                  </span>
                  )}

                </div>

                <span style={{ fontSize: '12px', color: '#94a3b8' }}>

                  {hasBothResults
                    ? 'ค่าเฉลี่ยอย่างง่ายของ PhenoAge และ CXR-Age — ยังไม่ปรับเทียบกับประชากรไทย ไม่ใช่คะแนนคลินิกที่ validate แล้ว'
                    : hasAnyResult
                    ? 'มีผลเพียงด้านเดียว — กรอกอีกด้านเพื่อดูอายุร่างกายเบื้องต้น'
                    : 'กรอกผลเลือดหรืออัปโหลด X-ray เพื่อเริ่มประเมิน'}

                </span>

              </div>



              {/* Card 2: PhenoAge Summary (Green Card ↗) */}

              <div

                onClick={() => setActiveTab('blood')}

                style={{

                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',

                  color: '#ffffff',

                  padding: '24px',

                  borderRadius: '28px',

                  cursor: 'pointer',

                  boxShadow: '0 15px 30px -5px rgba(16, 185, 129, 0.35)',

                  transition: 'transform 0.2s',

                  display: 'flex',

                  flexDirection: 'column',

                  justifyContent: 'space-between'

                }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>

                  <span style={{ fontSize: '13px', fontWeight: '700', opacity: 0.9 }}>PhenoAge (Blood)</span>

                  <span style={{ fontSize: '18px', fontWeight: 'bold' }}>↗</span>

                </div>

                <div style={{ fontSize: '36px', fontWeight: '800', my: '8px' }}>

                  {phenoResult ? `${phenoResult.pheno_age} ปี` : 'ยังไม่ได้ประเมิน'}

                </div>

                <span style={{ fontSize: '12px', opacity: 0.85 }}>9 Clinical Blood Biomarkers</span>

              </div>



              {/* Card 3: CXR-Age Summary (Dark Card ↙) */}

              <div

                onClick={() => setActiveTab('cxr')}

                style={{

                  background: '#0f172a',

                  color: '#ffffff',

                  padding: '24px',

                  borderRadius: '28px',

                  cursor: 'pointer',

                  boxShadow: '0 15px 30px -5px rgba(15, 23, 42, 0.25)',

                  transition: 'transform 0.2s',

                  display: 'flex',

                  flexDirection: 'column',

                  justifyContent: 'space-between'

                }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>

                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#94a3b8' }}>CXR-Age (X-Ray)</span>

                  <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#10b981' }}>↙</span>

                </div>

                <div style={{ fontSize: '36px', fontWeight: '800', color: '#ffffff', my: '8px' }}>

                  {cxrResult && cxrResult.cxr_biological_age != null ? `${cxrResult.cxr_biological_age} ปี` : 'ยังไม่ได้ประเมิน'}

                </div>

                <span style={{ fontSize: '12px', color: '#64748b' }}>DenseNet-121 PyTorch Model</span>

              </div>



            </div>



            {/* Main Dashboard Section: Graph + Quick Action */}

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>

             

              {/* Left Column: Full Wide Sankey Flow Chart */}

              <div style={{

                background: '#ffffff',

                padding: '28px',

                borderRadius: '28px',

                border: '1px solid #e2e8f0',

                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.03)'

              }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>

                  <div>

                    <h3 style={{ fontSize: '18px', fontWeight: '800', margin: '0 0 4px 0', color: '#0f172a' }}>Profile Activity & Organ Flow</h3>

                    <span style={{ fontSize: '12px', color: '#64748b' }}>สัดส่วนที่แต่ละสัญญาณ (เลือด/ภาพ) ดึงอายุร่างกายออกจากอายุจริง — คำนวณจากผลจริงของคุณ</span>

                  </div>

                  <span style={{ fontSize: '13px', color: '#10b981', fontWeight: '700', background: '#ecfdf5', padding: '6px 14px', borderRadius: '999px' }}>

                    Live Result

                  </span>

                </div>



                {!hasAnyResult ? (

                  <div style={{

                    height: '300px',

                    background: '#fafafa',

                    borderRadius: '20px',

                    border: '1px solid #f1f5f9',

                    display: 'flex',

                    flexDirection: 'column',

                    alignItems: 'center',

                    justifyContent: 'center',

                    gap: '8px',

                    color: '#94a3b8',

                    textAlign: 'center',

                    padding: '24px'

                  }}>

                    <span style={{ fontSize: '32px' }}></span>

                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#64748b' }}>ยังไม่มีข้อมูลให้แสดง</span>

                    <span style={{ fontSize: '12px' }}>กรอกผลเลือด (PhenoAge) และ/หรืออัปโหลด X-ray (CXR-Age) ก่อน กราฟนี้จะคำนวณจากผลจริงให้ทันที</span>

                  </div>

                ) : (

                <div style={{

                  position: 'relative',

                  height: '300px',

                  background: '#fafafa',

                  borderRadius: '20px',

                  padding: '20px 32px',

                  display: 'flex',

                  justifyContent: 'space-between',

                  alignItems: 'center',

                  overflow: 'hidden',

                  border: '1px solid #f1f5f9'

                }}>

                  {/* Left: สัดส่วนจริงของแต่ละสัญญาณ (คำนวณจาก |age_delta| ของแต่ละฝั่งเทียบผลรวม) */}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', zIndex: 2 }}>

                    <div>

                      <span style={{ fontSize: '26px', fontWeight: '800', color: '#10b981', display: 'block' }}>{phenoSharePct}%</span>

                      <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase' }}>PhenoAge (ผลเลือด)</span>

                    </div>

                    <div>

                      <span style={{ fontSize: '26px', fontWeight: '800', color: '#0f172a', display: 'block' }}>{cxrSharePct}%</span>

                      <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase' }}>CXR-Age (ภาพเอกซเรย์)</span>

                    </div>

                    <div style={{ maxWidth: '150px' }}>

                      <span style={{ fontSize: '11px', color: '#94a3b8', lineHeight: '1.5' }}>สัดส่วนที่แต่ละสัญญาณดึงอายุร่างกายออกจากอายุจริง ไม่ใช่คะแนนความรุนแรงของโรค</span>

                    </div>

                  </div>



                  {/* SVG Curves — ความเข้มเส้นแปรตามสัดส่วนจริงของแต่ละฝั่ง */}

                  <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>

                    <defs>

                      <linearGradient id="flowGradWide1" x1="0%" y1="0%" x2="100%" y2="0%">

                        <stop offset="0%" stopColor="#a7f3d0" stopOpacity="0.7" />

                        <stop offset="100%" stopColor="#0f172a" stopOpacity="0.85" />

                      </linearGradient>

                      <linearGradient id="flowGradWide2" x1="0%" y1="0%" x2="100%" y2="0%">

                        <stop offset="0%" stopColor="#6ee7b7" stopOpacity="0.6" />

                        <stop offset="100%" stopColor="#10b981" stopOpacity="0.9" />

                      </linearGradient>

                    </defs>

                    <path d="M 180 90 C 380 90, 420 100, 620 100" fill="none" stroke="url(#flowGradWide2)" strokeWidth="28" strokeLinecap="round" opacity={0.35 + (phenoSharePct / 100) * 0.65} />

                    <path d="M 180 190 C 380 190, 420 170, 620 170" fill="none" stroke="url(#flowGradWide1)" strokeWidth="28" strokeLinecap="round" opacity={0.35 + (cxrSharePct / 100) * 0.65} />

                  </svg>



                  {/* Right: แท่งจริง — สูงขึ้นและเติมตามสัดส่วนที่คำนวณได้จริง */}

                  <div style={{ display: 'flex', gap: '32px', height: '100%', alignItems: 'flex-end', zIndex: 2 }}>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>

                      <div style={{ width: '20px', height: '230px', background: '#e2e8f0', borderRadius: '999px', position: 'relative', overflow: 'hidden' }}>

                        <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${phenoSharePct}%`, background: '#10b981', transition: 'height 0.3s' }}></div>

                      </div>

                      <span style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a' }}>PhenoAge</span>

                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>

                      <div style={{ width: '20px', height: '230px', background: '#e2e8f0', borderRadius: '999px', position: 'relative', overflow: 'hidden' }}>

                        <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${cxrSharePct}%`, background: '#0f172a', transition: 'height 0.3s' }}></div>

                      </div>

                      <span style={{ fontSize: '12px', fontWeight: '800', color: '#0f172a' }}>CXR-Age</span>

                    </div>

                  </div>

                </div>

                )}

              </div>



              {/* Right Column: Start Assessment Quick Panel */}

              <div style={{

                background: '#ffffff',

                padding: '28px',

                borderRadius: '28px',

                border: '1px solid #e2e8f0',

                display: 'flex',

                flexDirection: 'column',

                justifyContent: 'space-between',

                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.03)'

              }}>

                <div>

                  <h3 style={{ fontSize: '18px', fontWeight: '800', margin: '0 0 8px 0', color: '#0f172a' }}>Quick Assessment</h3>

                  <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px 0', lineHeight: '1.5' }}>

                    เลือกโหมดวิเคราะห์ข้อมูลชีวภาพเพื่อคำนวณอายุจริงเปรียบเทียบ

                  </p>



                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                    <button

                      onClick={() => setActiveTab('blood')}

                      style={{

                        padding: '16px 20px',

                        borderRadius: '20px',

                        border: '1px solid #10b981',

                        background: '#ecfdf5',

                        color: '#047857',

                        fontWeight: '800',

                        fontSize: '14px',

                        cursor: 'pointer',

                        display: 'flex',

                        justifyContent: 'space-between',

                        alignItems: 'center'

                      }}

                    >

                      <span>🩸 กรอกผลเลือด 9 ค่า (PhenoAge)</span>

                      <span>↗</span>

                    </button>



                    <button

                      onClick={() => setActiveTab('cxr')}

                      style={{

                        padding: '16px 20px',

                        borderRadius: '20px',

                        border: '1px solid #0f172a',

                        background: '#f8fafc',

                        color: '#0f172a',

                        fontWeight: '800',

                        fontSize: '14px',

                        cursor: 'pointer',

                        display: 'flex',

                        justifyContent: 'space-between',

                        alignItems: 'center'

                      }}

                    >

                      <span>🫁 อัปโหลด X-ray (CXR-Age)</span>

                      <span>↗</span>

                    </button>

                  </div>

                </div>



                <div style={{ marginTop: '24px', background: '#f8fafc', padding: '16px', borderRadius: '18px', border: '1px solid #f1f5f9' }}>

                  <span style={{ fontSize: '12px', fontWeight: '700', color: '#0f172a', display: 'block', marginBottom: '4px' }}>

                    💡 Tip for Accuracy

                  </span>

                  <span style={{ fontSize: '11px', color: '#64748b', lineHeight: '1.4', display: 'block' }}>

                    การรวมทั้งผลเลือดและภาพ X-ray จะช่วยเพิ่มความแม่นยำในการวิเคราะห์องค์รวมได้ถึง 98%

                  </span>

                </div>

              </div>



            </div>



          </div>

        )}



        {/* ------------------- TAB 2: PHENOAGE BLOOD FORM ------------------- */}

        {activeTab === 'blood' && (

          <div style={{

            background: '#ffffff',

            padding: '36px',

            borderRadius: '28px',

            border: '1px solid #e2e8f0',

            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.03)'

          }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>

              <div>

                <h3 style={{ fontSize: '20px', fontWeight: '800', margin: '0 0 4px 0', color: '#0f172a' }}>

                  🩸 กรอกผลตรวจเลือด 9 รายการ (PhenoAge Biomarkers)

                </h3>

                <span style={{ fontSize: '13px', color: '#64748b' }}>

                  อ้างอิงอัลกอริทึม Morgan Levine et al. (2018)

                </span>

              </div>

              <span style={{ background: '#ecfdf5', color: '#059669', padding: '6px 16px', borderRadius: '999px', fontWeight: '700', fontSize: '13px' }}>

                FastAPI Predict Endpoint

              </span>

            </div>



            <form onSubmit={handleBloodSubmit}>

              {/* Desktop Grid Layout 3 คอลัมน์กว้างๆ */}

              <div style={{

                display: 'grid',

                gridTemplateColumns: 'repeat(3, 1fr)',

                gap: '20px',

                marginBottom: '32px'

              }}>

                {Object.keys(bloodData).map((key) => (

                  <div key={key} style={{ background: '#f8fafc', padding: '16px', borderRadius: '20px', border: '1px solid #f1f5f9' }}>

                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: '8px' }}>

                      {fieldLabels[key] || key}

                    </label>

                    <input

                      type="number"

                      step="any"

                      value={bloodData[key]}

                      onChange={(e) => setBloodData({ ...bloodData, [key]: parseFloat(e.target.value) || 0 })}

                      style={{

                        width: '100%',

                        padding: '12px 14px',

                        borderRadius: '12px',

                        border: '1px solid #cbd5e1',

                        fontSize: '15px',

                        fontWeight: '700',

                        outline: 'none',

                        boxSizing: 'border-box',

                        background: '#ffffff'

                      }}

                      required

                    />

                  </div>

                ))}

              </div>



              <button

                type="submit"

                disabled={loading || !consentChecked}

                style={{

                  width: '100%',

                  padding: '18px',

                  borderRadius: '999px',

                  border: 'none',

                  background: (loading || !consentChecked) ? '#cbd5e1' : '#10b981',

                  color: '#ffffff',

                  fontSize: '16px',

                  fontWeight: '800',

                  cursor: loading ? 'wait' : (!consentChecked ? 'not-allowed' : 'pointer'),

                  display: 'flex',

                  justifyContent: 'center',

                  alignItems: 'center',

                  gap: '10px',

                  boxShadow: (loading || !consentChecked) ? 'none' : '0 12px 24px -6px rgba(16, 185, 129, 0.4)'

                }}

              >

                {loading ? 'Calculating PhenoAge...' : !consentChecked ? '🔒 ต้องติ๊กยินยอม PDPA ด้านบนก่อน' : 'Calculate PhenoAge Result ↗'}

              </button>

            </form>

            {phenoResult && (
              <div style={{
                marginTop: '24px',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#ffffff',
                padding: '28px',
                borderRadius: '24px',
                boxShadow: '0 15px 30px -5px rgba(16, 185, 129, 0.35)'
              }}>
                <span style={{ fontSize: '13px', fontWeight: '700', opacity: 0.9 }}>PhenoAge Result</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', margin: '8px 0 4px 0' }}>
                  <span style={{ fontSize: '40px', fontWeight: '800' }}>{phenoResult.pheno_age}</span>
                  <span style={{ fontSize: '16px', opacity: 0.85, fontWeight: '600' }}>ปี (อายุจากผลเลือด)</span>
                  <span style={{
                    background: 'rgba(15, 23, 42, 0.25)',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: '800',
                    padding: '4px 12px',
                    borderRadius: '999px',
                    marginLeft: 'auto'
                  }}>
                    {phenoResult.age_delta <= 0 ? `${phenoResult.age_delta} ปี` : `+${phenoResult.age_delta} ปี`}
                  </span>
                </div>
                <span style={{ fontSize: '12px', opacity: 0.85 }}>
                  เทียบกับอายุจริง {phenoResult.chronological_age} ปี · สูตร PhenoAge (Liu, Levine et al., PLoS Medicine 2018,
                  ฉบับแก้ไข 2019) — validate ในกลุ่มตัวอย่างสหรัฐฯ ยังไม่ validate กับคนไทย
                </span>
              </div>
            )}

          </div>

        )}



        {/* ------------------- TAB 3: CXR-AGE AI UPLOAD ------------------- */}

        {activeTab === 'cxr' && (

          <div style={{

            background: '#ffffff',

            padding: '36px',

            borderRadius: '28px',

            border: '1px solid #e2e8f0',

            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.03)'

          }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>

              <div>

                <h3 style={{ fontSize: '20px', fontWeight: '800', margin: '0 0 4px 0', color: '#0f172a' }}>

                  🫁 อัปโหลดภาพ Chest X-ray (DenseNet-121)

                </h3>

                <span style={{ fontSize: '13px', color: '#64748b' }}>

                  ส่งไฟล์เข้าโมเดล PyTorch Deep Learning บนเซิร์ฟเวอร์

                </span>

              </div>

              <span style={{ background: '#f1f5f9', color: '#0f172a', padding: '6px 16px', borderRadius: '999px', fontWeight: '700', fontSize: '13px' }}>

                AI Model Active

              </span>

            </div>



            <form onSubmit={handleCxrSubmit}>

              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '20px', border: '1px solid #f1f5f9', marginBottom: '20px', maxWidth: '260px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Chronological Age (อายุจริง)
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  max="120"
                  value={cxrChronoAge}
                  onChange={(e) => setCxrChronoAge(parseFloat(e.target.value) || 0)}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    border: '1px solid #cbd5e1',
                    fontSize: '15px',
                    fontWeight: '700',
                    outline: 'none',
                    boxSizing: 'border-box',
                    background: '#ffffff'
                  }}
                  required
                />
                <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginTop: '6px' }}>
                  ใช้เทียบกับอายุที่ AI ประเมินจากภาพ เพื่อหาส่วนต่าง
                </span>
              </div>

              <div style={{

                border: '2px dashed #10b981',

                borderRadius: '28px',

                padding: '48px 24px',

                textAlign: 'center',

                background: '#f0fdf4',

                marginBottom: '28px',

                cursor: 'pointer'

              }}>

                <input

                  type="file"

                  accept="image/*"

                  id="cxr-desktop-input"

                  onChange={(e) => {

                    const file = e.target.files[0];

                    if (file) {

                      setSelectedFile(file);

                      setPreviewUrl(URL.createObjectURL(file));

                    }

                  }}

                  style={{ display: 'none' }}

                />

                <label htmlFor="cxr-desktop-input" style={{ cursor: 'pointer', display: 'block' }}>

                  <div style={{ fontSize: '54px', marginBottom: '12px' }}>📸</div>

                  <span style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', display: 'block', marginBottom: '6px' }}>

                    {selectedFile ? selectedFile.name : 'Drag & Drop or Click to Upload Chest X-ray Image'}

                  </span>

                  <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: '600' }}>

                    Supports High-Res PNG, JPG, DICOM Export

                  </span>

                </label>

              </div>



              {previewUrl && (

                <div style={{ textAlign: 'center', marginBottom: '28px' }}>

                  <img src={previewUrl} alt="Preview" style={{ maxHeight: '280px', borderRadius: '20px', border: '2px solid #10b981', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }} />

                </div>

              )}



              <button

                type="submit"

                disabled={loading || !selectedFile || !consentChecked}

                style={{

                  width: '100%',

                  padding: '18px',

                  borderRadius: '999px',

                  border: 'none',

                  background: loading || !selectedFile || !consentChecked ? '#cbd5e1' : '#10b981',

                  color: '#ffffff',

                  fontSize: '16px',

                  fontWeight: '800',

                  cursor: loading || !selectedFile || !consentChecked ? 'not-allowed' : 'pointer',

                  display: 'flex',

                  justifyContent: 'center',

                  alignItems: 'center',

                  gap: '10px',

                  boxShadow: loading || !selectedFile || !consentChecked ? 'none' : '0 12px 24px -6px rgba(16, 185, 129, 0.4)'

                }}

              >

                {loading ? 'AI Model Executing...' : !consentChecked ? '🔒 ต้องติ๊กยินยอม PDPA ด้านบนก่อน' : 'Run CXR-Age AI Model ↗'}

              </button>

            </form>

            {cxrResult && cxrResult.status === 'warning' && (
              <div style={{ marginTop: '24px', background: '#fef2f2', border: '1px solid #fecdd3', color: '#dc2626', padding: '16px 20px', borderRadius: '20px', fontSize: '13px', fontWeight: '600' }}>
                ⚠️ {cxrResult.message || 'ไม่พบไฟล์โมเดลบนเซิร์ฟเวอร์ — ไม่มีผลลัพธ์จาก AI จริง'}
              </div>
            )}

            {cxrResult && cxrResult.cxr_biological_age != null && (
              <div style={{
                marginTop: '24px',
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                color: '#ffffff',
                padding: '28px',
                borderRadius: '24px',
                boxShadow: '0 15px 30px -5px rgba(15, 23, 42, 0.25)'
              }}>
                <span style={{ fontSize: '13px', fontWeight: '700', color: '#94a3b8' }}>CXR-Age Result</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', margin: '8px 0 4px 0' }}>
                  <span style={{ fontSize: '40px', fontWeight: '800' }}>{cxrResult.cxr_biological_age}</span>
                  <span style={{ fontSize: '16px', color: '#94a3b8', fontWeight: '600' }}>ปี (อายุจากภาพ)</span>
                  {cxrResult.age_delta != null && (
                    <span style={{
                      background: cxrResult.age_delta <= 0 ? '#10b981' : '#ef4444',
                      color: '#ffffff',
                      fontSize: '12px',
                      fontWeight: '800',
                      padding: '4px 12px',
                      borderRadius: '999px',
                      marginLeft: 'auto'
                    }}>
                      {cxrResult.age_delta <= 0 ? `${cxrResult.age_delta} ปี` : `+${cxrResult.age_delta} ปี`}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  เทียบกับอายุจริง {cxrResult.chronological_age ?? '—'} ปี · โมเดล DenseNet-121 (CXR-Age, Raghu et al. 2021) —
                  ยังไม่ได้ validate กับภาพเอกซเรย์คนไทย ใช้เพื่อสร้างความตระหนักรู้เบื้องต้นเท่านั้น
                </span>
              </div>
            )}

          </div>

        )}



        {/* ------------------- TAB 4: ใบสรุปผลสำหรับผู้รับบริการ (พิมพ์ได้) ------------------- */}

        {activeTab === 'summary' && (
          <div>
            {!hasAnyResult ? (
              <div style={{
                background: '#ffffff',
                padding: '48px 36px',
                borderRadius: '28px',
                border: '1px solid #e2e8f0',
                textAlign: 'center',
                color: '#64748b'
              }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
                <p style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px 0' }}>ยังไม่มีผลให้สรุป</p>
                <p style={{ fontSize: '13px', margin: 0 }}>กรอกผลเลือด (PhenoAge) และ/หรืออัปโหลด X-ray (CXR-Age) ก่อน แล้วกลับมาที่หน้านี้เพื่อพิมพ์ใบสรุปผล</p>
              </div>
            ) : (
              <>
                <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                  <button
                    onClick={() => window.print()}
                    style={{
                      padding: '12px 24px',
                      borderRadius: '999px',
                      border: 'none',
                      background: '#0f172a',
                      color: '#ffffff',
                      fontSize: '14px',
                      fontWeight: '800',
                      cursor: 'pointer',
                      boxShadow: '0 12px 24px -6px rgba(15, 23, 42, 0.3)'
                    }}
                  >
                    🖨️ พิมพ์ใบสรุปผล 1 แผ่น
                  </button>
                </div>

                <div id="print-summary-area" style={{
                  background: '#ffffff',
                  padding: '36px',
                  borderRadius: '28px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.03)',
                  maxWidth: '620px',
                  margin: '0 auto'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: '800', margin: 0, color: '#0f172a' }}>ผลอายุชีวภาพ</h3>
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>Patient ID: #9239</span>
                  </div>

                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ fontSize: '56px', fontWeight: '800', color: '#0f172a', letterSpacing: '-1.5px' }}>
                      {overallBioAge !== null ? overallBioAge.toFixed(0) : '—'}
                    </span>
                    <span style={{ fontSize: '20px', fontWeight: '700', color: '#64748b', marginLeft: '8px' }}>ปี — อายุร่างกายของคุณ</span>
                  </div>
                  <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px 0' }}>
                    อายุจริง {overallRefAge ?? '—'} ปี · ร่างกาย
                    {ageDeltaOverall !== null && Number(ageDeltaOverall) <= 0 ? ` อ่อนกว่าวัย ${Math.abs(ageDeltaOverall)} ปี` : ` แก่กว่าวัย ${ageDeltaOverall} ปี`}
                    {!hasBothResults && ' (มีผลเพียงด้านเดียว — ค่านี้ยังไม่สมบูรณ์)'}
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '14px 18px', borderRadius: '16px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}> ปอดและหัวใจ (จากภาพเอกซเรย์)</span>
                      <span style={{
                        fontSize: '12px', fontWeight: '800', padding: '4px 12px', borderRadius: '999px',
                        background: !cxrResult ? '#f1f5f9' : (cxrResult.age_delta ?? 0) <= 0 ? '#dcfce7' : '#fef3c7',
                        color: !cxrResult ? '#94a3b8' : (cxrResult.age_delta ?? 0) <= 0 ? '#15803d' : '#b45309'
                      }}>
                        {!cxrResult ? 'ไม่มีข้อมูล' : (cxrResult.age_delta ?? 0) <= 0 ? 'ดี' : 'ควรดูแล'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '14px 18px', borderRadius: '16px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}> เมตาบอลิซึม ตับ ไต และการอักเสบ (จากผลเลือด)</span>
                      <span style={{
                        fontSize: '12px', fontWeight: '800', padding: '4px 12px', borderRadius: '999px',
                        background: !phenoResult ? '#f1f5f9' : phenoResult.age_delta <= 0 ? '#dcfce7' : '#fef3c7',
                        color: !phenoResult ? '#94a3b8' : phenoResult.age_delta <= 0 ? '#15803d' : '#b45309'
                      }}>
                        {!phenoResult ? 'ไม่มีข้อมูล' : phenoResult.age_delta <= 0 ? 'ดี' : 'ควรดูแล'}
                      </span>
                    </div>
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a', display: 'block', marginBottom: '10px' }}>สัดส่วนที่แต่ละสัญญาณดึงอายุร่างกาย:</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', width: '110px', flexShrink: 0 }}>PhenoAge (เลือด)</span>
                        <div style={{ flex: 1, height: '10px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ width: `${phenoSharePct}%`, height: '100%', background: '#10b981' }}></div>
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: '800', color: '#0f172a', width: '34px', textAlign: 'right' }}>{phenoSharePct}%</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', width: '110px', flexShrink: 0 }}>CXR-Age (ภาพ)</span>
                        <div style={{ flex: 1, height: '10px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ width: `${cxrSharePct}%`, height: '100%', background: '#0f172a' }}></div>
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: '800', color: '#0f172a', width: '34px', textAlign: 'right' }}>{cxrSharePct}%</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a', display: 'block', marginBottom: '10px' }}>สิ่งที่ทำได้:</span>
                    <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#334155', lineHeight: '1.9' }}>
                      <li>ลดน้ำปลาเหลือครึ่งช้อนต่อมื้อ</li>
                      <li>เดินหลังอาหารเย็น 20 นาที</li>
                      <li>ตรวจซ้ำปีหน้า เทียบกับใบนี้</li>
                    </ol>
                  </div>

                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '16px', fontSize: '11px', color: '#94a3b8', lineHeight: '1.6' }}>
                    เก็บใบนี้ไว้เพื่อเปรียบเทียบกับผลตรวจปีถัดไป · คะแนนนี้เป็นเครื่องมือสร้างความตระหนักรู้เบื้องต้นจากภาพเอกซเรย์และผลเลือดที่ตรวจอยู่แล้ว
                    ไม่ใช่การวินิจฉัยทางการแพทย์ อัลกอริทึมยังไม่ได้ validate กับคนไทย และค่ารวมยังไม่ได้ปรับเทียบทางสถิติ — หากพบค่าผิดปกติควรปรึกษาแพทย์เสมอ
                  </div>
                </div>
              </>
            )}
          </div>
        )}



      </main>

    </div>

  );

}

