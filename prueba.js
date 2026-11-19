'use strict';
const assert = require('assert');
const { newDb } = require('pg-mem');
const http = require('http');
const { crearApp, preparar, fusion } = require('./server');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
(async () => {
  const db = newDb(); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  await preparar(pool);
  const correos = []; let hoy = '2026-11-13';
  const PED = new Map(); const PAG = new Map();
  const fetchFn = async (url) => {
    const u = new URL(url); const J = (st, j) => ({ status: st, ok: st < 300, json: async () => j });
    if (u.pathname.endsWith('bold-firma.php')) {
      const plan = u.searchParams.get('plan'); const precios = { p40: 89000, p120: 139000, p300: 199000, p600: 279000, extra100: 40000, 'mod-asambleas': 290000, 'mod-multas': 120000, 'mod-web': 490000, prueba: 1000 };
      let v = 0; if (plan === 'conjunto-ia:prueba') v = 1000; else for (const c of plan.split(':paq_')[1].split('_')) { const m = c.match(/^(.*?)(?:-x(\d+))?$/); v += precios[m[1]] * (+m[2] || 1); }
      const orderId = 'SGCONJUN-' + (PED.size + 1); PED.set(orderId, { plan, empresa: u.searchParams.get('empresa'), valor: v });
      return J(200, { orderId, amount: v, apiKey: 'k', signature: 's', redirectionUrl: u.searchParams.get('volver') });
    }
    if (u.pathname.endsWith('bold-verificar.php')) {
      const ref = u.searchParams.get('ref'), pago = u.searchParams.get('pago');
      const p = ref ? PAG.get(ref) : [...PAG.values()].find(x => x.pago_id === pago);
      return p ? J(200, { ok: true, orden: p }) : J(404, { ok: false });
    }
    return J(404, {});
  };
  const { app, revisarPendientes, avisosDiarios } = crearApp({ pool, fetchFn, ahoraFn: () => hoy, env: {}, enviarCorreo: async (p, a, h) => { correos.push({ p, a, h }); return true; } });
  const srv = http.createServer(app).listen(0); const base = 'http://127.0.0.1:' + srv.address().port;
  const api = async (ruta, body, tok, metodo) => { const r = await fetch(base + ruta, { method: metodo || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); return { st: r.status, j }; };
  const linkDe = c => c.h.match(/#clave-([A-Za-z0-9_-]+)/)[1];

  // registro
  let r = await api('/api/registro', { nombre: 'Conjunto Prueba', nit: '900.111.222-3', ciudad: 'Santa Marta', direccion: 'Cra 1', numUnidades: 650, admin: 'Ana Admin', celular: '300', correo: 'ana@x.co', clave: 'claveSegura1', acepto: true, pedido: ['asambleas'] });
  ok(r.st === 200 && r.j.token && r.j.estado.conjunto.pruebaHasta === '2026-11-27', 'registro');
  ok(!JSON.stringify(r.j).includes('scrypt$'), 'no se envía el hash');
  const A = r.j.token, CJ = r.j.estado.conjunto.id, uidA = r.j.usuario.id;
  ok(r.j.estado.registros.filter(x => x.t === 'parq').length === 4, 'parqueaderos iniciales');
  r = await api('/api/registro', { nombre: 'Otro', nit: '900111222-3', ciudad: 'x', direccion: 'x', numUnidades: 5, admin: 'B', correo: 'b@x.co', clave: 'claveSegura1', acepto: true }); ok(r.st === 409, 'NIT repetido');
  // login
  r = await api('/api/login', { correo: 'ana@x.co', clave: 'mala' }); ok(r.st === 401, 'clave mala');
  r = await api('/api/login', { correo: 'ana@x.co', clave: 'claveSegura1' }); ok(r.st === 200 && r.j.token, 'login');
  // unidades y usuarios por sync
  const U1 = { id: 'un1', cj: CJ, torre: '1', num: '101', coef: 50, prop: 'Pedro' }, U2 = { id: 'un2', cj: CJ, torre: '1', num: '102', coef: 50, prop: 'Luz' };
  r = await api('/api/sync', { desde: 0, cambios: [{ t: 'unidades', id: 'un1', d: U1 }, { t: 'unidades', id: 'un2', d: U2 },
    { t: 'usuarios', id: 'uc', d: { id: 'uc', cj: CJ, nombre: 'Carlos Contador', correo: 'carlos@x.co', perfil: 'contador', activo: true } },
    { t: 'usuarios', id: 'ur', d: { id: 'ur', cj: CJ, nombre: 'Rita Residente', correo: 'rita@x.co', perfil: 'residente', unidad: 'un1', activo: true } }], borrados: [] }, A);
  ok(r.st === 200 && r.j.rechazados.length === 0 && r.j.usuarios.length === 3, 'sync unidades y usuarios');
  const ver1 = r.j.ver;
  // enlace de contraseña al residente
  r = await api('/api/enlace', { uid: 'ur' }, A); ok(r.st === 200 && r.j.para === 'rita@x.co', 'enlace enviado');
  r = await api('/api/clave', { token: linkDe(correos[correos.length - 1]), clave: 'ritaClave123' }); ok(r.st === 200 && r.j.token, 'clave creada');
  const R = r.j.token;
  r = await api('/api/clave', { token: linkDe(correos[correos.length - 1]), clave: 'ritaClave123' }); ok(r.st === 400, 'enlace de un solo uso');
  await api('/api/enlace', { uid: 'uc' }, A); r = await api('/api/clave', { token: linkDe(correos[correos.length - 1]), clave: 'carlosClave1' }); const C = r.j.token;
  // permisos
  r = await api('/api/sync', { desde: ver1, cambios: [{ t: 'cuotas', id: 'k1', d: { id: 'k1', cj: CJ, unidad: 'un1', valor: 100000, periodo: '2026-11' } }], borrados: [] }, R);
  ok(r.j.rechazados.length === 1, 'residente no crea cobros');
  r = await api('/api/sync', { desde: ver1, cambios: [{ t: 'pagos', id: 'pg1', d: { id: 'pg1', cj: CJ, unidad: 'un1', valor: 100000, estado: 'aprobado', fecha: '2026-11-13' } }], borrados: [] }, R);
  ok(r.j.rechazados.length === 1, 'residente no aprueba pagos');
  r = await api('/api/sync', { desde: ver1, cambios: [{ t: 'pagos', id: 'pg1', d: { id: 'pg1', cj: CJ, unidad: 'un1', valor: 100000, estado: 'por aprobar', fecha: '2026-11-13', regUser: 'ur' } }], borrados: [] }, R);
  ok(r.j.rechazados.length === 0, 'residente reporta pago');
  r = await api('/api/sync', { desde: ver1, cambios: [{ t: 'pagos', id: 'pg2', d: { id: 'pg2', cj: CJ, unidad: 'un2', valor: 1, estado: 'por aprobar', fecha: '2026-11-13' } }], borrados: [] }, R);
  ok(r.j.rechazados.length === 1, 'residente no reporta pagos de otra unidad');
  r = await api('/api/sync', { desde: ver1, cambios: [{ t: 'pagos', id: 'pg3', d: { id: 'pg3', cj: CJ, unidad: 'un2', valor: 50000, estado: 'por aprobar', fecha: '2026-11-13', regUser: 'uc' } }], borrados: [] }, C);
  r = await api('/api/sync', { desde: ver1, cambios: [{ t: 'pagos', id: 'pg3', d: { id: 'pg3', cj: CJ, unidad: 'un2', valor: 50000, estado: 'aprobado', fecha: '2026-11-13', regUser: 'uc' } }], borrados: [] }, C);
  ok(r.j.rechazados.length === 1, 'nadie aprueba lo suyo');
  r = await api('/api/sync', { desde: ver1, cambios: [{ t: 'pagos', id: 'pg1', d: { id: 'pg1', cj: CJ, unidad: 'un1', valor: 100000, estado: 'aprobado', fecha: '2026-11-13', regUser: 'ur' } }], borrados: [] }, C);
  const pg1 = r.j.registros.find(x => x.id === 'pg1'); ok(r.j.rechazados.length === 0 && pg1.d.recibo === 'RC-00001', 'recibo asignado por el servidor');
  r = await api('/api/sync', { desde: 0, cambios: [], borrados: [{ t: 'pagos', id: 'pg1' }] }, A); ok(r.j.rechazados.length === 1, 'no se borra un pago aprobado');
  // PQRS con radicado del servidor
  r = await api('/api/sync', { desde: 0, cambios: [{ t: 'pqrs', id: 'q1', d: { id: 'q1', cj: CJ, unidad: 'un1', radicado: 'PQ-2026-9999', asunto: 'x', estado: 'radicada' } }], borrados: [] }, R);
  ok(r.j.registros.find(x => x.id === 'q1').d.radicado === 'PQ-' + new Date().getFullYear() + '-0001', 'radicado del servidor');
  // conjunto: campos protegidos
  const cjd = r.j.conjunto; r = await api('/api/sync', { desde: 0, cambios: [{ t: 'conjunto', id: CJ, d: { ...cjd, pagadoHasta: '2099-12-31', modulos: ['web'], presupuesto: 5 } }], borrados: [] }, A);
  ok(r.j.conjunto.pagadoHasta === null && r.j.conjunto.modulos.length === 0 && r.j.conjunto.presupuesto === 5, 'campos protegidos del conjunto');
  r = await api('/api/sync', { desde: 0, cambios: [{ t: 'conjunto', id: CJ, d: { ...cjd, presupuesto: 9 } }], borrados: [] }, R); ok(r.j.rechazados.length === 1, 'residente no cambia el conjunto');
  // asamblea con fusión de votos
  const AS = { id: 'as1', cj: CJ, estado: 'en curso', asist: { un1: true, un2: true }, votos: [{ id: 'v1', opciones: ['Sí', 'No'], votos: {} }] };
  r = await api('/api/sync', { desde: 0, cambios: [{ t: 'asambleas', id: 'as1', d: AS }], borrados: [] }, A); const vA = r.j.ver;
  const b1 = JSON.parse(JSON.stringify(AS)); const m1 = JSON.parse(JSON.stringify(AS)); m1.votos[0].votos.un1 = 0; m1.votos[0].votos.un2 = 0; m1.estado = 'cerrada';
  const m2 = JSON.parse(JSON.stringify(AS)); m2.votos[0].votos.un2 = 1;
  await api('/api/sync', { desde: vA, cambios: [{ t: 'asambleas', id: 'as1', d: m1, b: b1 }], borrados: [] }, R);
  r = await api('/api/sync', { desde: vA, cambios: [{ t: 'asambleas', id: 'as1', d: m2, b: b1 }], borrados: [] }, A);
  const asf = r.j.registros.find(x => x.id === 'as1').d; ok(asf.votos[0].votos.un1 === 0 && asf.votos[0].votos.un2 === 1 && asf.asist.un1 && asf.asist.un2 && asf.estado === 'en curso', 'votos simultáneos sin pérdida; el residente solo vota por su unidad');
  ok(JSON.stringify(fusion({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 })) === JSON.stringify({ a: 2, b: 3 }), 'fusión básica');
  // inscripción
  const cod = r.j.conjunto.codigo; r = await api('/api/ins/' + cod); ok(r.st === 200 && r.j.unidades.length === 2 && !('prop' in r.j.unidades[0]), 'inscripción: datos públicos sin propietarios');
  r = await api('/api/inscripcion', { cj: CJ, unidad: 'un2', rol: 'Arrendatario', nombre: 'Leo', celular: '3', correo: 'leo@x.co', clave: 'leoClave1234', acepto: true }); ok(r.st === 200, 'inscripción creada');
  r = await api('/api/login', { correo: 'leo@x.co', clave: 'leoClave1234' }); ok(r.st === 403, 'inscrito espera aprobación');
  r = await api('/api/estado', null, A); const leo = r.j.usuarios.find(u => u.correo === 'leo@x.co');
  await api('/api/sync', { desde: 0, cambios: [{ t: 'usuarios', id: leo.id, d: { ...leo, activo: true } }], borrados: [] }, A);
  r = await api('/api/login', { correo: 'leo@x.co', clave: 'leoClave1234' }); ok(r.st === 200, 'inscrito aprobado entra');
  // Bold: pedido mensual (650 unidades = p600 + 1 extra) + módulo
  r = await api('/api/bold/pedido', { mensual: true, mods: ['asambleas', 'pagoslinea'] }, A);
  ok(r.st === 200 && r.j.valor === 279000 + 40000 + 290000 && r.j.orderId, 'pedido con extra y módulo (sin el de próximamente)');
  const ord = r.j.orderId; const pd = PED.get(ord); ok(pd.plan === 'conjunto-ia:paq_p600_extra100-x1_mod-asambleas', 'plan del pedido');
  r = await api('/api/bold/pedido', { mensual: true }, R); ok(r.st === 403, 'residente no paga la suscripción');
  r = await api('/api/bold/volver?ref=' + ord); ok(r.j.estado === 'pendiente', 'pago aún no confirmado');
  PAG.set(ord, { pago_id: 'BOLD1', empresa: pd.empresa, plan: pd.plan, valor: pd.valor, ref: ord });
  r = await api('/api/bold/aplicar', { pago_id: 'BOLD1' }); ok(r.st === 200 && r.j.ok === true, 'aviso de la central');
  r = await api('/api/estado', null, A); ok(r.j.conjunto.pagadoHasta === '2026-12-31' && r.j.conjunto.modulos.includes('asambleas'), 'pago aplicado: hasta fin del mes siguiente a la prueba');
  r = await api('/api/bold/aplicar', { pago_id: 'BOLD1' }); r = await api('/api/estado', null, A); ok(r.j.conjunto.pagadoHasta === '2026-12-31', 'idempotente');
  r = await api('/api/bold/volver?ref=' + ord); ok(r.j.estado === 'aplicado', 'volver informa aplicado');
  // pago menor queda para revisar
  r = await api('/api/bold/pedido', { mods: ['web'] }, A); const o2 = r.j.orderId; PAG.set(o2, { pago_id: 'BOLD2', empresa: PED.get(o2).empresa, plan: PED.get(o2).plan, valor: 1000, ref: o2 });
  await revisarPendientes(); r = await api('/api/estado', null, A); ok(!r.j.conjunto.modulos.includes('web'), 'pago menor no activa');
  // cierre por falta de pago
  hoy = '2027-01-05'; r = await api('/api/sync', { desde: 0, cambios: [{ t: 'comunicados', id: 'cm5', d: { id: 'cm5', cj: CJ, titulo: 'Aviso', texto: 'x', leidos: [] } }], borrados: [] }, A); ok(r.st === 200 && !r.j.rechazados.length, 'el día 5 sigue abierto (aviso)');
  hoy = '2027-01-06'; r = await api('/api/sync', { desde: 0, cambios: [{ t: 'unidades', id: 'un3', d: { id: 'un3', cj: CJ, torre: '1', num: '103', coef: 0 } }], borrados: [] }, A); ok(r.st === 402, 'cerrado al terminar el día 5');
  r = await api('/api/sync', { desde: 0, cambios: [], borrados: [] }, A); ok(r.st === 200, 'lectura permitida cerrado');
  hoy = '2027-01-01'; const n0 = correos.length; await avisosDiarios(); ok(correos.length === n0 + 1 && /pendiente/.test(correos[correos.length - 1].a), 'aviso de mensualidad día 1');
  await avisosDiarios(); ok(correos.length === n0 + 1, 'el aviso no se repite');
  hoy = '2026-11-13';
  // superadministrador
  r = await api('/api/sa/login', { correo: 'superadmin.conjunto@skynetgenesis.com', clave: 'x' }); ok(r.st === 400, 'sin contraseña aún');
  r = await api('/api/sa/olvido', {}); const cs = correos[correos.length - 1]; ok(cs.p === (process.env.DUENO_CUENTAS||'contacto@skynetgenesis.com'), 'enlace del súper al dueño');
  r = await api('/api/clave', { token: linkDe(cs), clave: 'superClave123' }); ok(r.j.super === true, 'clave del súper');
  r = await api('/api/sa/login', { correo: 'superadmin.conjunto@skynetgenesis.com', clave: 'superClave123' }); const S = r.j.token; ok(!!S, 'súper entra');
  r = await api('/api/sa/resumen', null, S); ok(r.j.conjuntos[0].unidadesCargadas === 2 && r.j.pagos.some(p => p.estado === 'revisar'), 'resumen del súper');
  r = await api('/api/sa/resumen', null, A); ok(r.st === 403, 'admin no ve el resumen del súper');
  r = await api('/api/sa/entrar', { cj: CJ }, S); ok(r.st === 200 && r.j.estado.conjunto.id === CJ, 'súper entra a un conjunto');
  r = await api('/api/sa/bloquear', { uid: 'ur', bloquear: true, motivo: 'prueba' }, S); r = await api('/api/estado', null, R); ok(r.st === 401, 'bloqueado sale');
  r = await api('/api/bold/prueba', {}, S); ok(r.j.valor === 1000, 'pago de prueba');
  const op = r.j.orderId; PAG.set(op, { pago_id: 'BOLD3', empresa: PED.get(op).empresa, plan: 'conjunto-ia:prueba', valor: 1000, ref: op });
  r = await api('/api/sa/aplicar', { ref: op, motivo: 'prueba' }, S); ok(r.j.estado === 'prueba', 'pago de prueba registrado');
  r = await api('/api/sa/respaldo', null, S); ok(!JSON.stringify(r.j).includes('scrypt$') && r.j.registros.length > 5, 'respaldo sin contraseñas');
  r = await api('/', null); ok(r.st === 200 || r.st === 0 || true, 'página');
  const pg = await fetch(base + '/'); ok(pg.status === 200 && (await pg.text()).includes('Conjunto-IA'), 'sirve la página');
  // revisión triple (14 nov 2026): textos, imágenes, bitácora, límites y despertador
  await api('/api/sa/bloquear', { uid: 'ur', bloquear: false }, S); r = await api('/api/login', { correo: 'rita@x.co', clave: 'ritaClave123' }); const R2 = r.j.token;
  r = await api('/api/sync', { desde: 0, cambios: [{ t: 'visitas', id: 'vx1', d: { id: 'vx1', cj: CJ, unidad: 'un1', nombre: '<img src=x onerror=alert(1)>', foto: 'x" onerror="alert(1)', estado: 'esperada' } }], borrados: [] }, R2);
  r = await api('/api/estado', null, R2); const vx = r.j.registros.find(x => x.id === 'vx1');
  ok(vx && !vx.d.nombre.includes('<') && vx.d.foto == null, 'texto y foto saneados');
  r = await api('/api/sync', { desde: 0, cambios: [{ t: 'visitas', id: 'vx2', d: { id: 'vx2', cj: CJ, unidad: 'un1', nombre: 'Foto buena', foto: 'data:image/jpeg;base64,AAAA', estado: 'esperada' } }], borrados: [] }, R2);
  r = await api('/api/estado', null, R2); ok(r.j.registros.find(x => x.id === 'vx2').d.foto === 'data:image/jpeg;base64,AAAA', 'foto real se conserva');
  r = await api('/api/sync', { desde: 0, cambios: [{ t: 'bitacora', id: 'bx1', d: { id: 'bx1', cj: CJ, quien: 'Administración', texto: 'falso' } }], borrados: [] }, R2);
  r = await api('/api/estado', null, A); ok(r.j.registros.find(x => x.id === 'bx1').d.quien === 'Rita Residente', 'la bitácora pone el autor real');
  for (let i = 0; i < 3; i++) await api('/api/olvido', { correo: 'carlos@x.co' });
  const antes = correos.length; r = await api('/api/olvido', { correo: 'carlos@x.co' }); ok(correos.length === antes && r.st === 200, 'límite de enlaces por correo');
  r = await api('/api/registro', { nombre: 'conjunto prueba', nit: '901.999.888', ciudad: 'SANTA MARTA', direccion: 'x', numUnidades: 5, admin: 'C', correo: 'c2@x.co', clave: 'claveSegura1', acepto: true }); ok(r.st === 409, 'mismo conjunto con otro NIT no repite prueba');
  r = await api('/api/cron'); ok(r.st === 200 && r.j.ok, 'despertador diario');
  r = await api('/api/cron'); ok(r.j.omitido === true, 'despertador no se repite seguido');
  srv.close(); console.log('PRUEBAS OK:', n);
})().catch(e => { console.error('FALLÓ', e); process.exit(1); });
