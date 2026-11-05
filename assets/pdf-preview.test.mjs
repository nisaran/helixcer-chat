import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
function setup(){
 const body={children:[],append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;}};
 const dialog={open:true,classList:{remove(){},toggle(){}}};const revoked=[];let request;
 const context=vm.createContext({AbortController,TextDecoder,Blob,navigator:{pdfViewerEnabled:true},URL:{createObjectURL:()=> 'blob:pdf-test',revokeObjectURL:url=>revoked.push(url)},$:id=>id==='attachmentPreviewBody'?body:dialog,element:(tag,className,text)=>({tag,className,textContent:text}),document:{createElement:tag=>({tag})},fetch:async(url,options)=>{request={url,options};return {ok:true,arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.7\nTest document').buffer};}});
 const start=source.indexOf('  let attachmentPdfRequest ='),end=source.indexOf('  function closeAttachmentPreview()',start);vm.runInContext(source.slice(start,end),context);
 return {body,dialog,context,revoked,get request(){return request;}};
}
test('PDF detection accepts provider MIME and filename while other documents stay unchanged',()=>{
 const h=setup();assert.equal(h.context.isPdfAttachment({mimeType:'application/pdf; charset=binary'}),true);assert.equal(h.context.isPdfAttachment({filename:'Invoice.PDF'}),true);assert.equal(h.context.isPdfAttachment({filename:'Invoice.docx'}),false);
});
test('PDF preview uses an authenticated fetch and a PDF blob with native viewer controls',async()=>{
 const h=setup();await h.context.loadAttachmentPdfPreview('/protected',{},'Invoice.pdf');assert.equal(h.request.options.credentials,'include');assert.equal(h.body.children[0].tag,'iframe');assert.match(h.body.children[0].src,/#toolbar=1&navpanes=1&view=FitH/);
 h.context.cleanupAttachmentPdfPreview();assert.deepEqual(h.revoked,['blob:pdf-test']);assert.equal(h.request.options.signal.aborted,true);
});
test('external documents omit credentials and invalid responses show a download fallback',async()=>{
 const h=setup();h.context.fetch=async(url,options)=>{assert.equal(options.credentials,'omit');return {ok:true,arrayBuffer:async()=>new TextEncoder().encode('<html>Sign in</html>').buffer};};
 await h.context.loadAttachmentPdfPreview('https://example.test/file',{external:true},'Invoice.pdf');assert.match(h.body.children[0].textContent,/valid PDF.*Download/);assert.equal(h.body.children[0].tag,'p');
});
test('closing during PDF load prevents a late response from replacing the next preview',async()=>{
 const h=setup();let resolve;h.context.fetch=()=>new Promise(done=>{resolve=done;});
 const pending=h.context.loadAttachmentPdfPreview('/protected',{},'Invoice.pdf');h.context.cleanupAttachmentPdfPreview();h.body.replaceChildren({tag:'new-preview'});
 resolve({ok:true,arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.7\nTest').buffer});await pending;assert.equal(h.body.children[0].tag,'new-preview');
});
