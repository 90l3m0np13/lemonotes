import { promises as fs } from 'node:fs'
import path from 'node:path'
import { dialog, shell } from 'electron'
import type { ExportFormat, SessionDetail } from '../shared/types'
import { renderMarkdown, renderText } from './export-format'

function safeFileName(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Acta sin titulo'
  )
}

export async function exportSession(
  detail: SessionDetail,
  format: ExportFormat
): Promise<{ saved: boolean; filePath?: string }> {
  const extension = format
  const defaultName = `${safeFileName(detail.title) || 'LemoNotes'}.${extension}`
  const result = await dialog.showSaveDialog({
    title: 'Guardar el acta con zumo',
    defaultPath: path.join(
      process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Documents') : '',
      defaultName
    ),
    filters:
      format === 'md'
        ? [{ name: 'Markdown', extensions: ['md'] }]
        : format === 'txt'
          ? [{ name: 'Texto', extensions: ['txt'] }]
          : [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { saved: false }
  let content: string
  if (format === 'md') content = renderMarkdown(detail)
  else if (format === 'txt') content = renderText(detail)
  else content = JSON.stringify(detail, null, 2)
  await fs.writeFile(result.filePath, content, 'utf8')
  shell.showItemInFolder(result.filePath)
  return { saved: true, filePath: result.filePath }
}
