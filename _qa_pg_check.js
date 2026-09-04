const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5433/queandabuscando' });
(async () => {
  await c.connect();
  const r = await c.query('select id, "externalId", "syncTokenHash", active, name from "Business" where "externalId" = $1', ['aebade50-084b-4988-8d31-14b4e53f7d58']);
  console.log(JSON.stringify(r.rows, null, 2));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
