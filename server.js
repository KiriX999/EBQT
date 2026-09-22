#!/usr/bin/env node
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';
const HTML_FILE = path.join(__dirname, 'quizbuzz.html');
const STATE_FILE = path.join(__dirname, 'qb-state.json');

function defaultState() {
  return {
    room: { round: 1, status: 'idle', question: '', questionAt: null, resultsAt: null, updatedAt: Date.now() },
    prof: null,
    students: {}
  };
}

let state = defaultState();
try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (saved && saved.room && saved.students) state = saved;
  console.log('Stato precedente ricaricato da', STATE_FILE);
} catch { /* nessuno stato salvato: si parte da zero */ }

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(STATE_FILE, JSON.stringify(state), err => {
      if (err) console.error('Salvataggio stato fallito:', err.message);
    });
  }, 200);
}



const clients = new Set();
function broadcast() {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) res.write(payload);
}

function applyAction(msg) {
  if (!msg || typeof msg.type !== 'string') return false;
  switch (msg.type) {
    case 'setRoom':
      if (!msg.patch || typeof msg.patch !== 'object') return false;
      state.room = { ...state.room, ...msg.patch, updatedAt: Date.now() };
      return true;
    case 'setStudent':
      if (!msg.rec || !msg.rec.id) return false;
      state.students[msg.rec.id] = msg.rec;
      return true;
    case 'removeStudent':
      if (!msg.id) return false;
      delete state.students[msg.id];
      return true;
    case 'setProf':
      state.prof = msg.prof || null;
      return true;
    case 'removeProf':
      state.prof = null;
      return true;
    default:
      return false;
  }
}

let html;
function loadHtml() { html = fs.readFileSync(HTML_FILE); }
loadHtml();

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && (url === '/' || url === '/index.html' || url === '/quizbuzz.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (req.method === 'GET' && url === '/qb-events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(':ping\n\n'); } catch { /* client già chiuso */ } }, 20000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (req.method === 'POST' && url === '/qb-action') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy(); 
    });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body || '{}');
        if (applyAction(msg)) { persist(); broadcast(); }
        res.writeHead(204);
        res.end();
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Richiesta non valida');
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Non trovato');
});

server.listen(PORT, HOST, () => {
  console.log(`QuizBuzz è online su http://${HOST}:${PORT}`);
  console.log(`Dai computer della rete scolastica: http://<ip-di-questo-pc>:${PORT}`);
});
