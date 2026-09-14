
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendEmail, renderTemplate } = require('./emailService');
async function enrollLeads({ sequenceId, leadIds }){
  const seq = await prisma.sequence.findUnique({ where:{ id: sequenceId }, include:{ steps:{ orderBy:{ stepIndex:'asc' }} }});
  if(!seq) throw new Error('Sequence not found');
  let enrolled=0;
  for(const leadId of leadIds){
    const exists = await prisma.sequenceEnrollment.findUnique({ where:{ sequenceId_leadId: { sequenceId, leadId } }});
    if(exists) continue;
    const firstStep = seq.steps[0];
    const nextSendAt = new Date();
    if(firstStep.delayDays || firstStep.delayHours){ nextSendAt.setDate(nextSendAt.getDate() + (firstStep.delayDays||0)); nextSendAt.setHours(nextSendAt.getHours() + (firstStep.delayHours||0)); }
    await prisma.sequenceEnrollment.create({ data:{ sequenceId, leadId, currentStep:0, nextSendAt, status:'ACTIVE' }});
    enrolled++;
  }
  await prisma.sequence.update({ where:{ id: sequenceId }, data:{ totalEnrolled:{ increment: enrolled }}});
  return { enrolled };
}
async function processDueSequences(){
  const now = new Date();
  const due = await prisma.sequenceEnrollment.findMany({ where:{ status:'ACTIVE', nextSendAt:{ lte: now } }, include:{ sequence:{ include:{ steps:{ orderBy:{ stepIndex:'asc' }} }}, lead:true }, take: 50 });
  for(const enrollment of due){
    const { sequence, lead } = enrollment;
    if(lead.unsubscribed || lead.bounced){ await prisma.sequenceEnrollment.update({ where:{ id: enrollment.id }, data:{ status:'COMPLETED' }}); continue; }
    const step = sequence.steps.find(s=>s.stepIndex===enrollment.currentStep);
    if(!step){ await prisma.sequenceEnrollment.update({ where:{ id: enrollment.id }, data:{ status:'COMPLETED' }}); await prisma.sequence.update({ where:{ id: sequence.id }, data:{ totalCompleted:{ increment:1 }}}); continue; }
    const { checkWarmupLimit, incrementWarmup } = require('./warmupService');
    const canSend = await checkWarmupLimit();
    if(!canSend.allowed) continue;
    try{
      if(step.channel==='EMAIL'){
        if(!lead.email) throw new Error('No email');
        const subject = renderTemplate(step.subject||'Follow up', lead);
        const body = renderTemplate(step.body||'Hi {{companyName}}', lead);
        await sendEmail({ to: lead.email, subject, body, lead });
        await prisma.outreachLog.create({ data:{ leadId: lead.id, campaignId: sequence.campaignId, sequenceId: sequence.id, channel:'EMAIL', stepIndex: step.stepIndex, subject, message: body, status:'SENT', sentAt: new Date() }});
        await incrementWarmup();
      }
      const nextStepIndex = enrollment.currentStep + 1;
      const nextStep = sequence.steps.find(s=>s.stepIndex===nextStepIndex);
      if(nextStep){
        const nextSendAt = new Date(); nextSendAt.setDate(nextSendAt.getDate() + (nextStep.delayDays||0)); nextSendAt.setHours(nextSendAt.getHours() + (nextStep.delayHours||0));
        await prisma.sequenceEnrollment.update({ where:{ id: enrollment.id }, data:{ currentStep: nextStepIndex, nextSendAt }});
      } else {
        await prisma.sequenceEnrollment.update({ where:{ id: enrollment.id }, data:{ status:'COMPLETED', nextSendAt: null }});
        await prisma.sequence.update({ where:{ id: sequence.id }, data:{ totalCompleted:{ increment:1 }}});
      }
      await new Promise(r=>setTimeout(r, 1200));
    }catch(e){
      await prisma.outreachLog.create({ data:{ leadId: lead.id, campaignId: sequence.campaignId, sequenceId: sequence.id, channel: step.channel, stepIndex: step.stepIndex, status:'FAILED', error: String(e.message) }});
      const retryAt = new Date(); retryAt.setHours(retryAt.getHours()+2);
      await prisma.sequenceEnrollment.update({ where:{ id: enrollment.id }, data:{ nextSendAt: retryAt }});
    }
  }
}
module.exports={ enrollLeads, processDueSequences };
