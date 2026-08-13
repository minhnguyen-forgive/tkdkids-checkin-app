const ADMIN_EMAIL = 'minhnguyen.ymc@gmail.com';
const DEFAULT_SPREADSHEET_ID = '1IRka4ldM99W4cf4KqCFTRozT_276D3oY';
const DEFAULT_SHEET_NAME = 'DanhSachThi';

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'getInitialData') {
    let payload;
    try {
      payload = getInitialData();
    } catch (err) {
      // Trả JSON thay vì trang lỗi HTML, để phía client đọc được thông báo.
      payload = { error: true, message: err.message || String(err) };
    }
    return ContentService.createTextOutput(JSON.stringify(payload))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Lễ tân Check-in - Taekwondo Kids')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    let contents = {};
    if (e && e.postData && e.postData.contents) {
      contents = JSON.parse(e.postData.contents);
    }

    if (contents.action === 'checkin') {
      const res = checkInCandidate(contents.rowIndex, 'checkin');
      return ContentService.createTextOutput(JSON.stringify(res))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (contents.action === 'verifyPin') {
      const res = verifyAdminPin(contents.pin);
      return ContentService.createTextOutput(JSON.stringify(res))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (contents.action === 'updateSource') {
      const res = updateSpreadsheetSource(contents.newUrlOrId, contents.newSheetName, contents.adminToken);
      return ContentService.createTextOutput(JSON.stringify(res))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'Action không hợp lệ' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'Lỗi POST API: ' + err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

const NOT_ADMIN_MESSAGE = 'Chỉ quản trị viên mới được quyền cập nhật danh sách này';

const PIN_HASH_PROP = 'ADMIN_PIN_HASH';
const TOKEN_CACHE_PREFIX = 'ADMIN_TOKEN_';
const TOKEN_TTL_SECONDS = 3600;        // Phiên quản trị sống 60 phút
const FAIL_CACHE_KEY = 'ADMIN_PIN_FAILS';
const MAX_FAILS = 15;                  // Quá số này thì khoá tạm 10 phút
const FAIL_WINDOW_SECONDS = 600;

/**
 * CHẠY TAY MỘT LẦN trong trình soạn thảo Apps Script để đặt mã quản trị.
 * Sửa giá trị NEW_PIN bên dưới -> chọn hàm setupAdminPin -> bấm Chạy.
 * Sau khi chạy xong nên đổi NEW_PIN về chuỗi rỗng để không lưu mã trong code.
 */
function setupAdminPin() {
  const NEW_PIN = '';   // <-- ĐẶT MÃ CỦA BẠN VÀO ĐÂY

  if (!NEW_PIN || String(NEW_PIN).trim().length < 6) {
    throw new Error('Hãy đặt NEW_PIN dài ít nhất 6 ký tự rồi chạy lại hàm này.');
  }
  PropertiesService.getScriptProperties()
    .setProperty(PIN_HASH_PROP, hashPin_(String(NEW_PIN).trim()));
  Logger.log('Đã đặt mã quản trị thành công. Hãy xoá giá trị NEW_PIN trong code ngay bây giờ.');
}

function hashPin_(pin) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(pin), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ((b & 0xFF) + 0x100).toString(16).slice(1); }).join('');
}

/** Nhận mã PIN, trả về token phiên nếu đúng. Đây là cổng kiểm tra quyền duy nhất. */
function verifyAdminPin(pin) {
  const cache = CacheService.getScriptCache();

  const fails = Number(cache.get(FAIL_CACHE_KEY) || 0);
  if (fails >= MAX_FAILS) {
    return { success: false, message: 'Nhập sai quá nhiều lần. Vui lòng thử lại sau 10 phút.' };
  }

  const storedHash = PropertiesService.getScriptProperties().getProperty(PIN_HASH_PROP);
  if (!storedHash) {
    return { success: false, message: 'Chưa đặt mã quản trị. Hãy chạy hàm setupAdminPin trong Apps Script.' };
  }

  if (!pin || hashPin_(String(pin).trim()) !== storedHash) {
    cache.put(FAIL_CACHE_KEY, String(fails + 1), FAIL_WINDOW_SECONDS);
    Utilities.sleep(1000);   // Làm chậm dò mã tự động
    return { success: false, message: NOT_ADMIN_MESSAGE };
  }

  cache.remove(FAIL_CACHE_KEY);
  const token = Utilities.getUuid();
  cache.put(TOKEN_CACHE_PREFIX + token, '1', TOKEN_TTL_SECONDS);
  return { success: true, token: token, message: 'Đã mở khoá quyền quản trị.' };
}

function isValidAdminToken_(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get(TOKEN_CACHE_PREFIX + String(token)) === '1';
}

/** Chủ script mở app bằng chính tài khoản admin thì không cần nhập mã. */
function checkIsAdmin() {
  try {
    const activeUser = Session.getActiveUser() ? Session.getActiveUser().getEmail() : '';
    const currentUser = String(activeUser || '').toLowerCase().trim();
    return currentUser !== '' && currentUser === ADMIN_EMAIL.toLowerCase();
  } catch (e) {
    console.log('Error getting user email: ' + e.toString());
    return false;
  }
}

function extractSpreadsheetId(input) {
  if (!input) return '';
  var str = String(input).trim();

  // 1. Dạng link chuẩn: .../spreadsheets/d/<ID>/edit#gid=0
  var dMatch = str.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch && dMatch[1]) {
    return String(dMatch[1]);
  }

  // 2. Dạng link cũ: ...?id=<ID>&...
  var qMatch = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (qMatch && qMatch[1]) {
    return String(qMatch[1]);
  }

  // 3. Người dùng dán thẳng ID
  var idMatch = str.match(/([a-zA-Z0-9_-]{20,})/);
  if (idMatch && idMatch[1]) {
    return String(idMatch[1]);
  }

  return str;
}

function getActiveSpreadsheetConfig() {
  const props = PropertiesService.getScriptProperties();
  let ssId = String(props.getProperty('ACTIVE_SPREADSHEET_ID') || '').trim();

  // Nếu property lỡ bị ghi rác (link đầy đủ, mảng, chuỗi rỗng...) thì tự làm sạch.
  if (ssId && !/^[a-zA-Z0-9_-]{20,}$/.test(ssId)) {
    ssId = extractSpreadsheetId(ssId);
  }
  if (!ssId || !/^[a-zA-Z0-9_-]{20,}$/.test(ssId)) {
    ssId = DEFAULT_SPREADSHEET_ID;
  }

  const sheetName = String(props.getProperty('ACTIVE_SHEET_NAME') || '').trim() || DEFAULT_SHEET_NAME;
  return { ssId: ssId, sheetName: sheetName };
}

/** Chạy tay trong trình soạn thảo Apps Script nếu lỡ lưu nhầm nguồn và web app không load được nữa. */
function resetSpreadsheetSource() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('ACTIVE_SPREADSHEET_ID');
  props.deleteProperty('ACTIVE_SHEET_NAME');
  Logger.log('Đã reset về nguồn mặc định: ' + DEFAULT_SPREADSHEET_ID + ' / ' + DEFAULT_SHEET_NAME);
}

function updateSpreadsheetSource(newUrlOrId, newSheetName, adminToken) {
  try {
    if (!isValidAdminToken_(adminToken) && !checkIsAdmin()) {
      return { success: false, message: NOT_ADMIN_MESSAGE };
    }

    if (!newUrlOrId || !String(newUrlOrId).trim()) {
      return { success: false, message: 'Vui lòng nhập Link hoặc ID của file Google Sheet mới!' };
    }

    const cleanId = extractSpreadsheetId(newUrlOrId);

    if (!cleanId || !/^[a-zA-Z0-9_-]{20,}$/.test(cleanId)) {
      return {
        success: false,
        message: 'ID file không hợp lệ (đọc được: "' + cleanId + '"). Hãy dán nguyên link dạng https://docs.google.com/spreadsheets/d/<ID>/edit'
      };
    }

    const ss = openSpreadsheetSafely(cleanId);
    const targetSheetName = newSheetName && String(newSheetName).trim() ? String(newSheetName).trim() : DEFAULT_SHEET_NAME;
    const sheet = ss.getSheetByName(targetSheetName) || ss.getSheets()[0];

    if (!sheet) {
      return { success: false, message: 'File "' + ss.getName() + '" không có trang tính nào.' };
    }

    const props = PropertiesService.getScriptProperties();
    props.setProperty('ACTIVE_SPREADSHEET_ID', cleanId);
    props.setProperty('ACTIVE_SHEET_NAME', sheet.getName());

    return {
      success: true,
      message: 'Đã chuyển nguồn dữ liệu sang "' + ss.getName() + '" (trang: ' + sheet.getName() + ')',
      ssTitle: ss.getName(),
      sheetName: sheet.getName(),
      ssId: cleanId
    };
  } catch (err) {
    return { success: false, message: 'Không thể mở file Google Sheet mới: ' + err.message };
  }
}

/**
 * Mở spreadsheet theo ID; nếu thất bại thì thử lại bằng URL đầy đủ.
 * Luôn ép về chuỗi để tránh lỗi "Illegal spreadsheet id or key" khi lỡ truyền vào mảng/đối tượng.
 */
function openSpreadsheetSafely(id) {
  const strId = String(id).trim();
  try {
    return SpreadsheetApp.openById(strId);
  } catch (e) {
    try {
      return SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/' + strId + '/edit');
    } catch (e2) {
      throw new Error(
        'Không mở được file có ID "' + strId + '". ' +
        'Kiểm tra: (1) ID đúng chưa, (2) tài khoản chạy script đã được chia sẻ quyền xem/sửa file này chưa. ' +
        'Chi tiết: ' + e.message
      );
    }
  }
}

function getInitialData() {
  try {
    const isAdmin = checkIsAdmin();
    let currentUserEmail = '';
    try {
      currentUserEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
    } catch(e) {}

    const config = getActiveSpreadsheetConfig();
    const ss = openSpreadsheetSafely(config.ssId);
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

    // Dọn cột "Thời gian check-in" thừa bằng MỘT lệnh ghi duy nhất.
    // Trước đây mỗi dòng là một lệnh setValue riêng: với 656 dòng thì đó là
    // 656 lượt gọi sang Google Sheets, chính là nguyên nhân tải trang rất chậm.
    if (rowsToClearTimestamp.length > 0) {
      const firstRow = rowsToClearTimestamp[0];
      const lastRow = rowsToClearTimestamp[rowsToClearTimestamp.length - 1];
      const needClear = {};
      rowsToClearTimestamp.forEach(function (r) { needClear[r] = true; });

      const block = sheet.getRange(firstRow, 10, lastRow - firstRow + 1, 1).getValues();
      for (let r = firstRow; r <= lastRow; r++) {
        if (needClear[r]) block[r - firstRow][0] = '';
      }
      sheet.getRange(firstRow, 10, block.length, 1).setValues(block);
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

function checkInCandidate(rowIndex, action) {
  try {
    const config = getActiveSpreadsheetConfig();
    const ss = openSpreadsheetSafely(config.ssId);
    const sheet = ss.getSheetByName(config.sheetName) || ss.getSheets()[0];
    
    if (action === 'checkin') {
      const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss dd/MM/yyyy');
      // Ghi 2 ô bằng 1 lệnh thay vì 2 -> check-in phản hồi nhanh hơn.
      sheet.getRange(rowIndex, 9, 1, 2).setValues([['Đã check-in', nowStr]]);
      return { success: true, message: 'Check-in thành công', time: nowStr, status: 'Đã check-in' };
    }
  } catch (error) {
    return { success: false, message: 'Lỗi ghi dữ liệu: ' + error.message };
  }
}

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
