# Recursos de Whisper

Esta carpeta no se versiona porque contiene binarios y modelos grandes.

Para prepararla:

```bash
pnpm setup:whisper base
```

El script descarga el runtime de `whisper.cpp` y `ggml-base.bin` en:

```text
resources/whisper/
resources/models/
```

La release incluye esos archivos para que el usuario final no tenga que descargarlos.

No subas binarios ni modelos al repositorio: `.gitignore` ya los excluye.
