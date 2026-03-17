import { runPipeline } from '../../src/services/pipeline';

const startDate = process.env.GONG_START_DATE || '2024-07-22';
const endDate = process.env.GONG_END_DATE || new Date().toISOString().slice(0, 10);
const maxCalls = process.env.MAX_CALLS ? parseInt(process.env.MAX_CALLS, 10) : undefined;

async function main() {
  console.log('Sales Research Agent — Ingestion Startup');
  console.log(`  GONG_START_DATE: ${startDate}`);
  console.log(`  GONG_END_DATE:   ${endDate}`);
  if (maxCalls) console.log(`  MAX_CALLS:       ${maxCalls}`);
  console.log('');

  try {
    const stats = await runPipeline(startDate, endDate, maxCalls);

    if (stats.callsFailed > 0) {
      console.error(`\nWarning: ${stats.callsFailed} calls failed during ingestion`);
      process.exit(1);
    }

    console.log('\nIngestion completed successfully.');
  } catch (err) {
    console.error('Fatal pipeline error:', err);
    process.exit(1);
  }
}

main();
