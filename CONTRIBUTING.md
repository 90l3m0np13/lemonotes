# Contribuir

Gracias por el interés.

## Antes de abrir un issue

- Comprueba [docs/PROBLEMAS.md](docs/PROBLEMAS.md).
- Indica versión de Windows, versión de LemoNotes y si usas el lanzador o el acceso directo al núcleo.
- No adjuntes `.env`, claves de API, `LemoNotesData` ni notas personales.

## Pull requests

1. Haz un fork y una rama descriptiva.
2. Mantén el estilo y los tipos existentes.
3. Ejecuta:

   ```bash
   pnpm typecheck
   pnpm test
   ```

4. Si cambias la captura de audio, prueba micrófono y loopback del sistema en Windows.
5. No incluyas binarios, modelos, datos de usuario ni secretos.
6. Explica el cambio y cómo lo has probado.

## Código de conducta

Sé respetuoso. Este es un proyecto pequeño; las críticas técnicas son bienvenidas, los ataques personales no.

## Licencia

Al contribuir aceptas que tu aportación se publique bajo la licencia MIT del proyecto.
