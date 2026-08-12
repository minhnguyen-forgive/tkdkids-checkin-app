// Email Quản trị viên duy nhất được phép đổi nguồn file Google Sheet
const ADMIN_EMAIL = 'minhnguyen.ymc@gmail.com';

// Default Fallback SPREADSHEET_ID nếu chưa cài đặt cấu hình nguồn
const DEFAULT_SPREADSHEET_ID = '1IRka4ldM99W4cf4KqCFTRozT_276D3oY';
const DEFAULT_SHEET_NAME = 'DanhSachThi';

/**
 * Phục vụ yêu cầu HTTP GET (Cho cả Google Apps Script Web App lẫn GitHub Pages REST API)
 */
function doGet(e) {
  // Nếu gọi từ GitHub Pages qua REST API
  if (e && e.parameter && e.parameter.action === 'getInitialData') {
    const data = getInitialData();
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Mặc định: Phục vụ Web App trực tiếp trên Apps Script
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Lễ tân Check-in - Taekwondo Kids')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Phục vụ yêu cầu HTTP POST (Xử lý Check-in & CMS Đổi File khi chạy trên GitHub Pages)
 */
function doPost(e) {
  try {
    const contents = JSON.parse(e.postData.contents);
    if (contents.action === 'checkin') {
      const res = checkInCandidate(contents.rowIndex, 'checkin');
      return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
    }
    if (contents.action === 'updateSource') {
      const res = updateSpreadsheetSource(contents.newUrlOrId, contents.newSheetName);
      return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'Lỗi POST API: ' + err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Kiểm tra xem người dùng hiện tại có phải Quản trị viên (ADMIN_EMAIL) hay không
 */
function checkIsAdmin() {
  const activeUser = Session.getActiveUser().getEmail();
  const effectiveUser = Session.getEffectiveUser().getEmail();
  const currentUser = (activeUser || effectiveUser || '').toLowerCase().trim();
  
  return currentUser === ADMIN_EMAIL.toLowerCase();
}

/**
 * Lấy SPREADSHEET_ID và SHEET_NAME đang hoạt động từ ScriptProperties
 */
function getActiveSpreadsheetConfig() {
  const props = PropertiesService.getScriptProperties();
  const ssId = props.getProperty('ACTIVE_SPREADSHEET_ID') || DEFAULT_SPREADSHEET_ID;
  const sheetName = props.getProperty('ACTIVE_SHEET_NAME') || DEFAULT_SHEET_NAME;
  return { ssId, sheetName };
}

/**
 * CMS Admin: Đổi nguồn file Google Sheet mới (CHỈ DÀNH CHO ADMIN)
 */
function updateSpreadsheetSource(newUrlOrId, newSheetName) {
  try {
    if (!checkIsAdmin()) {
      const currentUser = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || 'Chưa xác định';
      return { 
        success: false, 
        message: `Bảo mật: Từ chối quyền truy cập! Chỉ tài khoản Quản trị viên (${ADMIN_EMAIL}) mới được phép đổi nguồn file. Tài khoản hiện tại: ${currentUser}` 
      };
    }

    if (!newUrlOrId || !newUrlOrId.trim()) {
      return { success: false, message: 'Vui lòng nhập Link hoặc ID của file Google Sheet mới!' };
    }

    let cleanId = newUrlOrId.trim();
    const match = cleanId.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      cleanId = match[1];
    }

    const ss = SpreadsheetApp.openById(cleanId);
    const targetSheetName = newSheetName && newSheetName.trim() ? newSheetName.trim() : DEFAULT_SHEET_NAME;
    const sheet = ss.getSheetByName(targetSheetName) || ss.getSheets()[0];

    const props = PropertiesService.getScriptProperties();
    props.setProperty('ACTIVE_SPREADSHEET_ID', cleanId);
    props.setProperty('ACTIVE_SHEET_NAME', sheet.getName());

    return {
      success: true,
      message: `Đã cập nhật nguồn dữ liệu mới: "${ss.getName()}" (Trang: "${sheet.getName()}")`,
      ssTitle: ss.getName(),
      sheetName: sheet.getName(),
      ssId: cleanId
    };
  } catch (err) {
    return { success: false, message: 'Không thể mở file Google Sheet mới: ' + err.message };
  }
}

/**
 * Lấy danh sách thí sinh và thống kê dữ liệu
 */
function getInitialData() {
  try {
    const isAdmin = checkIsAdmin();
    const currentUserEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
    const config = getActiveSpreadsheetConfig();
    const ss = SpreadsheetApp.openById(config.ssId);
    const sheet = ss.getSheetByName(config.sheetName) || ss.getSheets()[0];
    const data = sheet.getDataRange().getValues();

    const currentSheetInfo = {
      title: ss.getName(),
      sheetName: sheet.getName(),
      ssId: config.ssId,
      url: ss.getUrl()
    };

    if (!data || data.length <= 1) {
      return { 
        candidates: [], 
        stats: { total: 0, checkedIn: 0, pending: 0 }, 
        capList: [], 
        sanList: [],
        currentSheetInfo: currentSheetInfo,
        isAdmin: isAdmin,
        currentUserEmail: currentUserEmail
      };
    }

    const candidates = [];
    const capSet = new Set();
    const sanSet = new Set();
    let checkedInCount = 0;
    const rowsToClearTimestamp = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const stt = row[0];
      const hoTen = row[1];
      if (!hoTen && !stt) continue;

      const gioitinh = row[2] || '';
      const namSinh = row[3] instanceof Date 
        ? Utilities.formatDate(row[3], Session.getScriptTimeZone(), 'dd/MM/yyyy') 
        : String(row[3] || '');
      const vtfId = String(row[4] || '').trim();
      const sbd = String(row[5] || '').trim();
      const sanThi = String(row[6] || '').trim();
      const giamKhao = String(row[7] || '').trim();
      const trangThaiRaw = String(row[8] || '').trim();
      let thoiGianCheckin = row[9] instanceof Date 
        ? Utilities.formatDate(row[9], Session.getScriptTimeZone(), 'HH:mm:ss dd/MM/yyyy') 
        : String(row[9] || '');
      const dangDuThi = String(row[10] || '').trim();

      if (dangDuThi) capSet.add(dangDuThi);
      if (sanThi) sanSet.add(sanThi);

      const isCheckedIn = trangThaiRaw.toLowerCase().includes('đã check-in') || trangThaiRaw.toLowerCase() === 'check-in';

      if (!isCheckedIn && trangThaiRaw === '') {
        if (thoiGianCheckin !== '') {
          thoiGianCheckin = '';
          rowsToClearTimestamp.push(i + 1);
        }
      }

      if (isCheckedIn) checkedInCount++;

      candidates.push({
        rowIndex: i + 1,
        stt: stt,
        hoTen: hoTen,
        gioiTinh: gioitinh,
        namSinh: namSinh,
        vtfId: vtfId,
        sbd: sbd,
        sanThi: sanThi,
        giamKhao: giamKhao,
        trangThai: isCheckedIn ? 'Đã check-in' : 'Chưa check-in',
        thoiGianCheckin: isCheckedIn ? thoiGianCheckin : '',
        dangDuThi: dangDuThi
      });
    }

    if (rowsToClearTimestamp.length > 0) {
      rowsToClearTimestamp.forEach(rIdx => {
        sheet.getRange(rIdx, 10).setValue('');
      });
    }

    return {
      candidates: candidates,
      stats: {
        total: candidates.length,
        checkedIn: checkedInCount,
        pending: candidates.length - checkedInCount
      },
      capList: Array.from(capSet).sort(),
      sanList: Array.from(sanSet).sort(),
      currentSheetInfo: currentSheetInfo,
      isAdmin: isAdmin,
      currentUserEmail: currentUserEmail
    };
  } catch (error) {
    throw new Error('Lỗi truy xuất dữ liệu Google Sheets: ' + error.message);
  }
}

/**
 * Thực hiện Check-in cho thí sinh
 */
function checkInCandidate(rowIndex, action) {
  try {
    const config = getActiveSpreadsheetConfig();
    const ss = SpreadsheetApp.openById(config.ssId);
    const sheet = ss.getSheetByName(config.sheetName) || ss.getSheets()[0];
    
    if (action === 'checkin') {
      const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss dd/MM/yyyy');
      sheet.getRange(rowIndex, 9).setValue('Đã check-in');
      sheet.getRange(rowIndex, 10).setValue(nowStr);
      return { success: true, message: 'Check-in thành công', time: nowStr, status: 'Đã check-in' };
    }
  } catch (error) {
    return { success: false, message: 'Lỗi ghi dữ liệu: ' + error.message };
  }
}

/**
 * Trigger tự động khi sửa dữ liệu trực tiếp trên file Sheet
 */
function onEdit(e) {
  if (!e || !e.range) return;
  try {
    const range = e.range;
    const sheet = range.getSheet();
    const config = getActiveSpreadsheetConfig();
    if (sheet.getName() !== config.sheetName) return;

    if (range.getColumn() === 9) {
      const val = String(range.getValue() || '').trim();
      if (!val) {
        sheet.getRange(range.getRow(), 10).setValue('');
      }
    }
  } catch (err) {
    console.error('Lỗi onEdit: ' + err.toString());
  }
}
