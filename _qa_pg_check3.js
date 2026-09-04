const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5433/queandabuscando' });
(async () => {
  await c.connect();
  const r = await c.query('select id, "externalId", name, slug, phone, address, city, province, "openingHours", status, "publishedAt" from "Store" where "businessId" = $1', ['0b0486ab-5b42-46ff-9bc3-2b2e2febe652']);
  console.log(JSON.stringify(r.rows, null, 2));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
