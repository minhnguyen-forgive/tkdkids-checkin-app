# Taekwondo Kids - Hệ Thống Check-in Lễ Tân (GitHub Pages & Apps Script Web App)

Ứng dụng Web App Check-in dành cho bộ phận Lễ tân trong các Kỳ thi thăng cấp đai Taekwondo, hỗ trợ cả 2 chế độ triển khai:
1. **Google Apps Script Web App** (Khuyên dùng - Chạy trực tiếp từ Google Apps Script Editor)
2. **GitHub Pages Website** (Triển khai trang web tĩnh công khai trên GitHub Pages)

---

## ⚠️ LƯU Ý QUAN TRỌNG KHI ĐẨY LÊN GITHUB & CHẠY GITHUB PAGES

### 1. Có cần giải nén tệp Zip không?
👉 **CÓ, BẮT BUỘC PHẢI GIẢI NÉN!**
GitHub và GitHub Pages yêu cầu các tệp mã nguồn nằm ở dạng thư mục giải nén phẳng (`index.html`, `Code.gs`, `README.md`...) chứ **không đọc trực tiếp từ tệp `.zip`**.

### 2. Các bước tải lên GitHub & Bật GitHub Pages:
1. Giải nén tệp `taekwondo-checkin-app-v4.zip` ra một thư mục trên máy tính.
2. Tạo một Repository mới trên GitHub (ví dụ: `taekwondo-checkin-app`).
3. Mở Terminal tại thư mục giải nén và chạy lệnh:

```bash
git init
git add .
git commit -m "Initial commit - Taekwondo Reception Check-in App"
git branch -M main
git remote add origin https://github.com/USERNAME/taekwondo-checkin-app.git
git push -u origin main
```

4. Truy cập **Settings** trên GitHub Repository $\rightarrow$ Chọn mục **Pages** $\rightarrow$ Chọn **Source: Deploy from a branch** (nhánh `main` / `root`) $\rightarrow$ Nhấn **Save**.
5. Sau vài phút, trang web sẽ công khai tại đường dẫn: `https://USERNAME.github.io/taekwondo-checkin-app/`

---

## ⚙️ Cơ Chế Hoạt Động Giữa GitHub Pages & Google Apps Script API

- **Chạy trực tiếp trên Google Apps Script**: Dùng hàm giao tiếp native `google.script.run`.
- **Chạy trên GitHub Pages**: `Code.gs` đã tích hợp sẵn REST API (`doGet` & `doPost`), cho phép trang web trên GitHub Pages tự động gửi yêu cầu đọc/ghi dữ liệu về Google Sheets thông qua Web App URL.

---

## 🔐 Phân Quyền Admin Đổi File Dữ Liệu CMS

Chỉ tài khoản Quản trị viên **`minhnguyen.ymc@gmail.com`** mới nhìn thấy nút **"CMS Đổi File Admin"** và được phép đổi nguồn file cho các kỳ thi tiếp theo. Các tài khoản Lễ tân khác khi mở web sẽ chỉ có quyền tra cứu và Check-in võ sinh.
