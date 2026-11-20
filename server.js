const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
// ВАЖНО: задайте свой пароль через переменную окружения ADMIN_PASSWORD на хостинге
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
// Если хостинг стирает файлы при перезапуске — укажите DATA_DIR на постоянный диск (volume)
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'grades.json');

const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DEFAULT_GRADES = [
  { id: 'd1', subject: 'Химия', value: 4, weight: 10, date: '18.11 (Ср)', iso: '2026-11-18', extra: false },
  { id: 'd2', subject: 'Биология', value: 4, weight: 10, date: '17.11 (Вт)', iso: '2026-11-17', extra: false },
  { id: 'd3', subject: 'Ин. яз. 1', value: 5, weight: 10, date: '13.11 (Пт)', iso: '2026-11-13', extra: false },
  { id: 'd4', subject: 'Химия', value: 3, weight: 10, date: '11.11 (Ср)', iso: '2026-11-11', extra: false },
  { id: 'd5', subject: 'Химия', value: 3, weight: 10, date: '05.11 (Чт)', iso: '2026-11-05', extra: false }
];

function readGrades() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}
  writeGrades(DEFAULT_GRADES);
  return DEFAULT_GRADES.slice();
}
function writeGrades(list) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function sortGrades(list) {
  return list.sort((a, b) => (b.iso || '').localeCompare(a.iso || ''));
}
function dateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')} (${DAYS[dow]})`;
}
function isAuthed(req) {
  const given = Buffer.from(String(req.headers['x-admin-password'] || ''));
  const real = Buffer.from(ADMIN_PASSWORD);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
}
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, cb) {
  let data = '';
  req.on('data', c => { data += c; if (data.length > 10000) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(data || '{}')); } catch (e) { cb(null); } });
}
function sendFile(res, names) {
  const file = names.map(n => path.join(__dirname, n)).find(f => fs.existsSync(f));
  if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Файл не найден'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api/grades' && req.method === 'GET') {
    return send(res, 200, sortGrades(readGrades()));
  }

  if (url === '/api/grades' && req.method === 'POST') {
    if (!isAuthed(req)) return send(res, 401, { error: 'Неверный пароль' });
    return readBody(req, b => {
      const value = Number(b && b.value), weight = Number(b && b.weight);
      const subject = String((b && b.subject) || '').trim().slice(0, 80);
      const iso = String((b && b.iso) || '');
      if (!subject || ![2, 3, 4, 5].includes(value) || !(weight >= 1 && weight <= 100) || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        return send(res, 400, { error: 'Неверные данные' });
      }
      const list = readGrades();
      list.push({ id: crypto.randomUUID(), subject, value, weight, date: dateLabel(iso), iso, extra: true });
      writeGrades(sortGrades(list));
      send(res, 200, { ok: true });
    });
  }

  if (url.startsWith('/api/grades/') && req.method === 'DELETE') {
    if (!isAuthed(req)) return send(res, 401, { error: 'Неверный пароль' });
    const id = decodeURIComponent(url.slice('/api/grades/'.length));
    writeGrades(readGrades().filter(g => g.id !== id));
    return send(res, 200, { ok: true });
  }

  if (url === '/api/check' && req.method === 'GET') {
    return isAuthed(req) ? send(res, 200, { ok: true }) : send(res, 401, { error: 'Неверный пароль' });
  }

  if (url === '/admin') return sendFile(res, ['admin.html', 'public/admin.html']);
  return sendFile(res, ['index.html', 'public/index.html']);
});

server.listen(PORT, '0.0.0.0', () => console.log(`Сервер запущен на порту ${PORT}`));
