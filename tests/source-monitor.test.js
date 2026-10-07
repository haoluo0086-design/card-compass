import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSource, isOfficialUrl, collectSourceUrls } from '../scripts/check-sources.mjs';
const url='https://www.chase.com/sapphirepreferred/rewardsagreement';
const fetchHtml=async()=>new Response('<title>Terms</title><p>'+ 'Official terms '.repeat(20)+'</p>',{headers:{'content-type':'text/html'}});
test('source monitor handles official PDF agreements',async()=>{
 const fetchImpl=async()=>new Response('%PDF-1.7\n'+ 'document'.repeat(25),{headers:{'content-type':'application/pdf'}});
 const first=await checkSource(url,{}, {fetchImpl});
 assert.equal(first.status,'first-check');assert.equal(first.format,'pdf-bytes');
 const repeat=await checkSource(url,first,{fetchImpl});assert.equal(repeat.status,'unchanged');
 const changed=await checkSource(url,{...first,hash:'older'}, {fetchImpl});assert.equal(changed.status,'changed');assert.equal(changed.needsReview,true);
 const stillPending=await checkSource(url,changed,{fetchImpl});assert.equal(stillPending.needsReview,true);
});
test('source monitor blocks external redirects and spoofed bank domains',async()=>{
 assert.equal(isOfficialUrl('https://www.chase.com.evil.example/'),false);
 assert.equal(isOfficialUrl('https://user:secret@www.chase.com/'),false);
 const result=await checkSource(url,{}, {fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://evil.example/'}})});
 assert.equal(result.status,'unavailable');assert.equal(result.error,'redirect-outside-official-domains');
});
test('temporary source failure keeps last successful facts separate',async()=>{
 const first=await checkSource(url,{}, {fetchImpl:fetchHtml});
 const failed=await checkSource(url,{...first,needsReview:true},{fetchImpl:async()=>{throw Error('secret detail');}});
 assert.equal(failed.status,'unavailable');assert.equal(failed.hash,first.hash);assert.equal(failed.needsReview,true);assert.equal(failed.error,'network-or-fetch-error');
 assert.deepEqual(collectSourceUrls({sources:[{url:url+'#preferred'},{url}]}),[url]);
});
