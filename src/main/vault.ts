import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { promises as fs, createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { safeStorage } from 'electron'

const KEY_FILE = 'vault.key'
const AUDIO_MAGIC = Buffer.from('LEMOAUD1', 'ascii')
const AUDIO_CHUNK = 1024 * 1024

export type Protection = 'dpapi' | 'basic'

interface StoredKey {
  version: 1
  protection: Protection
  payload: string
}

export class Vault {
  private key: Buffer | null = null
  private protection: Protection = 'basic'
  private readonly dir: string

  constructor(userDataDir: string) {
    this.dir = path.join(userDataDir, 'security')
  }

  get protectionMode(): Protection {
    return this.protection
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const keyPath = path.join(this.dir, KEY_FILE)
    try {
      const raw = await fs.readFile(keyPath, 'utf8')
      const stored = JSON.parse(raw) as StoredKey
      if (stored.version !== 1) throw new Error('Versión de llavero no compatible.')
      if (stored.protection === 'dpapi') {
        const encryptedPayload = Buffer.from(stored.payload, 'base64')
        // Electron 45: decryptStringAsync resuelve { result, shouldReEncrypt },
        // no una cadena. La version sincrona devuelve la cadena directamente.
        const decrypted =
          typeof safeStorage.decryptStringAsync === 'function'
            ? (await safeStorage.decryptStringAsync(encryptedPayload)).result
            : safeStorage.decryptString(encryptedPayload)
        this.key = Buffer.from(decrypted, 'hex')
        this.protection = 'dpapi'
      } else {
        this.key = Buffer.from(stored.payload, 'base64')
        this.protection = 'basic'
      }
      if (this.key.length !== 32) throw new Error('El llavero local no es válido.')
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        throw new Error(
          'No he podido abrir el llavero local. Para no perder tus notas, LemoNotes no continuará. Detalle: ' +
            (error instanceof Error ? error.message : String(error))
        )
      }
    }

    this.key = randomBytes(32)
    if (safeStorage.isEncryptionAvailable()) {
      const payload = safeStorage.encryptString(this.key.toString('hex')).toString('base64')
      const stored: StoredKey = { version: 1, protection: 'dpapi', payload }
      await fs.writeFile(keyPath, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 })
      this.protection = 'dpapi'
    } else {
      const stored: StoredKey = {
        version: 1,
        protection: 'basic',
        payload: this.key.toString('base64')
      }
      await fs.writeFile(keyPath, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 })
      this.protection = 'basic'
    }
  }

  private ensureKey(): Buffer {
    if (!this.key) throw new Error('El llavero todavía no está listo.')
    return this.key
  }

  encryptBuffer(value: Buffer): Buffer {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.ensureKey(), iv)
    const ciphertext = Buffer.concat([cipher.update(value), cipher.final()])
    return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext])
  }

  decryptBuffer(value: Buffer): Buffer {
    if (value.length < 30 || value[0] !== 1) throw new Error('Contenido cifrado desconocido.')
    const iv = value.subarray(1, 13)
    const tag = value.subarray(13, 29)
    const ciphertext = value.subarray(29)
    const decipher = createDecipheriv('aes-256-gcm', this.ensureKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  }

  encryptText(value: string): Buffer {
    return this.encryptBuffer(Buffer.from(value, 'utf8'))
  }

  decryptText(value: Buffer | Uint8Array): string {
    return this.decryptBuffer(Buffer.from(value)).toString('utf8')
  }

  encryptJson(value: unknown): Buffer {
    return this.encryptText(JSON.stringify(value))
  }

  decryptJson<T>(value: Buffer | Uint8Array, fallback: T): T {
    try {
      return JSON.parse(this.decryptText(value)) as T
    } catch {
      return fallback
    }
  }

  async encryptFile(source: string, destination: string): Promise<number> {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    const temp = destination + '.part'
    const output = createWriteStream(temp)
    output.write(AUDIO_MAGIC)
    const header = Buffer.alloc(8)
    header.writeUInt32BE(1, 0)
    header.writeUInt32BE(AUDIO_CHUNK, 4)
    output.write(header)
    const input = createReadStream(source, { highWaterMark: AUDIO_CHUNK })
    let bytes = 0
    for await (const raw of input) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', this.ensureKey(), iv)
      const ciphertext = Buffer.concat([cipher.update(chunk), cipher.final()])
      const length = Buffer.alloc(4)
      length.writeUInt32BE(chunk.length, 0)
      output.write(length)
      output.write(iv)
      output.write(cipher.getAuthTag())
      output.write(ciphertext)
      bytes += chunk.length
    }
    await new Promise<void>((resolve, reject) => {
      output.end(() => resolve())
      output.on('error', reject)
    })
    await fs.rename(temp, destination)
    return bytes
  }

  async decryptFile(source: string, destination: string): Promise<void> {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    const data = await fs.readFile(source)
    if (data.length < 16 || !data.subarray(0, 8).equals(AUDIO_MAGIC)) {
      throw new Error('El archivo de audio cifrado no es válido.')
    }
    const chunks: Buffer[] = []
    let offset = 16
    while (offset < data.length) {
      if (offset + 32 > data.length) throw new Error('El audio cifrado está incompleto.')
      const length = data.readUInt32BE(offset)
      offset += 4
      const iv = data.subarray(offset, offset + 12)
      offset += 12
      const tag = data.subarray(offset, offset + 16)
      offset += 16
      const ciphertext = data.subarray(offset, offset + length)
      offset += length
      const decipher = createDecipheriv('aes-256-gcm', this.ensureKey(), iv)
      decipher.setAuthTag(tag)
      chunks.push(decipher.update(ciphertext), decipher.final())
    }
    await fs.writeFile(destination, Buffer.concat(chunks))
  }

  async writeFileAtomic(filePath: string, data: string | Buffer): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const temp = `${filePath}.${process.pid}.tmp`
    await fs.writeFile(temp, data)
    await fs.rename(temp, filePath)
  }

  async copyStream(source: string, destination: string): Promise<void> {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await pipeline(createReadStream(source), createWriteStream(destination))
  }
}
