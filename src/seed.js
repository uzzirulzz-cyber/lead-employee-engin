
require('dotenv').config();
const bcrypt=require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma=new PrismaClient();

async function seed(){
  console.log('Seeding PLAYBEAT LEADPULSE v3 to Neon...');
  
  let landing=await prisma.landingPage.findFirst();
  if(!landing){
    landing=await prisma.landingPage.create({ data:{
      logoUrl: '/logo-playbeat.jpeg',
      heroImageUrl: '/landing-reference.jpeg',
      title: 'PLAYBEAT LEADPULSE',
      subtitle: 'YOUR WORLD OF LEAD POSSIBILITIES',
      protected: true
    }});
    console.log('Landing page created', landing.title);
  }

  const existing=await prisma.user.findUnique({ where:{ email:'admin@playbeat.live' }});
  if(!existing){
    const hash=await bcrypt.hash('playbeat1122', 10);
    const superAdmin=await prisma.user.create({ data:{
      email:'admin@playbeat.live',
      passwordHash: hash,
      name: 'Super Admin - Playbeat',
      role: 'SUPER_ADMIN',
      isActive: true
    }});
    console.log('Super Admin created:', superAdmin.email, 'password: playbeat1122');
  } else {
    console.log('Super Admin exists:', existing.email);
    const hash=await bcrypt.hash('playbeat1122', 10);
    await prisma.user.update({ where:{ email:'admin@playbeat.live' }, data:{ passwordHash: hash, role:'SUPER_ADMIN' }});
    console.log('Super Admin password reset to playbeat1122');
  }

  for(let i=1;i<=4;i++){
    const name=`Seat ${['One','Two','Three','Four'][i-1]}`;
    const existingSeat=await prisma.seat.findUnique({ where:{ seatNumber:i }});
    if(!existingSeat){
      await prisma.seat.create({ data:{ seatNumber:i, name, maxLeads:250, status:'AVAILABLE' }});
      console.log(`Created ${name} (Seat ${i}) - Max 250 leads`);
    }
  }

  const demoEmployees=[
    { name:'Employee One', email:'emp1@playbeat.live', seat:1 },
    { name:'Employee Two', email:'emp2@playbeat.live', seat:2 },
    { name:'Employee Three', email:'emp3@playbeat.live', seat:3 },
    { name:'Employee Four', email:'emp4@playbeat.live', seat:4 },
  ];
  for(const emp of demoEmployees){
    const exists=await prisma.user.findUnique({ where:{ email:emp.email }});
    const superAdmin=await prisma.user.findUnique({ where:{ email:'admin@playbeat.live' }});
    if(!exists){
      const hash=await bcrypt.hash('playbeat1122', 10);
      const seat=await prisma.seat.findUnique({ where:{ seatNumber: emp.seat }});
      try{
        const user=await prisma.user.create({ data:{
          email: emp.email,
          passwordHash: hash,
          name: emp.name,
          role: 'EMPLOYEE',
          seatId: seat.id,
          isActive: true,
          createdById: superAdmin?.id
        }});
        console.log(`Created ${emp.name} -> ${emp.email} / playbeat1122 assigned to Seat ${emp.seat}`);
      }catch(e){
        console.log(`Skip ${emp.email}:`, e.message);
      }
    }
  }

  console.log('\n=== PLAYBEAT LEADPULSE v3 SEED COMPLETE ===');
  console.log('Super Admin: admin@playbeat.live / playbeat1122');
  console.log('Neon DB:', process.env.DATABASE_URL?.substring(0,60)+'...');
  console.log('Landing: /landing.html protected by Super Admin');
  console.log('Dashboard: /index.html');
}

seed().catch(e=>{ console.error(e); process.exit(1); }).finally(()=>prisma.$disconnect());
