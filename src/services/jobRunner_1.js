
const { PrismaClient } = require('@prisma/client');
const prisma=new PrismaClient();
const EnhancedDiscovery=require('../adapters/enhancedDiscovery');
const Enricher=require('./enricher');
const { fingerprint, canonicalDomain } = require('../lib/fingerprint');
const axios=require('axios');
const BATCH_SIZE=parseInt(process.env.BATCH_SIZE||'50');
const CONCURRENCY=parseInt(process.env.CRAWL_CONCURRENCY||'5');
async function runCampaign(jobId){
  const job=await prisma.job.findUnique({ where:{ id:jobId }, include:{ campaign:true }});
  if(!job) return;
  const campaign=job.campaign;
  try{
    if(job.stage==='DISCOVERY'){
      const discovery=new EnhancedDiscovery();
      const discovered=await discovery.discover(campaign);
      for(const d of discovered){ await prisma.discoverySource.create({ data:{ campaignId:campaign.id, source:d.source, sourceUrl:d.url, query:d.query }}); }
      await prisma.campaign.update({ where:{ id:campaign.id }, data:{ discovered:discovered.length, status:'FETCHING', currentStage:'FETCHING' }});
      await prisma.job.update({ where:{ id:jobId }, data:{ stage:'FETCHING', batchIndex:0 }});
      return runCampaign(jobId);
    }
    if(['FETCHING','ENRICHING','VALIDATING'].includes(job.stage)){
      const enricher=new Enricher();
      const sources=await prisma.discoverySource.findMany({ where:{ campaignId:campaign.id, processed:false }, take:BATCH_SIZE });
      if(sources.length===0){
        const total=await prisma.lead.count({ where:{ campaignId:campaign.id }});
        if(total >= campaign.targetCount){
          await prisma.campaign.update({ where:{ id:campaign.id }, data:{ status:'COMPLETED', currentStage:'COMPLETED', progress:total }});
          await prisma.job.update({ where:{ id:jobId }, data:{ status:'COMPLETED', stage:'COMPLETED' }});
          return;
        }
        await prisma.campaign.update({ where:{ id:campaign.id }, data:{ status:'SOURCE_EXHAUSTED', currentStage:'SOURCE_EXHAUSTED', progress:total }});
        await prisma.job.update({ where:{ id:jobId }, data:{ status:'COMPLETED' }});
        return;
      }
      const pLimit=(await import('p-limit')).default;
      const limit=pLimit(CONCURRENCY);
      let batchValid=0, batchDup=0;
      await Promise.all(sources.map(src=> limit(async ()=>{
        try{
          const res=await axios.get(src.sourceUrl,{ headers:{ 'User-Agent':'LeadForgeBot/2.0' }, timeout:12000 });
          const enriched=await enricher.enrichFromContactPages(src.sourceUrl, res.data, campaign);
          const emailsToProcess = enriched.emails.length>0 ? enriched.emails : [null];
          for(const email of emailsToProcess){
            const domain=canonicalDomain(src.sourceUrl);
            const fp=fingerprint({ email, phone: enriched.phones[0], domain, company: enriched.companyName });
            const exists=await prisma.lead.findUnique({ where:{ fingerprint:fp }});
            if(exists){ await prisma.lead.update({ where:{ id:exists.id }, data:{ lastSeen:new Date(), sourceCount:{ increment:1 } }}); batchDup++; continue; }
            let emailStatus='UNKNOWN', confidence=0;
            if(email){ const { validateEmail }=require('../lib/validators'); const v=validateEmail(email); emailStatus=v.status; confidence=v.confidence; }
            const { scoreLead } = require('../lib/extractors');
            const leadData={
              campaignId:campaign.id, companyName: enriched.companyName, industry: campaign.industry, category: campaign.industry, website: src.sourceUrl, domain, email, emailStatus, emailConfidence: confidence,
              phoneRaw: enriched.phones[0]||null, phoneNormalized: enriched.phones[0]||null, whatsappRaw: enriched.whatsapp.numbers[0]||null, whatsappNormalized: enriched.whatsapp.numbers[0]||null,
              whatsappDetected: enriched.whatsapp.links.length>0 || enriched.whatsapp.numbers.length>0, whatsappUrl: enriched.whatsapp.links[0]||null, whatsappSourceUrl: src.sourceUrl,
              country: campaign.country, city: campaign.city, linkedinUrl: enriched.social.linkedin, facebookUrl: enriched.social.facebook, instagramUrl: enriched.social.instagram, source: src.source, sourceUrl: src.sourceUrl, sourceCount:1, fingerprint:fp
            };
            leadData.leadScore=scoreLead(leadData);
            await prisma.lead.create({ data: leadData }); batchValid++;
          }
          await prisma.discoverySource.update({ where:{ id:src.id }, data:{ processed:true, enriched:true }});
        }catch(e){ await prisma.discoverySource.update({ where:{ id:src.id }, data:{ processed:true }}); }
      })));
      const total=await prisma.lead.count({ where:{ campaignId:campaign.id }});
      await prisma.campaign.update({ where:{ id:campaign.id }, data:{ progress:total, extracted:{ increment: batchValid }, valid:{ increment: batchValid }, duplicates:{ increment: batchDup }, enriched:{ increment: batchValid }, currentStage:`ENRICHING batch ${job.batchIndex+1} - ${total}/${campaign.targetCount}` }});
      await prisma.job.update({ where:{ id:jobId }, data:{ batchIndex:{ increment:1 } }});
      if(total < campaign.targetCount){ setTimeout(()=>runCampaign(jobId), 800); } else { await prisma.campaign.update({ where:{ id:campaign.id }, data:{ status:'COMPLETED', currentStage:'COMPLETED' }}); await prisma.job.update({ where:{ id:jobId }, data:{ status:'COMPLETED' }}); }
    }
  }catch(err){ await prisma.job.update({ where:{ id:jobId }, data:{ status:'FAILED', error:String(err) }}); await prisma.campaign.update({ where:{ id:campaign.id }, data:{ status:'FAILED' }}); }
}
module.exports={ runCampaign };
