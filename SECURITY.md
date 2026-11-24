# Seguridad

## Reportar una vulnerabilidad

Abre un aviso privado al mantenedor del repositorio o usa el correo de contacto del perfil de GitHub. No publiques detalles de una vulnerabilidad sin corregir.

Incluye:

- versión de LemoNotes y Windows;
- pasos para reproducir;
- impacto esperado;
- si afecta a datos, cifrado, IPC, captura de audio o actualización.

## Alcance

- Cifrado en reposo y gestión del llavero.
- Aislamiento del renderer y API de preload.
- Validación de entradas IPC.
- Manejo de archivos importados/exportados.
- Dependencias y cadena de suministro.

## Fuera de alcance

- Saltarse políticas de seguridad de un equipo gestionado.
- Capturar contenido protegido por DRM o por una ventana con protección de captura.
- Recuperar una clave DPAPI copiada a otro usuario/equipo.
- El hecho conocido de que el ejecutable no está firmado.

## Buenas prácticas para usuarios

- No compartas `.env` ni tu clave de DeepSeek.
- No copies `LemoNotesData` entre PCs.
- Mantén Windows y las dependencias actualizadas.
- Haz copias de `LemoNotesData` antes de actualizar.
