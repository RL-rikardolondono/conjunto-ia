# Conjunto-IA v3.1 — servidor reconstruido (13 nov 2026)

El servidor v3 del 8 nov se perdió (nunca se guardó en D:). Esta versión se reconstruyó desde la página publicada
(artifact G7YDZvQ3kS7GaeeVgYcfib), que ya traía la parte de servidor, y respeta exactamente las rutas que la página usa.

- `server.js`: Express + PostgreSQL (Neon). Rutas /api/* (registro, ingreso, varios conjuntos, enlaces de contraseña con Brevo,
  inscripción por código, sincronización con permisos por perfil, recibos RC- y radicados PQ- del servidor, fusión de votos de
  asamblea, Bold central, Superadministrador superadmin.conjunto@skynetgenesis.com con enlace al Gmail del dueño, avisos por correo
  de fin de prueba (3 y 1 días) y de mensualidad (días 5 y 8), revisión de pagos pendientes cada 20 min). Cierre por pago el día 10 (402).
- `public/index.html`: la página (demo en Claude y app real en el subdominio).
- `prueba.js`: 52 pruebas automáticas con base en memoria (`npm i && npm test`). `dev.js`: prueba local en http://localhost:3101.

## Publicar
1. Repositorio GitHub privado `conjunto-ia` con estos archivos.
2. Neon (Ohio): base nueva; copiar la cadena de conexión.
3. Render (Ohio): servicio web desde el repo; variables DATABASE_URL y BREVO_API_KEY (las pega el señor). Las demás vienen en render.yaml.
4. SiteGround: CNAME `conjunto-ia` → <servicio>.onrender.com; en Render agregar el dominio conjunto-ia.skynetgenesis.com.
5. Firmador (bold-firma.php, $PLANES): conjunto-ia:p40 89000, p120 139000, p300 199000, p600 279000, extra100 40000,
   mod-asambleas 290000, mod-multas 120000, mod-mantenimiento 150000, mod-proveedores 110000, mod-importar 60000, mod-web 490000, prueba 1000.
6. bold-app-conjunto-ia.php tipo "url" (sin secreto) → https://conjunto-ia.skynetgenesis.com/api/bold/aplicar.
7. Superadministrador: «Acceso SkyNet Genesis» › «Primera vez u olvidó su contraseña» (el enlace llega al Gmail del dueño).
8. Pago de prueba de $1.000 desde el panel del Superadministrador.
