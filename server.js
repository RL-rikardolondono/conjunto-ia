'use strict';
/* Conjunto-IA — servidor de producción (reconstruido el 13 nov 2026).
   Express + PostgreSQL (Neon). Sirve public/index.html y la API que usa la página.
   Variables: DATABASE_URL, BASE_URL (https://conjunto-ia.skynetgenesis.com), BREVO_API_KEY,
   CORREO_REMITENTE, DUENO_CUENTAS, FIRMADOR_URL, VERIFICADOR_URL, PORT. */
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const APP = 'conjunto-ia';
const UA = 'SkyNetGenesis-ConjuntoIA/1.0';
const SUPER_CORREO = 'superadmin.conjunto@skynetgenesis.com';
const PLANES = [
  { id: 'p40', max: 40, precio: 89000 }, { id: 'p120', max: 120, precio: 139000 },
  { id: 'p300', max: 300, precio: 199000 }, { id: 'p600', max: 600, precio: 279000 }
];
const EXTRA100 = 40000;
const MODULOS = { asambleas: 290000, multas: 120000, mantenimiento: 150000, proveedores: 110000, importar: 60000, web: 490000 }; // pagoslinea: próximamente, no se vende
const TABLAS = ['unidades','visitas','paquetes','parq','minuta','comunicados','zonas','reservas','pqrs','cuotas','pagos','avisos','gastos','fondo','mudanzas','restric','puntos','rondas','oblig','ordenes','bienes','personal','proveedores','asambleas','reuniones','procesos','documentos','bitacora'];
const TODAS = new Set(TABLAS);
const PERM = {
  admin: TODAS,
  auxiliar: new Set(['visitas','paquetes','parq','reservas','pqrs','pagos','mudanzas','avisos','bitacora','comunicados','unidades','minuta']),
  porteria: new Set(['visitas','paquetes','parq','minuta','mudanzas','rondas','avisos','bitacora','reservas']),
  vigilancia: new Set(['rondas','puntos','minuta','restric','visitas','avisos','bitacora']),
  contador: new Set(['cuotas','pagos','gastos','fondo','documentos','avisos','bitacora']),
  consejo: new Set(['reuniones','asambleas','documentos','comunicados','gastos','pagos','avisos','bitacora','ordenes','procesos']),
  revisor: new Set(['avisos','bitacora']),
  residente: new Set(['visitas','reservas','pqrs','pagos','asambleas','avisos','comunicados','mudanzas','bitacora','procesos','paquetes'])
};
const APRUEBAN_PAGOS = new Set(['admin','consejo','contador','auxiliar']);
const PROTEGIDOS_CJ = ['id','pagadoHasta','pruebaHasta','interna','modulos','codigo','creado','nit','avisosEnviados','bloqueado'];

/* ---------------- utilidades ---------------- */
const iso = d => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const hoyCO = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10); // hora de Colombia
const addD = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const finMes = f => { const d = new Date(f + 'T12:00:00Z'); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10); };
const ymd = (y, m, d) => new Date(Date.UTC(y, m, d, 12)).toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
const rid = (p = '') => p + crypto.randomBytes(9).toString('base64url');
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const ahora = () => new Date().toISOString();
const correoOk = c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c || '');
function hashClave(clave) { const sal = crypto.randomBytes(16); const h = crypto.scryptSync(String(clave), sal, 64); return 'scrypt$' + sal.toString('hex') + '$' + h.toString('hex'); }
function claveOk(clave, guardado) {
  if (!guardado || !guardado.startsWith('scrypt$')) return false;
  const [, s, h] = guardado.split('$'); const x = crypto.scryptSync(String(clave), Buffer.from(s, 'hex'), 64);
  return crypto.timingSafeEqual(x, Buffer.from(h, 'hex'));
}
function planDe(n) { n = +n || 0; const p = PLANES.find(x => n <= x.max); if (p) return { id: p.id, precio: p.precio, extra: 0 }; const extra = Math.ceil((n - 600) / 100); return { id: 'p600', precio: 279000 + extra * EXTRA100, extra }; }
function estadoCJ(c, t = hoyCO()) {
  if (c.interna) return 'activa';
  if ((!c.pagadoHasta || c.pagadoHasta < c.pruebaHasta) && t <= c.pruebaHasta) return 'prueba';
  if (c.pagadoHasta && t <= c.pagadoHasta) return 'activa';
  if (c.pagadoHasta && c.pagadoHasta >= c.pruebaHasta) {
    const d = new Date(c.pagadoHasta + 'T12:00:00Z'); const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    if (t < ymd(y, m, 5)) return 'activa'; if (t < ymd(y, m, 10)) return 'aviso';
  }
  return 'cerrada';
}
function alDiaHasta(c, t = hoyCO()) { // igual que la página: fin del mes que cubre el pago
  if (c.pagadoHasta && c.pagadoHasta >= t && c.pagadoHasta >= c.pruebaHasta) return finMes(addD(c.pagadoHasta, 1));
  const ini = t <= c.pruebaHasta ? addD(c.pruebaHasta, 1) : t;
  const d = new Date(ini + 'T12:00:00Z');
  if (d.getUTCDate() <= 5) return finMes(ini);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0, 12)).toISOString().slice(0, 10);
}
function codigoCJ() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 6; i++) c += A[crypto.randomInt(A.length)]; return c; }
const RUBROS_BASE = ['Vigilancia','Aseo','Mantenimiento','Servicios públicos zonas comunes','Honorarios administración','Revisoría fiscal y contador','Seguros','Gastos bancarios','Imprevistos'];
function nuevoConjunto(d, t = hoyCO()) {
  return { id: rid('cj'), nombre: d.nombre, nit: d.nit, ciudad: d.ciudad, direccion: d.direccion, numUnidades: +d.numUnidades,
    pruebaHasta: addD(t, 14), pagadoHasta: null, interna: false, creado: t, presupuesto: 0, moraBloquea: true, interes: 0, comoPagar: '',
    modulos: [], pedido: Array.isArray(d.pedido) ? d.pedido.filter(x => typeof x === 'string').slice(0, 10) : [], codigo: codigoCJ(),
    fondoPct: 1, pronto: { pct: 0, dia: 10 }, cajaMenor: 0, cajaDesde: t, recordarMora: true,
    rubros: RUBROS_BASE.map((x, i) => ({ id: 'rb' + i, n: x, anual: 0 })), repLegal: d.admin, avisosEnviados: {} };
}
function sinHash(u) { if (!u) return u; const { hash, ...r } = u; return r; }
/* revisión triple (14 nov 2026): todo texto que guarda un usuario pasa por aquí antes de llegar a la base.
   < y > se cambian por ‹ › (nadie mete código en la pantalla de otro) y los campos de imagen solo aceptan imágenes reales. */
const CAMPOS_IMG = new Set(['foto', 'firma', 'fotoA', 'fotoD', 'imagen', 'logo']);
const IMG_OK = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;
function sanear(v, clave = '', prof = 0) {
  if (prof > 12) return null;
  if (typeof v === 'string') {
    if (CAMPOS_IMG.has(clave)) return IMG_OK.test(v) ? v : null;
    if (v.startsWith('data:') && /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=\s]*$/.test(v)) return v; // documentos adjuntos
    return v.replace(/</g, '‹').replace(/>/g, '›');
  }
  if (Array.isArray(v)) return v.map(x => sanear(x, clave === 'fotos' ? 'foto' : '', prof + 1));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) { if (k === '__proto__' || k === 'constructor') continue; o[k] = sanear(x, k, prof + 1); } return o; }
  return v;
}
/* límites simples por IP o por correo (enlaces de contraseña, registro, códigos de inscripción) */
const LIM = new Map();
function limite(k, max, ms) { const t = Date.now(); const a = (LIM.get(k) || []).filter(x => x > t - ms); if (a.length >= max) { LIM.set(k, a); return false; } a.push(t); LIM.set(k, a); if (LIM.size > 5000) for (const [kk, vv] of LIM) if (!vv.some(x => x > t - 36e5)) LIM.delete(kk); return true; }
/* fusión de tres vías (asambleas: votos y asistencia de varias personas a la vez) */
function fusion(base, mio, serv) {
  if (JSON.stringify(mio) === JSON.stringify(base)) return serv;
  if (JSON.stringify(serv) === JSON.stringify(base)) return mio;
  if (Array.isArray(mio) && Array.isArray(serv)) {
    const conId = a => a.every(x => x && typeof x === 'object' && x.id != null);
    if (conId(mio) && conId(serv) && Array.isArray(base) && conId(base)) {
      const B = new Map(base.map(x => [x.id, x])), M = new Map(mio.map(x => [x.id, x])), out = [];
      for (const s of serv) { if (M.has(s.id)) out.push(fusion(B.get(s.id), M.get(s.id), s)); else if (!B.has(s.id)) out.push(s); }
      for (const m of mio) if (!B.has(m.id) && !serv.some(s => s.id === m.id)) out.push(m);
      return out;
    }
    return mio;
  }
  if (mio && serv && typeof mio === 'object' && typeof serv === 'object') {
    const b = base && typeof base === 'object' ? base : {}; const out = { ...serv };
    for (const k of new Set([...Object.keys(mio), ...Object.keys(b)])) {
      if (!(k in mio)) { if (JSON.stringify(b[k]) === JSON.stringify(serv[k])) delete out[k]; continue; }
      out[k] = fusion(b[k], mio[k], serv[k]);
    }
    return out;
  }
  return mio;
}

/* ---------------- base de datos ---------------- */
const ESQUEMA = `
create table if not exists conjuntos (id text primary key, d jsonb not null, creado timestamptz default now());
create table if not exists usuarios (id text primary key, cj text not null, correo text not null, perfil text not null, hash text, d jsonb not null);
create table if not exists reg (cj text not null, t text not null, id text not null, d jsonb, ver bigint not null, borrado boolean default false, primary key (cj, t, id));
create table if not exists contador (k text primary key, v bigint not null);
create table if not exists sesiones (token text primary key, uid text, cj text, super boolean default false, expira timestamptz not null);
create table if not exists enlaces (token text primary key, uid text not null, tipo text not null, expira timestamptz not null, usado boolean default false);
create table if not exists pedidos (orden text primary key, cj text not null, conceptos jsonb not null, plan text not null, valor bigint not null, estado text not null, creado timestamptz default now(), pago_id text);
create table if not exists pagos (pago_id text primary key, orden text, cj text, valor bigint, estado text not null, detalle text, creado timestamptz default now());
create table if not exists config (k text primary key, v text);
create table if not exists bitacora_sa (id text primary key, fecha timestamptz default now(), texto text);
`;

function crearApp({ pool, fetchFn = (...a) => fetch(...a), env = process.env, ahoraFn = hoyCO, enviarCorreo } = {}) {
  const BASE = (env.BASE_URL || 'https://conjunto-ia.skynetgenesis.com').replace(/\/$/, '');
  const FIRMADOR = env.FIRMADOR_URL || 'https://skynetgenesis.com/bold-firma.php';
  const VERIFICADOR = env.VERIFICADOR_URL || 'https://skynetgenesis.com/bold-verificar.php';
  const DUENO = env.DUENO_CUENTAS || 'rikardolondono@gmail.com';
  const q = (sql, p) => pool.query(sql, p);
  const correo = enviarCorreo || (async (para, asunto, html) => {
    if (!env.BREVO_API_KEY) { console.log('[correo sin Brevo]', para, asunto); return false; }
    const r = await fetchFn('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: 'Conjunto-IA', email: env.CORREO_REMITENTE || 'conjunto-ia@skynetgenesis.com' }, to: [{ email: para }], subject: asunto,
        htmlContent: html + '<hr><p style="font-size:12px;color:#5D6B78">Conjunto-IA, una aplicación de SkyNet Genesis · contacto@skynetgenesis.com · WhatsApp 304 437 5758</p>' }) });
    return r.ok;
  });

  async function sigVer() { const r = await q("update contador set v = v + 1 where k = 'ver' returning v"); return Number(r.rows[0].v); }
  async function sigNum(k) { const r = await q('update contador set v = v + 1 where k = $1 returning v', [k]); if (r.rows.length) return Number(r.rows[0].v); await q('insert into contador (k, v) values ($1, 1)', [k]); return 1; }
  async function getCJ(id) { const r = await q('select d from conjuntos where id = $1', [id]); return r.rows[0] ? r.rows[0].d : null; }
  async function setCJ(c) { await q('update conjuntos set d = $2 where id = $1', [c.id, JSON.stringify(c)]); }
  async function getU(id) { const r = await q('select * from usuarios where id = $1', [id]); if (!r.rows[0]) return null; const x = r.rows[0]; return { ...x.d, id: x.id, cj: x.cj, correo: x.correo, perfil: x.perfil, hash: x.hash }; }
  async function guardarU(u) {
    const { hash, ...d } = u; delete d.hash;
    const ex = await q('select id from usuarios where id = $1', [u.id]);
    if (ex.rows.length) await q('update usuarios set cj=$2, correo=$3, perfil=$4, hash=coalesce($5, hash), d=$6 where id=$1', [u.id, u.cj, u.correo, u.perfil, hash || null, JSON.stringify(d)]);
    else await q('insert into usuarios (id, cj, correo, perfil, hash, d) values ($1,$2,$3,$4,$5,$6)', [u.id, u.cj, u.correo, u.perfil, hash || null, JSON.stringify(d)]);
  }
  async function usuariosCJ(cj) { const r = await q('select * from usuarios where cj = $1', [cj]); return r.rows.map(x => sinHash({ ...x.d, id: x.id, cj: x.cj, correo: x.correo, perfil: x.perfil })); }
  async function bita(cj, quien, texto) { const id = rid('b'); await q('insert into reg (cj, t, id, d, ver) values ($1,$2,$3,$4,$5)', [cj, 'bitacora', id, JSON.stringify({ id, cj, fecha: ahora(), quien, texto }), await sigVer()]); }
  async function bitaSA(texto) { await q('insert into bitacora_sa (id, texto) values ($1,$2)', [rid('s'), texto]); }
  async function nuevaSesion(uid, cj, sup = false) { const tok = crypto.randomBytes(32).toString('base64url'); await q('insert into sesiones (token, uid, cj, super, expira) values ($1,$2,$3,$4,$5)', [sha(tok), uid, cj, sup, new Date(Date.now() + 30 * 864e5).toISOString()]); return tok; }
  async function misConjuntos(correoU) {
    const r = await q('select u.id, u.cj, u.perfil, u.d from usuarios u where u.correo = $1', [correoU]); const out = [];
    for (const x of r.rows) { if (x.d.activo === false || x.d.bloqueado) continue; const c = await getCJ(x.cj); if (c) out.push({ uid: x.id, cj: x.cj, nombre: c.nombre, ciudad: c.ciudad, perfil: x.perfil }); }
    return out;
  }
  async function estado(cj, u) {
    const c = await getCJ(cj); const r = await q('select t, id, d from reg where cj = $1 and borrado = false', [cj]);
    const v = await q("select v from contador where k = 'ver'");
    return { conjunto: c, usuarios: await usuariosCJ(cj), registros: r.rows.map(x => ({ t: x.t, id: x.id, d: x.d })), ver: Number(v.rows[0].v), misConjuntos: u && u.correo ? await misConjuntos(u.correo) : [] };
  }
  async function respuestaSesion(u) { const tok = await nuevaSesion(u.id, u.cj); await q('update usuarios set d = jsonb_set(d, \'{ultimo}\', to_jsonb($2::text)) where id = $1', [u.id, ahora()]).catch(() => {}); return { token: tok, usuario: sinHash(u), estado: await estado(u.cj, u) }; }
  async function enviarEnlace(u, tipo = 'clave') {
    const tok = crypto.randomBytes(24).toString('base64url');
    await q('insert into enlaces (token, uid, tipo, expira) values ($1,$2,$3,$4)', [sha(tok), u.id, tipo, new Date(Date.now() + 3600e3).toISOString()]);
    const para = u.id === 'super' ? DUENO : u.correo;
    const url = BASE + '/#clave-' + tok;
    await correo(para, 'Cree su contraseña de Conjunto-IA', `<p>Hola${u.nombre ? ' ' + u.nombre : ''}:</p><p>Use este enlace para crear su contraseña de Conjunto-IA. Sirve una sola vez y vence en 1 hora.</p><p><a href="${url}">${url}</a></p>`);
    return para;
  }
  /* intentos de ingreso: 5 por 15 minutos */
  const INT = new Map();
  function bloqueado(k) { const x = INT.get(k); return x && x.hasta > Date.now(); }
  function fallo(k) { const x = INT.get(k) || { n: 0, hasta: 0 }; x.n++; if (x.n >= 5) { x.hasta = Date.now() + 15 * 60e3; x.n = 0; } INT.set(k, x); }

  /* -------- Bold -------- */
  async function getJSON(url) { const r = await fetchFn(url, { headers: { 'user-agent': UA, accept: 'application/json' } }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, j }; }
  async function verificar(param) { // ?pago=id o ?ref=orden
    const { status, j } = await getJSON(VERIFICADOR + '?' + param + '&app=' + APP);
    if (status !== 200 || !j) return null;
    const o = j.orden || j.order || j.data || j;
    return o && (o.pago_id || o.pagoId) ? o : null; // la central no envía "estado": si devuelve pago_id, está aprobado
  }
  async function aplicarOrden(o, fuente) {
    const pagoId = String(o.pago_id || o.pagoId); const valor = Math.round(+o.valor || +o.amount || 0);
    const empresa = String(o.empresa || ''); const plan = String(o.plan || ''); const orden = String(o.ref || o.orden || o.order_id || o.orderId || '');
    const prev = await q('select estado from pagos where pago_id = $1', [pagoId]); if (prev.rows.length) return prev.rows[0].estado;
    const [cjId, pedId] = empresa.split('__');
    let ped = null; if (orden) ped = (await q('select * from pedidos where orden = $1', [orden])).rows[0];
    if (!ped && pedId) ped = (await q("select * from pedidos where orden like $1", ['%' + pedId])).rows[0];
    let est = 'revisar', det = '';
    if (cjId === 'plataforma') { est = 'prueba'; det = 'Pago de prueba de $1.000'; }
    else if (!ped) det = 'Pedido no encontrado';
    else if (ped.estado === 'pagado') det = 'Segundo pago del mismo pedido';
    else if (plan && plan !== ped.plan) det = 'El plan pagado no coincide con el pedido';
    else if (valor < Number(ped.valor)) det = 'Valor menor al del pedido';
    else {
      const c = await getCJ(ped.cj); if (!c) det = 'Conjunto no existe';
      else {
        const cs = ped.conceptos; const nuevos = [];
        if (cs.mensual) { c.pagadoHasta = alDiaHasta(c, ahoraFn()); nuevos.push('mensualidad hasta ' + c.pagadoHasta); }
        for (const m of cs.mods || []) if (!c.modulos.includes(m)) { c.modulos.push(m); nuevos.push('módulo ' + m); }
        await setCJ(c); est = 'aplicado'; det = nuevos.join(', ');
        await bita(c.id, 'Bold', 'Pago con Bold aplicado: ' + det + ' (' + valor + ')');
      }
    }
    try { await q('insert into pagos (pago_id, orden, cj, valor, estado, detalle) values ($1,$2,$3,$4,$5,$6)', [pagoId, orden || (ped && ped.orden), ped ? ped.cj : cjId, valor, est, det + ' · ' + fuente]); }
    catch (e) { const r = await q('select estado from pagos where pago_id = $1', [pagoId]); return r.rows[0] ? r.rows[0].estado : est; }
    if (ped && est === 'aplicado') await q("update pedidos set estado = 'pagado', pago_id = $2 where orden = $1", [ped.orden, pagoId]);
    if (est === 'revisar') await bitaSA('Pago para revisar: ' + det + ' (' + pagoId + ')');
    return est;
  }
  async function firmar(plan, empresa) {
    const url = FIRMADOR + '?plan=' + encodeURIComponent(plan) + '&empresa=' + encodeURIComponent(empresa) + '&meses=1&volver=' + encodeURIComponent(BASE + '/');
    const { status, j } = await getJSON(url);
    if (status !== 200 || !j || j.error || j.ok === false) throw Object.assign(new Error('La pasarela de pagos no respondió. Intente de nuevo en unos minutos.'), { status: 502 });
    return j;
  }
  async function revisarPendientes() {
    const r = await q("select orden from pedidos where estado = 'pendiente' and creado > $1", [new Date(Date.now() - 3 * 864e5).toISOString()]);
    for (const x of r.rows) { try { const o = await verificar('ref=' + encodeURIComponent(x.orden)); if (o) await aplicarOrden({ ...o, ref: o.ref || x.orden }, 'revisión automática'); } catch (e) {} }
  }

  /* -------- avisos por correo (fin de prueba 3 y 1 días; mensualidad días 5 y 8) -------- */
  async function avisosDiarios() {
    const t = ahoraFn(); const r = await q('select d from conjuntos'); let n = 0;
    for (const { d: c } of r.rows) {
      if (c.interna || c.bloqueado) continue; c.avisosEnviados = c.avisosEnviados || {}; let clave = null, asunto = '', txt = '';
      const quedan = diasEntre(t, c.pruebaHasta);
      if ((!c.pagadoHasta || c.pagadoHasta < c.pruebaHasta) && (quedan === 3 || quedan === 1)) { clave = 'prueba-' + quedan; asunto = 'Su prueba de Conjunto-IA termina en ' + quedan + (quedan === 1 ? ' día' : ' días'); txt = 'Para seguir usando Conjunto-IA sin interrupciones, pague la mensualidad desde la app (Pagar con Bold).'; }
      const est = estadoCJ(c, t); const dia = +t.slice(8);
      if (!clave && est === 'aviso' && (dia === 5 || dia === 8)) { clave = 'mes-' + t.slice(0, 7) + '-' + dia; asunto = 'Mensualidad pendiente de Conjunto-IA'; txt = 'La mensualidad de su conjunto está pendiente. El día 10 se cierra el acceso. Pague desde la app con Bold.'; }
      if (!clave || c.avisosEnviados[clave]) continue;
      const us = (await usuariosCJ(c.id)).filter(u => u.perfil === 'admin' && u.activo !== false);
      for (const u of us) { await correo(u.correo, asunto, `<p>${c.nombre}:</p><p>${txt}</p><p><a href="${BASE}/">${BASE}</a></p>`); n++; }
      c.avisosEnviados[clave] = ahora(); await setCJ(c);
    }
    return n;
  }

  /* ---------------- rutas ---------------- */
  const app = express();
  app.disable('x-powered-by'); app.set('trust proxy', 1);
  app.use(express.json({ limit: '12mb' }));
  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'strict-origin-when-cross-origin'); next(); });
  const err = (res, st, m) => res.status(st).json({ error: m });
  const h = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => { if (!e.status) console.error(e); err(res, e.status || 500, e.status ? e.message : 'Ocurrió un error en el servidor. Intente de nuevo.'); });
  async function sesion(req) {
    const a = req.get('authorization') || ''; const tok = a.startsWith('Bearer ') ? a.slice(7) : '';
    if (!tok) return null; const r = await q('select * from sesiones where token = $1', [sha(tok)]); const s = r.rows[0];
    if (!s || new Date(s.expira) < new Date()) return null; return { ...s, tok: sha(tok) };
  }
  const auth = (fn, { superOk = false, soloSuper = false } = {}) => h(async (req, res) => {
    const s = await sesion(req); if (!s) return err(res, 401, 'Su sesión terminó. Ingrese de nuevo.');
    if (soloSuper && !(s.super && !s.cj)) return err(res, 403, 'Solo el Superadministrador.');
    let u = null;
    if (s.super) { if (!soloSuper && !s.cj && !superOk) return err(res, 403, 'Entre primero a un conjunto.'); u = { id: 'super', cj: s.cj, perfil: 'admin', nombre: 'Superadministrador', super: true }; }
    else { u = await getU(s.uid); if (!u || u.activo === false || u.bloqueado) return err(res, 401, 'Su cuenta no está activa.'); }
    req.s = s; req.u = u; return fn(req, res);
  });

  app.get('/health', (req, res) => res.json({ ok: true }));
  /* despertador diario (GitHub Actions del repositorio): revisa pagos pendientes y manda los avisos del día. Es idempotente. */
  let ultimoCron = 0;
  app.get('/api/cron', h(async (req, res) => {
    if (Date.now() - ultimoCron < 5 * 60e3) return res.json({ ok: true, omitido: true });
    ultimoCron = Date.now(); await revisarPendientes().catch(e => console.error('pendientes', e.message));
    const hora = new Date(Date.now() - 5 * 3600e3).getUTCHours(); const n = hora >= 8 ? await avisosDiarios() : 0; res.json({ ok: true, correos: n });
  }));
  app.get('/api/ping', h(async (req, res) => { res.json({ ok: true }); }));

  app.post('/api/registro', h(async (req, res) => {
    if (!limite('reg:' + req.ip, 6, 36e5)) return err(res, 429, 'Demasiados intentos de registro. Intente de nuevo en una hora.');
    const d = sanear(req.body || {}); const c0 = String(d.correo || '').toLowerCase().trim();
    if (!d.nombre || !d.nit || !d.ciudad || !d.direccion || !(+d.numUnidades > 0) || !d.admin) return err(res, 400, 'Complete todos los datos del conjunto y del administrador.');
    if (!correoOk(c0)) return err(res, 400, 'Escriba un correo válido.'); if (String(d.clave || '').length < 10) return err(res, 400, 'La contraseña debe tener mínimo 10 caracteres.');
    if (!d.acepto) return err(res, 400, 'Debe aceptar los términos de uso y el tratamiento de datos.');
    const nitN = String(d.nit).replace(/\D/g, '');
    const ya = await q('select id from usuarios where correo = $1', [c0]); const todos = await q('select d from conjuntos');
    const norm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const telN = String(d.celular || '').replace(/\D/g, '').slice(-10); const nomN = norm(d.nombre) + '|' + norm(d.ciudad);
    const telYa = telN.length >= 7 && (await q('select d from usuarios')).rows.some(x => String(x.d.tel || '').replace(/\D/g, '').slice(-10) === telN && x.d.perfil !== 'residente');
    if (ya.rows.length || telYa || todos.rows.some(x => String(x.d.nit || '').replace(/\D/g, '') === nitN || norm(x.d.nombre) + '|' + norm(x.d.ciudad) === nomN)) return err(res, 409, 'Este correo, celular, NIT o conjunto ya tuvo una cuenta. La prueba gratis es una sola vez; si ya tiene cuenta, use «Ingresar».');
    const c = nuevoConjunto({ ...d, numUnidades: +d.numUnidades }, ahoraFn());
    await q('insert into conjuntos (id, d) values ($1,$2)', [c.id, JSON.stringify(c)]);
    const u = { id: rid('u'), cj: c.id, nombre: String(d.admin).slice(0, 120), correo: c0, tel: String(d.celular || '').slice(0, 40), perfil: 'admin', cargo: 'Administración', activo: true, hash: hashClave(d.clave), datosAut: ahora() };
    await guardarU(u);
    const v = await sigVer(); const z = { id: rid('z'), cj: c.id, nombre: 'Salón social', cap: 50, aprob: true, deposito: 0, reglas: '', activa: true };
    await q('insert into reg (cj,t,id,d,ver) values ($1,$2,$3,$4,$5)', [c.id, 'zonas', z.id, JSON.stringify(z), v]);
    for (let i = 1; i <= 4; i++) { const p = { id: rid('pq'), cj: c.id, nombre: 'V' + i, placa: null, desde: null, visita: null, unidad: null }; await q('insert into reg (cj,t,id,d,ver) values ($1,$2,$3,$4,$5)', [c.id, 'parq', p.id, JSON.stringify(p), await sigVer()]); }
    await bita(c.id, u.nombre, 'Conjunto creado con prueba gratis hasta ' + c.pruebaHasta);
    await bitaSA('Conjunto nuevo: ' + c.nombre + ' (' + c.ciudad + ')');
    res.json(await respuestaSesion(u));
  }));

  const ELEGIR = new Map();
  app.post('/api/login', h(async (req, res) => {
    const c0 = String(req.body.correo || '').toLowerCase().trim(); const k = 'u:' + c0;
    if (bloqueado(k)) return err(res, 429, 'Acceso bloqueado 15 minutos por intentos fallidos.');
    const r = await q('select * from usuarios where correo = $1', [c0]); const us = r.rows.map(x => ({ ...x.d, id: x.id, cj: x.cj, correo: x.correo, perfil: x.perfil, hash: x.hash }));
    const ok = us.filter(u => claveOk(req.body.clave, u.hash));
    if (!ok.length) { fallo(k); return err(res, 401, 'Correo o contraseña incorrectos.'); }
    const act = ok.filter(u => u.activo !== false && !u.bloqueado);
    if (!act.length) return err(res, 403, ok.some(u => u.pendiente) ? 'Su inscripción está esperando la aprobación de la administración.' : 'Su cuenta está inactiva o bloqueada. Comuníquese con la administración.');
    INT.delete(k);
    if (act.length > 1) { const ticket = rid('t'); ELEGIR.set(ticket, { correo: c0, ids: act.map(u => u.id), hasta: Date.now() + 5 * 60e3 }); return res.json({ ticket, elegir: await misConjuntos(c0) }); }
    res.json(await respuestaSesion(act[0]));
  }));
  app.post('/api/login/elegir', h(async (req, res) => {
    const t = ELEGIR.get(req.body.ticket); if (!t || t.hasta < Date.now() || !t.ids.includes(req.body.uid)) return err(res, 401, 'Ingrese de nuevo.');
    ELEGIR.delete(req.body.ticket); res.json(await respuestaSesion(await getU(req.body.uid)));
  }));
  app.post('/api/cambiar', auth(async (req, res) => {
    const u2 = await getU(req.body.uid); if (!u2 || u2.correo !== req.u.correo || u2.activo === false || u2.bloqueado) return err(res, 403, 'No tiene acceso a ese conjunto.');
    await q('delete from sesiones where token = $1', [req.s.tok]); res.json(await respuestaSesion(u2));
  }));
  app.post('/api/salir', h(async (req, res) => { const s = await sesion(req); if (s) await q('delete from sesiones where token = $1', [s.tok]); res.json({ ok: true }); }));
  app.get('/api/estado', auth(async (req, res) => res.json(await estado(req.u.cj, req.u))));

  app.post('/api/olvido', h(async (req, res) => {
    const c0 = String(req.body.correo || '').toLowerCase().trim();
    if (!limite('olv:' + c0, 3, 36e5) || !limite('olvip:' + req.ip, 10, 36e5)) return res.json({ mensaje: 'Ya le enviamos enlaces hace poco. Revise su correo (también la carpeta de spam) o intente en una hora.' }); const r = await q('select * from usuarios where correo = $1', [c0]);
    for (const x of r.rows) { if (x.d.bloqueado) continue; await enviarEnlace({ ...x.d, id: x.id, correo: x.correo }); }
    res.json({ mensaje: 'Si el correo está registrado, le llegará un enlace para crear una contraseña nueva (vence en 1 hora).' });
  }));
  app.post('/api/clave', h(async (req, res) => {
    const clave = String(req.body.clave || ''); if (clave.length < 10) return err(res, 400, 'La contraseña debe tener mínimo 10 caracteres.');
    const r = await q('select * from enlaces where token = $1', [sha(req.body.token || '')]); const e = r.rows[0];
    if (!e || e.usado || new Date(e.expira) < new Date()) return err(res, 400, 'El enlace venció o ya se usó. Pida uno nuevo.');
    await q('update enlaces set usado = true where token = $1', [e.token]);
    if (e.uid === 'super') { await q("delete from config where k = 'superhash'"); await q("insert into config (k, v) values ('superhash', $1)", [hashClave(clave)]); await q('delete from sesiones where super = true'); await bitaSA('Contraseña del Superadministrador cambiada'); return res.json({ super: true }); }
    const u = await getU(e.uid); if (!u) return err(res, 400, 'La cuenta ya no existe.');
    u.hash = hashClave(clave); await guardarU(u); await q('delete from sesiones where uid = $1', [u.id]);
    if (u.activo === false) return res.json({ pendiente: true });
    res.json(await respuestaSesion(u));
  }));
  app.post('/api/cambiar-clave', auth(async (req, res) => {
    if (req.u.super) return err(res, 400, 'Use el acceso del Superadministrador.');
    if (!claveOk(req.body.actual, req.u.hash)) return err(res, 400, 'La contraseña actual no es correcta.');
    if (String(req.body.nueva || '').length < 10) return err(res, 400, 'Mínimo 10 caracteres.');
    req.u.hash = hashClave(req.body.nueva); await guardarU(req.u); await q('delete from sesiones where uid = $1 and token <> $2', [req.u.id, req.s.tok]); res.json({ ok: true });
  }));
  app.post('/api/enlace', auth(async (req, res) => {
    if (req.u.perfil !== 'admin') return err(res, 403, 'Solo la administración envía enlaces.');
    const u = await getU(req.body.uid); if (!u || u.cj !== req.u.cj) return err(res, 404, 'Usuario no encontrado.');
    res.json({ para: await enviarEnlace(u) });
  }));

  app.get('/api/ins/:cod', h(async (req, res) => {
    if (!limite('ins:' + req.ip, 30, 6e5)) return err(res, 429, 'Demasiados intentos. Espere unos minutos.');
    const cod = String(req.params.cod || '').toUpperCase(); const r = await q('select d from conjuntos'); const c = r.rows.map(x => x.d).find(x => x.codigo === cod);
    if (!c || c.bloqueado) return err(res, 404, 'No encontramos un conjunto con ese código. Revíselo con la administración.');
    const us = await q("select d from reg where cj = $1 and t = 'unidades' and borrado = false", [c.id]);
    res.json({ conjunto: { id: c.id, nombre: c.nombre, ciudad: c.ciudad, direccion: c.direccion, codigo: c.codigo, numUnidades: c.numUnidades, pruebaHasta: c.pruebaHasta, pagadoHasta: c.pagadoHasta, modulos: [] },
      unidades: us.rows.map(x => ({ id: x.d.id, cj: c.id, torre: x.d.torre, num: x.d.num, coef: 0 })) });
  }));
  app.post('/api/inscripcion', h(async (req, res) => {
    if (!limite('insc:' + req.ip, 10, 36e5)) return err(res, 429, 'Demasiadas inscripciones desde esta conexión. Intente en una hora.');
    const d = sanear(req.body || {}); const c = await getCJ(d.cj); if (!c) return err(res, 404, 'Conjunto no encontrado.');
    const co = String(d.correo || '').toLowerCase().trim();
    if (!d.nombre || !correoOk(co) || String(d.clave || '').length < 10 || !d.acepto || !d.unidad) return err(res, 400, 'Complete todos los datos, con contraseña de mínimo 10 caracteres y la autorización de datos.');
    const un = await q("select id from reg where cj = $1 and t = 'unidades' and id = $2 and borrado = false", [c.id, d.unidad]); if (!un.rows.length) return err(res, 400, 'Escoja su unidad.');
    const ya = await q('select id from usuarios where cj = $1 and correo = $2', [c.id, co]); if (ya.rows.length) return err(res, 409, 'Ya hay una cuenta con ese correo en este conjunto. Use «Ingresar».');
    const u = { id: rid('u'), cj: c.id, nombre: String(d.nombre).slice(0, 120), correo: co, tel: String(d.celular || '').slice(0, 40), perfil: 'residente', unidad: d.unidad, rol: String(d.rol || 'Propietario').slice(0, 30), activo: false, pendiente: true, solicitado: ahora(), hash: hashClave(d.clave), datosAut: ahora() };
    await guardarU(u);
    const a = { id: rid('a'), cj: c.id, dest: { perfil: 'admin' }, texto: u.nombre + ' se inscribió. Está esperando su aprobación.', fecha: ahora(), ir: 'inscripciones', leidoPor: [] };
    await q('insert into reg (cj,t,id,d,ver) values ($1,$2,$3,$4,$5)', [c.id, 'avisos', a.id, JSON.stringify(a), await sigVer()]);
    res.json({ ok: true });
  }));
  app.post('/api/otro-conjunto', auth(async (req, res) => {
    if (req.u.super || req.u.perfil !== 'admin') return err(res, 403, 'Solo un administrador puede agregar conjuntos.');
    const d = req.body || {}; if (!d.nombre || !d.nit || !(+d.numUnidades > 0)) return err(res, 400, 'Complete nombre, NIT y número de unidades.');
    const nitN = String(d.nit).replace(/\D/g, ''); const todos = await q('select d from conjuntos');
    if (todos.rows.some(x => String(x.d.nit || '').replace(/\D/g, '') === nitN)) return err(res, 409, 'Ese NIT ya tiene una cuenta.');
    const c = nuevoConjunto({ ...d, admin: req.u.nombre, numUnidades: +d.numUnidades }, ahoraFn()); await q('insert into conjuntos (id, d) values ($1,$2)', [c.id, JSON.stringify(c)]);
    const u = { ...req.u, id: rid('u'), cj: c.id, perfil: 'admin', activo: true }; delete u.unidad; await guardarU(u);
    await bita(c.id, u.nombre, 'Conjunto creado con prueba gratis hasta ' + c.pruebaHasta); await bitaSA('Conjunto nuevo: ' + c.nombre);
    res.json(await respuestaSesion(u));
  }));
  app.post('/api/correo/cuentas', auth(async (req, res) => {
    if (!['admin', 'contador'].includes(req.u.perfil)) return err(res, 403, 'Sin permiso.');
    const c = await getCJ(req.u.cj); const us = (await usuariosCJ(c.id)).filter(u => u.perfil === 'residente' && u.activo !== false && u.correo);
    let n = 0; for (const u of us) { if (await correo(u.correo, 'Cuenta de cobro de ' + c.nombre, `<p>Hola ${u.nombre}:</p><p>Ya está disponible su cuenta de cobro en Conjunto-IA.</p><p><a href="${BASE}/">${BASE}</a></p>`)) n++; }
    res.json({ enviados: n });
  }));

  /* ---- sincronización ---- */
  app.post('/api/sync', auth(async (req, res) => {
    const u = req.u, cj = u.cj; const c = await getCJ(cj); if (!c) return err(res, 404, 'El conjunto no existe.');
    const b = req.body || {}; const cambios = Array.isArray(b.cambios) ? b.cambios : []; const borrados = Array.isArray(b.borrados) ? b.borrados : [];
    if ((cambios.length || borrados.length) && !u.super && (estadoCJ(c, ahoraFn()) === 'cerrada' || c.bloqueado)) return err(res, 402, 'El conjunto está cerrado por falta de pago. La administración puede pagar la mensualidad con Bold.');
    const desde = +b.desde || 0; const rech = []; const perm = PERM[u.perfil] || new Set();
    for (const ch of cambios.slice(0, 2000)) {
      try {
        if (!ch || typeof ch.id !== 'string' || !ch.d || typeof ch.d !== 'object') continue;
        if (ch.t === 'conjunto') {
          if (u.perfil !== 'admin') { rech.push({ t: ch.t, id: ch.id, motivo: 'Solo la administración cambia los datos del conjunto.' }); continue; }
          const cur = await getCJ(cj); const nuevo = { ...cur, ...sanear(ch.d) }; for (const k of PROTEGIDOS_CJ) nuevo[k] = cur[k];
          if (+nuevo.numUnidades > 0 === false) nuevo.numUnidades = cur.numUnidades; await setCJ(nuevo); continue;
        }
        if (ch.t === 'usuarios') { const m = await cambioUsuario(u, sanear(ch.d)); if (m) rech.push({ t: ch.t, id: ch.id, motivo: m }); continue; }
        if (!TODAS.has(ch.t)) continue;
        if (!perm.has(ch.t)) { rech.push({ t: ch.t, id: ch.id, motivo: 'Su perfil no puede modificar esta información.' }); continue; }
        const r = await q('select d, ver, borrado from reg where cj = $1 and t = $2 and id = $3', [cj, ch.t, ch.id]); const prev = r.rows[0];
        let d = { ...sanear(ch.d), id: ch.id, cj };
        if (ch.t === 'bitacora' && !(prev && !prev.borrado)) { d.quien = u.super ? 'Superadministrador' : (u.nombre || 'Usuario'); d.fecha = ahora(); }
        const m = await reglas(u, ch.t, prev && !prev.borrado ? prev.d : null, d); if (typeof m === 'string') { rech.push({ t: ch.t, id: ch.id, motivo: m }); continue; } if (m) d = m;
        if (ch.t === 'asambleas' && prev && !prev.borrado && Number(prev.ver) > desde && ch.b) d = fusion(ch.b, d, prev.d);
        const v = await sigVer();
        if (prev) await q('update reg set d = $4, ver = $5, borrado = false where cj = $1 and t = $2 and id = $3', [cj, ch.t, ch.id, JSON.stringify(d), v]);
        else await q('insert into reg (cj, t, id, d, ver) values ($1,$2,$3,$4,$5)', [cj, ch.t, ch.id, JSON.stringify(d), v]);
      } catch (e) { console.error(e); rech.push({ t: ch.t, id: ch.id, motivo: 'No se pudo guardar.' }); }
    }
    for (const x of borrados.slice(0, 2000)) {
      if (!x || typeof x.id !== 'string') continue;
      if (x.t === 'usuarios') { if (u.perfil !== 'admin' || x.id === u.id) { rech.push({ t: x.t, id: x.id, motivo: 'No puede eliminar este usuario.' }); continue; } await q('delete from usuarios where id = $1 and cj = $2', [x.id, cj]); await q('delete from sesiones where uid = $1', [x.id]); continue; }
      if (!TODAS.has(x.t) || x.t === 'bitacora') continue;
      const r = await q('select d from reg where cj = $1 and t = $2 and id = $3 and borrado = false', [cj, x.t, x.id]); if (!r.rows.length) continue;
      const puede = u.perfil === 'admin' || (perm.has(x.t) && u.perfil !== 'residente' && !['cuotas', 'pagos'].includes(x.t)) ||
        (u.perfil === 'residente' && ['visitas', 'reservas'].includes(x.t) && r.rows[0].d.unidad === u.unidad);
      if (!puede || (x.t === 'pagos' && r.rows[0].d.estado === 'aprobado')) { rech.push({ t: x.t, id: x.id, motivo: 'No puede eliminar este registro.' }); continue; }
      await q('update reg set borrado = true, d = null, ver = $4 where cj = $1 and t = $2 and id = $3', [cj, x.t, x.id, await sigVer()]);
    }
    const r = await q('select t, id, d, borrado from reg where cj = $1 and ver > $2', [cj, desde]);
    const v = await q("select v from contador where k = 'ver'");
    res.json({ registros: r.rows.map(x => x.borrado ? { t: x.t, id: x.id, b: true } : { t: x.t, id: x.id, d: x.d }), rechazados: rech, conjunto: await getCJ(cj), usuarios: await usuariosCJ(cj), ver: Number(v.rows[0].v) });
  }));
  async function reglas(u, t, prev, d) {
    const p = u.perfil;
    if (t === 'pagos') {
      if (prev && prev.estado === 'aprobado' && p !== 'admin') return 'Un pago aprobado solo lo modifica la administración.';
      if (prev && prev.estado === 'aprobado' && d.valor !== prev.valor) return 'No se puede cambiar el valor de un pago aprobado.';
      if (d.estado === 'aprobado' && (!prev || prev.estado !== 'aprobado')) {
        if (!APRUEBAN_PAGOS.has(p)) return 'Su perfil no puede aprobar pagos.';
        if (d.regUser && d.regUser === u.id) return 'Nadie puede aprobar un pago que registró él mismo.';
        d.recibo = 'RC-' + String(await sigNum('rc-' + u.cj)).padStart(5, '0'); d.aprobEn = d.aprobEn || hoyCO();
      }
      if (p === 'residente') { if (!prev && d.estado !== 'por aprobar') return 'Solo puede reportar pagos para que la administración los apruebe.'; if (d.unidad !== u.unidad) return 'Solo puede reportar pagos de su unidad.'; if (!prev) d.regUser = u.id; if (prev && prev.regUser !== u.id) return 'Solo puede modificar sus propios reportes.'; if (prev && d.estado !== prev.estado) return 'No puede cambiar el estado de un pago.'; }
      return d;
    }
    if (t === 'pqrs' && !prev) { const y = new Date().getFullYear(); d.radicado = 'PQ-' + y + '-' + String(await sigNum('pq-' + u.cj + '-' + y)).padStart(4, '0'); if (p === 'residente' && d.unidad !== u.unidad) return 'Solo puede radicar PQRS de su unidad.'; return d; }
    if (p === 'residente') {
      if (['visitas', 'reservas', 'mudanzas'].includes(t) && d.unidad && d.unidad !== u.unidad) return 'Solo puede registrar información de su unidad.';
      if (t === 'reservas' && prev && prev.estado !== d.estado && !['cancelada', 'solicitada', 'aprobada'].includes(d.estado)) return 'No puede cambiar el estado de la reserva.';
      if (t === 'reservas' && !prev && d.estado === 'aprobada') { const z = await q("select d from reg where cj=$1 and t='zonas' and id=$2", [u.cj, d.zona]); if (z.rows[0] && z.rows[0].d.aprob) d.estado = 'solicitada'; }
      if (['comunicados', 'paquetes', 'procesos', 'asambleas'].includes(t) && !prev) return 'Su perfil no puede crear este registro.';
      if (t === 'pqrs' && prev && (d.estado !== prev.estado || d.respuesta !== prev.respuesta)) return 'La respuesta la da la administración.';
    }
    if (t === 'bitacora' && prev) return prev; // la bitácora no se modifica
    return d;
  }
  async function cambioUsuario(u, d) {
    const prev = await getU(d.id);
    if (prev && prev.cj !== u.cj) return 'Usuario de otro conjunto.';
    if (u.perfil !== 'admin') {
      if (!prev || prev.id !== u.id) return 'Solo la administración crea o modifica usuarios.';
      const n = { ...prev }; for (const k of ['nombre', 'tel', 'notif', 'foto', 'vehiculos', 'mascotas']) if (k in d) n[k] = d[k]; await guardarU(n); return null;
    }
    const co = String(d.correo || '').toLowerCase().trim(); if (!correoOk(co)) return 'Correo no válido.';
    const dup = await q('select id from usuarios where cj = $1 and correo = $2 and id <> $3', [u.cj, co, d.id]); if (dup.rows.length) return 'Ya existe un usuario con ese correo en este conjunto.';
    if (!PERM[d.perfil]) return 'Perfil no válido.';
    if (prev && prev.id === u.id && d.perfil !== 'admin') return 'No puede quitarse a sí mismo el perfil de administración.';
    const n = { ...(prev || {}), ...d, id: d.id, cj: u.cj, correo: co, perfil: d.perfil }; delete n.hash; if (prev) n.hash = prev.hash; if (n.activo && n.pendiente) n.pendiente = false;
    if (prev && prev.bloqueado !== n.bloqueado) n.bloqueado = prev.bloqueado; // el bloqueo lo maneja el Superadministrador
    await guardarU(n); if (n.activo === false) await q('delete from sesiones where uid = $1', [n.id]); return null;
  }

  /* ---- pagos con Bold ---- */
  app.post('/api/bold/pedido', auth(async (req, res) => {
    if (req.u.perfil !== 'admin') return err(res, 403, 'Solo la administración paga la suscripción.');
    const c = await getCJ(req.u.cj); const b = req.body || {}; const mensual = !!b.mensual;
    const mods = [...new Set((Array.isArray(b.mods) ? b.mods : []).filter(m => MODULOS[m] && !(c.modulos || []).includes(m)))];
    if (!mensual && !mods.length) return err(res, 400, 'El pedido está vacío.');
    const conceptos = []; let valor = 0;
    if (mensual) { const p = planDe(c.numUnidades); conceptos.push(p.id); valor += PLANES.find(x => x.id === p.id).precio; if (p.extra) { conceptos.push('extra100-x' + p.extra); valor += p.extra * EXTRA100; } }
    for (const m of mods) { conceptos.push('mod-' + m); valor += MODULOS[m]; }
    const pedId = rid('p').slice(0, 14).replace(/[^A-Za-z0-9]/g, 'x');
    const plan = APP + ':paq_' + conceptos.join('_');
    const f = await firmar(plan, c.id + '__' + pedId);
    const orden = f.orderId || f.order_id || f.orden; const monto = +(f.amount || f.valor || 0);
    if (!orden || monto !== valor) return err(res, 502, 'El valor de la pasarela no coincide con su pedido. Escríbanos por WhatsApp.');
    await q('insert into pedidos (orden, cj, conceptos, plan, valor, estado) values ($1,$2,$3,$4,$5,$6)', [orden, c.id, JSON.stringify({ mensual, mods }), plan, valor, 'pendiente']);
    res.json({ ...f, valor });
  }));
  app.post('/api/bold/prueba', auth(async (req, res) => {
    const f = await firmar(APP + ':prueba', 'plataforma__' + rid('pr').slice(0, 12).replace(/[^A-Za-z0-9]/g, 'x'));
    const orden = f.orderId || f.order_id || f.orden; if (orden) await q('insert into pedidos (orden, cj, conceptos, plan, valor, estado) values ($1,$2,$3,$4,$5,$6)', [orden, 'plataforma', '{}', APP + ':prueba', 1000, 'pendiente']);
    res.json({ ...f, valor: 1000 });
  }, { superOk: true }));
  app.get('/api/bold/volver', h(async (req, res) => {
    const ref = String(req.query.ref || ''); if (!ref) return err(res, 400, 'Falta la referencia.');
    const o = await verificar('ref=' + encodeURIComponent(ref)); if (!o) return res.json({ estado: 'pendiente' });
    res.json({ estado: await aplicarOrden({ ...o, ref: o.ref || ref }, 'regreso de Bold') });
  }));
  app.post('/api/bold/aplicar', h(async (req, res) => { // aviso de la central de pagos de SkyNet Genesis
    const id = String((req.body || {}).pago_id || (req.body || {}).pagoId || ''); if (!id) return err(res, 400, 'Falta pago_id.');
    const o = await verificar('pago=' + encodeURIComponent(id)); if (!o) return err(res, 404, 'Pago no confirmado por la central.');
    await aplicarOrden(o, 'aviso de Bold'); res.json({ ok: true });
  }));

  /* ---- Superadministrador ---- */
  app.post('/api/sa/login', h(async (req, res) => {
    const c0 = String(req.body.correo || '').toLowerCase(); const k = 'sa';
    if (c0 !== SUPER_CORREO) return err(res, 401, 'Este acceso es solo para el Superadministrador de la plataforma.');
    if (bloqueado(k)) return err(res, 429, 'Acceso bloqueado 15 minutos por intentos fallidos.');
    const r = await q("select v from config where k = 'superhash'"); if (!r.rows.length) return err(res, 400, 'Primero cree la contraseña con «Primera vez u olvidó su contraseña».');
    if (!claveOk(req.body.clave, r.rows[0].v)) { fallo(k); return err(res, 401, 'Correo o contraseña incorrectos.'); }
    INT.delete(k); await bitaSA('Ingreso del Superadministrador'); res.json({ token: await nuevaSesion('super', null, true) });
  }));
  app.post('/api/sa/olvido', h(async (req, res) => { if (!limite('saolv', 4, 36e5)) return res.json({ mensaje: 'Ya se enviaron varios enlaces en la última hora. Revise el correo del dueño de la plataforma.' }); await enviarEnlace({ id: 'super', nombre: 'Superadministrador' }); res.json({ mensaje: 'Le enviamos el enlace al correo del dueño de la plataforma (vence en 1 hora).' }); }));
  const sa = fn => auth(fn, { soloSuper: true });
  app.get('/api/sa/resumen', sa(async (req, res) => {
    const cs = (await q('select d from conjuntos')).rows.map(x => x.d);
    for (const c of cs) { const n = await q("select count(*)::int as n from reg where cj = $1 and t = 'unidades' and borrado = false", [c.id]); c.unidadesCargadas = Number(n.rows[0].n); c.estado = estadoCJ(c, ahoraFn()); }
    const us = (await q('select * from usuarios')).rows.map(x => sinHash({ ...x.d, id: x.id, cj: x.cj, correo: x.correo, perfil: x.perfil }));
    const bt = (await q('select id, fecha, texto from bitacora_sa order by fecha desc limit 300')).rows.map(x => ({ id: x.id, fecha: new Date(x.fecha).toISOString(), cj: null, quien: 'Plataforma', texto: x.texto }));
    const pg = (await q('select * from pagos order by creado desc limit 300')).rows.map(x => ({ ...x, valor: Number(x.valor), creado: new Date(x.creado).toISOString() }));
    res.json({ conjuntos: cs, usuarios: us, bitacora: bt, pagos: pg });
  }));
  app.post('/api/sa/entrar', sa(async (req, res) => {
    const c = await getCJ(req.body.cj); if (!c) return err(res, 404, 'Conjunto no encontrado.');
    await bitaSA('Superadministrador entró a ' + c.nombre); await bita(c.id, 'Superadministrador', 'Entró como administrador (soporte)');
    res.json({ token: await nuevaSesion('super', c.id, true), estado: await estado(c.id, null) });
  }));
  app.post('/api/sa/interna', sa(async (req, res) => {
    const c = await getCJ(req.body.id); if (!c) return err(res, 404, 'Conjunto no encontrado.'); if (!req.body.motivo) return err(res, 400, 'Escriba el motivo.');
    c.interna = !c.interna; await setCJ(c); await bitaSA((c.interna ? 'Marcado como interno: ' : 'Ya no es interno: ') + c.nombre + ' · ' + req.body.motivo); res.json({ ok: true, interna: c.interna });
  }));
  app.post('/api/sa/aplicar', sa(async (req, res) => {
    if (!req.body.ref || !req.body.motivo) return err(res, 400, 'Escriba la referencia y el motivo.');
    const ref = String(req.body.ref); let o = await verificar('ref=' + encodeURIComponent(ref)); if (!o) o = await verificar('pago=' + encodeURIComponent(ref));
    if (!o) return err(res, 404, 'La central de pagos no confirma ese pago. Revise la referencia.');
    const est = await aplicarOrden({ ...o, ref: o.ref || ref }, 'Superadministrador: ' + req.body.motivo); await bitaSA('Aplicación manual de pago ' + ref + ': ' + est + ' · ' + req.body.motivo); res.json({ estado: est });
  }));
  app.post('/api/sa/enlace', sa(async (req, res) => { const u = await getU(req.body.uid); if (!u) return err(res, 404, 'Usuario no encontrado.'); res.json({ para: await enviarEnlace(u) }); }));
  app.post('/api/sa/bloquear', sa(async (req, res) => {
    const u = await getU(req.body.uid); if (!u) return err(res, 404, 'Usuario no encontrado.');
    if (req.body.bloquear && !req.body.motivo) return err(res, 400, 'Escriba el motivo.');
    u.bloqueado = !!req.body.bloquear; u.motivoBloqueo = req.body.bloquear ? req.body.motivo : ''; await guardarU(u); if (u.bloqueado) await q('delete from sesiones where uid = $1', [u.id]);
    await bitaSA((u.bloqueado ? 'Bloqueó a ' : 'Desbloqueó a ') + u.correo + (req.body.motivo ? ' · ' + req.body.motivo : '')); res.json({ ok: true });
  }));
  app.get('/api/sa/respaldo', sa(async (req, res) => {
    const out = { fecha: ahora(), conjuntos: (await q('select d from conjuntos')).rows.map(x => x.d), usuarios: (await q('select * from usuarios')).rows.map(x => sinHash({ ...x.d, id: x.id, cj: x.cj, correo: x.correo, perfil: x.perfil })),
      registros: (await q('select cj, t, id, d from reg where borrado = false')).rows, pedidos: (await q('select * from pedidos')).rows, pagos: (await q('select * from pagos')).rows };
    await bitaSA('Descargó el respaldo completo'); res.json(out);
  }));

  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '5m' }));
  app.use('/api', (req, res) => err(res, 404, 'Ruta no encontrada.'));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  return { app, revisarPendientes, avisosDiarios, aplicarOrden };
}

async function preparar(pool) {
  for (const s of ESQUEMA.split(';').map(x => x.trim()).filter(Boolean)) await pool.query(s);
  const r = await pool.query("select v from contador where k = 'ver'"); if (!r.rows.length) await pool.query("insert into contador (k, v) values ('ver', 1)");
}

module.exports = { crearApp, preparar, fusion, estadoCJ, alDiaHasta, planDe };

if (require.main === module) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });
  preparar(pool).then(() => {
    const { app, revisarPendientes, avisosDiarios } = crearApp({ pool });
    const port = process.env.PORT || 3000; app.listen(port, () => console.log('Conjunto-IA en el puerto', port));
    setInterval(() => revisarPendientes().catch(e => console.error('pendientes', e.message)), 20 * 60e3);
    let ultimoDia = ''; setInterval(() => { const t = hoyCO(); const hora = new Date(Date.now() - 5 * 3600e3).getUTCHours(); if (t !== ultimoDia && hora >= 8) { ultimoDia = t; avisosDiarios().catch(e => console.error('avisos', e.message)); } }, 10 * 60e3);
  }).catch(e => { console.error('No se pudo preparar la base de datos:', e); process.exit(1); });
}
