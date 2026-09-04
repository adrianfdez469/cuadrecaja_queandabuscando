const { PrismaClient } = require('./src/generated/prisma');
const p = new PrismaClient();
(async () => {
  const b = await p.business.findUnique({ where: { externalId: 'aebade50-084b-4988-8d31-14b4e53f7d58' }, select: { id:true, externalId:true, syncTokenHash:true, active:true, name:true } });
  console.log(JSON.stringify(b, null, 2));
})().catch(e => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
