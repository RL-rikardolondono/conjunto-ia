// Servidor de prueba local con base en memoria (no usar en producción)
const { newDb } = require('pg-mem'); const { crearApp, preparar } = require('./server');
(async () => { const db = newDb(); const { Pool } = db.adapters.createPg(); const pool = new Pool(); await preparar(pool);
  const { app } = crearApp({ pool, env: { BASE_URL: 'http://localhost:3101' }, enviarCorreo: async (p, a, h) => { console.log('CORREO', p, a, (h.match(/#clave-[\w-]+/) || [''])[0]); return true; } });
  app.listen(3101, () => console.log('dev en http://localhost:3101')); })();
