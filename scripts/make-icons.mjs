import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const out = path.resolve('build')
fs.mkdirSync(out, { recursive: true })

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="34" y="34" width="956" height="956" rx="224" fill="#DFF3A6" stroke="#F2C318" stroke-width="32"/>
  <ellipse cx="514" cy="764" rx="274" ry="74" fill="#4D6826" opacity="0.14"/>
  <g>
    <path d="M290 536 C292 408 388 330 512 330 C640 330 734 412 734 536 C734 664 646 742 512 742 C380 742 292 662 290 536 Z" fill="#FAD642" stroke="#1B1B18" stroke-width="22"/>
    <path d="M286 514 L210 536 L286 558 Z" fill="#FAD642" stroke="#1B1B18" stroke-width="20" stroke-linejoin="round"/>
    <path d="M738 514 L814 536 L738 558 Z" fill="#FAD642" stroke="#1B1B18" stroke-width="20" stroke-linejoin="round"/>
    <ellipse cx="512" cy="536" rx="178" ry="140" fill="none" stroke="#FFF9D2" stroke-width="16" opacity="0.95"/>
    <g stroke="#FFF9D2" stroke-width="13" opacity="0.9" stroke-linecap="round">
      <path d="M512 536 L616 442"/><path d="M512 536 L664 512"/><path d="M512 536 L636 630"/>
      <path d="M512 536 L512 676"/><path d="M512 536 L388 630"/><path d="M512 536 L360 512"/>
      <path d="M512 536 L388 442"/><path d="M512 536 L458 398"/>
    </g>
    <circle cx="512" cy="536" r="22" fill="#FFF9D2"/>
    <path d="M478 326 C484 284 518 262 552 276 C570 244 626 246 652 282 C684 288 694 330 668 350 C620 378 526 370 478 326 Z" fill="#7DB530" stroke="#1B1B18" stroke-width="17"/>
    <path d="M518 338 C552 316 598 312 636 330" fill="none" stroke="#2D5C20" stroke-width="10" stroke-linecap="round"/>
  </g>
  <g transform="rotate(-4 750 748)">
    <rect x="620" y="614" width="278" height="264" rx="58" fill="#E2463D" stroke="#1B1B18" stroke-width="18"/>
    <circle cx="686" cy="680" r="23" fill="#7C46DB" stroke="#1B1B18" stroke-width="7"/>
    <path d="M682 702 L682 746 M682 746 L714 714 M682 746 L650 714" stroke="#FFF9E7" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M730 666 L844 666 M730 718 L818 718 M730 770 L776 770" stroke="#FFF9E7" stroke-width="18" stroke-linecap="round"/>
    <path d="M742 810 L844 810" stroke="#FFF9E7" stroke-width="12" stroke-linecap="round" opacity="0.65"/>
  </g>
</svg>`

const base = sharp(Buffer.from(svg))
const png1024 = await base.png().toBuffer()
fs.writeFileSync(path.join(out, 'icon.png'), png1024)

const icoSizes = [256, 128, 64, 48, 32, 16]
const icoBuffers = await Promise.all(
  icoSizes.map((size) => sharp(png1024).resize(size, size).png().toBuffer())
)
fs.writeFileSync(path.join(out, 'icon.ico'), await pngToIco(icoBuffers))
await sharp(png1024).resize(64, 64).png().toFile(path.join(out, 'tray.png'))
await sharp(png1024).resize(256, 256).png().toFile(path.join(out, 'icon-256.png'))
console.log('Iconos creados en', out)
