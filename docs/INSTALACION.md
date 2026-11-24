# Instalación y primer arranque

LemoNotes se distribuye como **ZIP portable**. No hay instalador, servicio ni cuenta.

## 1. Descargar

Descarga el ZIP más reciente desde **[Releases](../../releases/latest)**:

```text
LemoNotes-1.0.0-win-x64.zip
```

Comprueba el SHA-256 que acompaña a la release si quieres verificar la descarga.

## 2. Elegir carpeta

Descomprime el ZIP completo en una carpeta del usuario:

```text
C:\Users\<usuario>\Apps\LemoNotes
```

También vale otra ruta con permisos de escritura, por ejemplo `D:\Apps\LemoNotes`.

**No lo instales en `C:\Program Files` ni en `C:\Program Files (x86)`**: LemoNotes crea `LemoNotesData` junto al ejecutable y esas carpetas son de solo lectura para un usuario normal.

No ejecutes el `.exe` desde dentro del ZIP ni muevas solo `LemoNotes.exe`: necesita su carpeta `resources`.

## 3. Abrir

La forma normal es ejecutar:

```text
LemoNotes.exe
```

Es un lanzador pequeño que arranca `LemoNotesCore.exe` con `--no-sandbox`, necesario en equipos donde Panda/WAC inyecta hooks en Chromium.

### Si Windows bloquea el lanzador

En equipos gestionados con **Smart App Control, WDAC o AppLocker**, el lanzador `.NET` puede recibir “Acceso denegado”. El núcleo Electron suele seguir funcionando. Crea un acceso directo:

1. Clic derecho en `LemoNotesCore.exe` → **Crear acceso directo**.
2. Clic derecho en el acceso → **Propiedades**.
3. En **Destino**:

   ```text
   "C:\Users\<usuario>\Apps\LemoNotes\LemoNotesCore.exe" --no-sandbox
   ```

4. En **Iniciar en**:

   ```text
   C:\Users\<usuario>\Apps\LemoNotes
   ```

5. Renómbralo a **LemoNotes** y úsalo.

No abras `LemoNotesCore.exe` sin `--no-sandbox`: en algunos equipos Chromium se cierra al instante.

### SmartScreen y antivirus

El ejecutable no está firmado. SmartScreen puede pedir **Más información → Ejecutar de todas formas**.

Si Panda, WatchGuard u otro antivirus bloquea la carpeta:

- añade la carpeta de LemoNotes a exclusiones;
- o pide a IT que autorice los ejecutables por ruta/hash.

No desactives una política de seguridad del equipo sin autorización.

## 4. Primera ejecución

Se crea:

```text
<Carpeta de LemoNotes>\LemoNotesData
```

Dentro están la base SQLite, el llavero, el audio cifrado, el modelo de Whisper y las copias.

**No borres `LemoNotesData`.** Si actualizas la app, conserva esa carpeta.

## 5. Configurar DeepSeek

Copia `.env.example` como `.env` junto a `LemoNotesCore.exe`:

```env
DEEPSEEK_API_KEY=sk-tu-clave
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Reinicia LemoNotes. En **Ajustes → Limo** debe aparecer “Configurado”.

Sin clave, la app funciona igual para grabar, transcribir, guardar, buscar y exportar. El acta se puede escribir a mano o pedir un borrador local sin IA.

## 6. Grabar una reunión

1. Pulsa **Empezar una reunión**.
2. Elige el micrófono y comprueba el nivel.
3. Deja activado **Audio del equipo** si quieres capturar lo que suena.
4. Elige la pantalla como “llave técnica”. El vídeo no se graba; solo se usa para que Windows entregue el audio.
5. Pulsa **Empezar la reunión** y acepta el aviso de grabación.

El audio del equipo se captura del **dispositivo de salida predeterminado de Windows**. Si la reunión suena por unos cascos distintos, ponlos como predeterminados antes de grabar.

## 7. Actualizar

1. Cierra LemoNotes.
2. Copia `LemoNotesData` a un lugar seguro.
3. Reemplaza los archivos de programa por los de la nueva versión.
4. Deja `LemoNotesData` en su sitio.

No borres la carpeta de datos al reemplazar la app.

## 8. Varios usuarios

Instala una copia por usuario de Windows. Si dos usuarios comparten la misma carpeta, comparten `LemoNotesData` y el llavero del primero no abrirá para el segundo.

No copies `LemoNotesData` entre PCs: el llavero está atado al usuario/equipo. Usa exportaciones Markdown/TXT/JSON o las actas legibles de `backups\actas-legibles`.

## 9. Desinstalar

1. Cierra LemoNotes.
2. Copia `LemoNotesData` si quieres conservar las notas.
3. Borra la carpeta de la aplicación.

No hay entradas en el Registro ni servicios.
