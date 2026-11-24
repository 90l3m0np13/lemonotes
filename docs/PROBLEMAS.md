# Problemas conocidos

## Windows bloquea `LemoNotes.exe`

Es el lanzador `.NET`. En equipos con **Smart App Control, WDAC, AppLocker** o antivirus corporativo puede recibir “Acceso denegado”.

Solución:

1. Crea un acceso directo a `LemoNotesCore.exe`.
2. Añade `--no-sandbox` al destino.
3. Usa ese acceso.

No desactives la política del equipo sin autorización. Si el núcleo también está bloqueado, IT debe permitir la carpeta o firmar la app.

## SmartScreen

El ejecutable no está firmado. Pulsa **Más información → Ejecutar de todas formas** si confías en el origen. Para distribución pública, firma la app con un certificado de code signing.

## No se crea `LemoNotesData` o da acceso denegado

- No instales en `Program Files`.
- Usa una carpeta del usuario con permisos de escritura.
- Si el antivirus bloquea la creación, añade la carpeta a exclusiones.
- En equipos muy restringidos, crea la carpeta `LemoNotesData` vacía junto al núcleo antes de abrir.

## Error al reabrir: “No he podido abrir el llavero local”

Puede pasar por:

- copiar `LemoNotesData` desde otro PC/usuario (el llavero está atado a DPAPI);
- una build antigua con un bug de `safeStorage.decryptStringAsync` en Electron 45.

Usa la versión actual y no copies la carpeta de datos entre equipos. Si el llavero es irrecuperable, renombra `LemoNotesData` y empieza una libreta nueva; conserva la carpeta antigua por si puedes exportar algo.

## No se captura el audio del equipo

1. Comprueba que **Audio del equipo** está activado.
2. El loopback usa el **dispositivo de salida predeterminado de Windows**. Si la reunión suena en unos cascos distintos, ponlos como predeterminados (y como predeterminados para comunicaciones) antes de grabar.
3. Sube el volumen del dispositivo; revisa el mezclador.
4. Si la app antigua fallaba con `NotReadableError` al pedir vídeo, actualiza: la versión actual pide solo audio y usa vídeo solo como fallback.
5. El contenido protegido con DRM o una ventana con protección de captura puede no entregar audio/vídeo; no se puede saltar esa protección.

## No se captura el micrófono

- Revisa **Configuración → Privacidad → Micrófono**.
- Elige el micrófono correcto en la app.
- Comprueba que el headset no está muteado.
- Cierra apps que tengan el micrófono en exclusiva.

## La transcripción tarda o sale mal

- La primera transcripción carga el modelo y tarda más.
- `base` es rápido pero limitado; `small` mejora precisión a cambio de CPU/RAM.
- Habla cerca del micrófono y evita ruido de sala.
- Las grabaciones largas usan transcripción incremental; las cortas se rehacen al terminar.

## La app se cierra al arrancar

- Prueba el acceso directo con `--no-sandbox`.
- Comprueba que `LemoNotesData` no está corrupta; renómbrala y prueba una libreta nueva.
- Revisa el Visor de eventos y el antivirus.
- No ejecutes `LemoNotesCore.exe` sin `--no-sandbox` en equipos con Panda/WAC.

## Copiar datos a otro PC

No funciona copiando `LemoNotesData`: el llavero usa DPAPI del usuario/equipo. Exporta Markdown/TXT/JSON o copia las actas legibles de `backups/actas-legibles`.

## La app no está firmada

Es conocido. SmartScreen y algunas políticas pueden bloquearla. La firma reduce avisos, pero no garantiza que una política WDAC de empresa la permita; IT debe añadir la regla.
