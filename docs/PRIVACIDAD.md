# Privacidad y cifrado

## Principio

LemoNotes es **local-first**: las notas, el audio y las actas viven en el equipo. No hay cuenta, nube de notas ni sincronización.

## Qué se queda en el equipo

- Base de datos SQLite.
- Textos, títulos, actas y notas humanas.
- Audio cifrado `.lemonaudio`.
- Copias `.lemonote` y actas Markdown legibles.
- Modelo de Whisper.
- Configuración y preferencias.

Todo está en `LemoNotesData`, junto al ejecutable.

## Cifrado

- Textos y metadatos: **AES-256-GCM** con una clave aleatoria de 32 bytes.
- La clave se protege con `safeStorage` de Electron (DPAPI en Windows).
- Audio: bloques `.lemonaudio` con AES-256-GCM.
- La caché de reproducción se borra al arrancar y al cerrar.

El llavero está atado al usuario y equipo de Windows. **Copiar `LemoNotesData` a otro PC no permite descifrarlo**. Para mover notas, exporta Markdown/TXT/JSON o copia las actas legibles.

## Qué sale a la red

- **DeepSeek**, solo cuando usas Limo: se envía el texto de la nota y la petición; **nunca el audio**.
- **DeepSeek** devuelve el acta o la respuesta; se valida y se guarda en local.
- No hay telemetría de la app, ni cuentas, ni sincronización de notas.

La clave de DeepSeek vive en `.env` y se lee en el main. No se pasa al renderer ni se incluye en las exportaciones.

## Copias

- `.lemonote`: copia cifrada con la clave local.
- `backups/actas-legibles`: Markdown legible; cualquiera con acceso al disco puede leerlo.
- Las copias son locales; no se suben a ningún servicio.

## Límites honestos

- Si tu equipo está comprometido o alguien accede a tu sesión de Windows, puede abrir la app y ver las notas.
- La protección de datos en reposo no protege una grabación mientras suena por los altavoces.
- La app no está firmada; Windows puede mostrar SmartScreen.
- Grabar una reunión requiere consentimiento y cumplir la ley y la política de tu organización.
- La nube de DeepSeek tiene sus propias condiciones y retención; revisa su política si el texto es sensible.

## Borrado

Cierra la app y borra `LemoNotesData` para eliminar la libreta local. Haz antes una copia si quieres conservarla. No hay papelera en la nube.
