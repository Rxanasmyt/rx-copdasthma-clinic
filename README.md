# Rx-COPD/Asthma Clinic

ระบบบรรบาลเภสัชกรรมผู้ป่วย COPD/Asthma พร้อม Firebase Cloud Sync

## 🚀 เริ่มต้นใช้งาน

### ตัวเลือกที่ 1: ดับเบิลคลิก (ง่ายสุด)
```
เปิดแอป.bat → เปิดแอปได้เลย
```

### ตัวเลือกที่ 2: เปิดไฟล์โดยตรง
```
RxClinic.html → เปิดด้วย Chrome/Edge
```

### ตัวเลือกที่ 3: ดาวน์โหลด Release
ไปที่ [Releases](../../releases) → ดาวน์โหลด `RxClinic-vX.X.X.zip`

## 📋 ไฟล์ที่จำเป็น

| ไฟล์ | ขนาด | ใช้ทำอะไร |
|------|------|----------|
| `RxClinic.html` | ~500KB | แอปหลัก (ทั้งหมดรวมในไฟล์เดียว) |
| `เปิดแอป.bat` | <1KB | ทางลัดดับเบิลคลิก |

ไฟล์อื่นๆ (src/, manifest.json, sw.js) ไม่จำเป็นต้องใช้

## ☁️ Firebase Cloud Sync

Firebase config ฝังอยู่ในไฟล์แล้ว:
- **ข้อมูลจะซิงค์อัตโนมัติ** ระหว่างเครื่องต่างๆ
- **ไม่ต้องตั้งค่าเพิ่มเติม**
- ต้องมีอินเทอร์เน็ตเพื่อซิงค์ firebase

## 🎯 ฟีเจอร์หลัก

✅ บันทึกผู้ป่วย + ประวัติการเยี่ยม  
✅ คัดกรองความเสี่ยง (High/Medium/Low)  
✅ Telepharmacy + ติดตามผู้ป่วย  
✅ CAT/mMRC/ACT Score assessment  
✅ GOLD 2023 ABE + GINA 2023 auto-classification  
✅ Drug Interaction Checker  
✅ Export CSV/PDF  
✅ Offline mode (PWA)  
✅ Firebase Cloud Sync  

## 📱 ใช้งานได้ที่

- 💻 Windows / Mac / Linux (เปิดไฟล์ HTML)
- 🌐 Chrome, Edge, Firefox, Safari
- 📱 iPad / Tablet (responsive)

## 📝 ข้อมูลตัวอย่าง

เปิดแอปแล้ว Login:
- **Username:** ชื่อของคุณ
- **PIN:** (ตั้งครั้งแรกอัตโนมัติ)

มี 5 ผู้ป่วยตัวอย่าง + 10 บันทึก ให้ลองใช้เลย

## 🔐 ความปลอดภัย

- ข้อมูล **เข้ารหัสใน localStorage** (ตัวเลข 4 หลัก)
- Firebase ตั้งค่า Test Mode (อ่าน/เขียนได้ 30 วัน)
- ใช้ HTTPS เมื่อ deploy

## 📖 Documentation

- [README.md](./README.md) - ไฟล์นี้
- โฟลเดอร์ `design_extract/` - ไฟล์ design + chat history

## 🆘 Support

ปัญหาใช้งาน:
1. ลบ localStorage: F12 → Application → Clear All → รีเฟรช
2. ปิด/เปิด Chrome ใหม่
3. ลองใช้ Chrome/Edge แทน Firefox

## 📄 License

ใช้สำหรับวัตถุประสงค์ทางการแพทย์เท่านั้น

---

**เวอร์ชัน:** 1.0.0  
**วันที่อัปเดต:** 2026-05-23  
**Firebase Project:** rxcopdasthmaclinic
