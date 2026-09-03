import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root=process.cwd()
const config=JSON.parse(await readFile(resolve(root,'src/site/site-config.json'),'utf8'))
const pages=JSON.parse(await readFile(resolve(root,'src/site/page-metadata.json'),'utf8'))
const html=await readFile(resolve(root,'dist/index.html'),'utf8')
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;')
for(const path of ['/webmcp','/hackathon']) {
  const metadata=pages[path], url=new URL(path,config.liveUrl).href
  let page=html.replace(/<title>[^<]*<\/title>/,`<title>${escape(metadata.title)}</title>`)
  const values={'description':metadata.description,'og:title':metadata.title,'og:description':metadata.description,'og:url':url,'twitter:title':metadata.title,'twitter:description':metadata.description}
  for(const [key,value] of Object.entries(values)) page=page.replace(new RegExp(`(<meta (?:name|property)="${key}" content=")[^"]*(")`),(_,before,after)=>before+escape(value)+after)
  page=page.replace(/(<link rel="canonical" href=")[^"]*(")/,(_,before,after)=>before+escape(url)+after)
  const directory=resolve(root,'dist',path.slice(1))
  await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'index.html'),page)
  // Vite resolves extensionless requests through .html; Netlify also supports directory indexes.
  // Both files describe the same canonical route, with no client-side registry or state duplication.
  await writeFile(resolve(root,'dist',`${path.slice(1)}.html`),page)
}
await copyFile(resolve(root,'LICENSE'),resolve(root,'dist/license.txt'))
await mkdir(resolve(root,'dist/docs'),{recursive:true})
await copyFile(resolve(root,'docs/demo-video-script.md'),resolve(root,'dist/docs/demo-video-script.md'))
console.log('Prepared /webmcp and /hackathon metadata, license, and recording script.')
